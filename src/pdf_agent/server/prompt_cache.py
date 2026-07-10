"""Prompt-cache helpers: cache keys, retry logic, payload manipulation.

These functions handle Anthropic/OpenAI-style prompt caching for the Codex
gateway.  They are stateless and import nothing from ``web_app.py`` so they
can be used from any module without circular-import risk.

Callers that need the document cache context (``_prompt_cache_key``,
``_prompt_cache_metadata``, ``_apply_prompt_cache_fields``) must supply it;
see the ``*_fn`` or ``*_context`` keyword parameters.
"""

from __future__ import annotations

import hashlib
import math
import random
import datetime
from collections.abc import Callable, Mapping, Sequence
from email.utils import parsedate_to_datetime
from typing import Any

from pdf_agent.server.constants import MODEL_GPT_54, MODEL_GPT_55, MODEL_GPT_56
from pdf_agent.server.errors import HttpError
from pdf_agent.server.json_utils import (
    json_dumps_utf8_safe,
    repair_unicode_surrogates_text,
)
from pdf_agent.server.response_parsing import _extract_prompt_cache_usage
from pdf_agent.server.value_utils import string_value

# ---------------------------------------------------------------------------
# Constants (mirror the values originally in web_app.py)
# ---------------------------------------------------------------------------

PROMPT_CACHE_VERSION = "synchropage.prompt-cache.v1"
DOCUMENT_CACHE_PREFIX_MARKER = "SYNCHROPAGE CACHEABLE DOCUMENT CONTEXT"
TEACHING_RETRY_DELAYS_SECONDS: tuple[float, ...] = (0.5, 1.5, 3.0)
TEACHING_MAX_RETRY_DELAY_SECONDS = 12.0


# ---------------------------------------------------------------------------
# Cache-key building
# ---------------------------------------------------------------------------


