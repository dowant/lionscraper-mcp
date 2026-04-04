import type { BridgeMethod } from '../types/bridge.js';

const METHOD_CLI_TO_BRIDGE: Record<string, BridgeMethod | 'ping'> = {
  scrape: 'scrape',
  article: 'scrape_article',
  emails: 'scrape_emails',
  phones: 'scrape_phones',
  urls: 'scrape_urls',
  images: 'scrape_images',
};

function parseBool(argv: string[], i: number): { value: boolean; next: number } {
  const v = argv[i + 1];
  if (v === 'true' || v === '1') return { value: true, next: i + 2 };
  if (v === 'false' || v === '0') return { value: false, next: i + 2 };
  return { value: true, next: i + 1 };
}

/**
 * Parse `lionscraper scrape ...` or `lionscraper ping ...` argv (excluding subcommand).
 */
export function buildInvocationFromArgv(
  argv: string[],
  mode: 'scrape' | 'ping',
): { name: string; arguments: Record<string, unknown> } {
  const out: Record<string, unknown> = {};
  let methodCli = 'scrape';
  const urls: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-')) continue;

    const flag = a === '-u' ? '--url' : a;

    if (flag === '--url') {
      const v = argv[++i];
      if (v) urls.push(v);
      continue;
    }
    if (flag === '--method') {
      methodCli = argv[++i] ?? 'scrape';
      continue;
    }
    if (flag === '--lang') {
      const v = argv[++i];
      if (v === 'zh-CN' || v === 'en-US') out.lang = v;
      continue;
    }
    if (flag === '--delay') {
      out.delay = Number(argv[++i]);
      continue;
    }
    if (flag === '--timeout-ms') {
      out.timeoutMs = Number(argv[++i]);
      continue;
    }
    if (flag === '--bridge-timeout-ms') {
      out.bridgeTimeoutMs = Number(argv[++i]);
      continue;
    }
    if (flag === '--include-html') {
      const { value, next } = parseBool(argv, i);
      out.includeHtml = value;
      i = next - 1;
      continue;
    }
    if (flag === '--include-text') {
      const { value, next } = parseBool(argv, i);
      out.includeText = value;
      i = next - 1;
      continue;
    }
    if (flag === '--scrape-interval') {
      out.scrapeInterval = Number(argv[++i]);
      continue;
    }
    if (flag === '--concurrency') {
      out.concurrency = Number(argv[++i]);
      continue;
    }
    if (flag === '--scroll-speed') {
      out.scrollSpeed = Number(argv[++i]);
      continue;
    }
    if (flag === '--wait-scroll-speed') {
      if (!out.waitForScroll || typeof out.waitForScroll !== 'object') out.waitForScroll = {};
      (out.waitForScroll as Record<string, number>).scrollSpeed = Number(argv[++i]);
      continue;
    }
    if (flag === '--wait-scroll-interval') {
      if (!out.waitForScroll || typeof out.waitForScroll !== 'object') out.waitForScroll = {};
      (out.waitForScroll as Record<string, number>).scrollInterval = Number(argv[++i]);
      continue;
    }
    if (flag === '--wait-max-scroll-height') {
      if (!out.waitForScroll || typeof out.waitForScroll !== 'object') out.waitForScroll = {};
      (out.waitForScroll as Record<string, number>).maxScrollHeight = Number(argv[++i]);
      continue;
    }
    if (flag === '--scroll-container') {
      if (!out.waitForScroll || typeof out.waitForScroll !== 'object') out.waitForScroll = {};
      (out.waitForScroll as Record<string, string>).scrollContainerSelector = String(argv[++i]);
      continue;
    }
    if (flag === '--max-pages') {
      out.maxPages = Number(argv[++i]);
      continue;
    }
    if (flag === '--email-domain') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).domain = String(argv[++i]);
      continue;
    }
    if (flag === '--email-keyword') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).keyword = String(argv[++i]);
      continue;
    }
    if (flag === '--email-limit') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, number>).limit = Number(argv[++i]);
      continue;
    }
    if (flag === '--phone-type') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).type = String(argv[++i]);
      continue;
    }
    if (flag === '--phone-area-code') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).areaCode = String(argv[++i]);
      continue;
    }
    if (flag === '--phone-keyword') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).keyword = String(argv[++i]);
      continue;
    }
    if (flag === '--phone-limit') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, number>).limit = Number(argv[++i]);
      continue;
    }
    if (flag === '--url-domain') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).domain = String(argv[++i]);
      continue;
    }
    if (flag === '--url-keyword') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).keyword = String(argv[++i]);
      continue;
    }
    if (flag === '--url-pattern') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).pattern = String(argv[++i]);
      continue;
    }
    if (flag === '--url-limit') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, number>).limit = Number(argv[++i]);
      continue;
    }
    if (flag === '--img-min-width') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, number>).minWidth = Number(argv[++i]);
      continue;
    }
    if (flag === '--img-min-height') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, number>).minHeight = Number(argv[++i]);
      continue;
    }
    if (flag === '--img-format') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).format = String(argv[++i]);
      continue;
    }
    if (flag === '--img-keyword') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, string>).keyword = String(argv[++i]);
      continue;
    }
    if (flag === '--img-limit') {
      if (!out.filter || typeof out.filter !== 'object') out.filter = {};
      (out.filter as Record<string, number>).limit = Number(argv[++i]);
      continue;
    }
    if (flag === '--auto-launch-browser') {
      const { value, next } = parseBool(argv, i);
      out.autoLaunchBrowser = value;
      i = next - 1;
      continue;
    }
    if (flag === '--no-auto-launch-browser') {
      out.autoLaunchBrowser = false;
      continue;
    }
    if (flag === '--post-launch-wait-ms') {
      out.postLaunchWaitMs = Number(argv[++i]);
      continue;
    }
  }

  if (mode === 'ping') {
    return { name: 'ping', arguments: out };
  }

  if (urls.length === 1) {
    out.url = urls[0];
  } else if (urls.length > 1) {
    out.url = urls;
  }

  const bridgeName = METHOD_CLI_TO_BRIDGE[methodCli] ?? methodCli;
  if (bridgeName === 'ping') {
    return { name: 'ping', arguments: out };
  }
  return { name: bridgeName, arguments: out };
}

export interface OutputOptions {
  format: 'json' | 'pretty';
  raw: boolean;
  outputPath?: string;
}

export function parseOutputFlags(argv: string[]): OutputOptions {
  let format: 'json' | 'pretty' = 'json';
  let raw = false;
  let outputPath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--format' && argv[i + 1]) {
      const v = argv[++i];
      if (v === 'pretty' || v === 'json') format = v;
      continue;
    }
    if (a === '--raw') {
      raw = true;
      continue;
    }
    if ((a === '-o' || a === '--output') && argv[i + 1]) {
      outputPath = argv[++i];
      continue;
    }
  }

  return { format, raw, outputPath };
}

export function parseApiUrl(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--api-url' && argv[i + 1]) {
      return argv[++i].replace(/\/$/, '');
    }
  }
  return undefined;
}
