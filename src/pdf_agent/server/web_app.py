from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import logging
import mimetypes
import os
import re
import shutil
import threading
import urllib.parse
from collections.abc import Mapping
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from pdf_agent.auth import OpenAIOAuthApi, OpenAIOAuthError, OpenAIOAuthManager
from pdf_agent.gateway import (
    redacted_gateway_error,
)
from pdf_agent.server.constants import (
    DEFAULT_AGENT_MODEL,
    MAX_PDF_FILE_DATA_CHARS,
)
from pdf_agent.server.json_utils import (
    json_bytes_utf8_safe as _json_bytes_utf8_safe,
    repair_unicode_surrogates as _repair_unicode_surrogates,
)
from pdf_agent.server.errors import HttpError
from pdf_agent.server.model_config import ModelConfigStore
from pdf_agent.server.model_gateway import check_provider_model, fetch_provider_models, provider_endpoint_preview
from pdf_agent.server.pdf_file_cache import (
    PdfFileCache,
    raw_pdf_file_data as _raw_pdf_file_data,
)
from pdf_agent.server.value_utils import (
    env_positive_int as _env_positive_int,
    string_value as _string_value,
)
from pdf_agent.server.provider_catalog import catalog_summary, provider_model_details
from pdf_agent.server.agent_gateway import AgentChatGateway
from pdf_agent.server.teaching_gateway import TeachingGenerationGateway


PROJECT_ROOT = Path(__file__).resolve().parents[3]
SOURCE_WEB_ROOT = PROJECT_ROOT / "apps" / "web"
DIST_WEB_ROOT = SOURCE_WEB_ROOT / "dist"
WEB_ROOT = DIST_WEB_ROOT if DIST_WEB_ROOT.exists() else SOURCE_WEB_ROOT
OAUTH_CONFIG_PATH = PROJECT_ROOT / "config" / "auth" / "openai_oauth.yaml"
DEFAULT_MAX_JSON_BODY_BYTES = 100_000_000
MAX_JSON_BODY_BYTES = _env_positive_int("PDF_AGENT_MAX_JSON_BODY_BYTES", DEFAULT_MAX_JSON_BODY_BYTES)
LOGGER = logging.getLogger("pdf_agent.server.web_app")


class AsyncRunner:
    def __init__(self) -> None:
        self.loop = asyncio.new_event_loop()
        self.thread = threading.Thread(target=self._run, name="pdf-agent-async", daemon=False)
        self.thread.start()

    def run(self, awaitable: Any, *, timeout_seconds: float | None = None) -> Any:
        future = asyncio.run_coroutine_threadsafe(awaitable, self.loop)
        try:
            return future.result(timeout=timeout_seconds)
        except TimeoutError:
            LOGGER.warning(
                "AsyncRunner.run timed out after %.1fs — the coroutine may still be "
                "running on the event loop but the caller will not wait for it.",
                timeout_seconds,
            )
            raise

    def shutdown(self, *, timeout_seconds: float = 10.0) -> None:
        if not self.thread.is_alive():
            return
        future = asyncio.run_coroutine_threadsafe(self._cancel_pending_tasks(), self.loop)
        try:
            future.result(timeout=timeout_seconds)
        except Exception as exc:
            LOGGER.warning("Async shutdown did not complete cleanly: %s", redacted_gateway_error(str(exc)))
        finally:
            self.loop.call_soon_threadsafe(self.loop.stop)
            self.thread.join(timeout=timeout_seconds)
            if self.thread.is_alive():
                LOGGER.error("Async runner thread did not stop after %.1fs", timeout_seconds)

    def _run(self) -> None:
        asyncio.set_event_loop(self.loop)
        try:
            self.loop.run_forever()
        finally:
            self.loop.close()

    async def _cancel_pending_tasks(self) -> None:
        current = asyncio.current_task(self.loop)
        pending = [task for task in asyncio.all_tasks(self.loop) if task is not current and not task.done()]
        if pending:
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
        await self.loop.shutdown_asyncgens()

