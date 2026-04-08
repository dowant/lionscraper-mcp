from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any, TypedDict

from lionscraper.bridge.protocol import BridgeProgressParams
from lionscraper.bridge.timeout import params_for_extension, resolve_bridge_timeout_ms
from lionscraper.bridge.websocket import BridgeServer
from lionscraper.core.http_fetch_fallback import run_http_fetch_fallback
from lionscraper.i18n.lang import SupportedLang, log_t, normalize_lang, port_lang, t
from lionscraper.types.bridge import BridgeMethod
from lionscraper.types.errors import (
    BridgeErrorCode,
    LionScraperError,
    SystemErrorCode,
    create_error,
    create_extension_not_connected_error,
    is_lion_scraper_error,
)
from lionscraper.utils.browser_env import (
    BrowserEnv,
    BrowserKind,
    default_browser_env,
    try_open_extension_store_install_page,
)
from lionscraper.utils.logger import logger

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
BRIDGE_DISCONNECT_MAX_EXTRA_RETRIES = 2
BRIDGE_DISCONNECT_RETRY_DELAYS_MS = (400, 800, 1600)
PING_POLL_INTERVAL_MS = 400
PING_WAIT_MS_MIN = 3_000
PING_WAIT_MS_MAX = 60_000
PING_WAIT_MS_DEFAULT = 20_000


class McpToolHandlerExtra(TypedDict, total=False):
    signal: Any
    requestId: int
    _meta: dict[str, Any]
    sendNotification: Callable[[dict[str, Any]], Awaitable[None]]
    sendRequest: Callable[..., Awaitable[Any]]


def _sleep_ms(ms: int) -> Awaitable[None]:
    return asyncio.sleep(ms / 1000.0)


def _resolve_auto_launch_browser(args: dict[str, Any] | None) -> bool:
    if args is not None and "autoLaunchBrowser" in args:
        return args.get("autoLaunchBrowser") is True
    return True


def _resolve_post_launch_wait_ms(args: dict[str, Any] | None) -> int:
    raw = (args or {}).get("postLaunchWaitMs")
    n = int(round(raw)) if isinstance(raw, (int, float)) and raw == raw else PING_WAIT_MS_DEFAULT
    return min(PING_WAIT_MS_MAX, max(PING_WAIT_MS_MIN, n))


async def _wait_for_extension_session(
    get_session_info: Callable[[], dict[str, str] | None],
    max_ms: int,
    interval_ms: int,
) -> int:
    loop = asyncio.get_running_loop()
    start = loop.time()
    while (loop.time() - start) * 1000 < max_ms:
        if get_session_info() is not None:
            return int((loop.time() - start) * 1000)
        remaining = max_ms - int((loop.time() - start) * 1000)
        if remaining <= 0:
            break
        await _sleep_ms(min(interval_ms, remaining))
    return int((loop.time() - start) * 1000)


def _get_progress_token(extra: McpToolHandlerExtra | None) -> str | int | None:
    if not extra:
        return None
    meta = extra.get("_meta")
    if not isinstance(meta, dict):
        return None
    return meta.get("progressToken")


async def _forward_bridge_progress_to_mcp(
    extra: McpToolHandlerExtra,
    payload: BridgeProgressParams,
    seq: list[int],
) -> None:
    token = _get_progress_token(extra)
    if token is None:
        return

    prog_raw = payload.get("progress")
    if isinstance(prog_raw, (int, float)) and prog_raw == prog_raw:
        progress = float(prog_raw)
    else:
        seq[0] += 1
        progress = float(seq[0])
    total_raw = payload.get("total")
    total = float(total_raw) if isinstance(total_raw, (int, float)) and total_raw == total_raw else None

    message = payload.get("message")
    phase = payload.get("phase")
    if phase:
        message = f"[{phase}] {message}" if message else f"[{phase}]"

    meta: dict[str, Any] = {}
    data = payload.get("data")
    if isinstance(data, dict):
        meta["lionscraper"] = data

    params: dict[str, Any] = {
        "progressToken": token,
        "progress": progress,
    }
    if total is not None:
        params["total"] = total
    if message is not None:
        params["message"] = message
    if meta:
        params["_meta"] = meta

    notification = {"method": "notifications/progress", "params": params}
    try:
        await extra["sendNotification"](notification)
    except Exception:
        pass


TryOpenExtensionStoreFn = Callable[[BrowserEnv], Awaitable[dict[str, str] | None]]


