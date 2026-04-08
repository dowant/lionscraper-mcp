from __future__ import annotations

import asyncio
import re
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

import aiohttp

from lionscraper.bridge.timeout import DEFAULT_PER_TASK_TIMEOUT_MS, count_urls
from lionscraper.i18n.lang import SupportedLang, t
from lionscraper.types.bridge import BridgeMethod
from lionscraper.types.errors import PageErrorCode, create_error

MAX_BODY_BYTES = 2 * 1024 * 1024

EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b"
)
PHONE_RE = re.compile(
    r"(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{2,6})?"
)
ABS_URL_RE = re.compile(r"\bhttps?://[^\s\"'<>()[\]{}]+", re.I)
HREF_RE = re.compile(r'\bhref\s*=\s*["\']([^"\']+)["\']', re.I)
IMG_SRC_RE = re.compile(r'<img\b[^>]*\bsrc\s*=\s*["\']([^"\']+)["\']', re.I)

_FETCH_HEADERS = {
    "User-Agent": "LionScraper-MCP/1.0 (+https://www.lionspider.com/) aiohttp-fetch-fallback",
    "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
}


def _normalize_url_list(params: dict[str, Any]) -> list[str]:
    u = params.get("url")
    if isinstance(u, str) and u.strip():
        return [u.strip()]
    if isinstance(u, list):
        out = [str(x).strip() for x in u if isinstance(x, str) and str(x).strip()]
        return out[:50]
    raise create_error(PageErrorCode.PAGE_LOAD_FAILED, "Missing or invalid url parameter")


def _resolve_fetch_timeout_ms(params: dict[str, Any]) -> float:
    per = (
        float(params["timeoutMs"])
        if isinstance(params.get("timeoutMs"), (int, float)) and params["timeoutMs"] >= 1000
        else float(DEFAULT_PER_TASK_TIMEOUT_MS)
    )
    n = min(50, max(1, count_urls(params.get("url"))))
    return min(120_000.0, per * n + 5000.0) / 1000.0


def _strip_tags(html: str) -> str:
    html = re.sub(r"<script\b[^<]*(?:(?!</script>)<[^<]*)*</script>", " ", html, flags=re.I)
    html = re.sub(r"<style\b[^<]*(?:(?!</style>)<[^<]*)*</style>", " ", html, flags=re.I)
    html = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", html).strip()