class PdfAgentHttpServer(ThreadingHTTPServer):
    def __init__(
        self,
        server_address: tuple[str, int],
        handler_class: type[BaseHTTPRequestHandler],
        *,
        web_root: Path,
        oauth_api: OpenAIOAuthApi,
        chat_gateway: AgentChatGateway,
        teaching_gateway: TeachingGenerationGateway,
        model_config_store: ModelConfigStore,
        runner: AsyncRunner,
        pdf_file_cache: PdfFileCache,
    ) -> None:
        super().__init__(server_address, handler_class)
        self.web_root = web_root
        self.oauth_api = oauth_api
        self.chat_gateway = chat_gateway
        self.teaching_gateway = teaching_gateway
        self.model_config_store = model_config_store
        self.runner = runner
        self.pdf_file_cache = pdf_file_cache


class PdfAgentRequestHandler(BaseHTTPRequestHandler):
    server: PdfAgentHttpServer

    def do_GET(self) -> None:
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        query = urllib.parse.parse_qs(parsed_url.query)
        try:
            if path == "/api/health":
                self._send_json({"ok": True, "service": "pdf-agent"})
            elif path == "/auth/openai/status":
                self._send_json(self.server.runner.run(self.server.oauth_api.status()))
            elif path == "/api/model-config":
                self._send_json(self.server.model_config_store.load_public())
            elif path == "/api/model-catalog":
                self._send_json(catalog_summary())
            elif path == "/api/model-catalog/models":
                provider_id = _string_value((query.get("providerId") or [""])[0], "")
                if not provider_id:
                    raise HttpError(400, "providerId is required", code="model_provider_required")
                search_query = _string_value((query.get("q") or [""])[0], "")
                limit_raw = _string_value((query.get("limit") or ["200"])[0], "200")
                try:
                    limit = max(1, min(int(limit_raw), 1000))
                except ValueError:
                    limit = 200
                self._send_json({"models": provider_model_details(provider_id, query=search_query, limit=limit)})
            else:
                self._send_static(path)
        except Exception as exc:
            self._send_exception(exc)

    def do_HEAD(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        try:
            self._send_static(path, include_body=False)
        except Exception as exc:
            self._send_exception(exc)

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/auth/openai/start":
                self._send_json(self.server.runner.run(self.server.oauth_api.start_login()))
            elif path == "/auth/openai/poll":
                body = self._read_json()
                self._send_json(self.server.runner.run(self.server.oauth_api.poll_login(str(body.get("device_code", "")))))
            elif path == "/auth/openai/logout":
                self._send_json(self.server.runner.run(self.server.oauth_api.logout()))
            elif path == "/auth/openai/default":
                body = self._read_json()
                self._send_json(self.server.runner.run(self.server.oauth_api.set_default_account(str(body.get("account_id", "")))))
            elif path == "/api/model-config":
                body = self._read_json()
                self._send_json(self.server.model_config_store.save(body))
            elif path == "/api/model-config/models":
                body = self._read_json()
                provider = body.get("provider")
                if not isinstance(provider, Mapping):
                    raise HttpError(400, "Model provider is required", code="model_provider_required")
                self._send_json(self.server.runner.run(fetch_provider_models(
                    manager=self.server.oauth_api.manager,
                    config_store=self.server.model_config_store,
                    provider_value=provider,
                )))
            elif path == "/api/model-config/preview":
                body = self._read_json()
                provider = body.get("provider")
                if not isinstance(provider, Mapping):
                    raise HttpError(400, "Model provider is required", code="model_provider_required")
                self._send_json({"url": provider_endpoint_preview(provider)})
            elif path == "/api/model-config/check":
                body = self._read_json()
                provider = body.get("provider")
                if not isinstance(provider, Mapping):
                    raise HttpError(400, "Model provider is required", code="model_provider_required")
                self._send_json(self.server.runner.run(check_provider_model(
                    provider_value=provider,
                    model=_string_value(body.get("model"), ""),
                    post_with_retries=self.server.chat_gateway._post_with_retries,
                    config_store=self.server.model_config_store,
                    manager=self.server.oauth_api.manager,
                )))
            elif path == "/api/agent/chat":
                body = self._read_json()
                self._send_json(self.server.runner.run(self.server.chat_gateway.chat(body)))
            elif path == "/api/pdf/cache":
                body = self._read_json()
                self._send_json(self._cache_pdf_file_payload(body.get("documentFile") or body))
            elif path == "/api/generate/page":
                body = self._read_json()
                self._send_json(self.server.runner.run(self.server.teaching_gateway.generate_page(body)))
            elif path == "/api/generate/pages":
                body = self._read_json()
                self._send_json(self.server.runner.run(self.server.teaching_gateway.generate_pages(body)))
            else:
                raise HttpError(404, f"Route not found: {path}", code="not_found")
        except Exception as exc:
            self._send_exception(exc)

    def do_DELETE(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        try:
            prefix = "/auth/openai/accounts/"
            if path.startswith(prefix):
                account_id = urllib.parse.unquote(path[len(prefix) :])
                self._send_json(self.server.runner.run(self.server.oauth_api.remove_account(account_id)))
            else:
                raise HttpError(404, f"Route not found: {path}", code="not_found")
        except Exception as exc:
            self._send_exception(exc)

    def log_message(self, format: str, *args: Any) -> None:
        try:
            message = format % args if args else format
        except TypeError:
            message = f"{format} {args!r}"
        LOGGER.info("%s - %s", self.address_string(), redacted_gateway_error(message))

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError as exc:
            raise HttpError(400, "Invalid Content-Length", code="invalid_content_length") from exc
        if length <= 0:
            return {}
        if length > MAX_JSON_BODY_BYTES:
            raise HttpError(
                413,
                f"JSON body is too large. Limit is {MAX_JSON_BODY_BYTES} bytes.",
                code="json_body_too_large",
            )
        raw = self.rfile.read(length).decode("utf-8")
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HttpError(400, f"Invalid JSON: {exc}", code="invalid_json") from exc
        if not isinstance(value, dict):
            raise HttpError(400, "JSON body must be an object", code="invalid_json")
        return _repair_unicode_surrogates(value)

    def _send_json(self, value: Any, *, status: int = 200) -> None:
        data = _json_bytes_utf8_safe(value, ensure_ascii=False)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _send_static(self, path: str, *, include_body: bool = True) -> None:
        file_path = _resolve_static_path(self.server.web_root, path)
        if not file_path.exists() or not file_path.is_file():
            raise HttpError(404, f"File not found: {path}", code="not_found")
        stat_result = file_path.stat()
        etag = _static_file_etag(stat_result)
        cache_control = _static_cache_control(self.server.web_root, file_path)
        if _request_etag_matches(self.headers.get("If-None-Match"), etag):
            self.send_response(HTTPStatus.NOT_MODIFIED)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache_control)
            self.end_headers()
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(stat_result.st_size))
        self.send_header("ETag", etag)
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        if include_body:
            with file_path.open("rb") as file:
                shutil.copyfileobj(file, self.wfile, length=1024 * 1024)

    def _send_exception(self, exc: Exception) -> None:
        if isinstance(exc, OpenAIOAuthError):
            status = 401 if exc.code in {"account_not_found", "refresh_token_invalid"} else 400
            self._send_json({"error": exc.code, "message": str(exc)}, status=status)
        elif isinstance(exc, HttpError):
            self._send_json({"error": exc.code, "message": str(exc)}, status=exc.status)
        else:
            self._send_json({"error": "internal_error", "message": redacted_gateway_error(str(exc))}, status=500)

    def _cache_pdf_file_payload(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, Mapping):
            raise HttpError(400, "PDF cache request did not include a document file", code="invalid_pdf_cache")
        file_data = _raw_pdf_file_data(value.get("fileData") or value.get("file_data"))
        if not file_data or len(file_data) > MAX_PDF_FILE_DATA_CHARS:
            raise HttpError(400, "PDF cache request did not include usable PDF data", code="invalid_pdf_cache")
        try:
            pdf_bytes = base64.b64decode(file_data, validate=False)
        except Exception as exc:
            raise HttpError(400, "PDF cache request contained invalid base64 data", code="invalid_pdf_cache") from exc
        if not pdf_bytes:
            raise HttpError(400, "PDF cache request contained an empty PDF", code="invalid_pdf_cache")

        sha256 = _string_value(value.get("sha256"), "") or hashlib.sha256(pdf_bytes).hexdigest()
        filename = _string_value(value.get("filename") or value.get("fileName"), "document.pdf")
        if not filename.lower().endswith(".pdf"):
            filename = f"{filename}.pdf"
        record = {
            "filename": filename,
            "mimeType": _string_value(value.get("mimeType"), "application/pdf"),
            "size": len(pdf_bytes),
            "sha256": sha256,
            "fileData": file_data,
        }
        self.server.pdf_file_cache.store(record)
        return {key: record[key] for key in ("filename", "mimeType", "size", "sha256")}