class ToolHandler:
    def __init__(
        self,
        bridge: BridgeServer,
        browser_env: BrowserEnv | None = None,
        try_open_extension_store: TryOpenExtensionStoreFn | None = None,
    ):
        self._bridge = bridge
        self._browser_env_override = browser_env
        self._try_open_store = try_open_extension_store or try_open_extension_store_install_page

    @property
    def _browser_env(self) -> BrowserEnv:
        return default_browser_env if self._browser_env_override is None else self._browser_env_override

    async def _extension_not_connected_response(
        self,
        lang: SupportedLang,
        options: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        launch = await self._try_open_store(self._browser_env)
        merged: dict[str, Any] = dict(options) if options else {}
        if launch is not None:
            merged["extensionStoreLaunch"] = launch
        err = create_extension_not_connected_error(
            {
                "bridgePort": self._bridge.bridge_port,
                "sessionCount": self._bridge.session_manager.session_count,
            },
            lang,
            merged if merged else None,
        )
        return self._format_error_response(err)

    async def handle_ping(
        self,
        args: dict[str, Any] | None = None,
        _extra: McpToolHandlerExtra | None = None,
    ) -> dict[str, Any]:
        args = args or {}
        lang = normalize_lang(args.get("lang"))
        if self._bridge.is_draining():
            err = create_error(BridgeErrorCode.SERVER_DRAINING, t(lang, "server_draining.requests"))
            return self._format_error_response(err)

        get_session = lambda: self._bridge.session_manager.get_session_info()
        session_info = get_session()
        if session_info:
            result = {
                "ok": True,
                "bridgeOk": True,
                "browser": session_info["browser"],
                "development": "python",
                "extensionVersion": session_info["extensionVersion"],
            }
            return self._format_success_response(result, lang)

        chrome_path = await self._browser_env.detect_chrome_install()
        edge_path = await self._browser_env.detect_edge_install()
        if not chrome_path and not edge_path:
            return self._format_success_response(
                {
                    "ok": True,
                    "bridgeOk": False,
                    "development": "python",
                    "extensionConnected": False,
                    "scrapingMode": "http_fetch",
                    "diagnostics": {
                        "httpFetchFallback": True,
                        "message": t(lang, "http_fetch_fallback.note"),
                    },
                },
                lang,
            )

        candidates: list[tuple[BrowserKind, str]] = []
        if chrome_path:
            candidates.append(("chrome", chrome_path))
        if edge_path:
            candidates.append(("edge", edge_path))

        auto_launch = _resolve_auto_launch_browser(args)
        wait_ms = _resolve_post_launch_wait_ms(args)

        last_probe: dict[str, Any] | None = None

        for kind, path in candidates:
            session_info = get_session()
            if session_info:
                result = {
                    "ok": True,
                    "bridgeOk": True,
                    "browser": session_info["browser"],
                    "development": "python",
                    "extensionVersion": session_info["extensionVersion"],
                }
                return self._format_success_response(result, lang)

            running = await self._browser_env.is_browser_running(kind)

            if not running:
                if not auto_launch:
                    last_probe = {
                        "selectedBrowser": kind,
                        "browserRunning": False,
                        "autoLaunchBrowser": False,
                        "executablePath": path,
                    }
                    continue

                launch_pid = self._browser_env.launch_browser(path, kind)
                waited_ms = await _wait_for_extension_session(get_session, wait_ms, PING_POLL_INTERVAL_MS)
                session_info = get_session()
                if session_info:
                    return self._format_success_response(
                        {
                            "ok": True,
                            "bridgeOk": True,
                            "browser": session_info["browser"],
                            "development": "python",
                            "extensionVersion": session_info["extensionVersion"],
                            "diagnostics": {
                                "browserAssist": True,
                                "selectedBrowser": kind,
                                "launched": True,
                                "waitedMs": waited_ms,
                            },
                        },
                        lang,
                    )

                if launch_pid is not None:
                    await self._browser_env.quit_launched_browser(launch_pid)

                last_probe = {
                    "selectedBrowser": kind,
                    "browserRunning": False,
                    "browserLaunched": True,
                    "waitedMs": waited_ms,
                    "executablePath": path,
                    "nextStep": "install_or_enable_lionscraper_extension_or_check_bridge_port",
                }
                continue

            waited_running_ms = await _wait_for_extension_session(get_session, wait_ms, PING_POLL_INTERVAL_MS)
            session_info = get_session()
            if session_info:
                return self._format_success_response(
                    {
                        "ok": True,
                        "bridgeOk": True,
                        "browser": session_info["browser"],
                        "development": "python",
                        "extensionVersion": session_info["extensionVersion"],
                        "diagnostics": {
                            "browserAssist": True,
                            "selectedBrowser": kind,
                            "launched": False,
                            "waitedMs": waited_running_ms,
                        },
                    },
                    lang,
                )

            last_probe = {
                "selectedBrowser": kind,
                "browserRunning": True,
                "waitedMs": waited_running_ms,
                "nextStep": "install_or_enable_lionscraper_extension_or_check_bridge_port",
            }

        fb_kind = candidates[-1][0] if candidates else "chrome"
        return await self._extension_not_connected_response(
            lang,
            {"browserProbe": last_probe or {"selectedBrowser": fb_kind, "browserRunning": False}},
        )

    async def handle_tool(
        self,
        method: BridgeMethod,
        params: dict[str, Any],
        extra: McpToolHandlerExtra | None = None,
    ) -> dict[str, Any]:
        lang = normalize_lang(params.get("lang"))
        if self._bridge.is_draining():
            err = create_error(BridgeErrorCode.SERVER_DRAINING, t(lang, "server_draining.new_tasks"))
            return self._format_error_response(err)

        if not self._bridge.session_manager.has_connected_extension():
            chrome_path = await self._browser_env.detect_chrome_install()
            edge_path = await self._browser_env.detect_edge_install()
            if not chrome_path and not edge_path:
                try:
                    result = await run_http_fetch_fallback(method, params, lang)
                    return self._format_success_response(result, lang)
                except LionScraperError as err:
                    return self._format_error_response(err)
                except Exception as err:
                    return self._format_error_response(
                        create_error(
                            SystemErrorCode.EXTENSION_INTERNAL_ERROR,
                            str(err) if err else "unknown",
                        )
                    )
            return await self._extension_not_connected_response(lang)

        bridge_timeout_ms = resolve_bridge_timeout_ms(params)
        extension_params = params_for_extension(params)

        for attempt in range(BRIDGE_DISCONNECT_MAX_EXTRA_RETRIES + 1):
            try:
                seq: list[int] = [0]

                async def on_progress(p: BridgeProgressParams) -> None:
                    if extra:
                        await _forward_bridge_progress_to_mcp(extra, p, seq)

                result = await self._bridge.send_to_extension(
                    method,
                    extension_params,
                    bridge_timeout_ms,
                    on_progress if extra else None,
                )
                return self._format_success_response(result, lang)
            except LionScraperError as err:
                error: LionScraperError = err
            except Exception as err:
                error = create_error(
                    SystemErrorCode.EXTENSION_INTERNAL_ERROR,
                    str(err) if err else "unknown",
                )

            will_retry = error.code == BridgeErrorCode.BRIDGE_DISCONNECTED.value and attempt < BRIDGE_DISCONNECT_MAX_EXTRA_RETRIES
            if will_retry:
                delay_ms = (
                    BRIDGE_DISCONNECT_RETRY_DELAYS_MS[attempt]
                    if attempt < len(BRIDGE_DISCONNECT_RETRY_DELAYS_MS)
                    else BRIDGE_DISCONNECT_RETRY_DELAYS_MS[-1]
                )
                L = port_lang()
                logger.info(
                    log_t(
                        L,
                        "toolBridgeDisconnectedRetry",
                        {
                            "method": method,
                            "attempt": attempt + 1,
                            "maxAttempts": BRIDGE_DISCONNECT_MAX_EXTRA_RETRIES + 1,
                            "delayMs": delay_ms,
                        },
                    )
                )
                await _sleep_ms(delay_ms)
                continue

            if is_lion_scraper_error(error):
                logger.error(log_t(port_lang(), "toolFailed", {"method": method}), error)
            return self._format_error_response(error)

        raise RuntimeError(f"Tool {method}: unreachable after bridge disconnect retries")

    def _format_success_response(self, result: Any, lang: SupportedLang) -> dict[str, Any]:
        text = json.dumps(result, ensure_ascii=False)
        if len(text) > MAX_RESPONSE_BYTES:
            text = self._truncate_result(result, lang)
        return {"content": [{"type": "text", "text": text}]}

    def _format_error_response(self, error: LionScraperError) -> dict[str, Any]:
        body: dict[str, Any] = {
            "ok": False,
            "error": {"code": error.code, "message": error.message},
        }
        if error.details is not None:
            body["error"]["details"] = error.details
        return {"content": [{"type": "text", "text": json.dumps(body, ensure_ascii=False)}], "isError": True}

    def _truncate_result(self, result: Any, lang: SupportedLang) -> str:
        if not isinstance(result, dict):
            s = json.dumps(result, ensure_ascii=False)
            return s if len(s) <= MAX_RESPONSE_BYTES else s[:MAX_RESPONSE_BYTES]

        obj = dict(result)
        copy: dict[str, Any] = {**obj, "truncated": True}
        if isinstance(copy.get("meta"), dict):
            copy["meta"] = {**copy["meta"], "truncated": True}

        def size() -> int:
            return len(json.dumps(copy, ensure_ascii=False))

        data = copy.get("data")
        if isinstance(data, list):
            arr = list(data)
            while len(arr) > 1 and size() > MAX_RESPONSE_BYTES:
                arr.pop()
            copy["data"] = arr
        elif isinstance(data, dict):
            d = dict(data)
            dl = d.get("dataList")
            if isinstance(dl, list):
                while len(dl) > 1 and size() > MAX_RESPONSE_BYTES:
                    dl.pop()
                d["dataList"] = dl
            copy["data"] = d

        if size() > MAX_RESPONSE_BYTES:
            if isinstance(copy.get("data"), list):
                copy["data"] = []
            elif isinstance(copy.get("data"), dict):
                d2 = dict(copy["data"])
                if isinstance(d2.get("dataList"), list):
                    d2["dataList"] = []
                copy["data"] = d2

        text = json.dumps(copy, ensure_ascii=False)
        if len(text) > MAX_RESPONSE_BYTES:
            text = json.dumps(
                {
                    "ok": bool(obj.get("ok")) if "ok" in obj else False,
                    "truncated": True,
                    "message": t(lang, "mcp_tool.response_truncated_after_limit"),
                },
                ensure_ascii=False,
            )
        return text
