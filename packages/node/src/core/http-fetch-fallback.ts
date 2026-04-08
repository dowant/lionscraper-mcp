import type { BridgeMethod } from '../types/bridge.js';
import { PageErrorCode, createError } from '../types/errors.js';
import { DEFAULT_PER_TASK_TIMEOUT_MS, countUrls } from '../bridge/timeout.js';
import type { SupportedLang } from '../i18n/lang.js';
import { t } from '../i18n/lang.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const EMAIL_RE = /\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/g;
/** Simple phone-like tokens (best-effort; no extension accuracy). */
const PHONE_RE = /(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{2,6})?/g;
const ABS_URL_RE = /\bhttps?:\/\/[^\s"'<>()[\]{}]+/gi;
const IMG_SRC_RE = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;

function normalizeUrlList(params: Record<string, unknown>): string[] {
  const u = params.url;
  if (typeof u === 'string' && u.trim()) return [u.trim()];
  if (Array.isArray(u)) {
    const out: string[] = [];
    for (const x of u) {
      if (typeof x === 'string' && x.trim()) out.push(x.trim());
    }
    return out.slice(0, 50);
  }
  throw createError(PageErrorCode.PAGE_LOAD_FAILED, 'Missing or invalid url parameter');
}

function resolveFetchTimeoutMs(params: Record<string, unknown>): number {
  const per =
    typeof params.timeoutMs === 'number' && params.timeoutMs >= 1000
      ? params.timeoutMs
      : DEFAULT_PER_TASK_TIMEOUT_MS;
  const n = Math.min(50, Math.max(1, countUrls(params.url)));
  return Math.min(120_000, per * n + 5000);
}

function stripTags(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupe<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

async function fetchHtml(
  url: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ html: string; finalUrl: string; status: number }> {
  const ctrl = new AbortController();
  const tId = setTimeout(() => ctrl.abort(), timeoutMs);
  const merged = signal
    ? (() => {
        const onAbort = () => ctrl.abort();
        if (signal.aborted) ctrl.abort();
        else signal.addEventListener('abort', onAbort, { once: true });
        return () => signal.removeEventListener('abort', onAbort);
      })()
    : null;

  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'LionScraper-MCP/1.0 (+https://www.lionspider.com/) http-fetch-fallback',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const slice = buf.byteLength > MAX_BODY_BYTES ? buf.slice(0, MAX_BODY_BYTES) : buf;
    const html = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    return { html, finalUrl: res.url, status: res.status };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw createError(PageErrorCode.PAGE_LOAD_FAILED, `HTTP fetch failed: ${msg}`, { url });
  } finally {
    clearTimeout(tId);
    merged?.();
  }
}

function extractEmails(html: string): string[] {
  const m = html.match(EMAIL_RE);
  return dedupe(m ?? []);
}

function extractPhones(html: string): string[] {
  const raw = html.match(PHONE_RE) ?? [];
  const cleaned = raw.map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length >= 8);
  return dedupe(cleaned);
}

function extractUrls(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(ABS_URL_RE)) {
    try {
      const u = m[0].replace(/[),.;]+$/g, '');
      found.push(new URL(u).href);
    } catch {
      /* skip */
    }
  }
  const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html)) !== null) {
    try {
      found.push(new URL(m[1], baseUrl).href);
    } catch {
      /* skip */
    }
  }
  return dedupe(found);
}

function extractImages(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(IMG_SRC_RE.source, IMG_SRC_RE.flags);
  while ((m = re.exec(html)) !== null) {
    try {
      found.push(new URL(m[1], baseUrl).href);
    } catch {
      /* skip */
    }
  }
  return dedupe(found);
}

function metaBase(httpFetchFallback: true, lang: SupportedLang, extra?: Record<string, unknown>) {
  return {
    httpFetchFallback,
    note: t(lang, 'http_fetch_fallback.note'),
    ...extra,
  };
}

/**
 * When Chrome/Edge are not installed and the extension is not connected, run a
 * minimal server-side GET + parse. Does not execute JavaScript.
 */
