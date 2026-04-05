from __future__ import annotations

import os

from lionscraper.utils.port import get_configured_port


def get_daemon_http_base_url() -> str:
    return f"http://127.0.0.1:{get_configured_port()}"


def get_daemon_auth_token() -> str | None:
    t = os.environ.get("TOKEN", "").strip()
    return t or None
