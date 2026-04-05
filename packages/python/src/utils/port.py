from __future__ import annotations

import asyncio
import json
import os
import socket
import uuid
from typing import Any, Literal

import httpx
import websockets
from websockets.exceptions import ConnectionClosed

from lionscraper.i18n.lang import port_lang, port_t
from lionscraper.utils.logger import logger

DEFAULT_PORT = 13808
PROBE_CONNECT_TIMEOUT_MS = 3_000
PROBE_CLOSE_GRACE_MS = 400
STOP_DAEMON_WAIT_MS = 8_000

ProbeIntent = Literal["takeover", "status", "forceShutdown"]


def get_configured_port() -> int:
    raw = os.environ.get("PORT")
    if raw is None or raw == "":
        return DEFAULT_PORT
    try:
        p = int(raw, 10)
        if 1 <= p <= 65535:
            return p
    except ValueError:
        pass
    L = port_lang()
    logger.warn(port_t(L, "invalidEnvPort", {"envValue": raw, "fallback": DEFAULT_PORT}))
    return DEFAULT_PORT


async def can_bind_port(port: int) -> bool:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False
        finally:
            s.close()
    except OSError:
        return False


def _loopback_auth_headers() -> dict[str, str]:
    t = os.environ.get("TOKEN", "").strip()
    return {"Authorization": f"Bearer {t}"} if t else {}


async def _http_health_is_lionscraper(port: int) -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(
                f"http://127.0.0.1:{port}/v1/health",
                headers=_loopback_auth_headers(),
            )
            if r.status_code != 200:
                return False
            body = r.json()
            return body.get("ok") is True and body.get("identity") == "lionscraper"
    except Exception:
        return False


async def _http_post_daemon_shutdown(port: int) -> bool:
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.post(
                f"http://127.0.0.1:{port}/v1/daemon/shutdown",
                headers={"Content-Type": "application/json", **_loopback_auth_headers()},
                content="{}",
            )
            return r.is_success
    except Exception:
        return False


async def _sleep_ms(ms: float) -> None:
    await asyncio.sleep(ms / 1000.0)


async def probe_port(
    port: int,
    intent: ProbeIntent,
    timeout_ms: int = PROBE_CONNECT_TIMEOUT_MS,
) -> dict[str, Any] | None:
    uri = f"ws://127.0.0.1:{port}"
    req_id = str(uuid.uuid4())
    payload = json.dumps(
        {"jsonrpc": "2.0", "id": req_id, "method": "probe", "params": {"intent": intent}}
    )
    deadline = asyncio.get_event_loop().time() + timeout_ms / 1000.0 + PROBE_CLOSE_GRACE_MS / 1000.0
    try:
        async with websockets.connect(
            uri,
            open_timeout=timeout_ms / 1000.0,
            close_timeout=PROBE_CLOSE_GRACE_MS / 1000.0,
        ) as ws:
            await ws.send(payload)
            while asyncio.get_event_loop().time() < deadline:
                try:
                    remaining = max(0.01, deadline - asyncio.get_event_loop().time())
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    return None
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if msg.get("id") != req_id:
                    continue
                if msg.get("error"):
                    return None
                res = msg.get("result")
                if isinstance(res, dict) and isinstance(res.get("identity"), str):
                    return res
    except (ConnectionClosed, OSError, asyncio.TimeoutError, websockets.InvalidURI, websockets.InvalidHandshake):
        return None
    except Exception:
        return None
    return None


def _parse_takeover_timeout_ms() -> int:
    raw = os.environ.get("TIMEOUT")
    if raw is None or raw == "":
        return 120_000
    try:
        v = int(raw, 10)
        return max(0, v)
    except ValueError:
        return 120_000


