from __future__ import annotations

import asyncio
import uuid
from typing import Any, Callable

from lionscraper.i18n.lang import SupportedLang, t
from lionscraper.types.bridge import BridgeMethod, BridgeProgressParams, BridgeRequest, BridgeResponse
from lionscraper.types.errors import BridgeErrorCode, LionScraperError, create_error
from lionscraper.utils.logger import logger

DEFAULT_TIMEOUT_MS = 60_000

BridgeProgressHandler = Callable[[BridgeProgressParams], None]


def create_bridge_request(method: BridgeMethod, params: dict[str, Any] | None = None) -> BridgeRequest:
    req: BridgeRequest = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": method,
    }
    if params is not None:
        req["params"] = params
    return req


def create_bridge_response(req_id: str, result: Any) -> BridgeResponse:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def create_bridge_error_response(
    req_id: str,
    code: int,
    message: str,
    data: dict[str, Any] | None = None,
) -> BridgeResponse:
    err: dict[str, Any] = {"code": code, "message": message}
    if data:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


DisconnectRejectId = str


class PendingRequest:
    __slots__ = ("id", "method", "fut", "timer_handle", "created_at", "lang", "on_progress")

    def __init__(
        self,
        id: str,
        method: str,
        fut: asyncio.Future[Any],
        timer_handle: asyncio.TimerHandle,
        lang: SupportedLang,
        on_progress: BridgeProgressHandler | None,
    ):
        self.id = id
        self.method = method
        self.fut = fut
        self.timer_handle = timer_handle
        self.lang = lang
        self.on_progress = on_progress


class PendingRequestManager:
    def __init__(self) -> None:
        self._pending: dict[str, PendingRequest] = {}

    def begin_request(
        self,
        req_id: str,
        method: BridgeMethod,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        lang: SupportedLang = "en-US",
        on_progress: BridgeProgressHandler | None = None,
    ) -> asyncio.Future[Any]:
        loop = asyncio.get_running_loop()
        fut: asyncio.Future[Any] = loop.create_future()

        def on_timeout() -> None:
            self._pending.pop(req_id, None)
            if not fut.done():
                logger.warn(f"Bridge request timed out: {req_id} ({method})")
                fut.set_exception(
                    create_error(
                        BridgeErrorCode.BRIDGE_TIMEOUT,
                        t(lang, "bridge_timeout", {"ms": timeout_ms}),
                    )
                )

        handle = loop.call_later(timeout_ms / 1000.0, on_timeout)
        self._pending[req_id] = PendingRequest(req_id, method, fut, handle, lang, on_progress)
        return fut

    def dispatch_progress(self, request_id: str, params: BridgeProgressParams) -> bool:
        pending = self._pending.get(request_id)
        if not pending:
            return False
        if pending.on_progress:
            try:
                pending.on_progress(params)
            except Exception:
                pass
        return True

    def resolve(self, req_id: str, result: Any) -> bool:
        pending = self._pending.pop(req_id, None)
        if not pending:
            return False
        pending.timer_handle.cancel()
        if not pending.fut.done():
            pending.fut.set_result(result)
        return True

    def reject(self, req_id: str, error: LionScraperError) -> bool:
        pending = self._pending.pop(req_id, None)
        if not pending:
            return False
        pending.timer_handle.cancel()
        if not pending.fut.done():
            pending.fut.set_exception(error)
        return True

    def reject_all_disconnected(self, reason_key: str) -> None:
        for req_id, pending in list(self._pending.items()):
            pending.timer_handle.cancel()
            if not pending.fut.done():
                pending.fut.set_exception(
                    create_error(
                        BridgeErrorCode.BRIDGE_DISCONNECTED,
                        t(pending.lang, reason_key),
                    )
                )
            self._pending.pop(req_id, None)

    def has(self, req_id: str) -> bool:
        return req_id in self._pending

    @property
    def size(self) -> int:
        return len(self._pending)

    def clear(self) -> None:
        for p in self._pending.values():
            p.timer_handle.cancel()
        self._pending.clear()
