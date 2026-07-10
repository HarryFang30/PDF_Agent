"""Model provider configuration storage and normalization."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from pdf_agent.auth.openai_oauth import atomic_write_secret, default_data_dir
from pdf_agent.server.constants import (
    GPT_56_MODELS,
    MODEL_GPT_54,
    MODEL_GPT_54_MINI,
    MODEL_GPT_55,
    MODEL_GPT_56_LUNA,
    MODEL_GPT_56_SOL,
    MODEL_GPT_56_TERRA,
)
from pdf_agent.server.errors import HttpError
from pdf_agent.server.json_utils import json_dumps_utf8_safe
from pdf_agent.server.provider_catalog import catalog_provider_defaults, catalog_versions
from pdf_agent.server.value_utils import string_value


MODEL_CONFIG_VERSION = 2
DEFAULT_CODEX_PROVIDER_ID = "codex_oauth"
DEFAULT_MODEL_CONFIG_PATH = default_data_dir() / "model_providers.json"
MODEL_REF_KEYS = frozenset({"assistant", "teachingFast", "teachingBalanced", "teachingQuality"})
LEGACY_PROVIDER_ID_ALIASES = {
    "openai_api": "openai",
    "siliconflow": "silicon",
}
LEGACY_PROVIDER_DEFAULT_NAMES = {
    "openai_api": "OpenAI API Key",
    "siliconflow": "SiliconFlow",
}
PROVIDER_TYPES = frozenset(
    {
        "codex-oauth",
        "openai-compatible",
        "openai-chat-completions",
        "openai-responses",
        "anthropic-messages",
        "google-generate-content",
        "ollama-chat",
    }
)


def default_model_config() -> dict[str, Any]:
    providers = [
        {
            "id": DEFAULT_CODEX_PROVIDER_ID,
            "name": "OpenAI OAuth",
            "description": "ChatGPT/Codex OAuth gateway for the bundled SynchroPage backend.",
            "type": "codex-oauth",
            "defaultChatEndpoint": "codex-oauth",
            "endpointConfigs": {
                "codex-oauth": {
                    "baseUrl": "https://chatgpt.com/backend-api/codex/",
                    "adapterFamily": "codex",
                }
            },
            "apiHost": "https://chatgpt.com/backend-api/codex/",
            "apiKeyRequired": False,
            "enabled": True,
            "models": [*GPT_56_MODELS, MODEL_GPT_55, MODEL_GPT_54, MODEL_GPT_54_MINI],
            "websites": {
                "official": "https://chatgpt.com/",
            },
        },
        *catalog_provider_defaults(),
    ]
    return {
        "version": MODEL_CONFIG_VERSION,
        "catalog": {"source": "cherry-studio", "versions": catalog_versions()},
        "selectedProviderId": DEFAULT_CODEX_PROVIDER_ID,
        "providers": providers,
        "defaults": {
            "assistant": {"providerId": DEFAULT_CODEX_PROVIDER_ID, "model": MODEL_GPT_56_SOL},
            "teachingFast": {"providerId": DEFAULT_CODEX_PROVIDER_ID, "model": MODEL_GPT_56_LUNA},
            "teachingBalanced": {"providerId": DEFAULT_CODEX_PROVIDER_ID, "model": MODEL_GPT_56_TERRA},
            "teachingQuality": {"providerId": DEFAULT_CODEX_PROVIDER_ID, "model": MODEL_GPT_56_SOL},
        },
    }


class ModelConfigStore:
    def __init__(self, path: Path | str | None = None) -> None:
        self.path = Path(path) if path is not None else DEFAULT_MODEL_CONFIG_PATH

    def load_private(self) -> dict[str, Any]:
        if not self.path.exists():
            return normalize_model_config(default_model_config())
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise HttpError(500, f"Unable to load model provider config: {exc}", code="model_config_load_failed") from exc
        return normalize_model_config(raw)

    def load_public(self) -> dict[str, Any]:
        return public_model_config(self.load_private())

    def save(self, value: Mapping[str, Any]) -> dict[str, Any]:
        current = self.load_private()
        normalized = normalize_model_config(value, existing=current)
        serialized = json_dumps_utf8_safe(normalized, ensure_ascii=False, indent=2)
        atomic_write_secret(self.path, serialized + "\n")
        return public_model_config(normalized)


def public_model_config(config: Mapping[str, Any]) -> dict[str, Any]:
    normalized = normalize_model_config(config)
    providers: list[dict[str, Any]] = []
    for provider in normalized["providers"]:
        public_provider = {key: value for key, value in provider.items() if key != "apiKey"}
        public_provider["hasApiKey"] = bool(provider.get("apiKey"))
        providers.append(public_provider)
    return {
        "version": normalized["version"],
        "catalog": normalized.get("catalog", {}),
        "selectedProviderId": normalized["selectedProviderId"],
        "providers": providers,
        "defaults": normalized["defaults"],
    }


def normalize_model_config(value: Mapping[str, Any] | None, *, existing: Mapping[str, Any] | None = None) -> dict[str, Any]:
    source = _migrate_model_config(value if isinstance(value, Mapping) else {})
    fallback = default_model_config()
    existing_providers = {
        _canonical_provider_id(provider.get("id")): provider
        for provider in (existing or {}).get("providers", [])
        if isinstance(provider, Mapping) and provider.get("id")
    }

    raw_providers = source.get("providers")
    fallback_providers_by_id = {
        str(provider.get("id")): provider
        for provider in fallback["providers"]
        if isinstance(provider, Mapping) and provider.get("id")
    }
    if not isinstance(raw_providers, list):
        raw_providers = fallback["providers"]
    else:
        merged_raw_providers: dict[str, Mapping[str, Any]] = {}
        raw_provider_ids: set[str] = set()
        for provider in raw_providers:
            if not isinstance(provider, Mapping):
                continue
            migrated = _migrate_legacy_provider(provider, fallback_providers_by_id)
            provider_id = _canonical_provider_id(migrated.get("id"))
            if not provider_id:
                continue
            raw_provider_ids.add(provider_id)
            merged = _merge_provider_with_catalog_defaults(migrated, fallback_providers_by_id.get(provider_id))
            if provider_id in merged_raw_providers:
                merged = _merge_duplicate_provider(merged_raw_providers[provider_id], merged)
            merged_raw_providers[provider_id] = merged
        raw_providers = [
            *merged_raw_providers.values(),
            *[
                provider
                for provider in fallback["providers"]
                if isinstance(provider, Mapping) and provider.get("id") not in raw_provider_ids
            ],
        ]
    providers: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw_provider in enumerate(raw_providers):
        if not isinstance(raw_provider, Mapping):
            continue
        provider = _normalize_provider(raw_provider, existing=existing_providers.get(_canonical_provider_id(raw_provider.get("id"))), index=index)
        if provider["id"] in seen:
            provider["id"] = _unique_provider_id(provider["id"], seen)
        seen.add(provider["id"])
        providers.append(provider)
    if not providers:
        providers = list(fallback["providers"])

    providers_by_id = {provider["id"]: provider for provider in providers}
    selected_provider_id = _canonical_provider_id(source.get("selectedProviderId")) or _canonical_provider_id(
        (existing or {}).get("selectedProviderId"), DEFAULT_CODEX_PROVIDER_ID
    )
    if selected_provider_id not in providers_by_id:
        selected_provider_id = providers[0]["id"]

    defaults = _normalize_defaults(source.get("defaults"), providers_by_id, selected_provider_id)
    return {
        "version": MODEL_CONFIG_VERSION,
        "catalog": {"source": "cherry-studio", "versions": catalog_versions()},
        "selectedProviderId": selected_provider_id,
        "providers": providers,
        "defaults": defaults,
    }


def _migrate_model_config(source: Mapping[str, Any]) -> Mapping[str, Any]:
    """Upgrade untouched v1 built-in role defaults to the GPT-5.6 family.

    Custom provider/model references are intentionally left unchanged.
    """
    raw_version = source.get("version")
    try:
        version = int(raw_version)
    except (TypeError, ValueError):
        version = 1
    if version >= MODEL_CONFIG_VERSION:
        return source

    raw_defaults = source.get("defaults")
    if not isinstance(raw_defaults, Mapping):
        return source

    replacements = {
        "assistant": ({MODEL_GPT_55}, MODEL_GPT_56_SOL),
        # Early v1 normalization could collapse missing role defaults to the
        # provider's first model (then GPT-5.5). Treat that known artifact as
        # an untouched built-in value too.
        "teachingFast": ({MODEL_GPT_54_MINI, MODEL_GPT_55}, MODEL_GPT_56_LUNA),
        "teachingBalanced": ({MODEL_GPT_54, MODEL_GPT_55}, MODEL_GPT_56_TERRA),
        "teachingQuality": ({MODEL_GPT_55}, MODEL_GPT_56_SOL),
    }
    migrated_defaults = dict(raw_defaults)
    changed = False
    for key, (old_models, new_model) in replacements.items():
        raw_ref = raw_defaults.get(key)
        if not isinstance(raw_ref, Mapping):
            continue
        provider_id = _canonical_provider_id(raw_ref.get("providerId"))
        model = string_value(raw_ref.get("model"), "")
        if provider_id != DEFAULT_CODEX_PROVIDER_ID or model not in old_models:
            continue
        migrated_defaults[key] = {**dict(raw_ref), "model": new_model}
        changed = True
    if not changed:
        return source
    return {**dict(source), "defaults": migrated_defaults}


def _normalize_provider(raw: Mapping[str, Any], *, existing: Mapping[str, Any] | None, index: int) -> dict[str, Any]:
    provider_id = _canonical_provider_id(raw.get("id")) or f"provider_{index + 1}"
    provider_type = string_value(raw.get("type"), "openai-chat-completions")
    if provider_type == "openai-compatible":
        provider_type = "openai-chat-completions"
    if provider_type not in PROVIDER_TYPES:
        provider_type = "openai-chat-completions"
    name = string_value(raw.get("name"), provider_id.replace("_", " ").title())
    endpoint_configs = _normalize_endpoint_configs(raw.get("endpointConfigs"))
    if not endpoint_configs and existing:
        endpoint_configs = _normalize_endpoint_configs(existing.get("endpointConfigs"))
    default_endpoint = string_value(raw.get("defaultChatEndpoint"), "") or string_value(
        (existing or {}).get("defaultChatEndpoint"), provider_type
    )
    if default_endpoint == "openai-compatible":
        default_endpoint = "openai-chat-completions"
    if default_endpoint not in PROVIDER_TYPES and default_endpoint not in endpoint_configs:
        default_endpoint = provider_type
    if provider_type == "codex-oauth":
        default_endpoint = "codex-oauth"
    if (
        provider_type == "openai-chat-completions"
        and default_endpoint in {"anthropic-messages", "google-generate-content", "ollama-chat"}
    ):
        provider_type = default_endpoint
    api_host = string_value(raw.get("apiHost"), "")
    if not api_host:
        api_host = (
            string_value(raw.get("baseUrl"), "")
            or _endpoint_base_url(endpoint_configs, default_endpoint)
            or string_value((existing or {}).get("apiHost"), "")
        )
    api_key = raw.get("apiKey")
    if isinstance(api_key, str) and api_key.strip():
        normalized_api_key = api_key.strip()
    elif existing and isinstance(existing.get("apiKey"), str) and existing.get("apiKey"):
        normalized_api_key = str(existing["apiKey"])
    else:
        normalized_api_key = ""
    models = _normalize_models(raw.get("models"))
    if not models and existing:
        models = _normalize_models(existing.get("models"))
    api_key_required = raw.get("apiKeyRequired")
    websites = raw.get("websites") if isinstance(raw.get("websites"), Mapping) else (existing or {}).get("websites")
    api_features = raw.get("apiFeatures") if isinstance(raw.get("apiFeatures"), Mapping) else (existing or {}).get("apiFeatures")
    catalog = raw.get("catalog") if isinstance(raw.get("catalog"), Mapping) else (existing or {}).get("catalog")
    return {
        "id": provider_id,
        "name": name,
        "description": string_value(raw.get("description"), string_value((existing or {}).get("description"), "")),
        "presetProviderId": string_value(raw.get("presetProviderId"), string_value((existing or {}).get("presetProviderId"), provider_id)),
        "type": provider_type,
        "defaultChatEndpoint": default_endpoint,
        "endpointConfigs": endpoint_configs,
        "apiHost": api_host,
        "apiKey": normalized_api_key,
        "apiKeyRequired": bool(api_key_required) if api_key_required is not None else _default_api_key_required(provider_id, provider_type),
        "enabled": bool(raw.get("enabled")) if raw.get("enabled") is not None else provider_type == "codex-oauth",
        "models": models,
        "websites": dict(websites) if isinstance(websites, Mapping) else {},
        "apiFeatures": dict(api_features) if isinstance(api_features, Mapping) else {},
        "catalog": dict(catalog) if isinstance(catalog, Mapping) else {},
    }


def _merge_provider_with_catalog_defaults(raw: Mapping[str, Any], fallback: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if not fallback:
        return raw
    merged: dict[str, Any] = {**dict(fallback), **dict(raw)}
    fallback_endpoints = fallback.get("endpointConfigs")
    raw_endpoints = raw.get("endpointConfigs")
    if isinstance(fallback_endpoints, Mapping) or isinstance(raw_endpoints, Mapping):
        merged["endpointConfigs"] = {
            **(dict(fallback_endpoints) if isinstance(fallback_endpoints, Mapping) else {}),
            **(dict(raw_endpoints) if isinstance(raw_endpoints, Mapping) else {}),
        }
    merged["models"] = _merge_model_lists(raw.get("models"), fallback.get("models"))
    for key in ("websites", "apiFeatures", "catalog", "description", "presetProviderId"):
        if not raw.get(key) and fallback.get(key):
            merged[key] = fallback[key]
    return merged


def _migrate_legacy_provider(raw: Mapping[str, Any], fallback_providers_by_id: Mapping[str, Mapping[str, Any]]) -> Mapping[str, Any]:
    original_id = _clean_provider_id(raw.get("id"))
    provider_id = _canonical_provider_id(original_id)
    if not original_id or provider_id == original_id:
        return raw
    migrated = dict(raw)
    migrated["id"] = provider_id
    migrated.setdefault("presetProviderId", original_id)
    fallback = fallback_providers_by_id.get(provider_id)
    if fallback and string_value(raw.get("name"), "") == LEGACY_PROVIDER_DEFAULT_NAMES.get(original_id):
        migrated.pop("name", None)
    return migrated


def _merge_duplicate_provider(primary: Mapping[str, Any], secondary: Mapping[str, Any]) -> Mapping[str, Any]:
    merged: dict[str, Any] = {**dict(primary), **dict(secondary)}
    if not secondary.get("apiKey") and primary.get("apiKey"):
        merged["apiKey"] = primary["apiKey"]
    if primary.get("enabled") is True or secondary.get("enabled") is True:
        merged["enabled"] = True
    merged["models"] = _merge_model_lists(secondary.get("models"), primary.get("models"))
    for key in ("endpointConfigs", "websites", "apiFeatures", "catalog"):
        primary_value = primary.get(key)
        secondary_value = secondary.get(key)
        if isinstance(primary_value, Mapping) or isinstance(secondary_value, Mapping):
            merged[key] = {
                **(dict(primary_value) if isinstance(primary_value, Mapping) else {}),
                **(dict(secondary_value) if isinstance(secondary_value, Mapping) else {}),
            }
    return merged


def _merge_model_lists(primary: Any, secondary: Any) -> list[str]:
    models: list[str] = []
    seen: set[str] = set()
    for source in (primary, secondary):
        for model in _normalize_models(source):
            if model in seen:
                continue
            seen.add(model)
            models.append(model)
    return models


def _normalize_defaults(value: Any, providers_by_id: Mapping[str, Mapping[str, Any]], selected_provider_id: str) -> dict[str, dict[str, str]]:
    raw_defaults = value if isinstance(value, Mapping) else {}
    fallback = default_model_config()["defaults"]
    normalized: dict[str, dict[str, str]] = {}
    for key in MODEL_REF_KEYS:
        raw_ref = raw_defaults.get(key)
        fallback_ref = fallback.get(key, {"providerId": selected_provider_id, "model": ""})
        provider_id = selected_provider_id
        model = ""
        if isinstance(raw_ref, Mapping):
            provider_id = _canonical_provider_id(raw_ref.get("providerId")) or selected_provider_id
            model = string_value(raw_ref.get("model"), "")
        if provider_id not in providers_by_id:
            provider_id = _canonical_provider_id(fallback_ref.get("providerId")) or selected_provider_id
        if provider_id not in providers_by_id:
            provider_id = selected_provider_id
        if not model:
            provider = providers_by_id.get(provider_id) or {}
            models = provider.get("models")
            fallback_model = string_value(fallback_ref.get("model"), "")
            model = fallback_model
            if isinstance(models, list) and models and fallback_model not in models:
                model = string_value(models[0], fallback_model)
        normalized[key] = {"providerId": provider_id, "model": model}
    return normalized


def _normalize_models(value: Any) -> list[str]:
    if isinstance(value, str):
        values = re.split(r"[\n,]+", value)
    elif isinstance(value, list):
        values = value
    else:
        return []
    models: list[str] = []
    seen: set[str] = set()
    for item in values:
        model = string_value(item, "")
        if not model or model in seen:
            continue
        seen.add(model)
        models.append(model)
    return models


def _normalize_endpoint_configs(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, Mapping):
        return {}
    configs: dict[str, dict[str, Any]] = {}
    for raw_key, raw_config in value.items():
        endpoint_type = string_value(raw_key, "")
        if not endpoint_type:
            continue
        if endpoint_type == "openai-compatible":
            endpoint_type = "openai-chat-completions"
        if not isinstance(raw_config, Mapping):
            continue
        config: dict[str, Any] = {}
        base_url = string_value(raw_config.get("baseUrl"), "")
        if base_url:
            config["baseUrl"] = base_url
        models_api_urls = raw_config.get("modelsApiUrls")
        if isinstance(models_api_urls, Mapping):
            config["modelsApiUrls"] = {
                string_value(key, ""): url
                for key, raw_url in models_api_urls.items()
                if string_value(key, "") and (url := string_value(raw_url, ""))
            }
        reasoning_format_type = string_value(raw_config.get("reasoningFormatType"), "")
        if reasoning_format_type:
            config["reasoningFormatType"] = reasoning_format_type
        adapter_family = string_value(raw_config.get("adapterFamily"), "")
        if adapter_family:
            config["adapterFamily"] = adapter_family
        configs[endpoint_type] = config
    return configs


def _endpoint_base_url(endpoint_configs: Mapping[str, Mapping[str, Any]], endpoint_type: str) -> str:
    config = endpoint_configs.get(endpoint_type)
    if isinstance(config, Mapping):
        return string_value(config.get("baseUrl"), "")
    return ""


def _default_api_key_required(provider_id: str, provider_type: str) -> bool:
    if provider_type == "codex-oauth":
        return False
    if provider_type == "ollama-chat" or provider_id in {"ollama", "lmstudio", "ovms"}:
        return False
    return True


def _clean_provider_id(value: Any) -> str:
    text = string_value(value, "")
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", text).strip("_")
    return cleaned[:48]


def _canonical_provider_id(value: Any, fallback: str = "") -> str:
    provider_id = _clean_provider_id(value) or fallback
    return LEGACY_PROVIDER_ID_ALIASES.get(provider_id, provider_id)


def _unique_provider_id(provider_id: str, seen: set[str]) -> str:
    index = 2
    while f"{provider_id}_{index}" in seen:
        index += 1
    return f"{provider_id}_{index}"


def provider_by_id(config: Mapping[str, Any], provider_id: str) -> Mapping[str, Any] | None:
    canonical_provider_id = _canonical_provider_id(provider_id)
    for provider in config.get("providers", []):
        if isinstance(provider, Mapping) and provider.get("id") in {provider_id, canonical_provider_id}:
            return provider
    return None


def resolve_model_ref(
    config: Mapping[str, Any],
    body: Mapping[str, Any],
    *,
    default_key: str,
    legacy_model: str,
) -> dict[str, str]:
    defaults = config.get("defaults") if isinstance(config.get("defaults"), Mapping) else {}
    default_ref = defaults.get(default_key) if isinstance(defaults.get(default_key), Mapping) else {}
    selected_provider_id = string_value(config.get("selectedProviderId"), DEFAULT_CODEX_PROVIDER_ID)
    provider_id = _canonical_provider_id(body.get("modelProviderId")) or _canonical_provider_id(default_ref.get("providerId")) or selected_provider_id
    model = string_value(body.get("model"), "") or string_value(default_ref.get("model"), legacy_model)
    if not provider_by_id(config, provider_id):
        provider_id = selected_provider_id
    return {"providerId": provider_id, "model": model or legacy_model}
