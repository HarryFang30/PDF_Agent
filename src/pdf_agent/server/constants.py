"""Shared constants for the SynchroPage server.

These are pure configuration values — no runtime logic, no imports from
other server modules.  Any module (document_context, payload_builders,
gateway, web_app) can import from here without circular-import risk.
"""

from __future__ import annotations

import os

from pdf_agent.server.value_utils import env_positive_int as _env_positive_int

# ---------------------------------------------------------------------------
# Context / prompt character budgets
# ---------------------------------------------------------------------------

MAX_CONTEXT_ITEMS = 10
MAX_CONTEXT_CHARS = 16_000
MAX_TEACHING_FAST_SOURCE_CHARS = 2_500
MAX_TEACHING_BALANCED_SOURCE_CHARS = 8_000
MAX_TEACHING_QUALITY_SOURCE_CHARS = 16_000
MAX_PDF_CONTEXT_CHARS = 120_000
MAX_TEACHING_CACHE_CHARS = 750_000

# ---------------------------------------------------------------------------
# PDF page context
# ---------------------------------------------------------------------------

PDF_CONTEXT_FULL_PAGE_LIMIT = 50
PDF_CONTEXT_EDGE_PAGE_COUNT = 10
MAX_AGENT_PDF_SUBSET_PAGES = 40

# ---------------------------------------------------------------------------
# Attachments & file limits
# ---------------------------------------------------------------------------

MAX_TRANSCRIPT_MESSAGES = 8
MAX_IMAGE_ATTACHMENTS = 8
MAX_IMAGE_DATA_URL_CHARS = 8_000_000
MAX_PDF_FILE_DATA_CHARS = 80_000_000

# ---------------------------------------------------------------------------
# Prompt-cache document prefix version — must match the key built by
# prompt_cache.py and the prefix emitted by document_context.py.
# ---------------------------------------------------------------------------

DOCUMENT_CACHE_PREFIX_VERSION = "synchropage.document-prefix.v1"

# ---------------------------------------------------------------------------
# Instructions / prompt text (shared across payload builders)
# ---------------------------------------------------------------------------

SYNCHROPAGE_SHARED_INSTRUCTIONS = """You are the model backend for SynchroPage.
Use the provided PDF/page context, selected text, formulas, images, and task-specific instructions as primary evidence.
Preserve LaTeX formulas, cite page numbers when available, and do not invent facts that are not supported by the provided source material.
Follow the task-specific instructions included in each request, including any required output format."""

SYNCHROPAGE_FAST_TEACHING_INSTRUCTIONS = (
    "Generate SynchroPage teaching notes from the compact document context and provided page source. "
    "Return strict JSON only, preserve technical tokens/LaTeX, and do not invent unsupported facts."
)

AGENT_INSTRUCTIONS = """You are the AI agent panel inside SynchroPage.
Use the current PDF/page context, selected text, formulas, and image attachments as primary evidence.
Answer in the user's language, preserve LaTeX formulas, cite page numbers when available, and keep the response useful for study, review, or editing.
Follow the answer-mode instructions included in each request."""

TEACHING_GENERATOR_INSTRUCTIONS = """You are the SynchroPage per-page teaching generator.
Generate page-aligned study notes for one PDF page at a time.
Return strict JSON only. Do not wrap JSON in Markdown fences.
Use the requested output language from the prompt for all prose. Preserve formulas in LaTeX using $...$ or $$...$$.
For display math, put opening and closing $$ on their own lines and do not attach prose to the same line.
When writing LaTeX in JSON strings, escape every LaTeX backslash as a JSON backslash pair, for example write \\\\frac and \\\\to.
Do not put natural-language Chinese text directly inside math delimiters. Write ranges like $0$ 到 $2^n - 1$, or use $0 \\text{ 到 } 2^n - 1$.
Never escape digits in LaTeX; write 2^n, not \\2^n.
Never escape binary strings; write 000, 111, not \\000 or \\111.
For binary counting sequences, write $000 \\to 001 \\to 010 \\to \\cdots \\to 111 \\to 000$ and close math before Chinese prose.
Render tables as GitHub-Flavored Markdown tables inside speaker_notes_md when the source page contains tabular content.
Keep speaker_notes_md concise: prefer 4-7 focused bullets or short sections, avoid restating the source text line by line, and only expand when formulas, tables, or derivations need it.
Do not invent facts that are not supported by the source page text. If the page has no extractable text, mark it as needs_parser_fallback."""

TEACHING_GENERATOR_FAST_INSTRUCTIONS = """You are the SynchroPage per-page teaching generator.
Return strict JSON only. Use the requested output language for all prose.
Keep speaker_notes_md concise, explain rather than transcribe, preserve technical tokens, and do not invent unsupported facts.
Escape LaTeX backslashes in JSON strings, for example write \\\\frac and \\\\to."""

# ---------------------------------------------------------------------------
# Gateway defaults
# ---------------------------------------------------------------------------

# Canonical model identifiers used across backend modules.
# Update these constants when model names change rather than hunting through
# string literals in gateway / prompt-cache / payload-builder code.
MODEL_GPT_56 = "gpt-5.6"
MODEL_GPT_56_SOL = "gpt-5.6-sol"
MODEL_GPT_56_TERRA = "gpt-5.6-terra"
MODEL_GPT_56_LUNA = "gpt-5.6-luna"
MODEL_GPT_55 = "gpt-5.5"
MODEL_GPT_54 = "gpt-5.4"
MODEL_GPT_54_MINI = "gpt-5.4-mini"

GPT_56_MODELS: tuple[str, ...] = (
    MODEL_GPT_56_SOL,
    MODEL_GPT_56_TERRA,
    MODEL_GPT_56_LUNA,
    MODEL_GPT_56,
)

DEFAULT_AGENT_MODEL = os.environ.get("PDF_AGENT_MODEL", MODEL_GPT_56_SOL)

TEACHING_API_CONCURRENCY = 6
TEACHING_UPSTREAM_TIMEOUT_SECONDS = _env_positive_int("PDF_AGENT_TEACHING_TIMEOUT_SECONDS", 90)
AGENT_RETRY_DELAYS_SECONDS: tuple[float, ...] = (0.75, 2.0)
TEACHING_RATE_LIMIT_MIN_COOLDOWN_SECONDS = 0.75
