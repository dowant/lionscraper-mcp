from __future__ import annotations

import asyncio
from typing import Callable

from aiohttp import web

from lionscraper.bridge.websocket import BridgeServer, websocket_middleware
from lionscraper.daemon.http_api import attach_daemon_api
from lionscraper.i18n.lang import log_t, port_lang
from lionscraper.mcp.handler import ToolHandler
from lionscraper.utils.config import cleanup_port_file, write_port_file
from lionscraper.utils.logger import logger
from lionscraper.utils.port import acquire_port, get_configured_port


class BridgeService:
    def __init__(self, on_after_bridge_drain: Callable[[], None]):
        self._on_after_bridge_drain = on_after_bridge_drain
        self._stopped = False
        self._port = 0
        self._runner: web.AppRunner | None = None
        self._shutdown_task: asyncio.Task[None] | None = None
        self.bridge = BridgeServer()
        self.tool_handler = ToolHandler(self.bridge)
        self.bridge.set_shutdown_handler(self._request_shutdown)

    def _request_shutdown(self) -> None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._shutdown_task and not self._shutdown_task.done():
            return
        self._shutdown_task = loop.create_task(self._shutdown_chain())

    async def _shutdown_chain(self) -> None:
        try:
            await self.stop()
        finally:
            self._on_after_bridge_drain()

    @property
    def listening_port(self) -> int:
        return self._port

    async def start(self) -> None:
        app = web.Application(middlewares=[websocket_middleware])
        attach_daemon_api(self, app)
        self._runner = web.AppRunner(app)
        await self._runner.setup()
        self._port = await acquire_port(get_configured_port())
        self.bridge.attach_to_app(app, self._port)
        site = web.TCPSite(self._runner, "127.0.0.1", self._port)
        await site.start()
        self.bridge.on_shared_server_listening(self._port)
        write_port_file(self._port)
        L = port_lang()
        logger.info(f"\n{log_t(L, 'bannerTop')}")
        logger.info(log_t(L, "bannerTitle"))
        logger.info(log_t(L, "bannerWs", {"url": f"ws://127.0.0.1:{self._port}"}))
        logger.info(log_t(L, "bannerHttpSamePort", {"url": f"http://127.0.0.1:{self._port}"}))
        logger.info(log_t(L, "bannerPortFile"))
        logger.info(f"{log_t(L, 'bannerBottom')}\n")

    async def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        L = port_lang()
        logger.info(log_t(L, "shuttingDownMcp"))
        await self.bridge.stop()
        if self._runner:
            await self._runner.cleanup()
            self._runner = None
        self._port = 0
        cleanup_port_file()
        logger.info(log_t(L, "serverStopped"))
