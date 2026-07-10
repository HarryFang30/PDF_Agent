"""Provider-aware model gateway helpers."""

from __future__ import annotations

import asyncio
import ipaddress
import json
import re
import urllib.parse
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any

from pdf_agent.auth import OpenAIOAuthManager
from pdf_agent.gateway import (
    build_chatgpt_codex_auth,
    build_codex_responses_payload,
    codex_responses_url,
)
from pdf_agent.server.errors import HttpError
from pdf_agent.server.gateway_fallback import post_payload_with_cache_fallback
from pdf_agent.server.model_config import (
    DEFAULT_CODEX_PROVIDER_ID,
    ModelConfigStore,
    normalize_model_config,
    provider_by_id,
    resolve_model_ref,
)
from pdf_agent.server.prompt_cache import _prompt_cache_metadata, _without_prompt_cache
from pdf_agent.server.response_parsing import _extract_gateway_text
from pdf_agent.server.value_utils import string_value


PostWithRetries = Callable[[str, dict[str, Any], dict[str, str]], Awaitable[tuple[str, str]]]
CodexAuthBuilder = Callable[..., Awaitable[Any]]
DEEPSEEK_PROVIDER_ID = "deepseek"
DEEPSEEK_HOSTS = frozenset({"api.deepseek.com"})
OPENAI_PROVIDER_IDS = frozenset({"openai", "openai_api"})
OPENAI_HOSTS = frozenset({"api.openai.com"})
ENDPOINT_CODEX_OAUTH = "codex-oauth"
ENDPOINT_OPENAI_CHAT = "openai-chat-completions"
ENDPOINT_OPENAI_RESPONSES = "openai-responses"
ENDPOINT_ANTHROPIC_MESSAGES = "anthropic-messages"
ENDPOINT_GOOGLE_GENERATE_CONTENT = "google-generate-content"
ENDPOINT_OLLAMA_CHAT = "ollama-chat"
ENDPOINT_ALIASES = {
    "openai-compatible": ENDPOINT_OPENAI_CHAT,
    "openai-chat": ENDPOINT_OPENAI_CHAT,
    "openai-response": ENDPOINT_OPENAI_RESPONSES,
    "gemini": ENDPOINT_GOOGLE_GENERATE_CONTENT,
}
BLOCKED_NETWORK_HOSTS = frozenset({"169.254.169.254", "metadata.google.internal"})


@dataclass(frozen=True)
class ModelGatewayResult:
    text: str
    content_type: str
    payload: dict[str, Any]
    account_id: str
    provider_id: str
    provider_name: str
    model: str


