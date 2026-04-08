from __future__ import annotations

import asyncio
import signal
import sys

from lionscraper.core.bridge_service import BridgeService
from lionscraper.i18n.lang import log_t, port_lang
from lionscraper.utils.logger import logger, set_log_level
from lionscraper.utils.port import get_configured_port
from lionscraper.version import PACKAGE_VERSION


async def _run_daemon() -> None:
    stop = asyncio.Event()

    def after_drain() -> None:
        stop.set()

    service = BridgeService(on_after_bridge_drain=after_drain)

    try:
        await service.start()
    except OSError as e:
        port = get_configured_port()
        L = port_lang()
        errn = getattr(e, "winerror", None) or getattr(e, "errno", None)
        if errn in (98, 48, 10048) or "Address already in use" in str(e):
            logger.error(log_t(L, "daemonPortInUse", {"port": port}))
        else:
            logger.error(log_t(L, "failedToStartServer"), e)
        await service.stop()
        raise SystemExit(1) from e

    port = service.listening_port
    logger.info(
        log_t(
            port_lang(),
            "daemonListening",
            {"url": f"http://127.0.0.1:{port}", "version": PACKAGE_VERSION},
        )
    )

    async def shutdown_graceful() -> None:
        await service.stop()
        stop.set()

    def on_sig() -> None:
        asyncio.create_task(shutdown_graceful())

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        if hasattr(signal, sig.name):
            try:
                loop.add_signal_handler(sig, on_sig)
            except NotImplementedError:
                pass

    await stop.wait()
    raise SystemExit(0)


def run_daemon_from_cli(daemon_argv: list[str]) -> None:
    if "--debug" in daemon_argv:
        set_log_level("debug")
    try:
        asyncio.run(_run_daemon())
    except SystemExit as e:
        raise e
