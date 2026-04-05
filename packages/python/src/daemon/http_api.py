from __future__ import annotations

import asyncio
import json
from typing import TYPE_CHECKING, Any

from aiohttp import web

from lionscraper.i18n.lang import get_tool_metadata_locale
from lionscraper.mcp.handler import McpToolHandlerExtra
from lionscraper.mcp.validate_tool_input import validate_tool_input
from lionscraper.types.bridge import BridgeMethod
from lionscraper.utils.daemon_config import get_daemon_auth_token
from lionscraper.utils.logger import logger

if TYPE_CHECKING:
    from lionscraper.core.bridge_service import BridgeService

TOOL_NAMES = frozenset(
    {
        "ping",
        "scrape",
        "scrape_article",
        "scrape_emails",
        "scrape_phones",
        "scrape_urls",
        "scrape_images",
    }
)

BRIDGE_METHODS = frozenset(
    {
        "scrape",
        "scrape_article",
        "scrape_emails",
        "scrape_phones",
        "scrape_urls",
        "scrape_images",
    }
)


def _unauthorized() -> web.Response:
    return web.json_response(
        {"ok": False, "error": {"code": "UNAUTHORIZED", "message": "Invalid or missing bearer token"}},
        status=401,
    )


def _bad_request(message: str) -> web.Response:
    return web.json_response({"ok": False, "error": {"code": "BAD_REQUEST", "message": message}}, status=400)


def _check_auth(request: web.Request) -> bool:
    token = get_daemon_auth_token()
    if not token:
        return True
    h = request.headers.get("Authorization", "")
    if not h.startswith("Bearer "):
        return False
    return h[7:] == token


def _wants_ndjson_stream(request: web.Request, body: dict[str, Any]) -> bool:
    accept = (request.headers.get("Accept") or "").lower()
    stream = body.get("progressToken") is not None
    return stream and "application/x-ndjson" in accept


async def _read_json_body(request: web.Request) -> dict[str, Any] | None:
    raw = (await request.read()).decode("utf-8").strip()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def _unsupported_send_request(*_a: Any, **_k: Any) -> Any:
    raise RuntimeError("sendRequest not supported in daemon HTTP")


def _create_tool_extra_ndjson(
    response: web.StreamResponse,
    progress_token: str | int,
) -> McpToolHandlerExtra:
    async def send_notification(notification: dict[str, Any]) -> None:
        line = json.dumps({"type": "progress", "notification": notification}, ensure_ascii=False) + "\n"
        await response.write(line.encode("utf-8"))

    return {
        "requestId": 0,
        "_meta": {"progressToken": progress_token},
        "sendNotification": send_notification,
        "sendRequest": _unsupported_send_request,
    }


def _create_tool_extra_no_progress() -> McpToolHandlerExtra:
    async def send_notification(_notification: dict[str, Any]) -> None:
        return None

    return {
        "requestId": 0,
        "sendNotification": send_notification,
        "sendRequest": _unsupported_send_request,
    }


async def _handle_tools_call(service: BridgeService, request: web.Request) -> web.StreamResponse | web.Response:
    if not _check_auth(request):
        return _unauthorized()
    body = await _read_json_body(request)
    if body is None:
        return _bad_request("Invalid JSON body")

    name = body.get("name")
    if not isinstance(name, str) or name not in TOOL_NAMES:
        return _bad_request("Unknown or missing tool name")

    raw_args = body["arguments"] if isinstance(body.get("arguments"), dict) else {}
    locale = get_tool_metadata_locale()
    verr = validate_tool_input(name, raw_args, locale)
    if verr:
        return _bad_request(f"Invalid arguments: {verr}")

    args = dict(raw_args)

    stream = _wants_ndjson_stream(request, body)

    if stream:
        resp = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "application/x-ndjson; charset=utf-8",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Transfer-Encoding": "chunked",
            },
        )
        await resp.prepare(request)
        extra = _create_tool_extra_ndjson(resp, body["progressToken"])
        try:
            if name == "ping":
                result = await service.tool_handler.handle_ping(args, extra)
            else:
                result = await service.tool_handler.handle_tool(name, args, extra)  # type: ignore[arg-type]
            line = json.dumps({"type": "result", **result}, ensure_ascii=False) + "\n"
            await resp.write(line.encode("utf-8"))
        except Exception as err:
            logger.error("daemon tool call failed", err)
            line = json.dumps(
                {"type": "error", "error": {"message": str(err) if err else "error"}},
                ensure_ascii=False,
            ) + "\n"
            await resp.write(line.encode("utf-8"))
        await resp.write_eof()
        return resp

    extra2 = _create_tool_extra_no_progress()
    try:
        if name == "ping":
            result = await service.tool_handler.handle_ping(args, extra2)
        elif name in BRIDGE_METHODS:
            result = await service.tool_handler.handle_tool(name, args, extra2)  # type: ignore[arg-type]
        else:
            return _bad_request("Invalid tool for bridge")
        return web.json_response(result)
    except Exception as err:
        logger.error("daemon tool call failed", err)
        return web.json_response(
            {"ok": False, "error": {"code": "INTERNAL", "message": str(err) if err else "error"}},
            status=500,
        )


def _handle_health(service: BridgeService, request: web.Request) -> web.Response:
    if not _check_auth(request):
        return _unauthorized()
    return web.json_response(
        {
            "ok": True,
            "identity": "lionscraper",
            "bridgePort": service.listening_port,
            "sessionCount": service.bridge.session_manager.session_count,
        }
    )


def attach_daemon_api(service: BridgeService, app: web.Application) -> None:
    async def health(request: web.Request) -> web.Response:
        return _handle_health(service, request)

    async def shutdown(request: web.Request) -> web.Response:
        if not _check_auth(request):
            return _unauthorized()
        loop = asyncio.get_running_loop()
        loop.call_soon(service.bridge.request_shutdown_from_loopback_http)
        return web.json_response({"ok": True})

    async def tools_call(request: web.Request) -> web.StreamResponse | web.Response:
        return await _handle_tools_call(service, request)

    async def not_found(_request: web.Request) -> web.Response:
        return web.json_response(
            {"ok": False, "error": {"code": "NOT_FOUND", "message": "Not found"}},
            status=404,
        )

    app.router.add_get("/v1/health", health)
    app.router.add_post("/v1/daemon/shutdown", shutdown)
    app.router.add_post("/v1/tools/call", tools_call)
    app.router.add_route("*", "/{tail:.*}", not_found)
