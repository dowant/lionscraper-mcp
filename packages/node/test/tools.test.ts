import { describe, it, expect } from 'vitest';
import { buildToolDefinitions, toolDefinitions } from '../src/mcp/tools.js';

describe('Tool definitions', () => {
  it('should define all 7 tools', () => {
    const names = Object.keys(toolDefinitions);
    expect(names).toHaveLength(7);
    expect(names).toContain('ping');
    expect(names).toContain('scrape');
    expect(names).toContain('scrape_article');
    expect(names).toContain('scrape_emails');
    expect(names).toContain('scrape_phones');
    expect(names).toContain('scrape_urls');
    expect(names).toContain('scrape_images');
  });

  it('each tool should have name, description, and schema', () => {
    for (const [key, tool] of Object.entries(toolDefinitions)) {
      expect(tool.name).toBe(key);
      expect(tool.description).toBeTruthy();
      expect(tool.schema).toBeDefined();
    }
  });

  describe('ping schema', () => {
    it('should accept empty object', () => {
      const result = toolDefinitions.ping.schema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept lang', () => {
      const result = toolDefinitions.ping.schema.safeParse({ lang: 'zh-CN' });
      expect(result.success).toBe(true);
    });

    it('should accept autoLaunchBrowser and postLaunchWaitMs', () => {
      const result = toolDefinitions.ping.schema.safeParse({
        autoLaunchBrowser: false,
        postLaunchWaitMs: 5000,
      });
      expect(result.success).toBe(true);
    });

    it('should reject postLaunchWaitMs below 3000', () => {
      const result = toolDefinitions.ping.schema.safeParse({ postLaunchWaitMs: 1000 });
      expect(result.success).toBe(false);
    });
  });

  describe('buildToolDefinitions(zh-CN)', () => {
    it('should use Chinese descriptions and schema labels', () => {
      const zh = buildToolDefinitions('zh-CN');
      expect(zh.ping.description).toContain('用途');
      expect(zh.scrape.description).toContain('结构化');
      expect(zh.scrape.description).toContain('多数据组');
      expect(zh.scrape.description).toContain('data[0]');
      expect(zh.scrape.description).not.toMatch(/docs\/mcp|§/);
      const parsed = zh.scrape.schema.safeParse({ url: 'https://x.com' });
      expect(parsed.success).toBe(true);
    });

    it('should mention multiple DataGroups and data[0] in English scrape description', () => {
      const en = buildToolDefinitions('en-US');
      expect(en.scrape.description).toContain('Multiple groups');
      expect(en.scrape.description).toContain('data[0]');
    });
  });

  describe('scrape schema', () => {
    it('should require url', () => {
      const result = toolDefinitions.scrape.schema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept valid params', () => {
      const result = toolDefinitions.scrape.schema.safeParse({
        url: 'https://example.com',
        maxPages: 5,
        delay: 1000,
        timeoutMs: 30000,
      });
      expect(result.success).toBe(true);
    });

    it('should accept bridgeTimeoutMs', () => {
      const result = toolDefinitions.scrape.schema.safeParse({
        url: 'https://example.com',
        timeoutMs: 60000,
        bridgeTimeoutMs: 900000,
      });
      expect(result.success).toBe(true);
    });

    it('should accept url as string[] and collection params without server-side validation', () => {
      const result = toolDefinitions.scrape.schema.safeParse({
        url: ['https://example.com/a', 'https://other.com/b'],
        scrapeInterval: 500,
        concurrency: 4,
        scrollSpeed: 50,
      });
      expect(result.success).toBe(true);
    });

    it('should accept arbitrary string url (forwarded to extension)', () => {
      const result = toolDefinitions.scrape.schema.safeParse({
        url: 'not-validated-by-server',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('scrape_article schema', () => {
    it('should accept valid params', () => {
      const result = toolDefinitions.scrape_article.schema.safeParse({
        url: 'https://example.com/article',
        includeHtml: true,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('scrape_emails schema', () => {
    it('should accept params with filter', () => {
      const result = toolDefinitions.scrape_emails.schema.safeParse({
        url: 'https://example.com',
        filter: {
          domain: 'gmail.com',
          limit: 10,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('scrape_phones schema', () => {
    it('should accept params with filter', () => {
      const result = toolDefinitions.scrape_phones.schema.safeParse({
        url: 'https://example.com',
        filter: {
          type: 'mobile',
          areaCode: '+86',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('scrape_urls schema', () => {
    it('should accept params with filter', () => {
      const result = toolDefinitions.scrape_urls.schema.safeParse({
        url: 'https://example.com',
        filter: {
          domain: 'example.com',
          pattern: '/article/\\d+',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('scrape_images schema', () => {
    it('should accept params with filter', () => {
      const result = toolDefinitions.scrape_images.schema.safeParse({
        url: 'https://example.com',
        filter: {
          minWidth: 200,
          minHeight: 100,
          format: 'png',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('common params', () => {
    it('should accept waitForScroll config', () => {
      const result = toolDefinitions.scrape.schema.safeParse({
        url: 'https://example.com',
        waitForScroll: {
          scrollSpeed: 300,
          scrollInterval: 100,
          maxScrollHeight: 5000,
          scrollContainerSelector: '.main-content',
        },
      });
      expect(result.success).toBe(true);
    });

    it('should accept includeHtml and includeText', () => {
      const result = toolDefinitions.scrape.schema.safeParse({
        url: 'https://example.com',
        includeHtml: true,
        includeText: true,
      });
      expect(result.success).toBe(true);
    });

    it('should accept top-level scrollSpeed alongside waitForScroll.scrollSpeed', () => {
      const result = toolDefinitions.scrape.schema.safeParse({
        url: 'https://example.com',
        scrollSpeed: 100,
        waitForScroll: {
          scrollSpeed: 300,
          scrollInterval: 100,
        },
      });
      expect(result.success).toBe(true);
    });
  });
});