async def post_responses_payload_for_body(
    *,
    manager: OpenAIOAuthManager,
    config_store: ModelConfigStore | None,
    body: Mapping[str, Any],
    default_key: str,
    legacy_model: str,
    responses_payload: dict[str, Any],
    post_with_retries: PostWithRetries,
    codex_include_reasoning_encrypted_content: bool,
    codex_auth_builder: CodexAuthBuilder = build_chatgpt_codex_auth,
) -> ModelGatewayResult:
    config = config_store.load_private() if config_store is not None else normalize_model_config(None)
    ref = resolve_model_ref(config, body, default_key=default_key, legacy_model=legacy_model)
    provider = provider_by_id(config, ref["providerId"])
    if provider is None:
        raise HttpError(400, f"Model provider not found: {ref['providerId']}", code="model_provider_not_found")
    if not bool(provider.get("enabled")) and provider.get("id") != DEFAULT_CODEX_PROVIDER_ID:
        raise HttpError(400, f"Model provider is disabled: {provider.get('name')}", code="model_provider_disabled")

    provider_type = provider_chat_endpoint(provider)
    payload = dict(responses_payload)
    payload["model"] = ref["model"]

    if provider_type == ENDPOINT_CODEX_OAUTH:
        auth = await codex_auth_builder(
            manager,
            session_id=string_value(body.get("session_id"), "") or None,
        )
        codex_payload = build_codex_responses_payload(
            payload,
            force_stream=True,
            include_reasoning_encrypted_content=codex_include_reasoning_encrypted_content,
            strip_unsupported_fields=True,
        )
        text, content_type, sent_payload = await post_payload_with_cache_fallback(
            post_with_retries,
            codex_responses_url(base_url=auth.upstream_base_url),
            codex_payload,
            auth.headers,
        )
        return ModelGatewayResult(
            text=text,
            content_type=content_type,
            payload=sent_payload,
            account_id=auth.account_id,
            provider_id=DEFAULT_CODEX_PROVIDER_ID,
            provider_name=string_value(provider.get("name"), "OpenAI OAuth"),
            model=string_value(sent_payload.get("model"), ref["model"]),
        )

    headers = _api_key_headers(provider, endpoint_type=provider_type)
    if provider_type == ENDPOINT_OPENAI_RESPONSES:
        url = provider_api_url(provider, "responses", endpoint_type=provider_type)
        api_payload = _strip_nonportable_responses_fields(
            payload,
            preserve_prompt_cache_fields=_is_official_openai_provider(provider),
        )
    elif provider_type == ENDPOINT_ANTHROPIC_MESSAGES:
        url = provider_api_url(provider, "messages", endpoint_type=provider_type)
        api_payload = responses_payload_to_anthropic_messages(payload)
    elif provider_type == ENDPOINT_GOOGLE_GENERATE_CONTENT:
        model_path = urllib.parse.quote(ref["model"].removeprefix("models/"), safe="")
        url = provider_api_url(provider, f"models/{model_path}:generateContent", endpoint_type=provider_type)
        api_payload = responses_payload_to_gemini_generate_content(payload)
    elif provider_type == ENDPOINT_OLLAMA_CHAT:
        url = provider_api_url(provider, "chat", endpoint_type=provider_type)
        api_payload = responses_payload_to_ollama_chat(payload)
    else:
        url = provider_api_url(provider, "chat/completions", endpoint_type=ENDPOINT_OPENAI_CHAT)
        api_payload = responses_payload_to_chat_completions(payload, provider=provider)

    text, content_type, sent_payload = await post_payload_with_cache_fallback(
        post_with_retries,
        url,
        api_payload,
        headers,
    )
    return ModelGatewayResult(
        text=text,
        content_type=content_type,
        payload=sent_payload,
        account_id=string_value(provider.get("id"), "api-key"),
        provider_id=string_value(provider.get("id"), "api-key"),
        provider_name=string_value(provider.get("name"), "API Provider"),
        model=string_value(sent_payload.get("model"), ref["model"]),
    )


def provider_chat_endpoint(provider: Mapping[str, Any]) -> str:
    configured = string_value(provider.get("defaultChatEndpoint"), "") or string_value(provider.get("type"), ENDPOINT_OPENAI_CHAT)
    endpoint = ENDPOINT_ALIASES.get(configured, configured)
    if endpoint == ENDPOINT_CODEX_OAUTH or string_value(provider.get("type"), "") == "codex-oauth":
        return ENDPOINT_CODEX_OAUTH
    endpoint_configs = provider.get("endpointConfigs")
    if endpoint and (not isinstance(endpoint_configs, Mapping) or endpoint in endpoint_configs):
        return endpoint
    if isinstance(endpoint_configs, Mapping):
        for candidate in (
            ENDPOINT_OPENAI_RESPONSES,
            ENDPOINT_OPENAI_CHAT,
            ENDPOINT_GOOGLE_GENERATE_CONTENT,
            ENDPOINT_OLLAMA_CHAT,
            ENDPOINT_ANTHROPIC_MESSAGES,
        ):
            if candidate in endpoint_configs:
                return candidate
    return ENDPOINT_OPENAI_CHAT


