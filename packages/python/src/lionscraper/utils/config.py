from __future__ import annotations

import os
from pathlib import Path

from lionscraper.utils.logger import logger

_CONFIG_DIR_NAME = ".lionscraper"
_PORT_FILE_NAME = "port"


def _config_dir() -> Path:
    return Path.home() / _CONFIG_DIR_NAME


def _port_file() -> Path:
    return _config_dir() / _PORT_FILE_NAME


def write_port_file(port: int) -> None:
    d = _config_dir()
    pf = _port_file()
    try:
        d.mkdir(parents=True, exist_ok=True)
        pf.write_text(str(port), encoding="utf-8")
        logger.info(f"Port file written: {pf} → {port}")
    except OSError as e:
        logger.warn(f"Failed to write port file: {pf}", str(e))


def cleanup_port_file() -> None:
    pf = _port_file()
    try:
        if pf.is_file():
            pf.unlink()
            logger.info(f"Port file cleaned up: {pf}")
    except OSError as e:
        logger.warn(f"Failed to clean up port file: {pf}", str(e))


def read_port_file() -> int | None:
    pf = _port_file()
    try:
        if pf.is_file():
            return int(pf.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        pass
    return None
