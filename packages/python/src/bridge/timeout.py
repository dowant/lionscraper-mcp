from __future__ import annotations

from typing import Any

DEFAULT_PER_TASK_TIMEOUT_MS = 60_000
MAX_BRIDGE_TIMEOUT_MS = 3_600_000


def count_urls(url: Any) -> int:
    if isinstance(url, list):
        return len(url)
    return 1


def resolve_bridge_timeout_ms(params: dict[str, Any]) -> int:
    explicit = params.get("bridgeTimeoutMs")
    if isinstance(explicit, (int, float)) and explicit >= 1000:
        return int(min(explicit, MAX_BRIDGE_TIMEOUT_MS))

    per_task = (
        int(params["timeoutMs"])
        if isinstance(params.get("timeoutMs"), (int, float)) and params["timeoutMs"] >= 1000
        else DEFAULT_PER_TASK_TIMEOUT_MS
    )

    url_count = max(1, count_urls(params.get("url")))
    max_pages_raw = params.get("maxPages")
    max_pages = (
        min(int(max_pages_raw), 10_000)
        if isinstance(max_pages_raw, (int, float)) and max_pages_raw >= 1
        else 1
    )
    n = url_count * max_pages

    interval = (
        int(params["scrapeInterval"])
        if isinstance(params.get("scrapeInterval"), (int, float)) and params["scrapeInterval"] >= 0
        else 0
    )
    stagger_ms = (n - 1) * interval if n > 1 else 0
    estimated = per_task * n + stagger_ms

    return int(min(MAX_BRIDGE_TIMEOUT_MS, max(per_task, estimated)))


def params_for_extension(params: dict[str, Any]) -> dict[str, Any]:
    copy = {**params}
    copy.pop("bridgeTimeoutMs", None)
    return copy