def provider_api_url(provider: Mapping[str, Any], path: str, *, endpoint_type: str | None = None) -> str:
    base = normalized_provider_api_base(provider, endpoint_type=endpoint_type)
    return urllib.parse.urljoin(base, path.lstrip("/"))


def provider_endpoint_preview(provider: Mapping[str, Any]) -> str:
    provider_type = provider_chat_endpoint(provider)
    if provider_type == ENDPOINT_CODEX_OAUTH:
        return urllib.parse.urljoin(_ensure_trailing_slash(string_value(provider.get("apiHost"), "")), "responses")
    if provider_type == ENDPOINT_OPENAI_RESPONSES:
        return provider_api_url(provider, "responses", endpoint_type=provider_type)
    if provider_type == ENDPOINT_ANTHROPIC_MESSAGES:
        return provider_api_url(provider, "messages", endpoint_type=provider_type)
    if provider_type == ENDPOINT_GOOGLE_GENERATE_CONTENT:
        return provider_api_url(provider, "models", endpoint_type=provider_type)
    if provider_type == ENDPOINT_OLLAMA_CHAT:
        return provider_api_url(provider, "chat", endpoint_type=provider_type)
    return provider_api_url(provider, "chat/completions", endpoint_type=ENDPOINT_OPENAI_CHAT)


def normalized_provider_api_base(provider: Mapping[str, Any], *, endpoint_type: str | None = None) -> str:
    endpoint = endpoint_type or provider_chat_endpoint(provider)
    raw = string_value(provider.get("apiHost"), "") or _provider_endpoint_base_url(provider, endpoint)
    if not raw:
        raise HttpError(400, "API host is required for this provider", code="model_api_host_missing")
    base = _format_endpoint_base(raw, provider=provider, endpoint_type=endpoint)
    _validate_provider_base_url(base)
    return _ensure_trailing_slash(base)


def _provider_endpoint_base_url(provider: Mapping[str, Any], endpoint_type: str) -> str:
    endpoint_configs = provider.get("endpointConfigs")
    if isinstance(endpoint_configs, Mapping):
        config = endpoint_configs.get(endpoint_type)
        if isinstance(config, Mapping):
            return string_value(config.get("baseUrl"), "")
    return ""


def _format_endpoint_base(raw: str, *, provider: Mapping[str, Any], endpoint_type: str) -> str:
    if endpoint_type == ENDPOINT_CODEX_OAUTH:
        return _ensure_trailing_slash(raw)
    if endpoint_type == ENDPOINT_OLLAMA_CHAT:
        return _format_ollama_api_base(raw)
    if endpoint_type == ENDPOINT_GOOGLE_GENERATE_CONTENT:
        return _format_api_host(raw, api_version="v1beta")
    if endpoint_type == ENDPOINT_ANTHROPIC_MESSAGES:
        return _format_api_host(raw, api_version="v1")
    if endpoint_type in {ENDPOINT_OPENAI_CHAT, ENDPOINT_OPENAI_RESPONSES}:
        return _format_openai_style_base(raw, provider=provider)
    return _format_api_host(raw, api_version="v1")


def _format_openai_style_base(raw: str, *, provider: Mapping[str, Any]) -> str:
    base = _ensure_trailing_slash(raw)
    parsed = urllib.parse.urlparse(base)
    provider_id = string_value(provider.get("id"), "").lower()
    if provider_id in {"github", "copilot"}:
        return _without_trailing_slash(raw)
    path_parts = [part for part in parsed.path.split("/") if part]
    if not path_parts and _is_deepseek_official_api_host(parsed):
        return _without_trailing_slash(raw)
    if path_parts and _has_api_version(path_parts[-1]):
        return _without_trailing_slash(raw)
    next_path = "/".join([*path_parts, "v1"])
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, f"/{next_path}/", "", "", ""))


