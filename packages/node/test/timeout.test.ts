import { describe, it, expect } from 'vitest';
import {
  countUrls,
  resolveBridgeTimeoutMs,
  paramsForExtension,
  DEFAULT_PER_TASK_TIMEOUT_MS,
  MAX_BRIDGE_TIMEOUT_MS,
} from '../src/bridge/timeout.js';

describe('timeout', () => {
  describe('countUrls', () => {
    it('counts array length', () => {
      expect(countUrls(['a', 'b'])).toBe(2);
    });

    it('treats non-array as one URL', () => {
      expect(countUrls('https://x.com')).toBe(1);
    });
  });

  describe('resolveBridgeTimeoutMs', () => {
    it('defaults to per-task timeout for single URL', () => {
      expect(resolveBridgeTimeoutMs({ url: 'https://a.com' })).toBe(DEFAULT_PER_TASK_TIMEOUT_MS);
    });

    it('scales with URL count', () => {
      expect(resolveBridgeTimeoutMs({ url: ['a', 'b', 'c'], timeoutMs: 10_000 })).toBe(30_000);
    });

    it('scales single URL with maxPages (pagination)', () => {
      expect(resolveBridgeTimeoutMs({ url: 'https://list.example', maxPages: 10, timeoutMs: 60_000 })).toBe(
        600_000,
      );
    });

    it('combines URL array length and maxPages', () => {
      expect(
        resolveBridgeTimeoutMs({ url: ['https://a.com', 'https://b.com'], maxPages: 3, timeoutMs: 10_000 }),
      ).toBe(60_000);
    });

    it('adds scrapeInterval stagger for batch', () => {
      expect(
        resolveBridgeTimeoutMs({
          url: ['a', 'b'],
          timeoutMs: 60_000,
          scrapeInterval: 5_000,
        }),
      ).toBe(125_000);
    });

    it('honors explicit bridgeTimeoutMs', () => {
      expect(
        resolveBridgeTimeoutMs({
          url: ['a', 'b', 'c'],
          bridgeTimeoutMs: 999_000,
          timeoutMs: 10_000,
        }),
      ).toBe(999_000);
    });

    it('caps explicit bridgeTimeoutMs', () => {
      expect(
        resolveBridgeTimeoutMs({
          url: 'x',
          bridgeTimeoutMs: MAX_BRIDGE_TIMEOUT_MS + 1_000_000,
        }),
      ).toBe(MAX_BRIDGE_TIMEOUT_MS);
    });

    it('caps derived value', () => {
      const urls = Array.from({ length: 100 }, (_, i) => `https://e.com/${i}`);
      expect(resolveBridgeTimeoutMs({ url: urls, timeoutMs: 120_000 })).toBe(MAX_BRIDGE_TIMEOUT_MS);
    });
  });

  describe('paramsForExtension', () => {
    it('removes bridgeTimeoutMs', () => {
      expect(
        paramsForExtension({
          url: 'x',
          timeoutMs: 30_000,
          bridgeTimeoutMs: 500_000,
        }),
      ).toEqual({ url: 'x', timeoutMs: 30_000 });
    });

    it('forwards lang to extension', () => {
      expect(
        paramsForExtension({
          url: 'x',
          lang: 'zh-CN',
          bridgeTimeoutMs: 500_000,
        }),
      ).toEqual({ url: 'x', lang: 'zh-CN' });
    });
  });
});
