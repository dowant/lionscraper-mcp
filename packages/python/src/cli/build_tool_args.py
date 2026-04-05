from __future__ import annotations

from typing import Any, Literal

METHOD_CLI_TO_BRIDGE: dict[str, str] = {
    "scrape": "scrape",
    "article": "scrape_article",
    "emails": "scrape_emails",
    "phones": "scrape_phones",
    "urls": "scrape_urls",
    "images": "scrape_images",
}


def _parse_bool(argv: list[str], i: int) -> tuple[bool, int]:
    v = argv[i + 1] if i + 1 < len(argv) else None
    if v in ("true", "1"):
        return True, i + 2
    if v in ("false", "0"):
        return False, i + 2
    return True, i + 1


def build_invocation_from_argv(
    argv: list[str],
    mode: Literal["scrape", "ping"],
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    method_cli = "scrape"
    urls: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if not a.startswith("-"):
            i += 1
            continue
        flag = "--url" if a == "-u" else a
        if flag == "--url":
            i += 1
            if i < len(argv):
                urls.append(argv[i])
            i += 1
            continue
        if flag == "--method":
            i += 1
            method_cli = argv[i] if i < len(argv) else "scrape"
            i += 1
            continue
        if flag == "--lang":
            i += 1
            if i < len(argv) and argv[i] in ("zh-CN", "en-US"):
                out["lang"] = argv[i]
            i += 1
            continue
        if flag == "--delay":
            i += 1
            out["delay"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--timeout-ms":
            i += 1
            out["timeoutMs"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--bridge-timeout-ms":
            i += 1
            out["bridgeTimeoutMs"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--include-html":
            val, ni = _parse_bool(argv, i)
            out["includeHtml"] = val
            i = ni
            continue
        if flag == "--include-text":
            val, ni = _parse_bool(argv, i)
            out["includeText"] = val
            i = ni
            continue
        if flag == "--scrape-interval":
            i += 1
            out["scrapeInterval"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--concurrency":
            i += 1
            out["concurrency"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--scroll-speed":
            i += 1
            out["scrollSpeed"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--wait-scroll-speed":
            out.setdefault("waitForScroll", {})
            i += 1
            out["waitForScroll"]["scrollSpeed"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--wait-scroll-interval":
            out.setdefault("waitForScroll", {})
            i += 1
            out["waitForScroll"]["scrollInterval"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--wait-max-scroll-height":
            out.setdefault("waitForScroll", {})
            i += 1
            out["waitForScroll"]["maxScrollHeight"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--scroll-container":
            out.setdefault("waitForScroll", {})
            i += 1
            out["waitForScroll"]["scrollContainerSelector"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--max-pages":
            i += 1
            out["maxPages"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--email-domain":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["domain"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--email-keyword":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["keyword"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--email-limit":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["limit"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--phone-type":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["type"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--phone-area-code":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["areaCode"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--phone-keyword":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["keyword"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--phone-limit":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["limit"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--url-domain":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["domain"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--url-keyword":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["keyword"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--url-pattern":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["pattern"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--url-limit":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["limit"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--img-min-width":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["minWidth"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--img-min-height":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["minHeight"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--img-format":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["format"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--img-keyword":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["keyword"] = str(argv[i]) if i < len(argv) else ""
            i += 1
            continue
        if flag == "--img-limit":
            out.setdefault("filter", {})
            i += 1
            out["filter"]["limit"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        if flag == "--auto-launch-browser":
            val, ni = _parse_bool(argv, i)
            out["autoLaunchBrowser"] = val
            i = ni
            continue
        if flag == "--no-auto-launch-browser":
            out["autoLaunchBrowser"] = False
            i += 1
            continue
        if flag == "--post-launch-wait-ms":
            i += 1
            out["postLaunchWaitMs"] = float(argv[i]) if i < len(argv) else 0
            i += 1
            continue
        i += 1

    if mode == "ping":
        return {"name": "ping", "arguments": out}

    if len(urls) == 1:
        out["url"] = urls[0]
    elif len(urls) > 1:
        out["url"] = urls

    bridge_name = METHOD_CLI_TO_BRIDGE.get(method_cli, method_cli)
    if bridge_name == "ping":
        return {"name": "ping", "arguments": out}
    return {"name": bridge_name, "arguments": out}


def _check_finite_number(label: str, v: Any) -> str | None:
    if v is None:
        return None
    if not isinstance(v, (int, float)) or v != v or abs(v) == float("inf"):
        return f"Invalid number for {label} (use a finite number, e.g. --delay 1000)"
    return None


def validate_cli_numeric_tool_args(args: dict[str, Any]) -> str | None:
    for k in (
        "delay",
        "timeoutMs",
        "bridgeTimeoutMs",
        "maxPages",
        "scrapeInterval",
        "concurrency",
        "scrollSpeed",
        "postLaunchWaitMs",
    ):
        err = _check_finite_number(k, args.get(k))
        if err:
            return err
    ws = args.get("waitForScroll")
    if isinstance(ws, dict):
        for k in ("scrollSpeed", "scrollInterval", "maxScrollHeight"):
            err = _check_finite_number(f"waitForScroll.{k}", ws.get(k))
            if err:
                return err
    f = args.get("filter")
    if isinstance(f, dict):
        for k in ("limit", "minWidth", "minHeight"):
            err = _check_finite_number(f"filter.{k}", f.get(k))
            if err:
                return err
    return None


def parse_output_flags(argv: list[str]) -> dict[str, Any]:
    fmt: Literal["json", "pretty"] = "json"
    raw = False
    output_path: str | None = None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--format" and i + 1 < len(argv):
            v = argv[i + 1]
            if v in ("pretty", "json"):
                fmt = v  # type: ignore[assignment]
            i += 2
            continue
        if a == "--raw":
            raw = True
            i += 1
            continue
        if a in ("-o", "--output") and i + 1 < len(argv):
            output_path = argv[i + 1]
            i += 2
            continue
        i += 1
    return {"format": fmt, "raw": raw, "outputPath": output_path}


def parse_api_url(argv: list[str]) -> str | None:
    for i, a in enumerate(argv):
        if a == "--api-url" and i + 1 < len(argv):
            return argv[i + 1].rstrip("/")
    return None