def _format_api_host(raw: str, *, api_version: str) -> str:
    stripped = raw.strip()
    no_version = stripped.endswith("#")
    if no_version:
        stripped = stripped[:-1]
    base = _without_trailing_slash(stripped)
    if not base or no_version:
        return base
    parsed = urllib.parse.urlparse(base)
    path_parts = [part for part in parsed.path.split("/") if part]
    if path_parts and _has_api_version(path_parts[-1]):
        return base
    next_path = "/".join([*path_parts, api_version])
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, f"/{next_path}", "", "", ""))


def _format_ollama_api_base(raw: str) -> str:
    base = _without_trailing_slash(raw)
    parsed = urllib.parse.urlparse(base)
    path_parts = [part for part in parsed.path.split("/") if part]
    if path_parts and _has_api_version(path_parts[-1]):
        base_path = "/".join(path_parts[:-1])
        base = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, f"/{base_path}" if base_path else "", "", "", ""))
    if base.endswith("/api"):
        return base
    return f"{base}/api"


def _has_api_version(path_part: str) -> bool:
    lowered = path_part.lower()
    return bool(re.match(r"^v\d+(?:beta\d*|alpha\d*)?$", lowered))


def _validate_provider_base_url(raw: str) -> None:
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HttpError(400, "API host must be an http(s) URL", code="model_api_host_invalid")
    if parsed.username or parsed.password:
        raise HttpError(400, "API host must not include credentials", code="model_api_host_credentials_forbidden")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise HttpError(400, "API host must include a hostname", code="model_api_host_invalid")
    if host in BLOCKED_NETWORK_HOSTS:
        raise HttpError(400, "API host points to a blocked metadata endpoint", code="model_api_host_blocked")
    try:
        address = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return
    if address.is_link_local or address.is_multicast or address.is_reserved or address.is_unspecified:
        raise HttpError(400, "API host points to a blocked network address", code="model_api_host_blocked")


def responses_payload_to_chat_completions(
    payload: Mapping[str, Any],
    *,
    provider: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    system_text = string_value(payload.get("instructions"), "")
    user_text = _responses_input_text(payload.get("input"))
    messages: list[dict[str, str]] = []
    if system_text:
        messages.append({"role": "system", "content": system_text})
    messages.append({"role": "user", "content": user_text or "Continue."})
    chat_payload: dict[str, Any] = {
        "model": string_value(payload.get("model"), ""),
        "messages": messages,
        "stream": False,
    }
    if provider is not None and _is_deepseek_provider(provider):
        chat_payload.update(_deepseek_chat_options(payload, chat_payload["model"]))
    elif provider is not None and _is_official_openai_provider(provider):
        reasoning = payload.get("reasoning")
        if isinstance(reasoning, Mapping):
            effort = string_value(reasoning.get("effort"), "")
            if effort:
                chat_payload["reasoning_effort"] = effort
        max_completion_tokens = _max_output_tokens(payload, default=0)
        if max_completion_tokens:
            chat_payload["max_completion_tokens"] = max_completion_tokens
        for field in ("prompt_cache_key", "prompt_cache_retention"):
            if field in payload:
                chat_payload[field] = payload[field]
        cache_options = payload.get("prompt_cache_options")
        if isinstance(cache_options, Mapping):
            chat_cache_options = dict(cache_options)
            # The broad Responses→Chat text conversion cannot retain content
            # block breakpoints. Fall back to Chat's implicit breakpoint
            # instead of sending explicit mode with zero usable markers.
            chat_cache_options.pop("mode", None)
            if chat_cache_options:
                chat_payload["prompt_cache_options"] = chat_cache_options
    return chat_payload


def responses_payload_to_anthropic_messages(payload: Mapping[str, Any]) -> dict[str, Any]:
    user_text = _responses_input_text(payload.get("input"))
    anthropic_payload: dict[str, Any] = {
        "model": string_value(payload.get("model"), ""),
        "max_tokens": _max_output_tokens(payload, default=4096),
        "messages": [{"role": "user", "content": user_text or "Continue."}],
        "stream": False,
    }
    system_text = string_value(payload.get("instructions"), "")
    if system_text:
        anthropic_payload["system"] = system_text
    return anthropic_payload


def responses_payload_to_gemini_generate_content(payload: Mapping[str, Any]) -> dict[str, Any]:
    user_text = _responses_input_text(payload.get("input"))
    gemini_payload: dict[str, Any] = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_text or "Continue."}],
            }
        ],
        "generationConfig": {
            "maxOutputTokens": _max_output_tokens(payload, default=8192),
        },
    }
    system_text = string_value(payload.get("instructions"), "")
    if system_text:
        gemini_payload["systemInstruction"] = {"parts": [{"text": system_text}]}
    return gemini_payload


