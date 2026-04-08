from __future__ import annotations

import json
from typing import Any

import mcp.types as types
from mcp.server.lowlevel.helper_types import ReadResourceContents
from mcp.server.lowlevel.server import Server
from pydantic import AnyUrl

from lionscraper.client.daemon_client import call_daemon_tool, daemon_health
from lionscraper.client.daemon_lifecycle import ensure_local_daemon_running
from lionscraper.i18n.lang import get_tool_metadata_locale, log_t, port_lang
from lionscraper.mcp.mcp_prompts import thin_mcp_get_prompt, thin_mcp_list_prompts
from lionscraper.mcp.mcp_resources import build_thin_mcp_resources, get_thin_mcp_server_instructions
from lionscraper.mcp.tools import build_tool_definitions, tool_input_schema
from lionscraper.types.errors import ClientErrorCode
from lionscraper.utils.daemon_config import get_daemon_auth_token, get_daemon_http_base_url
from lionscraper.utils.logger import logger
from lionscraper.version import PACKAGE_VERSION

_TOOL_ORDER = (
    "ping",
    "scrape",
    "scrape_article",
    "scrape_emails",
    "scrape_phones",
    "scrape_urls",
    "scrape_images",
)


def _daemon_unreachable_result(r: dict[str, Any]) -> bool:
    if not r.get("isError"):
        return False
    content = r.get("content")
    if not isinstance(content, list) or not content:
        return False
    first = content[0]
    if not isinstance(first, dict) or first.get("type") != "text":
        return False
    text = first.get("text", "")
    try:
        j = json.loads(text)
        return j.get("error", {}).get("code") == ClientErrorCode.DAEMON_UNREACHABLE.value
    except json.JSONDecodeError:
        return False


async def _enrich_ping_development_if_needed(
    name: str,
    base_url: str,
    auth_token: str | None,
    result: dict[str, Any],
) -> dict[str, Any]:
    """Thin MCP forwards to loopback daemon; old daemons omit `development` on ping — fill from /v1/health."""
    if name != "ping" or result.get("isError"):
        return result
    content = result.get("content")
    if not isinstance(content, list) or not content:
        return result
    first = content[0]
    if not isinstance(first, dict) or first.get("type") != "text":
        return result
    try:
        body = json.loads(str(first.get("text", "")))
    except json.JSONDecodeError:
        return result
    if body.get("ok") is not True or "development" in body:
        return result
    dev = "python"
    try:
        h = await daemon_health(base_url, auth_token)
        impl = h.get("implementation")
        if impl in ("node", "python"):
            dev = impl
    except Exception:
        pass
    body["development"] = dev
    new_first = {**first, "text": json.dumps(body, ensure_ascii=False)}
    return {**result, "content": [new_first, *content[1:]]}


def _result_to_call_tool(r: dict[str, Any]) -> types.CallToolResult:
    blocks: list[types.TextContent | types.ImageContent | types.EmbeddedResource] = []
    for c in r.get("content") or []:
        if not isinstance(c, dict):
            continue
        if c.get("type") == "text":
            blocks.append(types.TextContent(type="text", text=str(c.get("text", ""))))
    if not blocks:
        blocks.append(types.TextContent(type="text", text=""))
    return types.CallToolResult(content=blocks, isError=bool(r.get("isError")))


def create_thin_mcp_server() -> Server:
    locale = get_tool_metadata_locale()
    L = port_lang()
    defs = build_tool_definitions(locale)
    resources, resource_bodies = build_thin_mcp_resources(locale)

    server = Server(
        "lionscraper",
        version=PACKAGE_VERSION,
        instructions=get_thin_mcp_server_instructions(locale),
    )

    base_url = get_daemon_http_base_url()
    auth_token = get_daemon_auth_token()

    logger.info(log_t(L, "mcpToolMetadataLocale", {"locale": locale}))

    @server.list_tools()
    async def _list_tools() -> list[types.Tool]:
        out: list[types.Tool] = []
        for key in _TOOL_ORDER:
            d = defs[key]
            out.append(
                types.Tool(
                    name=d["name"],
                    description=d["description"],
                    inputSchema=tool_input_schema(d["model"]),
                )
            )
        return out

    async def _emit_progress(notification: dict[str, Any]) -> None:
        try:
            ctx = server.request_context
        except LookupError:
            return
        if notification.get("method") != "notifications/progress":
            return
        p = notification.get("params") or {}
        token = p.get("progressToken")
        if token is None:
            return
        prog = p.get("progress", 0)
        try:
            progress_f = float(prog)
        except (TypeError, ValueError):
            progress_f = 0.0
        total = p.get("total")
        total_f: float | None
        if isinstance(total, (int, float)) and total == total:
            total_f = float(total)
        else:
            total_f = None
        await ctx.session.send_progress_notification(
            progress_token=token,
            progress=progress_f,
            total=total_f,
            message=p.get("message") if isinstance(p.get("message"), str) else None,
            related_request_id=ctx.request_id,
        )

    @server.call_tool()
    async def _call_tool(name: str, arguments: dict[str, Any] | None) -> types.CallToolResult:
        args = arguments or {}
        ctx = server.request_context
        progress_token = ctx.meta.progressToken if ctx.meta else None
        on_progress = _emit_progress if progress_token is not None else None

        try:
            result = await call_daemon_tool(
                base_url,
                name,
                args,
                auth_token=auth_token,
                progress_token=progress_token,
                on_progress=on_progress,
            )
            if _daemon_unreachable_result(result):
                try:
                    await ensure_local_daemon_running()
                    result = await call_daemon_tool(
                        base_url,
                        name,
                        args,
                        auth_token=auth_token,
                        progress_token=progress_token,
                        on_progress=on_progress,
                    )
                except Exception:
                    pass
            result = await _enrich_ping_development_if_needed(name, base_url, auth_token, result)
            return _result_to_call_tool(result)
        except Exception as err:
            logger.warn("thin MCP tool forward failed", err)
            return types.CallToolResult(
                content=[
                    types.TextContent(
                        type="text",
                        text=json.dumps(
                            {"ok": False, "error": {"message": str(err)}},
                            ensure_ascii=False,
                        ),
                    )
                ],
                isError=True,
            )

    @server.list_resources()
    async def _list_resources() -> list[types.Resource]:
        return resources

    @server.read_resource()
    async def _read_resource(uri: AnyUrl) -> list[ReadResourceContents]:
        key = str(uri)
        body = resource_bodies.get(key, "")
        return [ReadResourceContents(content=body, mime_type="text/markdown")]

    @server.list_prompts()
    async def _list_prompts() -> list[types.Prompt]:
        return thin_mcp_list_prompts(locale)

    @server.get_prompt()
    async def _get_prompt(name: str, arguments: dict[str, str] | None) -> types.GetPromptResult:
        return thin_mcp_get_prompt(locale, name, arguments)

    logger.info(log_t(port_lang(), "registeredMcpTools", {"count": len(_TOOL_ORDER)}))
    logger.info(log_t(port_lang(), "thinMcpForwardingTo", {"url": base_url}))

    return server
