from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pdf_agent.server.constants import MODEL_GPT_56_SOL

AgentRole = Literal[
    "document_planner",
    "page_teacher",
    "page_reviewer",
    "page_repairer",
]

RunStatus = Literal[
    "queued",
    "planning",
    "generating",
    "reviewing",
    "repairing",
    "ready",
    "needs_review",
    "failed",
    "canceled",
]

PageStatus = Literal[
    "queued",
    "running",
    "ready",
    "needs_review",
    "needs_parser_fallback",
    "failed",
    "canceled",
]

PageType = Literal[
    "title",
    "agenda",
    "concept",
    "example",
    "figure",
    "table",
    "formula",
    "exercise",
    "summary",
    "blank",
    "unknown",
]

ParserName = Literal["gpt-5.5-direct", "docling", "pymupdf", "mineru", "manual"]


@dataclass(frozen=True)
class PdfReference:
    kind: Literal["openai_file_id", "signed_url", "local_path"]
    value: str


@dataclass(frozen=True)
class HarnessInput:
    document_id: str
    document_sha256: str
    pdf: PdfReference
    prompt_version: str
    schema_version: str
    model: str = MODEL_GPT_56_SOL
    title: str | None = None
    target_pages: list[int] | None = None
    max_concurrency: int = 3
    token_budget: int | None = None
    page_budget: int | None = None
    force_parser_fallback: bool = False
    cache_prefix_hash: str | None = None


@dataclass(frozen=True)
class Evidence:
    kind: Literal["title", "keyword", "formula", "figure", "table", "caption", "layout", "other"]
    quote_or_reference: str


@dataclass(frozen=True)
class PageSource:
    page_no: int
    pdf_page_ref: str
    page_type: PageType
    text_md: str
    parser: ParserName
    ocr_used: bool
    content_hash: str


@dataclass(frozen=True)
class PageTeaching:
    slide_title: str
    speaker_notes_md: str
    concepts: list[str]
    prerequisites: list[str]
    contextual_bridge: str
    visual_explanations: list[str]
    formula_explanations: list[str]
    evidence: list[Evidence]
    confidence: float
    needs_review: bool
    needs_parser_fallback: bool


@dataclass(frozen=True)
class PageResult:
    page_no: int
    source: PageSource
    teaching: PageTeaching | None
    status: PageStatus
    error: str | None = None


@dataclass(frozen=True)
class AgentRunParams:
    role: AgentRole
    prompt: str
    model: str
    schema: dict[str, Any]
    pdf: PdfReference
    target_pages: list[int]
    metadata: dict[str, str]
    document_plan: dict[str, Any] | None = None
    page_json: dict[str, Any] | None = None


@dataclass(frozen=True)
class AgentUsage:
    output_tokens: int
    input_tokens: int | None = None


@dataclass(frozen=True)
class AgentRunResult:
    kind: Literal["ok", "dead"]
    output: dict[str, Any] | None = None
    usage: AgentUsage = field(default_factory=lambda: AgentUsage(output_tokens=0))
    model: str | None = None
    reason: str | None = None
    detail: str | None = None


@dataclass(frozen=True)
class JournalEntry:
    key: str
    seq: int
    role: AgentRole
    target_pages: list[int]
    result: AgentRunResult