async def take_over_port(port: int) -> None:
    L = port_lang()
    takeover_timeout_ms = _parse_takeover_timeout_ms()

    first = await probe_port(port, "takeover", PROBE_CONNECT_TIMEOUT_MS)
    if not first or first.get("identity") != "lionscraper":
        raise RuntimeError(port_t(L, "nonLionScraperInUse", {"port": port}))

    if takeover_timeout_ms == 0:
        logger.warn(port_t(L, "takeoverTimeoutZeroWarn"))
        forced = await probe_port(port, "forceShutdown", PROBE_CONNECT_TIMEOUT_MS)
        if not forced:
            logger.warn(port_t(L, "forceShutdownNoResponse"))
        if not await _wait_until_port_free(port, 8_000):
            raise RuntimeError(port_t(L, "stillInUseAfterForce", {"port": port}))
        return

    deadline = asyncio.get_event_loop().time() + takeover_timeout_ms / 1000.0
    while asyncio.get_event_loop().time() < deadline:
        if await can_bind_port(port):
            return
        await _sleep_ms(200)
        status = await probe_port(port, "status", PROBE_CONNECT_TIMEOUT_MS)
        if not status:
            if await can_bind_port(port):
                return
            continue
        if status.get("identity") != "lionscraper":
            raise RuntimeError(port_t(L, "identityChanged", {"port": port}))

    logger.warn(port_t(L, "takeoverTimedOutWarn", {"takeoverTimeoutMs": takeover_timeout_ms}))
    await probe_port(port, "forceShutdown", PROBE_CONNECT_TIMEOUT_MS)
    if not await _wait_until_port_free(port, 8_000):
        raise RuntimeError(port_t(L, "stillInUseAfterForce", {"port": port}))


async def _wait_until_port_free(port: int, deadline_ms: int) -> bool:
    deadline = asyncio.get_event_loop().time() + deadline_ms / 1000.0
    while asyncio.get_event_loop().time() < deadline:
        if await can_bind_port(port):
            return True
        await _sleep_ms(100)
    return await can_bind_port(port)


async def acquire_port(port: int | None = None) -> int:
    p = port if port is not None else get_configured_port()
    L = port_lang()
    if await can_bind_port(p):
        return p
    logger.info(port_t(L, "inUseAttemptingTakeover", {"port": p}))
    await take_over_port(p)
    bind_deadline = asyncio.get_event_loop().time() + 10.0
    while asyncio.get_event_loop().time() < bind_deadline:
        if await can_bind_port(p):
            return p
        await _sleep_ms(100)
    raise RuntimeError(port_t(L, "bindFailedAfterTakeover", {"port": p}))


async def stop_lionscraper_on_port(port: int | None = None) -> Literal["idle", "stopped"]:
    p = port if port is not None else get_configured_port()
    L = port_lang()
    if await can_bind_port(p):
        return "idle"

    status = await probe_port(p, "status", PROBE_CONNECT_TIMEOUT_MS)
    verified = status.get("identity") == "lionscraper" if status else False
    if not verified:
        verified = await _http_health_is_lionscraper(p)
        if verified:
            logger.info(port_t(L, "stopVerifiedViaHttpHealth", {"port": p}))
    if not verified:
        raise RuntimeError(port_t(L, "nonLionScraperInUse", {"port": p}))

    forced = await probe_port(p, "forceShutdown", PROBE_CONNECT_TIMEOUT_MS)
    if not forced:
        http_ok = await _http_post_daemon_shutdown(p)
        if http_ok:
            logger.info(port_t(L, "stopRequestedHttpShutdown", {"port": p}))
        else:
            logger.warn(port_t(L, "forceShutdownNoResponse"))

    if not await _wait_until_port_free(p, STOP_DAEMON_WAIT_MS):
        raise RuntimeError(port_t(L, "stillInUseAfterForce", {"port": p}))
    return "stopped"


def stop_lionscraper_on_port_sync(port: int | None = None) -> Literal["idle", "stopped"]:
    return asyncio.run(stop_lionscraper_on_port(port))
