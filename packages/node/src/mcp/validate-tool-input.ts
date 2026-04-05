import type { SupportedLang } from '../i18n/lang.js';
import { buildToolDefinitions } from './tools.js';

/** Returns `null` if valid; otherwise a human-readable message for HTTP 400. */
export function validateToolInput(name: string, args: Record<string, unknown>, locale: SupportedLang): string | null {
  const defs = buildToolDefinitions(locale);
  const schema =
    name === 'ping'
      ? defs.ping.schema
      : name === 'scrape'
        ? defs.scrape.schema
        : name === 'scrape_article'
          ? defs.scrape_article.schema
          : name === 'scrape_emails'
            ? defs.scrape_emails.schema
            : name === 'scrape_phones'
              ? defs.scrape_phones.schema
              : name === 'scrape_urls'
                ? defs.scrape_urls.schema
                : name === 'scrape_images'
                  ? defs.scrape_images.schema
                  : null;
  if (!schema) return 'Unknown tool name';
  const parsed = schema.safeParse(args);
  if (parsed.success) return null;
  return parsed.error.issues.map((i) => `${i.path.length ? i.path.join('.') : 'root'}: ${i.message}`).join('; ');
}
