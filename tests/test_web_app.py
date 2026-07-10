from __future__ import annotations

import base64
import io
import json
import tempfile
import unittest
from pathlib import Path

from pdf_agent.server.document_context import _pdf_file_input
from pdf_agent.server.errors import HttpError
from pdf_agent.server.generation_parsing import (
    _parse_generated_page,
    _parse_generated_pages,
)
from pdf_agent.server.json_utils import json_bytes_utf8_safe as _json_bytes_utf8_safe
from pdf_agent.server.prompt_cache import (
    _retry_after_seconds,
    _transient_retry_delay_seconds,
    _without_file_input,
)
from pdf_agent.server.response_parsing import (
    _extract_event_stream_text,
    _extract_gateway_text,
    _extract_prompt_cache_usage,
)
from pdf_agent.server.payload_builders import (
    _build_responses_payload,
    _build_teaching_generation_payload,
    _build_teaching_generation_prompt,
    _teaching_generation_candidate_bodies,
)
from pdf_agent.server.web_app import (
    PdfAgentHttpServer,
    PdfAgentRequestHandler,
    _request_etag_matches,
    _resolve_static_path,
    _static_cache_control,
    _static_file_etag,
    create_server,
)
from pdf_agent.gateway.openai_gateway import redacted_gateway_error
from pdf_agent.server.document_context import set_pdf_file_cache
from pdf_agent.server.pdf_file_cache import PdfFileCache
from pdf_agent.server.gateway_transport import _redacted_upstream_detail


def _handler_with_cache() -> PdfAgentRequestHandler:
    """Return a bare handler with a server that has a fresh PdfFileCache."""
    handler = PdfAgentRequestHandler.__new__(PdfAgentRequestHandler)
    server = PdfAgentHttpServer.__new__(PdfAgentHttpServer)
    cache = PdfFileCache()
    server.pdf_file_cache = cache
    set_pdf_file_cache(cache)
    handler.server = server  # type: ignore[assignment]
    return handler


def _decode_pdf_file_data(value: str) -> bytes:
    if value.startswith("data:") and "," in value:
        value = value.split(",", 1)[1]
    return base64.b64decode(value)


def _blank_pdf_file_data(page_count: int = 2) -> str:
    from PyPDF2 import PdfWriter

    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=72, height=72)
    pdf_buffer = io.BytesIO()
    writer.write(pdf_buffer)
    return base64.b64encode(pdf_buffer.getvalue()).decode("ascii")


