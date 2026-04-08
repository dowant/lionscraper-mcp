from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any

LogLevel = str

_LOG_LEVELS: dict[str, int] = {"debug": 0, "info": 1, "warn": 2, "error": 3}

_current_level: str = "info"


def set_log_level(level: str) -> None:
    global _current_level
    _current_level = level if level in _LOG_LEVELS else "info"


def _should_log(level: str) -> bool:
    return _LOG_LEVELS.get(level, 99) >= _LOG_LEVELS.get(_current_level, 1)


def _format_ts() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _format_arg(value: Any) -> str:
    if isinstance(value, BaseException):
        return repr(value)
    if isinstance(value, dict | list):
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return repr(value)
    return str(value)


def _write(level: str, message: str, *args: Any) -> None:
    if not _should_log(level):
        return
    prefix = f"[{_format_ts()}] [{level.upper()}]"
    if args:
        body = " ".join(_format_arg(a) for a in args)
        line = f"{prefix} {message} {body}\n"
    else:
        line = f"{prefix} {message}\n"
    sys.stderr.write(line)


class _Logger:
    def debug(self, message: str, *args: Any) -> None:
        _write("debug", message, *args)

    def info(self, message: str, *args: Any) -> None:
        _write("info", message, *args)

    def warn(self, message: str, *args: Any) -> None:
        _write("warn", message, *args)

    def error(self, message: str, *args: Any) -> None:
        _write("error", message, *args)


logger = _Logger()
