from __future__ import annotations

import sys

from mcp.server.stdio import stdio_server

from lionscraper.client.daemon_lifecycle import ensure_local_daemon_running
from lionscraper.i18n.lang import log_t, port_lang
from lionscraper.mcp.thin_mcp_server import create_thin_mcp_server
from lionscraper.utils.logger import logger, set_log_level


async def start_thin_mcp_stdio() -> None:
    if "--debug" in sys.argv:
        set_log_level("debug")

    try:
        await ensure_local_daemon_running()
    except Exception as err:
        logger.error(str(err))
        raise SystemExit(1) from err

    mcp_server = create_thin_mcp_server()
    init = mcp_server.create_initialization_options()
    L = port_lang()

    async with stdio_server() as (read_stream, write_stream):
        logger.info(log_t(L, "mcpConnectedStdio"))
        await mcp_server.run(read_stream, write_stream, init)

    logger.info(log_t(L, "stdinClosedShuttingDown"))