class WebAppTest(unittest.TestCase):
    def setUp(self) -> None:
        set_pdf_file_cache(PdfFileCache())

    def test_read_json_rejects_oversized_content_length_before_reading(self) -> None:
        handler = PdfAgentRequestHandler.__new__(PdfAgentRequestHandler)
        handler.headers = {"Content-Length": "100000001"}  # type: ignore[assignment]
        handler.rfile = io.BytesIO(b"{}")  # type: ignore[assignment]

        with self.assertRaises(HttpError) as raised:
            handler._read_json()

        self.assertEqual(raised.exception.status, 413)
        self.assertEqual(raised.exception.code, "json_body_too_large")

    def test_read_json_repairs_unpaired_surrogates(self) -> None:
        raw = b'{"text":"bad \\ud835 value"}'
        handler = PdfAgentRequestHandler.__new__(PdfAgentRequestHandler)
        handler.headers = {"Content-Length": str(len(raw))}  # type: ignore[assignment]
        handler.rfile = io.BytesIO(raw)  # type: ignore[assignment]

        value = handler._read_json()

        self.assertEqual(value["text"], "bad \ufffd value")

    def test_json_bytes_repairs_surrogates_before_utf8_encoding(self) -> None:
        payload = {"text": "valid pair \ud835\udc47 and bad \ud835"}

        data = _json_bytes_utf8_safe(payload, ensure_ascii=False, separators=(",", ":"))
        decoded = json.loads(data.decode("utf-8"))

        self.assertEqual(decoded["text"], "valid pair 𝑇 and bad \ufffd")

    def test_static_path_rejects_symlinked_index_outside_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "web"
            outside = Path(tmp) / "outside"
            nested = root / "nested"
            root.mkdir()
            outside.mkdir()
            nested.mkdir()
            secret = outside / "index.html"
            secret.write_text("secret", encoding="utf-8")
            (nested / "index.html").symlink_to(secret)

            with self.assertRaises(HttpError) as raised:
                _resolve_static_path(root, "/nested/")

            self.assertEqual(raised.exception.status, 403)
            self.assertEqual(raised.exception.code, "forbidden")

    def test_retry_after_seconds_accepts_delta_seconds(self) -> None:
        self.assertEqual(_retry_after_seconds("2.5"), 2.5)
        self.assertIsNone(_retry_after_seconds("-1"))
        self.assertIsNone(_retry_after_seconds("not a date"))

    def test_transient_retry_delay_respects_retry_after_and_cap(self) -> None:
        import pdf_agent.server.prompt_cache as prompt_cache_module
        original_uniform = prompt_cache_module.random.uniform
        try:
            prompt_cache_module.random.uniform = lambda _start, _end: 0.0
            self.assertEqual(_transient_retry_delay_seconds(HttpError(429, "rate limited", retry_after_seconds=2.0), 0), 2.0)
            self.assertEqual(_transient_retry_delay_seconds(HttpError(429, "rate limited", retry_after_seconds=120.0), 0), 12.0)
        finally:
            prompt_cache_module.random.uniform = original_uniform

    def test_gateway_usage_limit_error_is_readable(self) -> None:
        message = redacted_gateway_error(
            '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","resets_in_seconds":7045}}'
        )

        self.assertIn("OpenAI usage limit reached", message)
        self.assertIn("about 1h 58m", message)

    def test_agent_payload_preserves_context_formula_and_image(self) -> None:
        payload = _build_responses_payload(
            {
                "model": "gpt-5.5",
                "document": {"id": "doc_1", "title": "Linear Algebra"},
                "page": {
                    "page_no": 7,
                    "source": {"text_md": "Eigenvectors and $Ax = \\lambda x$."},
                    "teaching": {"slide_title": "Eigenvectors", "speaker_notes_md": "Use $\\lambda$."},
                },
                "input": "解释这个公式",
                "selectedContext": {
                    "text": "D_i = Q_i^+",
                    "sourceType": "generated-explanation",
                    "documentTitle": "Linear Algebra",
                    "pageNumber": 7,
                    "sectionTitle": "讲解区选区",
                },
                "pdfContext": {
                    "documentTitle": "Linear Algebra",
                    "pageCount": 3,
                    "truncated": False,
                    "truncationPolicy": "all-pages",
                    "pages": [
                        {"page_no": 1, "title": "Intro", "text_md": "Vector spaces"},
                        {"page_no": 2, "title": "Basis", "text_md": "Basis and span"},
                        {"page_no": 3, "title": "Eigenvectors", "text_md": "Eigenvectors"},
                    ],
                },
                "parts": [
                    {"type": "text", "text": "解释这个公式"},
                    {
                        "type": "quote",
                        "title": "选区",
                        "text": "$$Ax = \\lambda x$$",
                        "source": {"page_no": 7, "document_id": "doc_1"},
                    },
                    {
                        "type": "file",
                        "name": "plot.png",
                        "mime": "image/png",
                        "data_url": "data:image/png;base64,AAAA",
                    },
                ],
                "messages": [
                    {
                        "role": "user",
                        "status": "success",
                        "parts": [{"type": "text", "text": "上一轮问题"}],
                    }
                ],
            },
            default_model="fallback-model",
        )

        self.assertEqual(payload["model"], "gpt-5.5")
        self.assertTrue(str(payload["prompt_cache_key"]).startswith("synchropage:doc_1:"))
        self.assertEqual(payload["prompt_cache_retention"], "24h")
        content = payload["input"][0]["content"]
        self.assertEqual(content[0]["type"], "input_text")
        self.assertIn("SYNCHROPAGE CACHEABLE DOCUMENT CONTEXT", content[0]["text"])
        self.assertIn("truncated_context: no", content[0]["text"])
        self.assertIn("[p.1] Intro", content[0]["text"])
        self.assertIn("[p.3] Eigenvectors", content[0]["text"])
        self.assertEqual(content[1]["type"], "input_text")
        self.assertIn("Selected source:", content[1]["text"])
        self.assertIn("PDF page: 7", content[1]["text"])
        self.assertIn("Selected explanation text:\n\nD_i = Q_i^+", content[1]["text"])
        self.assertIn("User question:\n\n解释这个公式", content[1]["text"])
        self.assertIn("# User selected source material", content[1]["text"])
        self.assertIn("D_i = Q_i^+", content[1]["text"])
        self.assertIn("$$Ax = \\lambda x$$", content[1]["text"])
        self.assertIn("上一轮问题", content[1]["text"])
        self.assertEqual(content[2], {"type": "input_image", "image_url": "data:image/png;base64,AAAA"})

    def test_agent_payload_truncates_large_pdf_context_to_edges(self) -> None:
        payload = _build_responses_payload(
            {
                "document": {"id": "doc_big", "title": "Large PDF"},
                "page": {"page_no": 30, "source": {}, "teaching": {"slide_title": "Middle"}},
                "input": "解释这段",
                "selectedContext": {
                    "text": "selected middle text",
                    "sourceType": "pdf-page",
                    "documentTitle": "Large PDF",
                    "pdfPageNumber": 30,
                },
                "pdfContext": {
                    "documentTitle": "Large PDF",
                    "pageCount": 60,
                    "truncated": True,
                    "truncationPolicy": "first-last-10",
                    "fullPageLimit": 50,
                    "edgePageCount": 10,
                    "includedPageNumbers": [*range(1, 11), *range(51, 61)],
                    "pages": [
                        {"page_no": page_no, "title": f"Page {page_no}", "text_md": f"Body {page_no}"}
                        for page_no in range(1, 61)
                    ],
                },
            },
            default_model="fallback-model",
        )

        cache_prefix = payload["input"][0]["content"][0]["text"]
        prompt = payload["input"][0]["content"][1]["text"]
        self.assertIn("truncated_context: yes", cache_prefix)
        self.assertIn("included_original_pdf_pages: 1-10, 51-60", cache_prefix)
        self.assertIn("[p.1] Page 1", cache_prefix)
        self.assertIn("[p.10] Page 10", cache_prefix)
        self.assertIn("[p.51] Page 51", cache_prefix)
        self.assertIn("[p.60] Page 60", cache_prefix)
        self.assertIn("PDF context is truncated: original PDF has 60 pages", prompt)
        self.assertIn("PDF page: 30", prompt)
        self.assertIn("outside the truncated PDF context", prompt)
        self.assertIn("Selected text:\n\nselected middle text", prompt)
        self.assertIn("User question:\n\n解释这段", prompt)
        self.assertNotIn("[p.11] Page 11", cache_prefix)
        self.assertNotIn("[p.30] Page 30", cache_prefix)

    def test_agent_payload_subsets_pdf_file_for_long_documents(self) -> None:
        from PyPDF2 import PdfReader

        file_data = _blank_pdf_file_data(12)

        payload = _build_responses_payload(
            {
                "model": "gpt-5.5",
                "document": {"id": "doc_long", "title": "Long PDF"},
                "documentFile": {"filename": "long.pdf", "fileData": file_data, "sha256": "agent-long-pdf"},
                "page": {"page_no": 7, "source": {}, "teaching": {"slide_title": "Middle"}},
                "input": "解释这一页",
                "selectedContext": {
                    "text": "middle-page selection",
                    "sourceType": "pdf-page",
                    "documentTitle": "Long PDF",
                    "pdfPageNumber": 7,
                },
                "pdfContext": {
                    "documentTitle": "Long PDF",
                    "pageCount": 12,
                    "truncated": True,
                    "fullPageLimit": 5,
                    "edgePageCount": 2,
                    "includedPageNumbers": [1, 2, 11, 12],
                    "pages": [
                        {"page_no": page_no, "title": f"Page {page_no}", "text_md": f"Body {page_no}"}
                        for page_no in range(1, 13)
                    ],
                },
            },
            default_model="fallback-model",
        )

        content = payload["input"][0]["content"]
        self.assertEqual(content[1]["type"], "input_file")
        self.assertTrue(content[1]["file_data"].startswith("data:application/pdf;base64,"))
        subset_reader = PdfReader(io.BytesIO(_decode_pdf_file_data(content[1]["file_data"])))
        self.assertEqual(len(subset_reader.pages), 5)
        self.assertIn("PDF subset is attached as an input_file for pages 1-2, 7, 11-12", content[2]["text"])

    def test_teaching_generation_payload_uses_stable_cache_prefix_before_target_page(self) -> None:
        payload = _build_teaching_generation_payload(
            {
                "model": "gpt-5.5",
                "document": {"id": "doc_1", "title": "T7 Verilog HDL", "page_count": 2},
                "documentFile": {
                    "filename": "t7.pdf",
                    "fileData": _blank_pdf_file_data(2),
                    "sha256": "a" * 64,
                },
                "documentContext": {
                    "documentId": "doc_1",
                    "documentTitle": "T7 Verilog HDL",
                    "pageCount": 2,
                    "pages": [
                        {"page_no": 1, "title": "Intro", "text_md": "counter overview"},
                        {"page_no": 2, "title": "Enable", "text_md": "count enable signal"},
                    ],
                },
                "pageCount": 2,
                "page": {
                    "page_no": 2,
                    "source": {"text_md": "count enable signal", "pdf_page_ref": "#page=2"},
                    "teaching": {"slide_title": "Enable", "speaker_notes_md": ""},
                },
            },
            default_model="fallback",
        )

        self.assertEqual(payload["model"], "gpt-5.5")
        self.assertEqual(payload["prompt_cache_retention"], "24h")
        self.assertTrue(str(payload["prompt_cache_key"]).startswith("synchropage:doc_1:"))
        content = payload["input"][0]["content"]
        self.assertEqual(content[0]["type"], "input_text")
        self.assertIn("SYNCHROPAGE CACHEABLE DOCUMENT CONTEXT", content[0]["text"])
        self.assertIn("[p.1] Intro", content[0]["text"])
        self.assertIn("[p.2] Enable", content[0]["text"])
        self.assertEqual(content[1]["type"], "input_file")
        self.assertEqual(content[1]["filename"], "t7.pdf")
        self.assertEqual(content[2]["type"], "input_text")
        self.assertIn("Target page:", content[2]["text"])
        self.assertIn("page_no: 2", content[2]["text"])

    def test_teaching_generation_fast_model_uses_compact_prompt_cache(self) -> None:
        payload = _build_teaching_generation_payload(
            {
                "model": "gpt-5.4-mini",
                "qualityPlan": {
                    "model": "gpt-5.4-mini",
                    "reasoningEffort": "none",
                    "attachPdf": False,
                    "batchable": True,
                    "reasons": ["text-fast-path"],
                },
                "document": {"id": "doc_1", "title": "Fast PDF", "page_count": 2},
                "documentContext": {
                    "documentId": "doc_1",
                    "documentTitle": "Fast PDF",
                    "pageCount": 2,
                    "pages": [{"page_no": 1, "title": "Intro", "text_md": "overview"}],
                },
                "page": {"page_no": 1, "source": {"text_md": "overview", "pdf_page_ref": "#page=1"}},
            },
            default_model="fallback",
        )

        self.assertEqual(payload["model"], "gpt-5.4-mini")
        self.assertEqual(payload["reasoning"]["effort"], "none")
        self.assertIn("Generate SynchroPage teaching notes", payload["instructions"])
        content = payload["input"][0]["content"]
        self.assertEqual(content[0]["type"], "input_text")
        self.assertIn("SYNCHROPAGE CACHEABLE DOCUMENT CONTEXT", content[0]["text"])
        self.assertIn("[p.1] Intro", content[0]["text"])
        self.assertEqual(content[1]["type"], "input_text")
        self.assertIn("Pages JSONL:", content[1]["text"])
        self.assertTrue(str(payload["prompt_cache_key"]).startswith("synchropage:doc_1:"))
        self.assertEqual(payload["prompt_cache_retention"], "24h")

    def test_teaching_generation_candidate_bodies_try_fast_model_then_fallback(self) -> None:
        candidates = _teaching_generation_candidate_bodies(
            {
                "model": "gpt-5.4-mini",
                "fallbackModel": "gpt-5.5",
                "documentFile": {"filename": "lecture.pdf", "fileData": _blank_pdf_file_data(2)},
                "page": {"page_no": 1},
            }
        )

        self.assertEqual(
            [candidate[0].get("model") for candidate in candidates],
            ["gpt-5.4-mini", "gpt-5.5", "gpt-5.4-mini", "gpt-5.5"],
        )
        self.assertEqual([document_file_used for _body, document_file_used in candidates], [True, True, False, False])
        self.assertIn("documentFile", candidates[0][0])
        self.assertNotIn("documentFile", candidates[2][0])

    def test_pdf_file_input_can_subset_to_target_pages(self) -> None:
        from PyPDF2 import PdfReader

        file_data = _blank_pdf_file_data(3)

        file_input = _pdf_file_input({"filename": "three.pdf", "fileData": file_data}, page_numbers=[2])

        self.assertIsNotNone(file_input)
        assert file_input is not None
        self.assertTrue(file_input["file_data"].startswith("data:application/pdf;base64,"))
        subset_reader = PdfReader(io.BytesIO(_decode_pdf_file_data(file_input["file_data"])))
        self.assertEqual(len(subset_reader.pages), 1)

    def test_pdf_file_input_reuses_cached_page_subset(self) -> None:
        from PyPDF2 import PdfReader, PdfWriter

        writer = PdfWriter()
        for _ in range(3):
            writer.add_blank_page(width=72, height=72)
        pdf_buffer = io.BytesIO()
        writer.write(pdf_buffer)
        file_data = base64.b64encode(pdf_buffer.getvalue()).decode("ascii")
        sha256 = "subset-cache-test"

        first = _pdf_file_input({"filename": "three.pdf", "fileData": file_data, "sha256": sha256}, page_numbers=[2])
        second = _pdf_file_input({"filename": "three.pdf", "fileData": "not-a-pdf", "sha256": sha256}, page_numbers=[2])

        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        assert first is not None and second is not None
        self.assertEqual(first["file_data"], second["file_data"])
        subset_reader = PdfReader(io.BytesIO(_decode_pdf_file_data(second["file_data"])))
        self.assertEqual(len(subset_reader.pages), 1)

    def test_pdf_file_input_does_not_fallback_to_full_pdf_when_subset_fails(self) -> None:
        file_input = _pdf_file_input(
            {"filename": "broken.pdf", "fileData": "not-a-pdf"},
            page_numbers=[2],
            fallback_to_original_on_subset_failure=False,
        )

        self.assertIsNone(file_input)

    def test_agent_payload_omits_pdf_file_when_required_subset_fails(self) -> None:
        payload = _build_responses_payload(
            {
                "model": "gpt-5.5",
                "document": {"id": "doc_long", "title": "Long PDF", "page_count": 303},
                "documentFile": {"filename": "broken.pdf", "fileData": "not-a-pdf", "sha256": "broken"},
                "pdfContext": {
                    "documentId": "doc_long",
                    "documentTitle": "Long PDF",
                    "pageCount": 303,
                    "fullPageLimit": 50,
                    "edgePageCount": 10,
                    "truncated": True,
                    "includedPageNumbers": [1, 2, 3, 301, 302, 303],
                    "pages": [
                        {"page_no": 1, "title": "Intro", "text_md": "intro"},
                        {"page_no": 303, "title": "End", "text_md": "end"},
                    ],
                },
                "page": {"page_no": 9, "source": {"text_md": "selected page"}, "teaching": {}},
                "input": "解释选中内容",
            },
            default_model="fallback",
        )

        content = payload["input"][0]["content"]
        self.assertFalse(any(part.get("type") == "input_file" for part in content))
        self.assertTrue(str(payload["prompt_cache_key"]).startswith("synchropage:doc_long:"))

    def test_without_file_input_preserves_cache_context_and_prompt(self) -> None:
        payload = {
            "model": "gpt-5.5",
            "prompt_cache_key": "synchropage:doc:abc",
            "input": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "SYNCHROPAGE CACHEABLE DOCUMENT CONTEXT\n\n[p.1] Intro",
                        },
                        {
                            "type": "input_file",
                            "filename": "lecture.pdf",
                            "file_data": "data:application/pdf;base64,JVBERi0x",
                        },
                        {"type": "input_text", "text": "User question"},
                    ],
                }
            ],
        }

        fallback = _without_file_input(payload)

        content = fallback["input"][0]["content"]
        self.assertEqual([part["type"] for part in content], ["input_text", "input_text"])
        self.assertTrue(content[0]["text"].startswith("SYNCHROPAGE CACHEABLE DOCUMENT CONTEXT"))
        self.assertEqual(content[1]["text"], "User question")
        self.assertIn("prompt_cache_key", fallback)

    def test_teaching_generation_payload_subsets_pdf_file_to_batch_pages(self) -> None:
        from PyPDF2 import PdfReader, PdfWriter

        writer = PdfWriter()
        for _ in range(5):
            writer.add_blank_page(width=72, height=72)
        pdf_buffer = io.BytesIO()
        writer.write(pdf_buffer)
        file_data = base64.b64encode(pdf_buffer.getvalue()).decode("ascii")

        payload = _build_teaching_generation_payload(
            {
                "model": "gpt-5.5",
                "documentFile": {"filename": "five.pdf", "fileData": file_data},
                "pages": [
                    {"page_no": 2, "source": {"text_md": "", "pdf_page_ref": "#page=2"}},
                    {"page_no": 4, "source": {"text_md": "", "pdf_page_ref": "#page=4"}},
                ],
            },
            default_model="fallback",
        )

        file_part = payload["input"][0]["content"][0]
        self.assertEqual(file_part["type"], "input_file")
        self.assertTrue(file_part["file_data"].startswith("data:application/pdf;base64,"))
        subset_reader = PdfReader(io.BytesIO(_decode_pdf_file_data(file_part["file_data"])))
        self.assertEqual(len(subset_reader.pages), 2)

    def test_teaching_generation_payload_can_use_cached_pdf_reference(self) -> None:
        from PyPDF2 import PdfReader, PdfWriter

        writer = PdfWriter()
        for _ in range(4):
            writer.add_blank_page(width=72, height=72)
        pdf_buffer = io.BytesIO()
        writer.write(pdf_buffer)
        file_data = base64.b64encode(pdf_buffer.getvalue()).decode("ascii")
        cached = _handler_with_cache()._cache_pdf_file_payload({"filename": "cached.pdf", "fileData": file_data})

        payload = _build_teaching_generation_payload(
            {
                "model": "gpt-5.5",
                "documentFile": {"filename": cached["filename"], "sha256": cached["sha256"]},
                "page": {"page_no": 3, "source": {"text_md": "", "pdf_page_ref": "#page=3"}},
            },
            default_model="fallback",
        )

        file_part = payload["input"][0]["content"][0]
        self.assertEqual(file_part["type"], "input_file")
        subset_reader = PdfReader(io.BytesIO(_decode_pdf_file_data(file_part["file_data"])))
        self.assertEqual(len(subset_reader.pages), 1)

    def test_server_pdf_cache_is_not_overwritten_by_later_server(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing_config = Path(tmp) / "missing-oauth.yaml"
            server_a = create_server(port=0, oauth_config_path=missing_config)
            server_b = create_server(port=0, oauth_config_path=missing_config)
            try:
                handler = PdfAgentRequestHandler.__new__(PdfAgentRequestHandler)
                handler.server = server_a  # type: ignore[assignment]
                cached = handler._cache_pdf_file_payload({
                    "filename": "cached.pdf",
                    "fileData": _blank_pdf_file_data(1),
                })

                self.assertIs(server_a.chat_gateway.pdf_file_cache, server_a.pdf_file_cache)
                self.assertIs(server_a.teaching_gateway.pdf_file_cache, server_a.pdf_file_cache)
                payload = _build_responses_payload(
                    {
                        "model": "gpt-5.5",
                        "input": "Use the cached PDF",
                        "documentFile": {"filename": cached["filename"], "sha256": cached["sha256"]},
                    },
                    default_model="fallback",
                    pdf_file_cache=server_a.pdf_file_cache,
                )
                other_payload = _build_responses_payload(
                    {
                        "model": "gpt-5.5",
                        "input": "Use the cached PDF",
                        "documentFile": {"filename": cached["filename"], "sha256": cached["sha256"]},
                    },
                    default_model="fallback",
                    pdf_file_cache=server_b.pdf_file_cache,
                )

                self.assertTrue(any(part.get("type") == "input_file" for part in payload["input"][0]["content"]))
                self.assertFalse(any(part.get("type") == "input_file" for part in other_payload["input"][0]["content"]))
            finally:
                server_a.runner.shutdown()
                server_a.server_close()
                server_b.runner.shutdown()
                server_b.server_close()

    def test_teaching_batch_prompt_uses_single_schema_contract(self) -> None:
        prompt = _build_teaching_generation_prompt(
            {
                "pages": [
                    {"page_no": 3, "source": {"text_md": "first target text", "pdf_page_ref": "#page=3"}},
                    {"page_no": 7, "source": {"text_md": "second target text", "pdf_page_ref": "#page=7"}},
                ],
                "pageCount": 10,
            }
        )

        self.assertIn("Target page numbers:", prompt)
        self.assertEqual(prompt.count('"page_no":"<target_page_no>"'), 1)
        self.assertEqual(prompt.count('"speaker_notes_md"'), 1)
        self.assertNotIn('"concepts"', prompt)
        self.assertNotIn('"evidence"', prompt)
        self.assertIn("--- Target page 3 ---", prompt)
        self.assertIn("--- Target page 7 ---", prompt)
        self.assertIn("first target text", prompt)
        self.assertIn("second target text", prompt)

    def test_teaching_prompt_limits_fast_source_text_more_aggressively(self) -> None:
        long_text = ("A" * 4100) + "AFTER_FAST_LIMIT"
        prompt = _build_teaching_generation_prompt(
            {
                "model": "gpt-5.4-mini",
                "qualityPlan": {
                    "model": "gpt-5.4-mini",
                    "reasoningEffort": "none",
                    "attachPdf": False,
                    "batchable": True,
                    "reasons": ["text-fast-path"],
                },
                "document": {"id": "doc_fast", "title": "Fast PDF", "page_count": 1},
                "page": {"page_no": 1, "source": {"text_md": long_text, "pdf_page_ref": "#page=1"}},
            }
        )

        self.assertNotIn("AFTER_FAST_LIMIT", prompt)
        self.assertNotIn("For binary counting sequences", prompt)
        self.assertNotIn("Document:", prompt)
        self.assertNotIn("Generation quality plan:", prompt)
        self.assertIn("Pages JSONL:", prompt)

    def test_fast_teaching_missing_confidence_defaults_to_reviewable_value(self) -> None:
        page = _parse_generated_page(
            json.dumps(
                {
                    "page": {
                        "page_no": 1,
                        "teaching": {
                            "slide_title": "Intro",
                            "speaker_notes_md": "A concise but confidence-free fast response.",
                        },
                    }
                }
            ),
            {
                "model": "gpt-5.4-mini",
                "qualityPlan": {
                    "model": "gpt-5.4-mini",
                    "reasoningEffort": "none",
                    "attachPdf": False,
                    "batchable": True,
                    "reasons": ["text-fast-path"],
                },
                "page": {"page_no": 1, "source": {"text_md": "overview", "pdf_page_ref": "#page=1"}},
            },
        )

        self.assertLess(page["teaching"]["confidence"], 0.58)
        self.assertTrue(page["teaching"]["needs_review"])

    def test_fast_teaching_batch_prompt_uses_compact_jsonl_pages(self) -> None:
        prompt = _build_teaching_generation_prompt(
            {
                "model": "gpt-5.4-mini",
                "qualityPlan": {
                    "model": "gpt-5.4-mini",
                    "reasoningEffort": "low",
                    "attachPdf": False,
                    "batchable": True,
                    "reasons": ["text-fast-path"],
                },
                "pages": [
                    {"page_no": 3, "source": {"text_md": "first target text", "pdf_page_ref": "#page=3"}},
                    {"page_no": 7, "source": {"text_md": "second target text", "pdf_page_ref": "#page=7"}},
                ],
                "pageCount": 10,
            }
        )

        self.assertIn("Pages JSONL:", prompt)
        self.assertIn('"page_no":3', prompt)
        self.assertIn('"source_text":"first target text"', prompt)
        self.assertIn('"page_no":7', prompt)
        self.assertIn('"source_text":"second target text"', prompt)
        self.assertEqual(prompt.count('"page_no":"<requested_page_no>"'), 1)
        self.assertEqual(prompt.count('"speaker_notes_md"'), 1)
        self.assertIn('"confidence"', prompt)
        self.assertIn('"needs_review"', prompt)
        self.assertNotIn('"needs_parser_fallback"', prompt)
        self.assertNotIn("--- Target page", prompt)
        self.assertNotIn("Document:", prompt)
        self.assertNotIn("existing_notes:", prompt)

    def test_teaching_prompt_keeps_more_source_text_for_balanced_pages(self) -> None:
        long_text = ("A" * 4100) + "BALANCED_VISIBLE"
        prompt = _build_teaching_generation_prompt(
            {
                "model": "gpt-5.4",
                "qualityPlan": {
                    "model": "gpt-5.4",
                    "reasoningEffort": "medium",
                    "attachPdf": False,
                    "batchable": True,
                    "reasons": ["formula"],
                },
                "document": {"id": "doc_balanced", "title": "Balanced PDF", "page_count": 1},
                "page": {"page_no": 1, "source": {"text_md": long_text, "pdf_page_ref": "#page=1"}},
            }
        )

        self.assertIn("BALANCED_VISIBLE", prompt)

    def test_balanced_teaching_model_uses_prompt_cache_fields(self) -> None:
        payload = _build_teaching_generation_payload(
            {
                "model": "gpt-5.4",
                "qualityPlan": {
                    "model": "gpt-5.4",
                    "reasoningEffort": "medium",
                    "attachPdf": False,
                    "batchable": True,
                    "reasons": ["formula"],
                },
                "document": {"id": "doc_balanced", "title": "Balanced PDF", "page_count": 1},
                "documentContext": {
                    "documentId": "doc_balanced",
                    "documentTitle": "Balanced PDF",
                    "pageCount": 1,
                    "pages": [{"page_no": 1, "title": "Formula", "text_md": "$a+b$"}],
                },
                "page": {"page_no": 1, "source": {"text_md": "$a+b$", "pdf_page_ref": "#page=1"}},
            },
            default_model="fallback",
        )

        self.assertTrue(str(payload["prompt_cache_key"]).startswith("synchropage:doc_balanced:"))
        self.assertEqual(payload["prompt_cache_retention"], "24h")

    def test_agent_and_teaching_share_document_cache_prefix(self) -> None:
        body = {
            "model": "gpt-5.5",
            "document": {"id": "doc_shared", "title": "Shared PDF", "page_count": 2},
            "pdfContext": {
                "documentId": "doc_shared",
                "documentTitle": "Shared PDF",
                "pageCount": 2,
                "pages": [
                    {"page_no": 1, "title": "Intro", "text_md": "overview"},
                    {"page_no": 2, "title": "Counters", "text_md": "counter details"},
                ],
            },
            "documentContext": {
                "documentId": "doc_shared",
                "documentTitle": "Shared PDF",
                "pageCount": 2,
                "pages": [
                    {"page_no": 1, "title": "Intro", "text_md": "overview"},
                    {"page_no": 2, "title": "Counters", "text_md": "counter details"},
                ],
            },
            "page": {
                "page_no": 2,
                "source": {"text_md": "counter details", "pdf_page_ref": "#page=2"},
                "teaching": {"slide_title": "Counters", "speaker_notes_md": ""},
            },
            "input": "解释这一页",
        }

        agent_payload = _build_responses_payload(body, default_model="fallback")
        teaching_payload = _build_teaching_generation_payload(body, default_model="fallback")

        self.assertEqual(
            agent_payload["input"][0]["content"][0]["text"],
            teaching_payload["input"][0]["content"][0]["text"],
        )
        self.assertEqual(agent_payload["prompt_cache_key"], teaching_payload["prompt_cache_key"])
        self.assertEqual(agent_payload["instructions"], teaching_payload["instructions"])
        self.assertIn("You are the AI agent panel inside SynchroPage.", agent_payload["input"][0]["content"][1]["text"])
        self.assertIn("You are the SynchroPage per-page teaching generator.", teaching_payload["input"][0]["content"][1]["text"])

    def test_document_cache_prefix_is_stable_for_page_order(self) -> None:
        base = {
            "model": "gpt-5.5",
            "document": {"id": "doc_order", "title": "Ordered PDF", "page_count": 2},
            "page": {
                "page_no": 1,
                "source": {"text_md": "intro", "pdf_page_ref": "#page=1"},
                "teaching": {"slide_title": "Intro", "speaker_notes_md": ""},
            },
            "input": "总结",
        }
        body_a = {
            **base,
            "pdfContext": {
                "documentId": "doc_order",
                "documentTitle": "Ordered PDF",
                "pageCount": 2,
                "pages": [
                    {"page_no": 2, "title": "Second", "text_md": "second page"},
                    {"page_no": 1, "title": "First", "text_md": "first page"},
                ],
            },
        }
        body_b = {
            **base,
            "pdfContext": {
                "documentId": "doc_order",
                "documentTitle": "Ordered PDF",
                "pageCount": 2,
                "pages": [
                    {"page_no": 1, "title": "First", "text_md": "first page"},
                    {"page_no": 2, "title": "Second", "text_md": "second page"},
                ],
            },
        }

        payload_a = _build_responses_payload(body_a, default_model="fallback")
        payload_b = _build_responses_payload(body_b, default_model="fallback")
        prefix_a = payload_a["input"][0]["content"][0]["text"]
        prefix_b = payload_b["input"][0]["content"][0]["text"]

        self.assertEqual(payload_a["prompt_cache_key"], payload_b["prompt_cache_key"])
        self.assertEqual(prefix_a, prefix_b)
        self.assertIn("cache_version: synchropage.document-prefix.v1", prefix_a)
        self.assertLess(prefix_a.index("[p.1] First"), prefix_a.index("[p.2] Second"))

    def test_generated_page_normalizes_mixed_language_latex_ranges(self) -> None:
        bad_notes = (
            r"计数范围是 $0 到 \2^n-1$。"
            "\n"
            r"三位计数器会 $000 数到 \111，然后回到 \000$。"
            "\n"
            r"状态转移：$000 \to 001 \to 010 \to \cdots \to 111 \to 000"
            "\n。表中的状态如下。"
        )
        page = _parse_generated_page(
            json.dumps(
                {
                    "page_no": 1,
                    "source": {"text_md": "n-bit counter range", "pdf_page_ref": "#page=1"},
                    "teaching": {
                        "slide_title": "Counter range",
                        "speaker_notes_md": bad_notes,
                        "concepts": ["counter"],
                        "confidence": 0.9,
                    },
                }
            ),
            {
                "page": {
                    "page_no": 1,
                    "source": {"text_md": "n-bit counter range", "pdf_page_ref": "#page=1"},
                }
            },
        )

        self.assertIn("$0 \\text{到} 2^n-1$", page["teaching"]["speaker_notes_md"])
        self.assertIn("$000 \\text{数到} 111\\text{，然后回到} 000$", page["teaching"]["speaker_notes_md"])
        self.assertIn(
            "$000 \\to 001 \\to 010 \\to \\cdots \\to 111 \\to 000$\n。表中的",
            page["teaching"]["speaker_notes_md"],
        )

    def test_generated_page_repairs_unescaped_latex_backslashes_in_json(self) -> None:
        content = r'''
{
  "page_no": 2,
  "source": {
    "text_md": "counter state transition",
    "pdf_page_ref": "#page=2"
  },
  "teaching": {
    "slide_title": "Counter states",
    "speaker_notes_md": "第一行\n状态转移：$000 \to 001 \to \cdots \to 111$，特征值 $\lambda$，分式 $\frac{a}{b}$。",
    "concepts": ["counter"],
    "confidence": 0.91
  },
  "status": "ready"
}
'''
        page = _parse_generated_page(
            content,
            {
                "page": {
                    "page_no": 2,
                    "source": {"text_md": "counter state transition", "pdf_page_ref": "#page=2"},
                }
            },
        )

        notes = page["teaching"]["speaker_notes_md"]
        self.assertIn("第一行\n状态转移", notes)
        self.assertIn("$000 \\to 001 \\to \\cdots \\to 111$", notes)
        self.assertIn("$\\lambda$", notes)
        self.assertIn("$\\frac{a}{b}$", notes)
        self.assertNotIn("\t", notes)
        self.assertNotIn("\f", notes)

    def test_generated_page_wraps_bare_latex_and_escaped_markdown_newlines(self) -> None:
        bad_notes = (
            r"本页延续上一页，重点仍是如何用 MATLAB 画出系统的冲激响应。\n"
            r"- tf(num,den) 是连续时间传递函数的标准构造方式。\n"
            r"- 对该 notch filter，传递函数写成 \frac{s^2 + 1.421e05}{s^2 + 2s + 1.421e05}。\n"
            r"- 用 impulse(sys,Tfinal) 可以直接得到系统对单位冲激的时域响应。"
        )
        page = _parse_generated_page(
            json.dumps(
                {
                    "page_no": 3,
                    "source": {"text_md": "MATLAB notch filter impulse response", "pdf_page_ref": "#page=3"},
                    "teaching": {
                        "slide_title": "Impulse response",
                        "speaker_notes_md": bad_notes,
                        "concepts": ["notch filter"],
                        "confidence": 0.88,
                    },
                }
            ),
            {
                "page": {
                    "page_no": 3,
                    "source": {"text_md": "MATLAB notch filter impulse response", "pdf_page_ref": "#page=3"},
                }
            },
        )

        notes = page["teaching"]["speaker_notes_md"]
        self.assertIn("\n- tf(num,den)", notes)
        self.assertNotIn(r"\n- tf(num,den)", notes)
        self.assertIn(
            "$\\frac{s^2 + 1.421e05}{s^2 + 2s + 1.421e05}$",
            notes,
        )

    def test_generated_pages_parse_batch_response_by_page_number(self) -> None:
        content = json.dumps(
            {
                "pages": [
                    {
                        "page_no": 4,
                        "source": {"text_md": "second target", "pdf_page_ref": "#page=4"},
                        "teaching": {
                            "slide_title": "Second target",
                            "speaker_notes_md": "Notes for page 4",
                            "confidence": 0.88,
                        },
                    },
                    {
                        "page_no": 3,
                        "source": {"text_md": "first target", "pdf_page_ref": "#page=3"},
                        "teaching": {
                            "slide_title": "First target",
                            "speaker_notes_md": "Notes for page 3",
                            "confidence": 0.9,
                        },
                    },
                ]
            }
        )
        pages = _parse_generated_pages(
            content,
            {
                "pages": [
                    {"page_no": 3, "source": {"text_md": "first target", "pdf_page_ref": "#page=3"}},
                    {"page_no": 4, "source": {"text_md": "second target", "pdf_page_ref": "#page=4"}},
                ],
            },
        )

        self.assertEqual([page["page_no"] for page in pages], [3, 4])
        self.assertEqual(pages[0]["teaching"]["slide_title"], "First target")
        self.assertEqual(pages[1]["teaching"]["slide_title"], "Second target")

    def test_generated_page_preserves_input_source_text_when_model_omits_it(self) -> None:
        page = _parse_generated_page(
            json.dumps(
                {
                    "page_no": 7,
                    "teaching": {
                        "slide_title": "No Echo",
                        "speaker_notes_md": "Concise notes without copying source.",
                        "confidence": 0.86,
                    },
                }
            ),
            {
                "page": {
                    "page_no": 7,
                    "source": {"text_md": "original source text that should stay local", "pdf_page_ref": "#page=7"},
                }
            },
        )

        self.assertEqual(page["source"]["text_md"], "original source text that should stay local")

    def test_generated_page_with_pdf_file_does_not_force_parser_fallback_for_empty_text(self) -> None:
        page = _parse_generated_page(
            json.dumps(
                {
                    "page_no": 4,
                    "teaching": {
                        "slide_title": "Visual Page",
                        "speaker_notes_md": "## Visual Page\n\nExplain the attached PDF page.",
                        "confidence": 0.82,
                    },
                }
            ),
            {
                "documentFile": {"filename": "visual.pdf", "fileData": "JVBERi0x"},
                "page": {
                    "page_no": 4,
                    "source": {"text_md": "", "pdf_page_ref": "#page=4"},
                },
            },
        )

        self.assertFalse(page["teaching"]["needs_parser_fallback"])
        self.assertFalse(page["teaching"]["needs_review"])
        self.assertEqual(page["teaching"]["confidence"], 0.82)

    def test_extracts_streaming_response_text(self) -> None:
        stream = "\n".join(
            [
                'data: {"type":"response.output_text.delta","delta":"hello "}',
                'data: {"type":"response.output_text.delta","delta":"world"}',
                "data: [DONE]",
            ]
        )
        self.assertEqual(_extract_gateway_text(stream, "text/event-stream"), "hello world")

    def test_extracts_streaming_prompt_cache_usage(self) -> None:
        stream = "\n".join(
            [
                'data: {"type":"response.output_text.delta","delta":"hello"}',
                'data: {"type":"response.completed","response":{"usage":{"input_tokens":2048,"output_tokens":12,"total_tokens":2060,"input_tokens_details":{"cached_tokens":1536}}}}',
                "data: [DONE]",
            ]
        )
        self.assertEqual(
            _extract_prompt_cache_usage(stream, "text/event-stream"),
            {
                "cached_tokens": 1536,
                "cache_hit": True,
                "input_tokens": 2048,
                "cached_ratio": 0.75,
                "output_tokens": 12,
                "total_tokens": 2060,
            },
        )

    def test_extracts_gpt_56_cache_write_tokens(self) -> None:
        text = json.dumps(
            {
                "usage": {
                    "input_tokens": 2400,
                    "input_tokens_details": {
                        "cached_tokens": 1200,
                        "cache_write_tokens": 800,
                    },
                }
            }
        )

        usage = _extract_prompt_cache_usage(text, "application/json")
        self.assertEqual(usage["cached_tokens"], 1200)
        self.assertEqual(usage["cache_write_tokens"], 800)

    def test_extracts_json_response_text(self) -> None:
        text = json.dumps(
            {
                "output": [
                    {
                        "content": [
                            {"type": "output_text", "text": "json reply"},
                        ]
                    }
                ]
            }
        )
        self.assertEqual(_extract_gateway_text(text, "application/json"), "json reply")

    def test_extracts_json_prompt_cache_usage(self) -> None:
        text = json.dumps(
            {
                "usage": {
                    "prompt_tokens": 2006,
                    "completion_tokens": 300,
                    "total_tokens": 2306,
                    "prompt_tokens_details": {"cached_tokens": 1920},
                }
            }
        )
        self.assertEqual(
            _extract_prompt_cache_usage(text, "application/json"),
            {
                "cached_tokens": 1920,
                "cache_hit": True,
                "input_tokens": 2006,
                "cached_ratio": 0.9571,
                "output_tokens": 300,
                "total_tokens": 2306,
            },
        )

    # -- SSE response.failed error redaction ---------------------------------

    def test_sse_response_failed_redacts_bearer_token_in_error(self) -> None:
        """``response.failed`` events must redact Bearer tokens before raising HttpError."""
        stream = (
            'data: {"type":"response.failed","error":{"code":"auth_error",'
            '"message":"Invalid auth: Bearer sk-secret123"}}\n'
            "data: [DONE]\n"
        )
        with self.assertRaises(HttpError) as raised:
            _extract_event_stream_text(stream)
        self.assertEqual(raised.exception.code, "upstream_error")
        self.assertNotIn("sk-secret123", str(raised.exception))
        self.assertIn("<redacted>", str(raised.exception))
        self.assertIn("auth_error", str(raised.exception).lower())

    def test_sse_response_failed_falls_back_to_event_body(self) -> None:
        """When ``error`` is not a dict the whole event is used."""
        stream = (
            'data: {"type":"response.failed","message":"internal error"}\n'
            "data: [DONE]\n"
        )
        with self.assertRaises(HttpError) as raised:
            _extract_event_stream_text(stream)
        self.assertEqual(raised.exception.code, "upstream_error")

    # -- prompt cache usage edge cases ---------------------------------------

    def test_extracts_prompt_cache_with_legacy_cached_input_tokens(self) -> None:
        text = json.dumps({
            "usage": {
                "input_tokens": 1000,
                "output_tokens": 200,
                "total_tokens": 1200,
                "cached_input_tokens": 500,
            }
        })
        usage = _extract_prompt_cache_usage(text, "application/json")
        self.assertTrue(usage["cache_hit"])
        self.assertEqual(usage["cached_tokens"], 500)

    def test_extracts_prompt_cache_miss_when_cached_is_zero(self) -> None:
        text = json.dumps({
            "usage": {
                "prompt_tokens": 1024,
                "completion_tokens": 128,
                "total_tokens": 1152,
                "prompt_tokens_details": {"cached_tokens": 0},
            }
        })
        usage = _extract_prompt_cache_usage(text, "application/json")
        self.assertFalse(usage["cache_hit"])
        self.assertEqual(usage["cached_tokens"], 0)

    def test_extracts_prompt_cache_from_plain_text_returns_empty(self) -> None:
        usage = _extract_prompt_cache_usage("not json", "text/plain")
        self.assertEqual(usage, {})

    def test_extracts_prompt_cache_from_sse_with_usage_at_top_level(self) -> None:
        stream = (
            'data: {"usage":{"input_tokens":500,"output_tokens":50,'
            '"total_tokens":550,"input_tokens_details":{"cached_tokens":300}}}\n'
            "data: [DONE]\n"
        )
        usage = _extract_prompt_cache_usage(stream, "text/event-stream")
        self.assertTrue(usage["cache_hit"])
        self.assertEqual(usage["cached_tokens"], 300)

    def test_static_path_rejects_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "index.html").write_text("ok")
            self.assertEqual(_resolve_static_path(root, "/").name, "index.html")
            with self.assertRaises(HttpError):
                _resolve_static_path(root, "/../secret.txt")

    def test_static_cache_headers_support_revalidation_and_immutable_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            assets = root / "assets"
            assets.mkdir()
            index = root / "index.html"
            app = assets / "app.abcdef12.js"
            plain = root / "manifest.json"
            index.write_text("ok")
            app.write_text("console.log('ok')")
            plain.write_text("{}")

            etag = _static_file_etag(index.stat())
            self.assertTrue(_request_etag_matches(etag, etag))
            self.assertTrue(_request_etag_matches(f'"other", {etag}', etag))
            self.assertFalse(_request_etag_matches('"other"', etag))
            self.assertEqual(_static_cache_control(root, index), "no-cache")
            self.assertEqual(_static_cache_control(root, app), "public, max-age=31536000, immutable")
            self.assertEqual(_static_cache_control(root, plain), "no-cache")

    # -- gateway transport truncation ---------------------------------------

    def test_gateway_redaction_truncates_long_raw_upstream_text(self) -> None:
        long_html = "<html>" + ("X" * 4000) + "</html>"
        result = _redacted_upstream_detail(long_html)
        self.assertLessEqual(len(result), 2100)  # 2000 + small redaction overhead
        self.assertIn("XXX", result)
        self.assertNotIn("</html>", result)

    def test_gateway_redaction_preserves_short_error(self) -> None:
        short = '{"error": "bad request"}'
        result = _redacted_upstream_detail(short)
        self.assertIn("bad request", result)

    def test_gateway_redaction_handles_truncated_json_secret(self) -> None:
        long_secret = '{"access_token":"' + ("s" * 4000) + '"}'
        result = _redacted_upstream_detail(long_secret)
        self.assertIn("<redacted>", result)
        self.assertNotIn("ssss", result)


if __name__ == "__main__":
    unittest.main()
