from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, TypedDict

import aiohttp

from lionscraper.i18n.lang import port_lang, t
from lionscraper.types.errors import ClientErrorCode


class DaemonCallResult(TypedDict, total=False):
    content: list[dict[str, Any]]
    isError: bool


def _auth_headers(token: str | None) -> dict[str, str]:
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def _daemon_unreachable_result(cause: str | None = None) -> DaemonCallResult:
    L = port_lang()
    details: dict[str, Any] = {
        "startCommand": "lionscraper daemon",
        "hint": t(L, "daemon_unreachable.hint"),
    }
    if cause:
        details["cause"] = cause
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "ok": False,
                        "error": {
                            "code": ClientErrorCode.DAEMON_UNREACHABLE.value,
                            "message": t(L, "daemon_unreachable.message"),
                            "details": details,
                        },
                    },
                    ensure_ascii=False,
                ),
            }
        ],
        "isError": True,
    }


def _invalid_response_result(message: str, details: dict[str, Any] | None = None) -> DaemonCallResult:
    err: dict[str, Any] = {
        "code": ClientErrorCode.DAEMON_INVALID_RESPONSE.value,
        "message": message,
    }
    if details:
        err["details"] = details
    return {
        "content": [{"type": "text", "text": json.dumps({"ok": False, "error": err}, ensure_ascii=False)}],
        "isError": True,
    }


async def _process_ndjson_lines(
    lines: list[str],
    on_progress: Callable[[dict[str, Any]], Awaitable[None]],
) -> DaemonCallResult:
    final: DaemonCallResult | None = None
    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            continue
        try:
            obj: dict[str, Any] = json.loads(trimmed)
        except json.JSONDecodeError:
            return _invalid_response_result(
                "Invalid JSON line in daemon NDJSON stream",
                {"linePreview": trimmed[:120]},
            )
        if obj.get("type") == "progress" and obj.get("notification"):
            await on_progress(obj["notification"])
        elif obj.get("type") == "result" and isinstance(obj.get("content"), list):
            final = {"content": obj["content"], "isError": bool(obj.get("isError"))}
        elif obj.get("type") == "error":
            return _invalid_response_result(
                str((obj.get("error") or {}).get("message") or "Daemon tool error line in NDJSON stream")
            )
    if not final:
        return _invalid_response_result("No result line in daemon NDJSON stream (incomplete response)")
    return final


def _handle_non_ok_response(status: int, text: str) -> DaemonCallResult:
    if status >= 500:
        return _daemon_unreachable_result(text or f"HTTP {status}")
    try:
        j = json.loads(text)
        msg = j.get("error", {}).get("message") or text or f"HTTP {status}"
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps({"ok": False, "error": {"message": msg, "status": status}}, ensure_ascii=False),
                }
            ],
            "isError": True,
        }
    except json.JSONDecodeError:
        return {"content": [{"type": "text", "text": text or f"HTTP {status}"}], "isError": True}


async def _try_read_ndjson_from_text_body(
    text: str,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]],
) -> DaemonCallResult | None:
    raw_lines = [l for l in text.split("\n") if l.strip()]
    if not raw_lines:
        return None
    looks = False
    for l in raw_lines:
        try:
            o = json.loads(l)
            if o.get("type") in ("progress", "result", "error"):
                looks = True
                break
        except json.JSONDecodeError:
            pass
    if not looks:
        return None
    return await _process_ndjson_lines(raw_lines, on_progress)


async def call_daemon_tool(
    base_url: str,
    name: str,
    args: dict[str, Any],
    *,
    auth_token: str | None = None,
    progress_token: str | int | None = None,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> DaemonCallResult:
    try:
        return await _call_daemon_tool_unsafe(
            base_url, name, args, auth_token, progress_token, on_progress
        )
    except Exception as e:
        return _daemon_unreachable_result(str(e) if e else None)


async def _call_daemon_tool_unsafe(
    base_url: str,
    name: str,
    args: dict[str, Any],
    auth_token: str | None,
    progress_token: str | int | None,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None,
) -> DaemonCallResult:
    url = f"{base_url.rstrip('/')}/v1/tools/call"
    use_stream = progress_token is not None and on_progress is not None
    headers: dict[str, str] = {"Content-Type": "application/json", **_auth_headers(auth_token)}
    if use_stream:
        headers["Accept"] = "application/x-ndjson"
    body: dict[str, Any] = {"name": name, "arguments": args}
    if use_stream:
        body["progressToken"] = progress_token

    timeout = aiohttp.ClientTimeout(total=600.0)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        if use_stream:
            async with session.post(url, headers=headers, json=body) as res:
                text = await res.text(encoding="utf-8", errors="replace")
                if res.status == 200:
                    ct = (res.headers.get("Content-Type") or "").lower()
                    lines = text.split("\n")
                    if "ndjson" in ct:
                        return await _process_ndjson_lines(lines, on_progress)  # type: ignore[arg-type]
                    from_ndjson = await _try_read_ndjson_from_text_body(text, on_progress)  # type: ignore[arg-type]
                    if from_ndjson:
                        return from_ndjson
                    try:
                        return json.loads(text)
                    except json.JSONDecodeError:
                        return _invalid_response_result(
                            "Expected application/x-ndjson from daemon for streaming tool call, but body was not valid NDJSON or JSON",
                            {"contentType": res.headers.get("Content-Type") or "", "snippet": text[:200]},
                        )
                return _handle_non_ok_response(res.status, text)

        async with session.post(url, headers=headers, json=body) as res:
            text = await res.text(encoding="utf-8", errors="replace")
            if res.status != 200:
                return _handle_non_ok_response(res.status, text)
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return _invalid_response_result(
                    "Invalid JSON from daemon (non-streaming response)",
                    {"snippet": text[:200]},
                )


async def daemon_health(base_url: str, auth_token: str | None = None) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/v1/health"
    timeout = aiohttp.ClientTimeout(total=10.0)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=_auth_headers(auth_token)) as res:
                text = await res.text(encoding="utf-8", errors="replace")
                if res.status < 200 or res.status >= 300:
                    raise RuntimeError(text or f"HTTP {res.status}")
                try:
                    parsed = json.loads(text)
                except json.JSONDecodeError as e:
                    raise RuntimeError("Invalid JSON from daemon health endpoint") from e
                if not isinstance(parsed, dict):
                    raise RuntimeError("Invalid daemon health response")
                if parsed.get("ok") is not True:
                    raise RuntimeError("Daemon health reports not ready")
                if parsed.get("identity") is not None and parsed.get("identity") != "lionscraper":
                    raise RuntimeError("Not a LionScraper daemon (identity mismatch)")
                bp = parsed.get("bridgePort")
                if not isinstance(bp, (int, float)) or bp <= 0:
                    raise RuntimeError("Daemon WebSocket bridge is not ready (invalid bridgePort)")
                raw_sc = parsed.get("sessionCount", 0)
                session_count = max(0, int(raw_sc)) if isinstance(raw_sc, (int, float)) else 0
                out: dict[str, Any] = {"ok": True, "bridgePort": int(bp), "sessionCount": session_count}
                if isinstance(parsed.get("identity"), str):
                    out["identity"] = parsed["identity"]
                impl = parsed.get("implementation")
                if isinstance(impl, str) and impl in ("node", "python"):
                    out["implementation"] = impl
                return out
    except aiohttp.ClientError as e:
        raise RuntimeError(str(e)) from e
