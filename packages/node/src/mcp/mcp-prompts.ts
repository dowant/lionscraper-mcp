import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SupportedLang } from '../i18n/lang.js';
import enUS from '../locale/en-US.json' with { type: 'json' };
import zhCN from '../locale/zh-CN.json' with { type: 'json' };

type McpContextCopy = (typeof enUS)['mcpContext'];

function mcpContext(locale: SupportedLang): McpContextCopy {
  return locale === 'zh-CN' ? zhCN.mcpContext : enUS.mcpContext;
}

function fill(template: string, vars: Record<string, string>): string {
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{{${k}}}`).join(v);
  }
  return s;
}

function langHintFragment(locale: SupportedLang, lang?: 'en-US' | 'zh-CN'): string {
  if (lang === 'zh-CN') {
    return locale === 'zh-CN' ? '（可传 `lang: \"zh-CN\"`）' : ' (pass `lang: \"zh-CN\"` for Chinese errors)';
  }
  if (lang === 'en-US') {
    return locale === 'zh-CN' ? '（可传 `lang: \"en-US\"`）' : ' (pass `lang: \"en-US\"`)';
  }
  return '';
}

const langSchema = z.enum(['en-US', 'zh-CN']).optional();

/**
 * Workflow prompts (static text). No daemon HTTP.
 */
export function registerThinMcpPrompts(mcpServer: McpServer, locale: SupportedLang): void {
  const c = mcpContext(locale);

  mcpServer.registerPrompt(
    'ping_then_scrape',
    {
      title: c.promptPingThenScrapeTitle,
      description: c.promptPingThenScrapeDescription,
      argsSchema: { lang: langSchema.describe('Error message language for subsequent tool calls') },
    },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: fill(c.promptPingThenScrapeUser, { langHint: langHintFragment(locale, args.lang) }),
          },
        },
      ],
    }),
  );

  mcpServer.registerPrompt(
    'scrape_article',
    {
      title: c.promptScrapeArticleTitle,
      description: c.promptScrapeArticleDescription,
      argsSchema: {
        url: z.string().url().optional().describe('Target page URL'),
        lang: langSchema,
      },
    },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: fill(c.promptScrapeArticleUser, {
              urlLine: args.url
                ? locale === 'zh-CN'
                  ? `\n目标 URL：**${args.url}**\n`
                  : `\nTarget URL: **${args.url}**\n`
                : '',
              langHint: langHintFragment(locale, args.lang),
            }),
          },
        },
      ],
    }),
  );

  mcpServer.registerPrompt(
    'multi_url_scrape',
    {
      title: c.promptMultiUrlTitle,
      description: c.promptMultiUrlDescription,
      argsSchema: { lang: langSchema },
    },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: fill(c.promptMultiUrlUser, { langHint: langHintFragment(locale, args.lang) }),
          },
        },
      ],
    }),
  );

  mcpServer.registerPrompt(
    'troubleshoot_extension',
    {
      title: c.promptTroubleshootTitle,
      description: c.promptTroubleshootDescription,
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: c.promptTroubleshootUser },
        },
      ],
    }),
  );

  mcpServer.registerPrompt(
    'prefer_lionscraper_scraping',
    {
      title: c.promptPreferLionscraperTitle,
      description: c.promptPreferLionscraperDescription,
      argsSchema: { lang: langSchema.describe('Error message language for subsequent tool calls') },
    },
    (args) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: fill(c.promptPreferLionscraperUser, { langHint: langHintFragment(locale, args.lang) }),
          },
        },
      ],
    }),
  );
}