export async function runHttpFetchFallback(
  method: BridgeMethod,
  params: Record<string, unknown>,
  lang: SupportedLang,
  signal?: AbortSignal,
): Promise<unknown> {
  const urls = normalizeUrlList(params);
  const timeoutMs = resolveFetchTimeoutMs(params);

  if (method === 'scrape') {
    const results = [];
    for (const url of urls) {
      const { html, finalUrl, status } = await fetchHtml(url, timeoutMs, signal);
      if (status >= 400) {
        results.push({
          url,
          ok: false,
          error: { code: PageErrorCode.PAGE_HTTP_ERROR, message: `HTTP ${status}` },
          meta: metaBase(true, lang, { status }),
        });
        continue;
      }
      const text = stripTags(html);
      results.push({
        url: finalUrl,
        ok: true,
        data: [],
        meta: metaBase(true, lang, { status, strippedTextLength: text.length }),
      });
    }
    return {
      ok: true,
      summary: { httpFetchFallback: true, urlCount: urls.length },
      results,
    };
  }

  if (method === 'scrape_article') {
    const results = [];
    for (const url of urls) {
      const { html, finalUrl, status } = await fetchHtml(url, timeoutMs, signal);
      if (status >= 400) {
        results.push({
          url,
          ok: false,
          error: { code: PageErrorCode.PAGE_HTTP_ERROR, message: `HTTP ${status}` },
        });
        continue;
      }
      const text = stripTags(html);
      results.push({
        url: finalUrl,
        ok: true,
        data: { markdown: text, html: params.includeHtml === true ? html : undefined },
        meta: metaBase(true, lang, { status }),
      });
    }
    return { ok: true, summary: { httpFetchFallback: true }, results };
  }

  if (method === 'scrape_emails') {
    const results = [];
    for (const url of urls) {
      const { html, finalUrl, status } = await fetchHtml(url, timeoutMs, signal);
      if (status >= 400) {
        results.push({ url, ok: false, error: { message: `HTTP ${status}` } });
        continue;
      }
      let emails = extractEmails(html);
      const f = params.filter as Record<string, unknown> | undefined;
      if (f && typeof f.domain === 'string' && f.domain) {
        const d = f.domain.toLowerCase();
        emails = emails.filter((e) => e.toLowerCase().endsWith(`@${d}`) || e.toLowerCase().includes(`@${d}`));
      }
      if (f && typeof f.keyword === 'string' && f.keyword) {
        const k = f.keyword.toLowerCase();
        emails = emails.filter((e) => e.toLowerCase().includes(k));
      }
      if (f && typeof f.limit === 'number' && f.limit > 0) {
        emails = emails.slice(0, Math.floor(f.limit));
      }
      results.push({
        url: finalUrl,
        ok: true,
        data: emails,
        meta: metaBase(true, lang, { status }),
      });
    }
    return { ok: true, summary: { httpFetchFallback: true }, results };
  }

  if (method === 'scrape_phones') {
    const results = [];
    for (const url of urls) {
      const { html, finalUrl, status } = await fetchHtml(url, timeoutMs, signal);
      if (status >= 400) {
        results.push({ url, ok: false, error: { message: `HTTP ${status}` } });
        continue;
      }
      let phones = extractPhones(html);
      const f = params.filter as Record<string, unknown> | undefined;
      if (f && typeof f.keyword === 'string' && f.keyword) {
        const k = f.keyword.toLowerCase();
        phones = phones.filter((p) => p.toLowerCase().includes(k));
      }
      if (f && typeof f.limit === 'number' && f.limit > 0) {
        phones = phones.slice(0, Math.floor(f.limit));
      }
      results.push({ url: finalUrl, ok: true, data: phones, meta: metaBase(true, lang, { status }) });
    }
    return { ok: true, summary: { httpFetchFallback: true }, results };
  }

  if (method === 'scrape_urls') {
    const results = [];
    for (const url of urls) {
      const { html, finalUrl, status } = await fetchHtml(url, timeoutMs, signal);
      if (status >= 400) {
        results.push({ url, ok: false, error: { message: `HTTP ${status}` } });
        continue;
      }
      let links = extractUrls(html, finalUrl);
      const f = params.filter as Record<string, unknown> | undefined;
      if (f && typeof f.domain === 'string' && f.domain) {
        const d = f.domain.toLowerCase();
        links = links.filter((x) => {
          try {
            return new URL(x).hostname.toLowerCase().includes(d);
          } catch {
            return false;
          }
        });
      }
      if (f && typeof f.keyword === 'string' && f.keyword) {
        const k = f.keyword.toLowerCase();
        links = links.filter((x) => x.toLowerCase().includes(k));
      }
      if (f && typeof f.limit === 'number' && f.limit > 0) {
        links = links.slice(0, Math.floor(f.limit));
      }
      results.push({ url: finalUrl, ok: true, data: links, meta: metaBase(true, lang, { status }) });
    }
    return { ok: true, summary: { httpFetchFallback: true }, results };
  }

  if (method === 'scrape_images') {
    const results = [];
    for (const url of urls) {
      const { html, finalUrl, status } = await fetchHtml(url, timeoutMs, signal);
      if (status >= 400) {
        results.push({ url, ok: false, error: { message: `HTTP ${status}` } });
        continue;
      }
      let imgs = extractImages(html, finalUrl);
      const f = params.filter as Record<string, unknown> | undefined;
      if (f && typeof f.keyword === 'string' && f.keyword) {
        const k = f.keyword.toLowerCase();
        imgs = imgs.filter((x) => x.toLowerCase().includes(k));
      }
      if (f && typeof f.limit === 'number' && f.limit > 0) {
        imgs = imgs.slice(0, Math.floor(f.limit));
      }
      results.push({ url: finalUrl, ok: true, data: imgs, meta: metaBase(true, lang, { status }) });
    }
    return { ok: true, summary: { httpFetchFallback: true }, results };
  }

  throw createError(PageErrorCode.PAGE_LOAD_FAILED, `HTTP fallback not supported for ${method}`);
}
