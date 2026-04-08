from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Literal

from lionscraper.client.daemon_client import call_daemon_tool, daemon_health
from lionscraper.client.daemon_lifecycle import ensure_local_daemon_running
from lionscraper.cli.build_tool_args import (
    build_invocation_from_argv,
    parse_api_url,
    parse_output_flags,
    validate_cli_numeric_tool_args,
)
from lionscraper.i18n.lang import port_lang, port_t
from lionscraper.types.errors import BridgeErrorCode, ClientErrorCode
from lionscraper.utils.daemon_config import get_daemon_auth_token, get_daemon_http_base_url
from lionscraper.utils.logger import set_log_level
from lionscraper.utils.port import get_configured_port, stop_lionscraper_on_port_sync
from lionscraper.version import PACKAGE_VERSION


async def _enrich_cli_ping_text_async(base_url: str, auth: str | None, text: str, is_error: bool) -> str:
    """Old daemons omit `development` on ping — fill from GET /v1/health (same as thin MCP)."""
    if is_error:
        return text
    try:
        body = json.loads(text)
    except json.JSONDecodeError:
        return text
    if body.get("ok") is not True or "development" in body:
        return text
    dev = "python"
    try:
        h = await daemon_health(base_url, auth)
        impl = h.get("implementation")
        if impl in ("node", "python"):
            dev = impl
    except Exception:
        pass
    body["development"] = dev
    return json.dumps(body, ensure_ascii=False)


def _print_help() -> None:
    sys.stderr.write(
        """LionScraper CLI (daemon + HTTP control plane)

Usage:
  lionscraper daemon [--debug]           Start bridge + HTTP API (keep running)
  lionscraper stop                     Stop daemon on PORT (WebSocket forceShutdown probe)
  lionscraper scrape [options]         Run a scrape* tool via daemon HTTP
  lionscraper ping [options]           Run ping via daemon HTTP
  lionscraper --help | -h              Show this help
  lionscraper --version                Print version

Scrape options (subset):
  -u, --url <url>              Target URL (repeat for multiple)
  --method scrape|article|emails|phones|urls|images   (default: scrape)
  --lang en-US|zh-CN
  --delay, --timeout-ms, --bridge-timeout-ms, --max-pages, ...
  --format json|pretty         (default: json)
  --raw                        Print tool text block as-is
  -o, --output <file>          Write stdout result to file
  --api-url <base>             Daemon HTTP base (default: http://127.0.0.1:$PORT, PORT default 13808)

Before scrape/ping: start the daemon in another terminal (or rely on auto-start when not using --api-url):
  lionscraper daemon

MCP (Trae/Cursor): use command "lionscraper-mcp" or pip-installed entry (stdio → daemon HTTP on same PORT).
HTTP and WebSocket share PORT (default 13808); set PORT in MCP env to match the extension bridgePort.
"""
    )