def responses_payload_to_ollama_chat(payload: Mapping[str, Any]) -> dict[str, Any]:
    chat_payload = responses_payload_to_chat_completions(payload)
    return {
        "model": chat_payload["model"],
        "messages": chat_payload["messages"],
        "stream": False,
    }


def extract_provider_text(text: str, content_type: str) -> str:
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return _extract_gateway_text(text, content_type)
    chat_text = _extract_chat_completion_text(value)
    if chat_text:
        return chat_text
    anthropic_text = _extract_anthropic_text(value)
    if anthropic_text:
        return anthropic_text
    gemini_text = _extract_gemini_text(value)
    if gemini_text:
        return gemini_text
    ollama_text = _extract_ollama_text(value)
    if ollama_text:
        return ollama_text
    return _extract_gateway_text(text, content_type)


def provider_cache_metadata(payload: Mapping[str, Any], response_text: str, content_type: str) -> dict[str, Any]:
    metadata = _prompt_cache_metadata(payload, response_text=response_text, content_type=content_type)
    if payload.get("messages"):
        metadata["transport"] = "chat-completions"
    else:
        metadata["transport"] = "responses"
    return metadata


async def fetch_provider_models(
    *,
    manager: OpenAIOAuthManager,
    config_store: ModelConfigStore,
    provider_value: Mapping[str, Any],
) -> dict[str, Any]:
    config = config_store.load_private()
    provider_id = string_value(provider_value.get("id"), "")
    stored = provider_by_id(config, provider_id) if provider_id else None
    provider = {**dict(stored or {}), **dict(provider_value)}
    if not provider.get("apiKey") and stored and stored.get("apiKey"):
        provider["apiKey"] = stored["apiKey"]
    provider_type = provider_chat_endpoint(provider)
    if provider_type == ENDPOINT_CODEX_OAUTH:
        auth = await build_chatgpt_codex_auth(manager)
        from pdf_agent.gateway import codex_models_url, parse_codex_models
        from pdf_agent.server.gateway_transport import get_json

        value = await asyncio.to_thread(get_json, codex_models_url(base_url=auth.upstream_base_url), auth.headers, timeout_seconds=30.0)
        models = parse_codex_models(value)
        return {"models": [{"id": model.id, "owned_by": model.owned_by} for model in models]}

    from pdf_agent.server.gateway_transport import get_json

    if provider_type == ENDPOINT_GOOGLE_GENERATE_CONTENT:
        value = await asyncio.to_thread(
            get_json,
            provider_api_url(provider, "models", endpoint_type=provider_type),
            _api_key_headers(provider, endpoint_type=provider_type),
            timeout_seconds=30.0,
        )
        return {"models": _parse_gemini_models(value)}

    if provider_type == ENDPOINT_OLLAMA_CHAT:
        value = await asyncio.to_thread(
            get_json,
            provider_api_url(provider, "tags", endpoint_type=provider_type),
            _api_key_headers(provider, endpoint_type=provider_type),
            timeout_seconds=30.0,
        )
        return {"models": _parse_ollama_models(value)}

    from pdf_agent.gateway import parse_codex_models

    value = await asyncio.to_thread(
        get_json,
        provider_api_url(provider, "models", endpoint_type=provider_type),
        _api_key_headers(provider, endpoint_type=provider_type),
        timeout_seconds=30.0,
    )
    models = parse_codex_models(value)
    return {"models": [{"id": model.id, "owned_by": model.owned_by} for model in models]}


