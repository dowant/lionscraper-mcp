import { describe, expect, it } from 'vitest';
import {
  buildInvocationFromArgv,
  parseApiUrl,
  parseOutputFlags,
  validateCliNumericToolArgs,
} from '../src/cli/build-tool-args.js';

describe('buildInvocationFromArgv', () => {
  it('maps scrape with single url and default method', () => {
    const r = buildInvocationFromArgv(['--url', 'https://a.com'], 'scrape');
    expect(r.name).toBe('scrape');
    expect(r.arguments).toEqual({ url: 'https://a.com' });
  });

  it('maps multiple --url to array', () => {
    const r = buildInvocationFromArgv(['-u', 'https://a.com', '--url', 'https://b.com'], 'scrape');
    expect(r.name).toBe('scrape');
    expect(r.arguments.url).toEqual(['https://a.com', 'https://b.com']);
  });

  it('maps --method article', () => {
    const r = buildInvocationFromArgv(['--method', 'article', '-u', 'https://x.com'], 'scrape');
    expect(r.name).toBe('scrape_article');
  });

  it('maps ping mode', () => {
    const r = buildInvocationFromArgv(['--lang', 'zh-CN'], 'ping');
    expect(r.name).toBe('ping');
    expect(r.arguments).toEqual({ lang: 'zh-CN' });
  });

  it('builds waitForScroll and filter', () => {
    const r = buildInvocationFromArgv(
      [
        '-u',
        'https://x.com',
        '--wait-scroll-speed',
        '80',
        '--scroll-container',
        '#main',
        '--email-domain',
        'ex.com',
        '--email-limit',
        '10',
      ],
      'scrape',
    );
    expect(r.arguments.url).toBe('https://x.com');
    expect(r.arguments.waitForScroll).toEqual({ scrollSpeed: 80, scrollContainerSelector: '#main' });
    expect(r.arguments.filter).toEqual({ domain: 'ex.com', limit: 10 });
  });
});

describe('parseOutputFlags', () => {
  it('defaults to json', () => {
    expect(parseOutputFlags([])).toEqual({ format: 'json', raw: false, outputPath: undefined });
  });

  it('parses --format pretty and -o', () => {
    expect(parseOutputFlags(['--format', 'pretty', '-o', 'out.json'])).toEqual({
      format: 'pretty',
      raw: false,
      outputPath: 'out.json',
    });
  });
});

describe('parseApiUrl', () => {
  it('returns override', () => {
    expect(parseApiUrl(['--api-url', 'http://127.0.0.1:9999'])).toBe('http://127.0.0.1:9999');
  });
});

describe('validateCliNumericToolArgs', () => {
  it('returns message when delay is NaN', () => {
    const r = buildInvocationFromArgv(['--url', 'https://a.com', '--delay', 'nope'], 'scrape');
    const err = validateCliNumericToolArgs(r.arguments);
    expect(err).toMatch(/delay/i);
  });

  it('returns null for valid numbers', () => {
    const r = buildInvocationFromArgv(['--url', 'https://a.com', '--delay', '500'], 'scrape');
    expect(validateCliNumericToolArgs(r.arguments)).toBeNull();
  });
});
