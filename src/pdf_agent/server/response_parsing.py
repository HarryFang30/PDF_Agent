"""Response-text and prompt-cache extraction from gateway responses.

These functions handle both JSON (non-streaming) and SSE (Server-Sent Events /
text/event-stream) response formats from the OpenAI / Codex gateway.

All functions are stateless with no dependency on ``web_app.py``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from pdf_agent.gateway import redacted_gateway_error
from pdf_agent.server.errors import HttpError
from pdf_agent.server.json_utils import json_dumps_utf8_safe
from pdf_agent.server.value_utils import int_value


def _extract_gateway_text(text: str, content_type: str) -> str:
    """Return the human-readable text from a gateway response body."""
    if (
        "text/event-stream" in content_type
        or text.lstrip().startswith("event:")
        or text.lstrip().startswith("data:")
    ):
        return _extract_event_stream_text(text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return text.strip()
    return _extract_response_text(value)


def _extract_prompt_cache_usage(text: str, content_type: str) -> dict[str, Any]:
    """Return prompt-cache metadata dict from a gateway response body."""
    value: Any = None
    if (
        "text/event-stream" in content_type
        or text.lstrip().startswith("event:")
        or text.lstrip().startswith("data:")
    ):
        for event in _iter_event_stream_payloads(text):
            event_type = event.get("type") or event.get("event")
            if event_type == "response.completed":
                candidate = event.get("response") or event
                if _find_response_usage(candidate):
                    value = candidate
            elif isinstance(event.get("usage"), Mapping):
                value = event
    else:
        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            return {}
    usage = _find_response_usage(value)
    if not usage:
        return {}

    input_tokens = int_value(usage.get("input_tokens") or usage.get("prompt_tokens"), 0)
    output_tokens = int_value(
        usage.get("output_tokens") or usage.get("completion_tokens"), 0
    )
    total_tokens = int_value(usage.get("total_tokens"), 0)
    details = usage.get("input_tokens_details")
    if not isinstance(details, Mapping):
        details = usage.get("prompt_tokens_details")
    if not isinstance(details, Mapping):
        details = {}
    cached_tokens = int_value(
        details.get("cached_tokens") or usage.get("cached_input_tokens"), 0
    )
    cache_write_tokens = int_value(
        details.get("cache_write_tokens") or usage.get("cache_write_tokens"), 0
    )

    metadata: dict[str, Any] = {
        "cached_tokens": cached_tokens,
        "cache_hit": cached_tokens > 0,
    }
    if input_tokens:
        metadata["input_tokens"] = input_tokens
        metadata["cached_ratio"] = round(cached_tokens / input_tokens, 4)
    if cache_write_tokens:
        metadata["cache_write_tokens"] = cache_write_tokens
    if output_tokens:
        metadata["output_tokens"] = output_tokens
    if total_tokens:
        metadata["total_tokens"] = total_tokens
    return metadata


def _find_response_usage(value: Any) -> Mapping[str, Any] | None:
    """Recursively locate ``usage`` dict inside a response object."""
    if not isinstance(value, Mapping):
        return None
    usage = value.get("usage")
    if isinstance(usage, Mapping):
        return usage
    response = value.get("response")
    if isinstance(response, Mapping):
        found = _find_response_usage(response)
        if found:
            return found
    return None


def _iter_event_stream_payloads(text: str) -> list[Mapping[str, Any]]:
    """Parse ``data:`` lines from an SSE stream into a list of dicts."""
    events: list[Mapping[str, Any]] = []
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            continue
        try:
            event = json.loads(data)
        except json.JSONDecodeError:
            continue
        if isinstance(event, Mapping):
            events.append(event)
    return events


def _extract_event_stream_text(text: str) -> str:
    """Extract accumulated text from an SSE ``text/event-stream`` body."""
    chunks: list[str] = []
    completed: Any = None
    last_event: Any = None

    for event in _iter_event_stream_payloads(text):
        last_event = event
        event_type = event.get("type") or event.get("event")
        if event_type in {"response.output_text.delta", "response.refusal.delta"}:
            chunks.append(str(event.get("delta") or ""))
        elif event_type == "response.output_text.done" and not chunks:
            chunks.append(str(event.get("text") or ""))
        elif event_type == "response.completed":
            completed = event.get("response") or event
        elif event_type in {"response.failed", "response.error"}:
            error = (
                event.get("error") if isinstance(event.get("error"), Mapping) else event
            )
            raise HttpError(
                502,
                redacted_gateway_error(
                    json_dumps_utf8_safe(error, ensure_ascii=False)
                ),
                code="upstream_error",
            )

    if chunks:
        return "".join(chunks).strip()
    if completed is not None:
        return _extract_response_text(completed)
    if last_event is not None:
        return _extract_response_text(last_event)
    return ""


def _extract_response_text(value: Any) -> str:
    """Recursively extract the text payload from a JSON response object."""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "\n".join(
            filter(None, (_extract_response_text(item) for item in value))
        ).strip()
    if not isinstance(value, Mapping):
        return ""

    for key in ("output_text", "text"):
        raw = value.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()

    if isinstance(value.get("response"), Mapping):
        found = _extract_response_text(value["response"])
        if found:
            return found

    output = value.get("output")
    if isinstance(output, list):
        found = _extract_response_text(output)
        if found:
            return found

    content = value.get("content")
    if isinstance(content, list):
        found = _extract_response_text(content)
        if found:
            return found
    if isinstance(content, str) and content.strip():
        return content.strip()

    choices = value.get("choices")
    if isinstance(choices, list):
        found = _extract_response_text(choices)
        if found:
            return found

    message = value.get("message")
    if isinstance(message, Mapping):
        found = _extract_response_text(message)
        if found:
            return found

    return ""