def create_server(
    host: str = "127.0.0.1",
    port: int = 8765,
    *,
    web_root: Path | None = None,
    oauth_config_path: Path = OAUTH_CONFIG_PATH,
    model: str = DEFAULT_AGENT_MODEL,
) -> PdfAgentHttpServer:
    manager = OpenAIOAuthManager(config=oauth_config_path if oauth_config_path.exists() else None)
    model_config_store = ModelConfigStore()
    runner = AsyncRunner()
    oauth_api = OpenAIOAuthApi(manager)
    pdf_file_cache = PdfFileCache()
    chat_gateway = AgentChatGateway(
        manager,
        model=model,
        config_store=model_config_store,
        pdf_file_cache=pdf_file_cache,
    )
    teaching_gateway = TeachingGenerationGateway(
        manager,
        model=model,
        config_store=model_config_store,
        pdf_file_cache=pdf_file_cache,
    )
    return PdfAgentHttpServer(
        (host, port),
        PdfAgentRequestHandler,
        web_root=web_root or _default_web_root(),
        oauth_api=oauth_api,
        chat_gateway=chat_gateway,
        teaching_gateway=teaching_gateway,
        model_config_store=model_config_store,
        runner=runner,
        pdf_file_cache=pdf_file_cache,
    )


def _default_web_root() -> Path:
    return DIST_WEB_ROOT if (DIST_WEB_ROOT / "index.html").exists() else SOURCE_WEB_ROOT


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local SynchroPage web app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--web-root", type=Path, default=None, help="Directory containing the built web UI.")
    parser.add_argument("--model", default=DEFAULT_AGENT_MODEL)
    args = parser.parse_args(argv)

    server = create_server(args.host, args.port, web_root=args.web_root, model=args.model)
    url = f"http://{args.host}:{server.server_address[1]}/"
    print(f"SynchroPage web app: {url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.runner.shutdown()
        server.server_close()
    return 0


def _resolve_static_path(web_root: Path, request_path: str) -> Path:
    decoded = urllib.parse.unquote(request_path)
    relative = "index.html" if decoded in {"", "/"} else decoded.lstrip("/")
    root = web_root.resolve()
    candidate = _resolve_under_root(root, web_root / relative)
    if candidate.is_dir():
        candidate = _resolve_under_root(root, candidate / "index.html")
    return candidate


def _resolve_under_root(root: Path, path: Path) -> Path:
    candidate = path.resolve()
    if candidate != root and root not in candidate.parents:
        raise HttpError(403, "Forbidden", code="forbidden")
    return candidate


def _static_file_etag(stat_result: os.stat_result) -> str:
    return f'W/"{stat_result.st_mtime_ns:x}-{stat_result.st_size:x}"'


def _request_etag_matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    return any(candidate.strip() in {etag, "*"} for candidate in header.split(","))


def _static_cache_control(web_root: Path, file_path: Path) -> str:
    try:
        relative = file_path.resolve().relative_to(web_root.resolve())
    except ValueError:
        relative = Path(file_path.name)
    if file_path.name == "index.html":
        return "no-cache"
    if "assets" in relative.parts or re.search(r"\.[0-9a-fA-F]{8,}\.", file_path.name):
        return "public, max-age=31536000, immutable"
    return "no-cache"


if __name__ == "__main__":
    raise SystemExit(main())
