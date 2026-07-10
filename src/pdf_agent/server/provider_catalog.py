"""Cherry Studio style provider/model catalog helpers."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from typing import Any

from pdf_agent.server.value_utils import string_value


CATALOG_PACKAGE = "pdf_agent.provider_registry"
PROVIDERS_RESOURCE = "providers.json"
MODELS_RESOURCE = "models.json"
PROVIDER_MODELS_RESOURCE = "provider-models.json"

CHAT_ENDPOINTS = frozenset(
    {
        "openai-chat-completions",
        "openai-responses",
        "anthropic-messages",
        "google-generate-content",
        "ollama-chat",
    }
)
FALLBACK_PROVIDER_MODELS: dict[str, list[str]] = {
    "openai": [
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.6",
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-4.1",
        "gpt-4.1-mini",
        "gpt-4o",
        "gpt-4o-mini",
    ],
    "anthropic": ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
    "gemini": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    "grok": ["grok-4", "grok-3", "grok-3-mini"],
    "groq": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
    "ollama": ["llama3.1", "qwen2.5"],
}


@lru_cache(maxsize=1)
def provider_registry() -> dict[str, Any]:
    return _load_json(PROVIDERS_RESOURCE)


@lru_cache(maxsize=1)
def model_registry() -> dict[str, Any]:
    return _load_json(MODELS_RESOURCE)


@lru_cache(maxsize=1)
def provider_model_registry() -> dict[str, Any]:
    return _load_json(PROVIDER_MODELS_RESOURCE)


@lru_cache(maxsize=1)
def catalog_providers_by_id() -> dict[str, dict[str, Any]]:
    return {
        string_value(provider.get("id"), ""): provider
        for provider in provider_registry().get("providers", [])
        if isinstance(provider, dict) and string_value(provider.get("id"), "")
    }


@lru_cache(maxsize=1)
def catalog_models_by_id() -> dict[str, dict[str, Any]]:
    return {
        string_value(model.get("id"), ""): model
        for model in model_registry().get("models", [])
        if isinstance(model, dict) and string_value(model.get("id"), "")
    }


@lru_cache(maxsize=1)
def catalog_overrides_by_provider() -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for override in provider_model_registry().get("overrides", []):
        if not isinstance(override, dict):
            continue
        provider_id = string_value(override.get("providerId"), "")
        if not provider_id or override.get("disabled") is True:
            continue
        grouped.setdefault(provider_id, []).append(override)
    return grouped


def catalog_versions() -> dict[str, str]:
    return {
        "providers": string_value(provider_registry().get("version"), ""),
        "models": string_value(model_registry().get("version"), ""),
        "providerModels": string_value(provider_model_registry().get("version"), ""),
    }


def catalog_provider_defaults() -> list[dict[str, Any]]:
    providers: list[dict[str, Any]] = []
    for provider in provider_registry().get("providers", []):
        if not isinstance(provider, dict):
            continue
        normalized = provider_to_config_provider(provider)
        if normalized is not None:
            providers.append(normalized)
    return providers


def provider_to_config_provider(provider: dict[str, Any]) -> dict[str, Any] | None:
    provider_id = string_value(provider.get("id"), "")
    if not provider_id:
        return None
    endpoint_configs = _clean_endpoint_configs(provider.get("endpointConfigs"))
    default_endpoint = _default_chat_endpoint(provider, endpoint_configs)
    if not default_endpoint:
        return None
    api_host = _endpoint_base_url(endpoint_configs, default_endpoint)
    website = provider.get("metadata", {}).get("website") if isinstance(provider.get("metadata"), dict) else None
    return {
        "id": provider_id,
        "presetProviderId": string_value(provider.get("presetProviderId"), provider_id) or provider_id,
        "name": string_value(provider.get("name"), provider_id),
        "description": string_value(provider.get("description"), ""),
        "type": default_endpoint,
        "defaultChatEndpoint": default_endpoint,
        "endpointConfigs": endpoint_configs,
        "apiHost": api_host,
        "apiKeyRequired": _provider_requires_api_key(provider_id, default_endpoint),
        "enabled": False,
        "models": provider_model_ids(provider_id),
        "apiFeatures": provider.get("apiFeatures") if isinstance(provider.get("apiFeatures"), dict) else {},
        "websites": website if isinstance(website, dict) else {},
        "catalog": {"source": "cherry-studio", "versions": catalog_versions()},
    }


def provider_model_ids(provider_id: str) -> list[str]:
    models: list[str] = []
    seen: set[str] = set()
    for override in catalog_overrides_by_provider().get(provider_id, []):
        model_id = string_value(override.get("apiModelId"), "") or string_value(override.get("modelId"), "")
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append(model_id)
    for model_id in FALLBACK_PROVIDER_MODELS.get(provider_id, []):
        if model_id and model_id not in seen:
            seen.add(model_id)
            models.append(model_id)
    return models


def provider_model_details(provider_id: str, *, query: str = "", limit: int = 200) -> list[dict[str, Any]]:
    lowered_query = query.strip().lower()
    details: list[dict[str, Any]] = []
    for override in catalog_overrides_by_provider().get(provider_id, []):
        detail = merged_model_detail(provider_id, override)
        if lowered_query:
            haystack = " ".join(
                string_value(detail.get(key), "")
                for key in ("id", "apiModelId", "name", "family", "ownedBy", "description")
            ).lower()
            if lowered_query not in haystack:
                continue
        details.append(detail)
        if len(details) >= limit:
            break
    if len(details) < limit:
        seen = {string_value(detail.get("apiModelId"), "") for detail in details}
        for model_id in FALLBACK_PROVIDER_MODELS.get(provider_id, []):
            if model_id in seen:
                continue
            detail = {
                "id": model_id,
                "apiModelId": model_id,
                "providerId": provider_id,
                "name": model_id,
                "description": "",
                "family": _fallback_model_family(model_id),
                "ownedBy": provider_id,
                "capabilities": ["function-call"] if provider_id in {"openai", "anthropic", "gemini"} else [],
                "inputModalities": ["text"],
                "outputModalities": ["text"],
                "contextWindow": None,
                "maxOutputTokens": None,
                "endpointTypes": [],
            }
            if lowered_query:
                haystack = " ".join(string_value(detail.get(key), "") for key in ("id", "apiModelId", "name", "family", "ownedBy")).lower()
                if lowered_query not in haystack:
                    continue
            details.append(detail)
            if len(details) >= limit:
                break
    return details


def catalog_summary() -> dict[str, Any]:
    providers: list[dict[str, Any]] = []
    counts = catalog_provider_model_counts()
    for provider in provider_registry().get("providers", []):
        if not isinstance(provider, dict):
            continue
        provider_id = string_value(provider.get("id"), "")
        endpoint_configs = _clean_endpoint_configs(provider.get("endpointConfigs"))
        website = provider.get("metadata", {}).get("website") if isinstance(provider.get("metadata"), dict) else None
        providers.append(
            {
                "id": provider_id,
                "name": string_value(provider.get("name"), provider_id),
                "description": string_value(provider.get("description"), ""),
                "defaultChatEndpoint": _default_chat_endpoint(provider, endpoint_configs),
                "endpointTypes": list(endpoint_configs),
                "modelCount": counts.get(provider_id, 0),
                "websites": website if isinstance(website, dict) else {},
            }
        )
    return {
        "versions": catalog_versions(),
        "providerCount": len(providers),
        "modelCount": len(model_registry().get("models", [])),
        "providerModelCount": len(provider_model_registry().get("overrides", [])),
        "providers": providers,
    }


def catalog_provider_model_counts() -> dict[str, int]:
    provider_ids = set(catalog_overrides_by_provider()) | set(FALLBACK_PROVIDER_MODELS)
    return {provider_id: len(provider_model_ids(provider_id)) for provider_id in provider_ids}


def merged_model_detail(provider_id: str, override: dict[str, Any]) -> dict[str, Any]:
    model_id = string_value(override.get("modelId"), "")
    base = catalog_models_by_id().get(model_id, {})
    api_model_id = string_value(override.get("apiModelId"), "") or model_id
    capabilities = _merged_capabilities(base.get("capabilities"), override.get("capabilities"))
    detail: dict[str, Any] = {
        "id": model_id,
        "apiModelId": api_model_id,
        "providerId": provider_id,
        "name": string_value(override.get("name"), "") or string_value(base.get("name"), model_id),
        "description": string_value(override.get("description"), "") or string_value(base.get("description"), ""),
        "family": string_value(override.get("family"), "") or string_value(base.get("family"), ""),
        "ownedBy": string_value(override.get("ownedBy"), "") or string_value(base.get("ownedBy"), ""),
        "capabilities": capabilities,
        "inputModalities": override.get("inputModalities") if isinstance(override.get("inputModalities"), list) else base.get("inputModalities", []),
        "outputModalities": override.get("outputModalities") if isinstance(override.get("outputModalities"), list) else base.get("outputModalities", []),
        "contextWindow": _limit_value(override, base, "contextWindow"),
        "maxOutputTokens": _limit_value(override, base, "maxOutputTokens"),
        "endpointTypes": override.get("endpointTypes") if isinstance(override.get("endpointTypes"), list) else [],
    }
    if isinstance(base.get("pricing"), dict) or isinstance(override.get("pricing"), dict):
        detail["pricing"] = {**dict(base.get("pricing") or {}), **dict(override.get("pricing") or {})}
    if isinstance(base.get("reasoning"), dict) or isinstance(override.get("reasoning"), dict):
        detail["reasoning"] = {**dict(base.get("reasoning") or {}), **dict(override.get("reasoning") or {})}
    return detail


def _load_json(resource_name: str) -> dict[str, Any]:
    with resources.files(CATALOG_PACKAGE).joinpath("data", resource_name).open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    return value if isinstance(value, dict) else {}


def _clean_endpoint_configs(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    configs: dict[str, dict[str, Any]] = {}
    for key, raw_config in value.items():
        endpoint_type = string_value(key, "")
        if not endpoint_type or not isinstance(raw_config, dict):
            continue
        config: dict[str, Any] = {}
        base_url = string_value(raw_config.get("baseUrl"), "")
        if base_url:
            config["baseUrl"] = base_url
        models_api_urls = raw_config.get("modelsApiUrls")
        if isinstance(models_api_urls, dict):
            config["modelsApiUrls"] = {
                name: url
                for name, raw_url in models_api_urls.items()
                if (url := string_value(raw_url, ""))
            }
        reasoning_format = raw_config.get("reasoningFormat")
        if isinstance(reasoning_format, dict) and string_value(reasoning_format.get("type"), ""):
            config["reasoningFormatType"] = string_value(reasoning_format.get("type"), "")
        adapter_family = string_value(raw_config.get("adapterFamily"), "")
        if adapter_family:
            config["adapterFamily"] = adapter_family
        configs[endpoint_type] = config
    return configs


def _default_chat_endpoint(provider: dict[str, Any], endpoint_configs: dict[str, dict[str, Any]]) -> str:
    configured = string_value(provider.get("defaultChatEndpoint"), "")
    if configured in endpoint_configs:
        return configured
    for endpoint in ("openai-responses", "openai-chat-completions", "google-generate-content", "ollama-chat", "anthropic-messages"):
        if endpoint in endpoint_configs:
            return endpoint
    for endpoint in endpoint_configs:
        if endpoint in CHAT_ENDPOINTS:
            return endpoint
    return ""


def _endpoint_base_url(endpoint_configs: dict[str, dict[str, Any]], endpoint_type: str) -> str:
    config = endpoint_configs.get(endpoint_type)
    if isinstance(config, dict):
        return string_value(config.get("baseUrl"), "")
    return ""


def _provider_requires_api_key(provider_id: str, endpoint_type: str) -> bool:
    if provider_id in {"ollama", "lmstudio", "ovms"} or endpoint_type == "ollama-chat":
        return False
    return True


def _merged_capabilities(base_value: Any, override_value: Any) -> list[str]:
    base = [string_value(item, "") for item in base_value] if isinstance(base_value, list) else []
    if not isinstance(override_value, dict):
        return [item for item in base if item]
    forced = override_value.get("force")
    if isinstance(forced, list):
        return [item for item in (string_value(value, "") for value in forced) if item]
    values = [item for item in base if item]
    for item in override_value.get("add") or []:
        text = string_value(item, "")
        if text and text not in values:
            values.append(text)
    for item in override_value.get("remove") or []:
        text = string_value(item, "")
        if text in values:
            values.remove(text)
    return values


def _limit_value(override: dict[str, Any], base: dict[str, Any], key: str) -> int | None:
    limits = override.get("limits")
    value = limits.get(key) if isinstance(limits, dict) else None
    if isinstance(value, (int, float)):
        return int(value)
    value = base.get(key)
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _fallback_model_family(model_id: str) -> str:
    lowered = model_id.lower()
    if "claude" in lowered:
        return "claude"
    if "gemini" in lowered:
        return "gemini"
    if lowered.startswith("gpt") or lowered.startswith("o"):
        return "openai"
    if "llama" in lowered:
        return "llama"
    return ""
