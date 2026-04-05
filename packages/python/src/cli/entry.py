from __future__ import annotations

import asyncio
import sys
import traceback

from lionscraper.cli.mcp_bin_argv import is_thin_mcp_stdio_argv
from lionscraper.i18n.lang import log_t, port_lang
from lionscraper.utils.logger import logger


def _excepthook(exc_type, exc, tb) -> None:  # type: ignore[no-untyped-def]
    if exc_type is SystemExit:
        sys.__excepthook__(exc_type, exc, tb)
        return
    L = port_lang()
    logger.error(log_t(L, "uncaughtException"), "".join(traceback.format_exception(exc_type, exc, tb)))


def _install_hooks() -> None:
    sys.excepthook = _excepthook


def main_cli() -> None:
    _install_hooks()
    from lionscraper.cli.router import run_lionscraper_cli

    run_lionscraper_cli()


def main_mcp_or_cli() -> None:
    argv = sys.argv[1:]
    if not is_thin_mcp_stdio_argv(argv):
        main_cli()
        return
    _install_hooks()
    from lionscraper.mcp.mcp_stdio_app import start_thin_mcp_stdio

    try:
        asyncio.run(start_thin_mcp_stdio())
    except KeyboardInterrupt:
        raise SystemExit(0) from None
