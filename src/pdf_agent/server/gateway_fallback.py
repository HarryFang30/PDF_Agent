"""Shared cache / file-input fallback logic for gateway POSTs.

Provides ``post_payload_with_cache_fallback`` — the common fallback
sequence used by both ``AgentChatGateway`` and
``TeachingGenerationGateway`` when an upstream error suggests that file
attachments or prompt-cache fields are not supported.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from pdf_agent.server.errors import HttpError
from pdf_agent.server.prompt_cache import (
    _should_retry_without_file_input,
    _should_retry_without_prompt_cache,
    _without_file_input,
    _without_prompt_cache,
)

#: Signature of the retry-enabled post function used by callers.
PostFn = Callable[
    [str, dict[str, Any], dict[str, str]], Awaitable[tuple[str, str]]
]


async def post_payload_with_cache_fallback(
    post_fn: PostFn,
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str],
) -> tuple[str, str, dict[str, Any]]:
    """Send *payload* via *post_fn*, falling back when file/cache fields
    are rejected by the upstream gateway.

    Fallback order (preserved from the original inline implementations):

    1. Original payload.
    2. If the error suggests the file input is unsupported → strip
       ``input_file`` parts and retry.
    3. If that also fails with a cache-related error → additionally strip
       ``prompt_cache_key`` / ``prompt_cache_retention`` /
       ``prompt_cache_options`` and retry.

    Fallback metadata keys ``_synchropage_file_fallback_without_input_file``
    and ``_synchropage_cache_fallback_without_fields`` are set on the
    returned payload dict so callers can record them in diagnostics.
    """
    try:
        text, content_type = await post_fn(url, payload, headers)
        return text, content_type, payload
    except HttpError as exc:
        if _should_retry_without_file_input(exc, payload):
            fallback_payload = _without_file_input(payload)
            try:
                text, content_type = await post_fn(url, fallback_payload, headers)
            except HttpError as fallback_exc:
                if not _should_retry_without_prompt_cache(fallback_exc, fallback_payload):
                    raise
                fallback_payload = _without_prompt_cache(fallback_payload)
                text, content_type = await post_fn(url, fallback_payload, headers)
                fallback_payload["_synchropage_cache_fallback_without_fields"] = True
            fallback_payload["_synchropage_file_fallback_without_input_file"] = True
            return text, content_type, fallback_payload
        if _should_retry_without_prompt_cache(exc, payload):
            fallback_payload = _without_prompt_cache(payload)
            text, content_type = await post_fn(url, fallback_payload, headers)
            fallback_payload["_synchropage_cache_fallback_without_fields"] = True
            return text, content_type, fallback_payload
        raise