async def check_provider_model(
    *,
    provider_value: Mapping[str, Any],
    model: str,
    post_with_retries: PostWithRetries,
    config_store: ModelConfigStore | None = None,
    manager: OpenAIOAuthManager | None = None,
    codex_auth_builder: CodexAuthBuilder = build_chatgpt_codex_auth,
) -> dict[str, Any]:
    provider = dict(provider_value)
    if config_store is not None:
        config = config_store.load_private()
        provider_id = string_value(provider_value.get("id"), "")
        stored = provider_by_id(config, provider_id) if provider_id else None
        provider = {**dict(stored or {}), **dict(provider_value)}
        if not provider.get("apiKey") and stored and stored.get("apiKey"):
            provider["apiKey"] = stored["apiKey"]
    endpoint_type = provider_chat_endpoint(provider)
    payload: dict[str, Any] = {
        "model": model or _first_provider_model(provider),
        "instructions": "You are checking whether this model provider can answer a minimal health check.",
        "input": "Reply with OK.",
    }
    if not payload["model"]:
        raise HttpError(400, "A model is required for provider connection checks", code="model_required")
    if endpoint_type == ENDPOINT_CODEX_OAUTH:
        if manager is None:
            raise HttpError(400, "OpenAI OAuth manager is required for this model check", code="model_oauth_manager_required")
        auth = await codex_auth_builder(manager)
        url = codex_responses_url(base_url=auth.upstream_base_url)
        request_payload = build_codex_responses_payload(
            payload,
            force_stream=True,
            include_reasoning_encrypted_content=False,
            strip_unsupported_fields=True,
        )
        headers = auth.headers
    elif endpoint_type == ENDPOINT_OPENAI_RESPONSES:
        headers = _api_key_headers(provider, endpoint_type=endpoint_type)
        url = provider_api_url(provider, "responses", endpoint_type=endpoint_type)
        request_payload = _strip_nonportable_responses_fields(
            payload,
            preserve_prompt_cache_fields=_is_official_openai_provider(provider),
        )
    elif endpoint_type == ENDPOINT_ANTHROPIC_MESSAGES:
        headers = _api_key_headers(provider, endpoint_type=endpoint_type)
        url = provider_api_url(provider, "messages", endpoint_type=endpoint_type)
        request_payload = responses_payload_to_anthropic_messages(payload)
    elif endpoint_type == ENDPOINT_GOOGLE_GENERATE_CONTENT:
        headers = _api_key_headers(provider, endpoint_type=endpoint_type)
        model_path = urllib.parse.quote(string_value(payload.get("model"), "").removeprefix("models/"), safe="")
        url = provider_api_url(provider, f"models/{model_path}:generateContent", endpoint_type=endpoint_type)
        request_payload = responses_payload_to_gemini_generate_content(payload)
    elif endpoint_type == ENDPOINT_OLLAMA_CHAT:
        headers = _api_key_headers(provider, endpoint_type=endpoint_type)
        url = provider_api_url(provider, "chat", endpoint_type=endpoint_type)
        request_payload = responses_payload_to_ollama_chat(payload)
    else:
        headers = _api_key_headers(provider, endpoint_type=endpoint_type)
        url = provider_api_url(provider, "chat/completions", endpoint_type=ENDPOINT_OPENAI_CHAT)
        request_payload = responses_payload_to_chat_completions(payload, provider=provider)

    text, content_type = await post_with_retries(url, request_payload, headers)
    content = extract_provider_text(text, content_type)
    return {
        "ok": bool(content),
        "endpoint": endpoint_type,
        "url": url,
        "model": payload["model"],
        "text": content[:500],
    }