def _prompt_cache_key(
    body: Mapping[str, Any],
    *,
    context: Mapping[str, Any] | None = None,
    prompt_cache_version: str = PROMPT_CACHE_VERSION,
) -> str:
    """Build a stable prompt-cache key from *body*.

    The *context* should be the result of
    ``_normalized_document_cache_context(body)`` (computed by the caller to
    avoid importing web_app.py).
    """
    context = dict(context or {})
    document_file = (
        body.get("documentFile")
        if isinstance(body.get("documentFile"), Mapping)
        else {}
    )
    if not context.get("pages") and not document_file:
        return ""
    document_id = _cache_key_part(
        string_value(context.get("documentId") or context.get("id"), "document")
    )
    stable_context = {
        "promptCacheVersion": prompt_cache_version,
        "documentFileSha256": string_value(document_file.get("sha256"), ""),
        "documentContext": context,
    }
    serialized = json_dumps_utf8_safe(
        stable_context, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    digest = _sha256_text(serialized)
    return f"synchropage:{document_id}:{_cache_key_part(digest)[:32]}"


def _sha256_text(value: str) -> str:
    """SHA-256 hex digest of *value*, with surrogate repair first."""
    value = repair_unicode_surrogates_text(value)
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _cache_key_part(value: str) -> str:
    """Sanitise *value* into a safe cache-key segment."""
    cleaned = "".join(
        character
        if character.isascii()
        and (character.isalnum() or character in {"-", "_"})
        else "_"
        for character in value
    )
    return cleaned[:48] or "unknown"


# ---------------------------------------------------------------------------
# Applying cache fields to payloads
# ---------------------------------------------------------------------------


def _apply_prompt_cache_fields(
    payload: dict[str, Any],
    body: Mapping[str, Any],
    model: str,
    *,
    context_fn: Callable[[Mapping[str, Any]], Mapping[str, Any]] | None = None,
) -> None:
    """Add the model-family-appropriate prompt-cache fields to *payload*.

    *context_fn* must be ``_normalized_document_cache_context`` (injected by
    the caller to avoid importing web_app.py).
    """
    if not _supports_prompt_cache(model):
        return
    context = context_fn(body) if context_fn else {}
    cache_key = _prompt_cache_key(body, context=context)
    if cache_key:
        payload["prompt_cache_key"] = cache_key
        if _is_gpt_56_model(model):
            payload["prompt_cache_options"] = {"mode": "explicit", "ttl": "30m"}
            _set_document_cache_breakpoint(payload)
        else:
            payload["prompt_cache_retention"] = "24h"


def _supports_prompt_cache(model: str) -> bool:
    """Return True when *model* is known to support prompt caching."""
    return _is_gpt_56_model(model) or model.startswith((MODEL_GPT_55, MODEL_GPT_54))


def _is_gpt_56_model(model: str) -> bool:
    return model == MODEL_GPT_56 or model.startswith(f"{MODEL_GPT_56}-")


def _set_document_cache_breakpoint(payload: dict[str, Any]) -> None:
    """Mark the stable document/PDF boundary for GPT-5.6 explicit caching."""
    input_value = payload.get("input")
    if not isinstance(input_value, list) or not input_value:
        return

    copied_input: list[Any] = []
    candidate: dict[str, Any] | None = None
    for message in input_value:
        if not isinstance(message, Mapping):
            copied_input.append(message)
            continue
        copied_message = dict(message)
        content = message.get("content")
        if not isinstance(content, list):
            copied_input.append(copied_message)
            continue
        copied_content: list[Any] = []
        for part in content:
            if not isinstance(part, Mapping):
                copied_content.append(part)
                continue
            copied_part = dict(part)
            copied_part.pop("prompt_cache_breakpoint", None)
            part_type = copied_part.get("type")
            if part_type == "input_file":
                candidate = copied_part
            elif part_type == "input_text":
                text = str(copied_part.get("text") or "")
                if text.startswith(DOCUMENT_CACHE_PREFIX_MARKER):
                    candidate = copied_part
                elif candidate is not None:
                    copied_content.append(copied_part)
                    continue
            copied_content.append(copied_part)
        copied_message["content"] = copied_content
        copied_input.append(copied_message)
    payload["input"] = copied_input
    if candidate is not None:
        candidate["prompt_cache_breakpoint"] = {"mode": "explicit"}


# ---------------------------------------------------------------------------
# Retry / fallback decision helpers
# ---------------------------------------------------------------------------


def _should_retry_without_prompt_cache(
    exc: HttpError, payload: Mapping[str, Any]
) -> bool:
    """True when a 400/422 error may be caused by the prompt-cache fields."""
    return exc.status in {400, 422} and bool(
        payload.get("prompt_cache_key")
        or payload.get("prompt_cache_retention")
        or payload.get("prompt_cache_options")
    )


def _should_retry_without_file_input(
    exc: HttpError, payload: Mapping[str, Any]
) -> bool:
    """True when the error suggests the file attachment is the problem."""
    if exc.status not in {400, 413, 415, 422} or not _payload_has_file_input(
        payload
    ):
        return False
    message = str(exc).lower()
    return any(
        token in message
        for token in (
            "file_data",
            "input_file",
            "input[0].content",
            "unsupported file",
        )
    )


def _should_retry_transient_upstream_error(exc: HttpError) -> bool:
    """True when the error is likely transient and worth retrying."""
    if exc.status == 429 and "usage limit" in str(exc).lower():
        return False
    if exc.code == "upstream_timeout":
        return False
    return exc.code == "network_error" or exc.status in {429, 500, 502, 503, 504}


def _retry_after_seconds(value: str | None) -> float | None:
    """Parse a ``Retry-After`` header value into seconds."""
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    try:
        seconds = float(text)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(text)
        except (TypeError, ValueError, IndexError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=datetime.timezone.utc)
        seconds = (
            retry_at.timestamp()
            - datetime.datetime.now(datetime.timezone.utc).timestamp()
        )
    if not math.isfinite(seconds) or seconds < 0:
        return None
    return seconds


def _transient_retry_delay_seconds(
    exc: HttpError,
    attempt: int,
    *,
    delays: Sequence[float] = TEACHING_RETRY_DELAYS_SECONDS,
    max_delay: float = TEACHING_MAX_RETRY_DELAY_SECONDS,
) -> float:
    """Compute a jittered retry delay respecting ``Retry-After`` and caps."""
    retry_delays = tuple(delays) or TEACHING_RETRY_DELAYS_SECONDS
    base_delay = retry_delays[min(max(attempt, 0), len(retry_delays) - 1)]
    if exc.retry_after_seconds is not None:
        base_delay = max(base_delay, exc.retry_after_seconds)
    base_delay = min(base_delay, max_delay)
    jitter = random.uniform(0, min(base_delay * 0.2, 0.75))
    return min(base_delay + jitter, max_delay)


def _should_try_next_teaching_generation_candidate(
    exc: HttpError, *, document_file_used: bool
) -> bool:
    """True when the caller should try the next model/payload candidate."""
    if exc.status in {400, 404, 413, 415, 422}:
        return True
    return document_file_used and exc.status in {500, 502}


# ---------------------------------------------------------------------------
# Payload manipulation (strip cache / file fields)
# ---------------------------------------------------------------------------


def _without_prompt_cache(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Return a shallow copy of *payload* without cache fields."""
    fallback_payload = _without_prompt_cache_breakpoints(payload)
    fallback_payload.pop("prompt_cache_key", None)
    fallback_payload.pop("prompt_cache_retention", None)
    fallback_payload.pop("prompt_cache_options", None)
    return fallback_payload


def _without_prompt_cache_breakpoints(payload: Mapping[str, Any]) -> dict[str, Any]:
    cleaned = dict(payload)
    input_value = payload.get("input")
    if not isinstance(input_value, list):
        return cleaned
    cleaned_input: list[Any] = []
    for message in input_value:
        if not isinstance(message, Mapping):
            cleaned_input.append(message)
            continue
        cleaned_message = dict(message)
        content = message.get("content")
        if isinstance(content, list):
            cleaned_content: list[Any] = []
            for part in content:
                if isinstance(part, Mapping):
                    cleaned_part = dict(part)
                    cleaned_part.pop("prompt_cache_breakpoint", None)
                    cleaned_content.append(cleaned_part)
                else:
                    cleaned_content.append(part)
            cleaned_message["content"] = cleaned_content
        cleaned_input.append(cleaned_message)
    cleaned["input"] = cleaned_input
    return cleaned


def _payload_has_file_input(payload: Mapping[str, Any]) -> bool:
    """True when *payload* contains an ``input_file`` content part."""
    for message in (
        payload.get("input") if isinstance(payload.get("input"), list) else []
    ):
        if not isinstance(message, Mapping):
            continue
        for part in (
            message.get("content")
            if isinstance(message.get("content"), list)
            else []
        ):
            if isinstance(part, Mapping) and part.get("type") == "input_file":
                return True
    return False


def _without_file_input(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Return a shallow copy of *payload* with ``input_file`` parts removed."""
    fallback_payload = dict(payload)
    input_value = payload.get("input")
    if not isinstance(input_value, list):
        return fallback_payload

    fallback_input: list[Any] = []
    for message in input_value:
        if not isinstance(message, Mapping):
            fallback_input.append(message)
            continue
        fallback_message = dict(message)
        content = message.get("content")
        if isinstance(content, list):
            fallback_message["content"] = [
                part
                for part in content
                if not (
                    isinstance(part, Mapping) and part.get("type") == "input_file"
                )
            ]
        fallback_input.append(fallback_message)
    fallback_payload["input"] = fallback_input
    options = fallback_payload.get("prompt_cache_options")
    if isinstance(options, Mapping) and options.get("mode") == "explicit":
        _set_document_cache_breakpoint(fallback_payload)
    return fallback_payload


# ---------------------------------------------------------------------------
# Prompt-cache metadata for diagnostics
# ---------------------------------------------------------------------------


def _prompt_cache_metadata(
    payload: Mapping[str, Any],
    *,
    response_text: str | None = None,
    content_type: str = "",
) -> dict[str, Any]:
    """Build metadata dict summarising prompt-cache state for a request."""
    prefix = _payload_document_cache_prefix(payload)
    metadata: dict[str, Any] = {
        "prompt_cache_key": payload.get("prompt_cache_key"),
        "prompt_cache_retention": payload.get("prompt_cache_retention"),
        "prompt_cache_options": payload.get("prompt_cache_options"),
        "prefix_hash": _sha256_text(prefix)[:24] if prefix else None,
        "prefix_chars": len(prefix),
        "fallback_without_cache": bool(
            payload.get("_synchropage_cache_fallback_without_fields")
        ),
        "fallback_without_file_input": bool(
            payload.get("_synchropage_file_fallback_without_input_file")
        ),
    }
    if response_text is not None:
        usage = _extract_prompt_cache_usage(response_text, content_type)
        if usage:
            metadata["usage"] = usage
    return metadata


def _payload_document_cache_prefix(payload: Mapping[str, Any]) -> str:
    """Extract the ``SYNCHROPAGE CACHEABLE DOCUMENT CONTEXT`` prefix if present."""
    input_value = payload.get("input")
    if not isinstance(input_value, list) or not input_value:
        return ""
    first = input_value[0]
    if not isinstance(first, Mapping):
        return ""
    content = first.get("content")
    if not isinstance(content, list) or not content:
        return ""
    first_part = content[0]
    if not isinstance(first_part, Mapping) or first_part.get("type") != "input_text":
        return ""
    text = str(first_part.get("text") or "")
    return text if text.startswith(DOCUMENT_CACHE_PREFIX_MARKER) else ""
