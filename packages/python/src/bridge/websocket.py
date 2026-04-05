from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable

import aiohttp
from aiohttp import web

from lionscraper.bridge.protocol import (
    BridgeProgressHandler,
    create_bridge_error_response,
    create_bridge_request,
    create_bridge_response,
)
from lionscraper.bridge.session import Session, SessionManager
from lionscraper.i18n.lang import bridge_t, log_t, port_lang
from lionscraper.types.bridge import (
    PROTOCOL_VERSION,
    BridgeMethod,
    BridgeProgressNotification,
    BridgeProgressParams,
    BridgeRequest,
    is_bridge_progress_notification,
    is_bridge_response,
    is_extension_bridge_request,
)
from lionscraper.i18n.lang import normalize_lang, t
from lionscraper.types.errors import BridgeErrorCode, create_error, create_extension_not_connected_error
from lionscraper.utils.logger import logger
from lionscraper.version import PACKAGE_VERSION

REGISTER_TIMEOUT_MS = 10_000
HEARTBEAT_INTERVAL_MS = 30_000


class BridgeServer:
    def __init__(self) -> None:
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._listen_port = 0
        self._draining = False
        self._shutdown_handler: Callable[[], None] | None = None
        self.session_manager = SessionManager()
        self._wss_clients: set[web.WebSocketResponse] = set()

    def set_shutdown_handler(self, handler: Callable[[], None]) -> None:
        self._shutdown_handler = handler

    def is_draining(self) -> bool:
        return self._draining

    @property
    def bridge_port(self) -> int:
        return self._listen_port

    def attach_to_app(self, app: web.Application, port: int) -> None:
        self._listen_port = port
        app["bridge_server"] = self

    def on_shared_server_listening(self, port: int) -> None:
        self._listen_port = port
        L = port_lang()
        logger.info(log_t(L, "wsListening", {"url": f"ws://127.0.0.1:{port}"}))
        logger.info(log_t(L, "bridgeStderrHint"))
        self._start_heartbeat()

    def _start_heartbeat(self) -> None:
        async def beat() -> None:
            while True:
                await asyncio.sleep(HEARTBEAT_INTERVAL_MS / 1000.0)
                for ws in list(self._wss_clients):
                    if ws.closed:
                        continue
                    try:
                        await ws.ping()
                    except Exception:
                        pass

        self._heartbeat_task = asyncio.create_task(beat())

    async def stop(self) -> None:
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None

        self.session_manager.clear()
        for ws in list(self._wss_clients):
            if not ws.closed:
                await ws.close()
        self._wss_clients.clear()
        self._listen_port = 0
        logger.info(log_t(port_lang(), "wsServerStopped"))

    async def send_message(self, ws: web.WebSocketResponse, msg: dict[str, Any]) -> None:
        if ws.closed:
            return
        await ws.send_str(json.dumps(msg, ensure_ascii=False))

    async def send_to_extension(
        self,
        method: BridgeMethod,
        params: dict[str, Any],
        timeout_ms: int | None = None,
        on_bridge_progress: BridgeProgressHandler | None = None,
    ) -> Any:
        lang = normalize_lang(params.get("lang"))
        if self._draining:
            raise create_error(BridgeErrorCode.SERVER_DRAINING, t(lang, "server_draining.new_tasks"))

        session = self.session_manager.get_active_session()
        if not session:
            raise create_extension_not_connected_error(
                {
                    "bridgePort": self._listen_port,
                    "sessionCount": self.session_manager.session_count,
                },
                lang,
            )

        request = create_bridge_request(method, params)
        req_id = request["id"]
        t_ms = timeout_ms if timeout_ms is not None else 60_000
        fut = session.pending_requests.begin_request(req_id, method, t_ms, lang, on_bridge_progress)
        try:
            await self.send_message(session.ws, request)
            return await fut
        finally:
            self._maybe_drain_complete()

    async def _run_connection(self, ws: web.WebSocketResponse) -> None:
        self._wss_clients.add(ws)
        logger.info(log_t(port_lang(), "newWebSocketConnection"))

        registered = False
        current_session: Session | None = None

        loop = asyncio.get_running_loop()

        reg_state = {"registered": False}

        def register_timeout_fire() -> None:
            if reg_state["registered"] or ws.closed:
                return
            L = port_lang()
            logger.warn(log_t(L, "registerTimeoutWarn", {"ms": REGISTER_TIMEOUT_MS, "port": self._listen_port}))

            async def _close() -> None:
                await ws.close(code=4001, message=bridge_t(L, "registerTimeoutClose").encode("utf-8"))

            asyncio.create_task(_close())

        timeout_handle = loop.call_later(REGISTER_TIMEOUT_MS / 1000.0, register_timeout_fire)

        try:
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                    except json.JSONDecodeError:
                        logger.warn(log_t(port_lang(), "invalidJsonFromExtension"))
                        continue

                    if not registered:
                        done = await self._handle_pre_register(ws, data, timeout_handle)
                        if isinstance(done, Session):
                            registered = True
                            reg_state["registered"] = True
                            current_session = done
                            timeout_handle.cancel()
                        continue

                    if not current_session:
                        logger.warn(log_t(port_lang(), "registeredWithoutSessionState"))
                        continue

                    await self._handle_message(ws, data, current_session)

                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(log_t(port_lang(), "wsConnectionError"), str(ws.exception()))
                    break
                elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING):
                    break
        finally:
            timeout_handle.cancel()
            if current_session:
                self.session_manager.remove_by_ws(ws)
            self._wss_clients.discard(ws)
            code = ws.close_code or 0
            reason = str(ws.close_message or "")
            logger.info(log_t(port_lang(), "wsConnectionClosed", {"code": code, "reason": reason}))

    async def _handle_pre_register(
        self,
        ws: web.WebSocketResponse,
        msg: Any,
        register_timeout: asyncio.TimerHandle,
    ) -> Session | None:
        if is_bridge_progress_notification(msg):
            logger.debug(log_t(port_lang(), "bridgeProgressIgnoredPreRegister"))
            return None

        if not is_extension_bridge_request(msg):
            logger.warn(log_t(port_lang(), "expectedRegisterGotResponse"))
            return None

        request = msg
        method = request.get("method")

        if method == "probe":
            await self._handle_probe(ws, request, register_timeout)
            return None

        if method == "register":
            register_timeout.cancel()
            return await self._handle_register(ws, request)

        L = port_lang()
        logger.warn(log_t(L, "unexpectedMethodBeforeRegister", {"method": str(method)}))
        await self.send_message(
            ws,
            create_bridge_error_response(
                request["id"],
                -32600,
                bridge_t(L, "mustRegisterFirst"),
            ),
        )
        return None

    async def _handle_register(self, ws: web.WebSocketResponse, request: BridgeRequest) -> Session | None:
        L = port_lang()
        params = request.get("params")
        if not params:
            await self.send_message(
                ws,
                create_bridge_error_response(request["id"], -32602, bridge_t(L, "missingRegisterParams")),
            )
            return None

        if params.get("protocolVersion") != PROTOCOL_VERSION:
            await self.send_message(
                ws,
                create_bridge_error_response(
                    request["id"],
                    -32000,
                    bridge_t(L, "protocolVersionMismatch", {"expected": PROTOCOL_VERSION, "got": params.get("protocolVersion")}),
                    {"lionscraperCode": BridgeErrorCode.BRIDGE_VERSION_MISMATCH.value},
                ),
            )
            await ws.close(code=4002, message=bridge_t(L, "protocolMismatchClose"))
            return None

        session = self.session_manager.register(
            str(params["deviceId"]),
            str(params["browser"]),
            str(params["extensionVersion"]),
            list(params.get("capabilities") or []),
            ws,
        )
        await self.send_message(ws, create_bridge_response(request["id"], {"ok": True}))
        return session

    async def _handle_message(self, ws: web.WebSocketResponse, msg: Any, session: Session) -> None:
        if is_bridge_progress_notification(msg):
            self._handle_bridge_progress(msg, session)
            return

        if is_bridge_response(msg):
            m = msg
            rid = m.get("id")
            payload: Any = {"ok": False, "error": m["error"]} if m.get("error") else m.get("result")
            resolved = session.pending_requests.resolve(rid, payload)
            if not resolved:
                logger.warn(log_t(port_lang(), "unknownRequestResponse", {"id": rid}))
            return

        if is_extension_bridge_request(msg):
            if msg.get("method") == "ping":
                await self.send_message(ws, create_bridge_response(msg["id"], {"pong": True}))
                return
            logger.warn(log_t(port_lang(), "unexpectedMethodFromExtension", {"method": str(msg.get("method"))}))
            return

        logger.debug(log_t(port_lang(), "ignoredExtensionMessage"))

    def _handle_bridge_progress(self, msg: BridgeProgressNotification, session: Session) -> None:
        params = msg.get("params") or {}
        rid = params.get("requestId")
        if not rid or not isinstance(rid, str):
            logger.debug(log_t(port_lang(), "bridgeProgressInvalidPayload"))
            return
        matched = session.pending_requests.dispatch_progress(rid, params)  # type: ignore[arg-type]
        if not matched:
            logger.debug(log_t(port_lang(), "bridgeProgressNoPending", {"requestId": rid}))

    def _build_probe_result(self) -> dict[str, Any]:
        return {
            "identity": "lionscraper",
            "version": PACKAGE_VERSION,
            "busyJobs": self.session_manager.get_total_pending_bridge_requests(),
            "draining": self._draining,
        }

    async def _handle_probe(
        self,
        ws: web.WebSocketResponse,
        request: BridgeRequest,
        register_timeout: asyncio.TimerHandle,
    ) -> None:
        register_timeout.cancel()
        intent = (request.get("params") or {}).get("intent")

        if intent == "forceShutdown":
            result = {**self._build_probe_result(), "ok": True}
            await self.send_message(ws, create_bridge_response(request["id"], result))
            await ws.close()
            asyncio.get_running_loop().call_soon(self._force_shutdown_from_probe)
            return

        if intent == "takeover":
            if not self._draining:
                self._draining = True
                logger.info(log_t(port_lang(), "mcpServerDrainingMode"))
            takeover_result = self._build_probe_result()
            await self.send_message(ws, create_bridge_response(request["id"], takeover_result))
            await ws.close()
            asyncio.get_running_loop().call_soon(self._maybe_drain_complete)
            return

        if intent not in ("status", None) and intent is not None:
            await self.send_message(
                ws,
                create_bridge_error_response(
                    request["id"],
                    -32602,
                    bridge_t(port_lang(), "unknownProbeIntent", {"intent": str(intent)}),
                ),
            )
            await ws.close()
            return

        result = self._build_probe_result()
        await self.send_message(ws, create_bridge_response(request["id"], result))
        await ws.close()

    def _maybe_drain_complete(self) -> None:
        if not self._draining:
            return
        if self.session_manager.get_total_pending_bridge_requests() > 0:
            return
        logger.info(log_t(port_lang(), "drainingCompleteShutdown"))
        fn = self._shutdown_handler
        if not fn:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            fn()
            return
        loop.call_soon(fn)

    def _force_shutdown_from_probe(self) -> None:
        logger.warn(log_t(port_lang(), "forceShutdownViaProbe"))
        self._draining = True
        self.session_manager.clear()
        if self._shutdown_handler:
            self._shutdown_handler()

    def request_shutdown_from_loopback_http(self) -> None:
        self._force_shutdown_from_probe()


async def websocket_middleware(
    request: web.Request,
    handler: Callable[[web.Request], Awaitable[web.StreamResponse]],
) -> web.StreamResponse:
    if request.method == "GET" and request.headers.get("Upgrade", "").lower() == "websocket":
        bridge: BridgeServer | None = request.app.get("bridge_server")
        if not bridge:
            return web.Response(status=500, text="bridge not configured")
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await bridge._run_connection(ws)
        return ws
    return await handler(request)