def _api_key_headers(provider: Mapping[str, Any], *, endpoint_type: str | None = None) -> dict[str, str]:
    api_key = string_value(provider.get("apiKey"), "")
    if bool(provider.get("apiKeyRequired")) and not api_key:
        raise HttpError(400, f"API key is required for {string_value(provider.get('name'), 'this provider')}", code="model_api_key_missing")
    endpoint = endpoint_type or provider_chat_endpoint(provider)
    if endpoint == ENDPOINT_ANTHROPIC_MESSAGES:
        headers = {"anthropic-version": "2023-06-01"}
        if api_key:
            headers["x-api-key"] = api_key
        return headers
    if endpoint == ENDPOINT_GOOGLE_GENERATE_CONTENT:
        return {"x-goog-api-key": api_key} if api_key else {}
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


def _parse_gemini_models(value: Any) -> list[dict[str, str]]:
    raw_models = value.get("models") if isinstance(value, Mapping) else None
    if not isinstance(raw_models, list):
        return []
    models: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_models:
        if not isinstance(item, Mapping):
            continue
        methods = item.get("supportedGenerationMethods")
        if isinstance(methods, list) and "generateContent" not in methods:
            continue
        model_id = string_value(item.get("name"), "").removeprefix("models/")
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({"id": model_id, "owned_by": "Google"})
    return models


def _parse_ollama_models(value: Any) -> list[dict[str, str]]:
    raw_models = value.get("models") if isinstance(value, Mapping) else None
    if not isinstance(raw_models, list):
        return []
    models: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_models:
        if not isinstance(item, Mapping):
            continue
        model_id = string_value(item.get("name") or item.get("model"), "")
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({"id": model_id, "owned_by": "Ollama"})
    return models


def _first_provider_model(provider: Mapping[str, Any]) -> str:
    models = provider.get("models")
    if isinstance(models, list):
        for model in models:
            text = string_value(model, "")
            if text:
                return text
    return ""


def _responses_input_text(value: Any) -> str:
    chunks: list[str] = []
    if isinstance(value, list):
        for message in value:
            if not isinstance(message, Mapping):
                continue
            role = string_value(message.get("role"), "user")
            text = _responses_content_text(message.get("content"))
            if text:
                chunks.append(f"{role}:\n{text}" if role != "user" else text)
    else:
        text = _responses_content_text(value)
        if text:
            chunks.append(text)
    return "\n\n".join(chunks).strip()


def _responses_content_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        chunks: list[str] = []
        for item in value:
            if isinstance(item, Mapping):
                item_type = item.get("type")
                if item_type in {"input_text", "text"}:
                    chunks.append(string_value(item.get("text"), ""))
                elif item_type == "input_file":
                    filename = string_value(item.get("filename") or item.get("file_id"), "attached PDF")
                    chunks.append(f"[Attached file omitted for Chat Completions compatibility: {filename}]")
                elif item_type == "input_image":
                    chunks.append("[Attached image omitted for broad Chat Completions compatibility.]")
            else:
                chunks.append(string_value(item, ""))
        return "\n\n".join(chunk for chunk in chunks if chunk).strip()
    if isinstance(value, Mapping):
        return _responses_content_text(value.get("content") or value.get("text"))
    return ""


def _strip_nonportable_responses_fields(
    payload: Mapping[str, Any],
    *,
    preserve_prompt_cache_fields: bool = False,
) -> dict[str, Any]:
    stripped = dict(payload)
    stripped["store"] = False
    if not preserve_prompt_cache_fields:
        stripped = _without_prompt_cache(stripped)
    stripped.pop("include", None)
    return stripped