def _dedupe(seq: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


async def _fetch_html(
    session: aiohttp.ClientSession,
    url: str,
    timeout_s: float,
) -> tuple[str, str, int]:
    try:
        t = aiohttp.ClientTimeout(total=timeout_s)
        async with session.get(url, headers=_FETCH_HEADERS, allow_redirects=True, timeout=t) as res:
            raw = await res.read()
            if len(raw) > MAX_BODY_BYTES:
                raw = raw[:MAX_BODY_BYTES]
            html = raw.decode("utf-8", errors="replace")
            return html, str(res.url), res.status
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        raise create_error(PageErrorCode.PAGE_LOAD_FAILED, f"HTTP fetch failed: {e}", {"url": url}) from e


def _extract_emails(html: str) -> list[str]:
    return _dedupe(EMAIL_RE.findall(html))


def _extract_phones(html: str) -> list[str]:
    raw = PHONE_RE.findall(html)
    cleaned = [re.sub(r"\s+", " ", p).strip() for p in raw if len(re.sub(r"\s+", " ", p).strip()) >= 8]
    return _dedupe(cleaned)


def _extract_urls(html: str, base_url: str) -> list[str]:
    found: list[str] = []
    for m in ABS_URL_RE.finditer(html):
        u = m.group(0).rstrip(").,;")
        try:
            p = urlparse(u)
            if p.scheme and p.netloc:
                found.append(urlunparse(p._replace(fragment="")))
        except Exception:
            pass
    for m in HREF_RE.finditer(html):
        try:
            found.append(urljoin(base_url, m.group(1)))
        except Exception:
            pass
    return _dedupe(found)


def _extract_images(html: str, base_url: str) -> list[str]:
    found: list[str] = []
    for m in IMG_SRC_RE.finditer(html):
        try:
            found.append(urljoin(base_url, m.group(1)))
        except Exception:
            pass
    return _dedupe(found)


def _meta(lang: SupportedLang, **extra: Any) -> dict[str, Any]:
    return {"httpFetchFallback": True, "note": t(lang, "http_fetch_fallback.note"), **extra}


async def run_http_fetch_fallback(
    method: BridgeMethod,
    params: dict[str, Any],
    lang: SupportedLang,
) -> Any:
    urls = _normalize_url_list(params)
    timeout_s = _resolve_fetch_timeout_ms(params)

    async with aiohttp.ClientSession() as session:
        if method == "scrape":
            results = []
            for url in urls:
                html, final_url, status = await _fetch_html(session, url, timeout_s)
                if status >= 400:
                    results.append(
                        {
                            "url": url,
                            "ok": False,
                            "error": {
                                "code": PageErrorCode.PAGE_HTTP_ERROR.value,
                                "message": f"HTTP {status}",
                            },
                            "meta": _meta(lang, status=status),
                        }
                    )
                    continue
                text = _strip_tags(html)
                results.append(
                    {
                        "url": final_url,
                        "ok": True,
                        "data": [],
                        "meta": _meta(lang, status=status, strippedTextLength=len(text)),
                    }
                )
            return {"ok": True, "summary": {"httpFetchFallback": True, "urlCount": len(urls)}, "results": results}

        if method == "scrape_article":
            results = []
            for url in urls:
                html, final_url, status = await _fetch_html(session, url, timeout_s)
                if status >= 400:
                    results.append(
                        {
                            "url": url,
                            "ok": False,
                            "error": {"code": PageErrorCode.PAGE_HTTP_ERROR.value, "message": f"HTTP {status}"},
                        }
                    )
                    continue
                text = _strip_tags(html)
                data: dict[str, Any] = {"markdown": text}
                if params.get("includeHtml") is True:
                    data["html"] = html
                results.append(
                    {"url": final_url, "ok": True, "data": data, "meta": _meta(lang, status=status)}
                )
            return {"ok": True, "summary": {"httpFetchFallback": True}, "results": results}

        if method == "scrape_emails":
            results = []
            for url in urls:
                html, final_url, status = await _fetch_html(session, url, timeout_s)
                if status >= 400:
                    results.append({"url": url, "ok": False, "error": {"message": f"HTTP {status}"}})
                    continue
                emails = _extract_emails(html)
                f = params.get("filter")
                if isinstance(f, dict):
                    if isinstance(f.get("domain"), str) and f["domain"]:
                        d = f["domain"].lower()
                        emails = [e for e in emails if d in e.lower()]
                    if isinstance(f.get("keyword"), str) and f["keyword"]:
                        k = f["keyword"].lower()
                        emails = [e for e in emails if k in e.lower()]
                    if isinstance(f.get("limit"), (int, float)) and f["limit"] > 0:
                        emails = emails[: int(f["limit"])]
                results.append(
                    {"url": final_url, "ok": True, "data": emails, "meta": _meta(lang, status=status)}
                )
            return {"ok": True, "summary": {"httpFetchFallback": True}, "results": results}

        if method == "scrape_phones":
            results = []
            for url in urls:
                html, final_url, status = await _fetch_html(session, url, timeout_s)
                if status >= 400:
                    results.append({"url": url, "ok": False, "error": {"message": f"HTTP {status}"}})
                    continue
                phones = _extract_phones(html)
                f = params.get("filter")
                if isinstance(f, dict):
                    if isinstance(f.get("keyword"), str) and f["keyword"]:
                        k = f["keyword"].lower()
                        phones = [p for p in phones if k in p.lower()]
                    if isinstance(f.get("limit"), (int, float)) and f["limit"] > 0:
                        phones = phones[: int(f["limit"])]
                results.append(
                    {"url": final_url, "ok": True, "data": phones, "meta": _meta(lang, status=status)}
                )
            return {"ok": True, "summary": {"httpFetchFallback": True}, "results": results}

        if method == "scrape_urls":
            results = []
            for url in urls:
                html, final_url, status = await _fetch_html(session, url, timeout_s)
                if status >= 400:
                    results.append({"url": url, "ok": False, "error": {"message": f"HTTP {status}"}})
                    continue
                links = _extract_urls(html, final_url)
                f = params.get("filter")
                if isinstance(f, dict):
                    if isinstance(f.get("domain"), str) and f["domain"]:
                        d = f["domain"].lower()
                        links = [x for x in links if d in urlparse(x).netloc.lower()]
                    if isinstance(f.get("keyword"), str) and f["keyword"]:
                        k = f["keyword"].lower()
                        links = [x for x in links if k in x.lower()]
                    if isinstance(f.get("limit"), (int, float)) and f["limit"] > 0:
                        links = links[: int(f["limit"])]
                results.append(
                    {"url": final_url, "ok": True, "data": links, "meta": _meta(lang, status=status)}
                )
            return {"ok": True, "summary": {"httpFetchFallback": True}, "results": results}

        if method == "scrape_images":
            results = []
            for url in urls:
                html, final_url, status = await _fetch_html(session, url, timeout_s)
                if status >= 400:
                    results.append({"url": url, "ok": False, "error": {"message": f"HTTP {status}"}})
                    continue
                imgs = _extract_images(html, final_url)
                f = params.get("filter")
                if isinstance(f, dict):
                    if isinstance(f.get("keyword"), str) and f["keyword"]:
                        k = f["keyword"].lower()
                        imgs = [x for x in imgs if k in x.lower()]
                    if isinstance(f.get("limit"), (int, float)) and f["limit"] > 0:
                        imgs = imgs[: int(f["limit"])]
                results.append(
                    {"url": final_url, "ok": True, "data": imgs, "meta": _meta(lang, status=status)}
                )
            return {"ok": True, "summary": {"httpFetchFallback": True}, "results": results}

    raise create_error(PageErrorCode.PAGE_LOAD_FAILED, f"HTTP fallback not supported for {method}")
