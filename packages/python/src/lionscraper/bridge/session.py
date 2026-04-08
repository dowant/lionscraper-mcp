from __future__ import annotations

from typing import TYPE_CHECKING

from lionscraper.bridge.protocol import PendingRequestManager
from lionscraper.utils.logger import logger

if TYPE_CHECKING:
    from aiohttp.web import WebSocketResponse


class Session:
    __slots__ = ("device_id", "browser", "extension_version", "capabilities", "ws", "pending_requests")

    def __init__(
        self,
        device_id: str,
        browser: str,
        extension_version: str,
        capabilities: list[str],
        ws: WebSocketResponse,
    ):
        self.device_id = device_id
        self.browser = browser
        self.extension_version = extension_version
        self.capabilities = capabilities
        self.ws = ws
        self.pending_requests = PendingRequestManager()


class SessionManager:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}

    def register(
        self,
        device_id: str,
        browser: str,
        extension_version: str,
        capabilities: list[str],
        ws: WebSocketResponse,
    ) -> Session:
        existing = self._sessions.get(device_id)
        if existing:
            logger.info(f"Replacing existing session for device: {device_id}")
            self._cleanup_session(existing, "disconnect.replaced")

        session = Session(device_id, browser, extension_version, capabilities, ws)
        self._sessions[device_id] = session
        logger.info(f"Session registered: {device_id} ({browser} {extension_version})")
        return session

    def remove(self, device_id: str) -> None:
        session = self._sessions.get(device_id)
        if session:
            self._cleanup_session(session, "disconnect.extension_gone")
            del self._sessions[device_id]
            logger.info(f"Session removed: {device_id}")

    def remove_by_ws(self, ws: WebSocketResponse) -> None:
        for device_id, session in list(self._sessions.items()):
            if session.ws is ws:
                self.remove(device_id)
                return

    def get_active_session(self) -> Session | None:
        for session in self._sessions.values():
            if not session.ws.closed:
                return session
        return None

    def get_session_by_device_id(self, device_id: str) -> Session | None:
        return self._sessions.get(device_id)

    def has_connected_extension(self) -> bool:
        return self.get_active_session() is not None

    @property
    def session_count(self) -> int:
        return len(self._sessions)

    def get_total_pending_bridge_requests(self) -> int:
        return sum(s.pending_requests.size for s in self._sessions.values())

    def get_session_info(self) -> dict[str, str] | None:
        session = self.get_active_session()
        if not session:
            return None
        return {
            "deviceId": session.device_id,
            "browser": session.browser,
            "extensionVersion": session.extension_version,
        }

    def _cleanup_session(self, session: Session, disconnect_reason: str) -> None:
        session.pending_requests.reject_all_disconnected(disconnect_reason)

    def clear(self) -> None:
        for session in self._sessions.values():
            self._cleanup_session(session, "disconnect.server_shutdown")
        self._sessions.clear()
