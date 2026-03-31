import { z } from 'zod';
import type { SupportedLang } from '../i18n/lang.js';
import enUS from '../locale/en-US.json' with { type: 'json' };
import zhCN from '../locale/zh-CN.json' with { type: 'json' };

/** Prepended to every scraping tool description (metadata locale). */
export const SCRAPE_SHARED_PREFIX: Record<SupportedLang, string> = {
  'en-US': enUS.tools.scrapeSharedPrefix,
  'zh-CN': zhCN.tools.scrapeSharedPrefix,
};

export const TOOL_DESCRIPTIONS: Record<
  SupportedLang,
  {
    ping: string;
    scrape: string;
    scrape_article: string;
    scrape_emails: string;
    scrape_phones: string;
    scrape_urls: string;
    scrape_images: string;
  }
> = {
  'en-US': enUS.tools.descriptions,
  'zh-CN': zhCN.tools.descriptions,
};

export interface ToolSchemaCopy {
  autoLaunchBrowser: string;
  postLaunchWaitMs: string;
  waitForScrollGroup: string;
  scrollSpeed: string;
  scrollInterval: string;
  maxScrollHeight: string;
  scrollContainerSelector: string;
  url: string;
  lang: string;
  delay: string;
  timeoutMs: string;
  bridgeTimeoutMs: string;
  includeHtml: string;
  includeText: string;
  scrapeInterval: string;
  concurrency: string;
  scrollSpeedTop: string;
  maxPages: string;
  filterEmails: string;
  emailDomain: string;
  emailKeyword: string;
  emailLimit: string;
  filterPhones: string;
  phoneType: string;
  phoneAreaCode: string;
  phoneKeyword: string;
  phoneLimit: string;
  filterUrls: string;
  urlDomain: string;
  urlKeyword: string;
  urlPattern: string;
  urlLimit: string;
  filterImages: string;
  imgMinWidth: string;
  imgMinHeight: string;
  imgFormat: string;
  imgKeyword: string;
  imgLimit: string;
}

export const TOOL_SCHEMA_COPY: Record<SupportedLang, ToolSchemaCopy> = {
  'en-US': enUS.tools.schema as ToolSchemaCopy,
  'zh-CN': zhCN.tools.schema as ToolSchemaCopy,
};

function buildWaitForScrollSchema(locale: SupportedLang) {
  const s = TOOL_SCHEMA_COPY[locale];
  return z
    .object({
      scrollSpeed: z.number().describe(s.scrollSpeed),
      scrollInterval: z.number().describe(s.scrollInterval),
      maxScrollHeight: z.number().optional().describe(s.maxScrollHeight),
      scrollContainerSelector: z.string().optional().describe(s.scrollContainerSelector),
    })
    .describe(s.waitForScrollGroup);
}

function buildCommonParamsFields(locale: SupportedLang) {
  const s = TOOL_SCHEMA_COPY[locale];
  return {
    url: z
      .union([z.string(), z.array(z.string())])
      .describe(s.url),
    lang: z
      .enum(['en-US', 'zh-CN'])
      .optional()
      .describe(s.lang),
    delay: z.number().min(0).optional().describe(s.delay),
    waitForScroll: buildWaitForScrollSchema(locale).optional(),
    timeoutMs: z.number().min(1000).optional().describe(s.timeoutMs),
    bridgeTimeoutMs: z.number().min(1000).optional().describe(s.bridgeTimeoutMs),
    includeHtml: z.boolean().optional().describe(s.includeHtml),
    includeText: z.boolean().optional().describe(s.includeText),
    scrapeInterval: z.number().optional().describe(s.scrapeInterval),
    concurrency: z.number().optional().describe(s.concurrency),
    scrollSpeed: z.number().optional().describe(s.scrollSpeedTop),
  };
}

/**
 * Build MCP tool definitions for the given **metadata** locale.
 * - Descriptions and Zod `describe` strings follow `locale`.
 * - Per-call runtime errors still use the `lang` argument on each tool (docs/mcp.md §5.0).
 * - Choose locale at process start via **`LANG`** (see `getToolMetadataLocale` in `i18n/lang.ts`).
 */
export function buildToolDefinitions(locale: SupportedLang) {
  const prefix = SCRAPE_SHARED_PREFIX[locale];
  const d = TOOL_DESCRIPTIONS[locale];
  const s = TOOL_SCHEMA_COPY[locale];
  const commonParamsFields = buildCommonParamsFields(locale);

  return {
    ping: {
      name: 'ping' as const,
      description: d.ping,
      schema: z.object({
        lang: z.enum(['en-US', 'zh-CN']).optional().describe(s.lang),
        autoLaunchBrowser: z.boolean().optional().describe(s.autoLaunchBrowser),
        postLaunchWaitMs: z
          .number()
          .min(3000)
          .max(60000)
          .optional()
          .describe(s.postLaunchWaitMs),
      }),
    },

    scrape: {
      name: 'scrape' as const,
      description: `${prefix}${d.scrape}`,
      schema: z.object({
        ...commonParamsFields,
        maxPages: z.number().min(1).optional().describe(s.maxPages),
      }),
    },

    scrape_article: {
      name: 'scrape_article' as const,
      description: `${prefix}${d.scrape_article}`,
      schema: z.object({
        ...commonParamsFields,
      }),
    },

    scrape_emails: {
      name: 'scrape_emails' as const,
      description: `${prefix}${d.scrape_emails}`,
      schema: z.object({
        ...commonParamsFields,
        filter: z
          .object({
            domain: z.string().optional().describe(s.emailDomain),
            keyword: z.string().optional().describe(s.emailKeyword),
            limit: z.number().min(1).optional().describe(s.emailLimit),
          })
          .optional()
          .describe(s.filterEmails),
      }),
    },

    scrape_phones: {
      name: 'scrape_phones' as const,
      description: `${prefix}${d.scrape_phones}`,
      schema: z.object({
        ...commonParamsFields,
        filter: z
          .object({
            type: z.string().optional().describe(s.phoneType),
            areaCode: z.string().optional().describe(s.phoneAreaCode),
            keyword: z.string().optional().describe(s.phoneKeyword),
            limit: z.number().min(1).optional().describe(s.phoneLimit),
          })
          .optional()
          .describe(s.filterPhones),
      }),
    },

    scrape_urls: {
      name: 'scrape_urls' as const,
      description: `${prefix}${d.scrape_urls}`,
      schema: z.object({
        ...commonParamsFields,
        filter: z
          .object({
            domain: z.string().optional().describe(s.urlDomain),
            keyword: z.string().optional().describe(s.urlKeyword),
            pattern: z.string().optional().describe(s.urlPattern),
            limit: z.number().min(1).optional().describe(s.urlLimit),
          })
          .optional()
          .describe(s.filterUrls),
      }),
    },

    scrape_images: {
      name: 'scrape_images' as const,
      description: `${prefix}${d.scrape_images}`,
      schema: z.object({
        ...commonParamsFields,
        filter: z
          .object({
            minWidth: z.number().min(0).optional().describe(s.imgMinWidth),
            minHeight: z.number().min(0).optional().describe(s.imgMinHeight),
            format: z.string().optional().describe(s.imgFormat),
            keyword: z.string().optional().describe(s.imgKeyword),
            limit: z.number().min(1).optional().describe(s.imgLimit),
          })
          .optional()
          .describe(s.filterImages),
      }),
    },
  } as const;
}

/** Default English metadata; tests and callers that do not use `buildToolDefinitions` + env locale. */
export const toolDefinitions = buildToolDefinitions('en-US');

export type ToolName = keyof typeof toolDefinitions;