def _is_official_openai_provider(provider: Mapping[str, Any]) -> bool:
    provider_id = string_value(provider.get("id"), "").lower()
    if provider_id in OPENAI_PROVIDER_IDS:
        return True
    parsed = urllib.parse.urlparse(_ensure_trailing_slash(string_value(provider.get("apiHost"), "")))
    return parsed.netloc.lower() in OPENAI_HOSTS


def _is_deepseek_provider(provider: Mapping[str, Any], *, parsed: urllib.parse.ParseResult | None = None) -> bool:
    provider_id = string_value(provider.get("id"), "").lower()
    if provider_id == DEEPSEEK_PROVIDER_ID:
        return True
    url = parsed or urllib.parse.urlparse(_ensure_trailing_slash(string_value(provider.get("apiHost"), "")))
    return _is_deepseek_official_api_host(url)


def _is_deepseek_official_api_host(parsed: urllib.parse.ParseResult) -> bool:
    return parsed.netloc.lower() in DEEPSEEK_HOSTS


def _deepseek_chat_options(payload: Mapping[str, Any], model: str) -> dict[str, Any]:
    effort = ""
    reasoning = payload.get("reasoning")
    if isinstance(reasoning, Mapping):
        effort = string_value(reasoning.get("effort"), "")
    lowered_model = model.lower()
    if lowered_model == "deepseek-chat":
        return {"thinking": {"type": "disabled"}}
    if lowered_model == "deepseek-reasoner":
        return {"thinking": {"type": "enabled"}, "reasoning_effort": _deepseek_reasoning_effort(effort)}
    if lowered_model.startswith("deepseek-v4"):
        if effort == "none":
            return {"thinking": {"type": "disabled"}}
        return {"thinking": {"type": "enabled"}, "reasoning_effort": _deepseek_reasoning_effort(effort)}
    return {}


def _deepseek_reasoning_effort(value: str) -> str:
    if value == "xhigh":
        return "max"
    return "high" if value in {"", "low", "medium", "high"} else "high"


def _max_output_tokens(payload: Mapping[str, Any], *, default: int) -> int:
    for key in ("max_output_tokens", "max_tokens", "maxOutputTokens"):
        value = payload.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return int(min(value, 32768))
    return default


def _extract_chat_completion_text(value: Any) -> str:
    if not isinstance(value, Mapping):
        return ""
    choices = value.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, Mapping):
        return ""
    message = first.get("message")
    if isinstance(message, Mapping):
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, Mapping) and isinstance(item.get("text"), str):
                    parts.append(item["text"])
            if parts:
                return "\n".join(parts).strip()
    text = first.get("text")
    return text.strip() if isinstance(text, str) else ""


def _extract_anthropic_text(value: Any) -> str:
    if not isinstance(value, Mapping):
        return ""
    content = value.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, Mapping) and isinstance(item.get("text"), str):
            parts.append(item["text"])
    return "\n".join(parts).strip()


def _extract_gemini_text(value: Any) -> str:
    if not isinstance(value, Mapping):
        return ""
    candidates = value.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        return ""
    parts: list[str] = []
    for candidate in candidates:
        if not isinstance(candidate, Mapping):
            continue
        content = candidate.get("content")
        if not isinstance(content, Mapping):
            continue
        for item in content.get("parts") or []:
            if isinstance(item, Mapping) and isinstance(item.get("text"), str):
                parts.append(item["text"])
    return "\n".join(parts).strip()


def _extract_ollama_text(value: Any) -> str:
    if not isinstance(value, Mapping):
        return ""
    message = value.get("message")
    if isinstance(message, Mapping) and isinstance(message.get("content"), str):
        return message["content"].strip()
    response = value.get("response")
    return response.strip() if isinstance(response, str) else ""


def _ensure_trailing_slash(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        return ""
    return stripped if stripped.endswith("/") else f"{stripped}/"


def _without_trailing_slash(value: str) -> str:
    return value.strip().rstrip("/")
