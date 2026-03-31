export interface CommonParams {
  url: string | string[];
  /** BCP 47; forwarded to extension; affects MCP Server human-readable errors. Default en-US when omitted. */
  lang?: 'en-US' | 'zh-CN';
  delay?: number;
  waitForScroll?: {
    scrollSpeed: number;
    scrollInterval: number;
    maxScrollHeight?: number;
    scrollContainerSelector?: string;
  };
  timeoutMs?: number;
  /** MCP Server WebSocket wait for the whole tool call; omitted → derived from batch size (see docs). */
  bridgeTimeoutMs?: number;
  includeHtml?: boolean;
  includeText?: boolean;
  scrapeInterval?: number;
  concurrency?: number;
  scrollSpeed?: number;
}

export interface ResultMeta {
  url: string;
  elapsed: number;
  html?: string;
  text?: string;
  truncated?: boolean;
}

export interface ScrapeParams extends CommonParams {
  maxPages?: number;
}

export type ScrapeArticleParams = CommonParams;

export interface ScrapeEmailsParams extends CommonParams {
  filter?: {
    domain?: string;
    keyword?: string;
    limit?: number;
  };
}

export interface ScrapePhonesParams extends CommonParams {
  filter?: {
    type?: string;
    areaCode?: string;
    keyword?: string;
    limit?: number;
  };
}

export interface ScrapeUrlsParams extends CommonParams {
  filter?: {
    domain?: string;
    keyword?: string;
    pattern?: string;
    limit?: number;
  };
}

export interface ScrapeImagesParams extends CommonParams {
  filter?: {
    minWidth?: number;
    minHeight?: number;
    format?: string;
    keyword?: string;
    limit?: number;
  };
}

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  meta?: ResultMeta & Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