async def _run_tool_cli(subcmd_args: list[str], mode: Literal["scrape", "ping"]) -> None:
    api_override = parse_api_url(subcmd_args)
    base_url = api_override or get_daemon_http_base_url()
    auth = get_daemon_auth_token()
    did_spawn = False

    try:
        if not api_override:
            ensured = await ensure_local_daemon_running()
            did_spawn = bool(ensured.get("didSpawn"))
        else:
            await daemon_health(base_url, auth)
    except Exception:
        sys.stderr.write(
            f"Error: cannot reach LionScraper daemon at {base_url}.\nStart it with: lionscraper daemon\n",
        )
        raise SystemExit(1)

    inv = build_invocation_from_argv(subcmd_args, mode)
    name = inv["name"]
    tool_args: dict[str, Any] = inv["arguments"]
    out_opts = parse_output_flags(subcmd_args)

    num_err = validate_cli_numeric_tool_args(tool_args)
    if num_err:
        sys.stderr.write(f"Error: {num_err}\n")
        raise SystemExit(1)

    if mode == "scrape" and tool_args.get("url") is None:
        sys.stderr.write("Error: missing --url (-u)\n")
        raise SystemExit(1)

    L_cli = port_lang()
    if mode == "scrape" and did_spawn:
        sys.stderr.write(f"{port_t(L_cli, 'cliAutoPingAfterSpawn')}\n")
        ping_args: dict[str, Any] = {}
        if tool_args.get("lang") in ("zh-CN", "en-US"):
            ping_args["lang"] = tool_args["lang"]
        await call_daemon_tool(base_url, "ping", ping_args, auth_token=auth)
    elif mode == "ping" and did_spawn:
        sys.stderr.write(f"{port_t(L_cli, 'cliPingAfterDaemonSpawn')}\n")

    result = await call_daemon_tool(base_url, name, tool_args, auth_token=auth)

    text = (
        result["content"][0]["text"]
        if result.get("content") and result["content"][0].get("type") == "text"
        else json.dumps(result.get("content", []))
    )

    if mode == "ping":
        text = await _enrich_cli_ping_text_async(base_url, auth, text, bool(result.get("isError")))

    try:
        err_body = json.loads(text)
        if err_body.get("error", {}).get("code") == ClientErrorCode.DAEMON_UNREACHABLE.value:
            sys.stderr.write(f"{port_t(L_cli, 'cliDaemonUnreachableStderr')}\n")
        ext_details = (err_body.get("error") or {}).get("details") or {}
        if (
            (mode in ("scrape", "ping"))
            and err_body.get("ok") is False
            and err_body.get("error", {}).get("code") == BridgeErrorCode.EXTENSION_NOT_CONNECTED.value
            and ext_details.get("daemonReachable") is True
        ):
            sys.stderr.write(f"{port_t(L_cli, 'cliExtensionNotConnectedStderr')}\n")
            if ext_details.get("extensionStoreOpened") is True:
                browser = "Microsoft Edge" if ext_details.get("extensionStoreBrowser") == "edge" else "Chrome"
                sys.stderr.write(f"{port_t(L_cli, 'cliExtensionStoreOpenedStderr', {'browser': browser})}\n")
    except json.JSONDecodeError:
        pass

    if out_opts["raw"]:
        payload = text
    else:
        try:
            parsed = json.loads(text)
            if out_opts["format"] == "pretty":
                payload = json.dumps(parsed, indent=2, ensure_ascii=False)
            else:
                payload = json.dumps(parsed, ensure_ascii=False)
        except json.JSONDecodeError:
            payload = text

    op = out_opts.get("outputPath")
    if op:
        Path(op).write_text(payload + ("\n" if not payload.endswith("\n") else ""), encoding="utf-8")
    else:
        sys.stdout.write(payload + "\n")

    if result.get("isError"):
        raise SystemExit(2)
    try:
        j = json.loads(text)
        if j.get("ok") is False:
            raise SystemExit(2)
    except json.JSONDecodeError:
        pass


def _run_stop_cli() -> None:
    L = port_lang()
    port = get_configured_port()
    try:
        result = stop_lionscraper_on_port_sync(port)
        if result == "idle":
            sys.stderr.write(f"{port_t(L, 'cliDaemonNotRunning', {'port': port})}\n")
            return
        sys.stderr.write(f"{port_t(L, 'cliDaemonStopped', {'port': port})}\n")
    except Exception as e:
        sys.stderr.write(f"{e}\n")
        raise SystemExit(1)


async def _async_main(argv: list[str]) -> None:
    if not argv or argv[0] in ("-h", "--help"):
        _print_help()
        raise SystemExit(0)

    if argv[0] in ("--version", "-v"):
        sys.stdout.write(f"{PACKAGE_VERSION}\n")
        return

    if argv[0] == "daemon":
        from lionscraper.daemon.daemon_main import run_daemon_from_cli

        run_daemon_from_cli(argv[1:])
        return

    if argv[0] == "stop":
        _run_stop_cli()
        return

    if argv[0] == "scrape":
        await _run_tool_cli(argv[1:], "scrape")
        return

    if argv[0] == "ping":
        await _run_tool_cli(argv[1:], "ping")
        return

    if "-u" in argv or "--url" in argv:
        await _run_tool_cli(argv, "scrape")
        return

    sys.stderr.write(f"Unknown command: {argv[0]}\n")
    _print_help()
    raise SystemExit(1)


def run_lionscraper_cli() -> None:
    import asyncio

    argv = sys.argv[1:]
    if "--debug" in argv:
        set_log_level("debug")
    try:
        asyncio.run(_async_main(argv))
    except KeyboardInterrupt:
        raise SystemExit(130)
