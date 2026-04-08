from __future__ import annotations

import asyncio
import os
import subprocess
import sys

from lionscraper.client.daemon_client import daemon_health
from lionscraper.i18n.lang import log_t, port_lang
from lionscraper.utils.daemon_config import get_daemon_auth_token, get_daemon_http_base_url
from lionscraper.utils.logger import logger

HEALTH_POLL_MS = 350
HEALTH_MAX_WAIT_MS = 20_000


async def _wait_for_healthy(base_url: str, auth: str | None) -> bool:
    deadline = asyncio.get_event_loop().time() + HEALTH_MAX_WAIT_MS / 1000.0
    while asyncio.get_event_loop().time() < deadline:
        try:
            await daemon_health(base_url, auth)
            return True
        except Exception:
            await asyncio.sleep(HEALTH_POLL_MS / 1000.0)
    return False


async def ensure_local_daemon_running() -> dict[str, bool]:
    base_url = get_daemon_http_base_url()
    auth = get_daemon_auth_token()
    L = port_lang()
    try:
        await daemon_health(base_url, auth)
        return {"didSpawn": False}
    except Exception:
        pass

    if os.environ.get("DAEMON", "").strip() == "0":
        raise RuntimeError(log_t(L, "daemonUnreachableNoAuto", {"baseUrl": base_url}))

    args = [sys.executable, "-m", "lionscraper", "daemon"]
    if "--debug" in sys.argv:
        args.append("--debug")

    logger.info(log_t(L, "autoDaemonSpawning", {"path": " ".join(args)}))

    popen_kw: dict = {
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "stdin": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        popen_kw["creationflags"] = subprocess.CREATE_NO_WINDOW | getattr(subprocess, "DETACHED_PROCESS", 0)
    else:
        popen_kw["start_new_session"] = True

    try:
        subprocess.Popen(args, **popen_kw)  # noqa: S603
    except OSError as e:
        raise RuntimeError(log_t(L, "autoDaemonSpawnFailed", {"message": str(e)})) from e

    ok = await _wait_for_healthy(base_url, auth)
    if not ok:
        raise RuntimeError(log_t(L, "autoDaemonTimeout", {"baseUrl": base_url}))
    return {"didSpawn": True}
