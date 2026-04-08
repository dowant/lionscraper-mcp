import enUS from '../locale/en-US.json' with { type: 'json' };
import zhCN from '../locale/zh-CN.json' with { type: 'json' };

export type SupportedLang = 'en-US' | 'zh-CN';

/** BCP 47 tags supported by MCP Server; anything else falls back to en-US. */
export function normalizeLang(raw: unknown): SupportedLang {
  if (raw === 'zh-CN') return 'zh-CN';
  if (raw === 'en-US') return 'en-US';
  return 'en-US';
}

/**
 * Maps process **LANG** (MCP `env` or OS) to tool-list metadata language.
 * Accepts BCP 47 (`zh-CN`) and common POSIX forms (`zh_CN.UTF-8`, `en_US.UTF-8`).
 */
export function supportedLangFromLangEnv(raw: string | undefined): SupportedLang {
  if (raw == null) return 'en-US';
  const s = raw.trim();
  if (!s) return 'en-US';
  const lower = s.toLowerCase();
  if (lower === 'c' || lower === 'posix') return 'en-US';
  if (/^zh([_.-]|$)/i.test(s)) return 'zh-CN';
  if (/^en([_.-]|$)/i.test(s)) return 'en-US';
  return 'en-US';
}

/**
 * Locale for MCP **tool list** metadata (`description` + Zod `describe` strings).
 * Set in MCP Client config, e.g. `"env": { "LANG": "zh-CN" }` (or OS `LANG` like `zh_CN.UTF-8`).
 */
export function getToolMetadataLocale(): SupportedLang {
  return supportedLangFromLangEnv(process.env.LANG);
}

export type MessageId =
  | 'browser_not_installed.message'
  | 'browser_not_installed.hint'
  | 'extension_not_connected.message'
  | 'extension_not_connected.hint'
  | 'extension_not_connected.troubleshoot.1'
  | 'extension_not_connected.troubleshoot.2'
  | 'extension_not_connected.troubleshoot.3'
  | 'extension_not_connected.troubleshoot.4'
  | 'extension_not_connected.troubleshoot.5'
  | 'extension_not_connected.store_opened_hint'
  | 'server_draining.requests'
  | 'server_draining.new_tasks'
  | 'bridge_timeout'
  | 'disconnect.replaced'
  | 'disconnect.extension_gone'
  | 'disconnect.server_shutdown'
  | 'mcp_tool.response_truncated_after_limit'
  | 'http_fetch_fallback.note'
  | 'daemon_unreachable.message'
  | 'daemon_unreachable.hint';

export type PortMessageKey = keyof typeof enUS.port;

export type BridgeProtocolKey = keyof typeof enUS.bridgeProtocol;

export type LogMessageKey = keyof typeof enUS.logMessages;

type ServerMessages = typeof enUS.serverMessages;

function flattenServerMessages(sm: ServerMessages): Record<MessageId, string> {
  return {
    'browser_not_installed.message': sm.browserNotInstalled.message,
    'browser_not_installed.hint': sm.browserNotInstalled.hint,
    'extension_not_connected.message': sm.extensionNotConnected.message,
    'extension_not_connected.hint': sm.extensionNotConnected.hint,
    'extension_not_connected.troubleshoot.1': sm.extensionNotConnected.troubleshoot['1'],
    'extension_not_connected.troubleshoot.2': sm.extensionNotConnected.troubleshoot['2'],
    'extension_not_connected.troubleshoot.3': sm.extensionNotConnected.troubleshoot['3'],
    'extension_not_connected.troubleshoot.4': sm.extensionNotConnected.troubleshoot['4'],
    'extension_not_connected.troubleshoot.5': sm.extensionNotConnected.troubleshoot['5'],
    'extension_not_connected.store_opened_hint': sm.extensionNotConnected.storeOpenedHint,
    'server_draining.requests': sm.serverDraining.requests,
    'server_draining.new_tasks': sm.serverDraining.new_tasks,
    'bridge_timeout': sm.bridge.timeout,
    'disconnect.replaced': sm.disconnect.replaced,
    'disconnect.extension_gone': sm.disconnect.extension_gone,
    'disconnect.server_shutdown': sm.disconnect.server_shutdown,
    'mcp_tool.response_truncated_after_limit': sm.mcpTool.responseTruncatedAfterLimit,
    'http_fetch_fallback.note': sm.httpFetchFallback.note,
    'daemon_unreachable.message': sm.daemonUnreachable.message,
    'daemon_unreachable.hint': sm.daemonUnreachable.hint,
  };
}

const byLang: Record<SupportedLang, Record<MessageId, string>> = {
  'en-US': flattenServerMessages(enUS.serverMessages),
  'zh-CN': flattenServerMessages(zhCN.serverMessages),
};

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{{${k}}}`).join(String(v));
  }
  return s;
}

/** Resolve a server-side user-visible string for the given BCP 47 tag (see docs/mcp.md §5.0). */
export function t(lang: SupportedLang, id: MessageId, vars?: Record<string, string | number>): string {
  const table = byLang[lang] ?? byLang['en-US'];
  const template = table[id] ?? byLang['en-US'][id];
  return interpolate(template, vars);
}

const bundles: Record<SupportedLang, typeof enUS> = {
  'en-US': enUS,
  'zh-CN': zhCN,
};

/** Operator-facing port / startup messages (follows `LANG` like tool metadata). */
export function portT(
  lang: SupportedLang,
  key: PortMessageKey,
  vars?: Record<string, string | number>,
): string {
  const bundle = bundles[lang] ?? bundles['en-US'];
  return interpolate(bundle.port[key], vars);
}

export function portLang(): SupportedLang {
  return supportedLangFromLangEnv(process.env.LANG);
}

const bridgeByLang: Record<SupportedLang, Record<BridgeProtocolKey, string>> = {
  'en-US': enUS.bridgeProtocol as Record<BridgeProtocolKey, string>,
  'zh-CN': zhCN.bridgeProtocol as Record<BridgeProtocolKey, string>,
};

/** WebSocket bridge JSON-RPC / close-reason strings (follows `LANG`; no per-tool `lang`). */
export function bridgeT(
  lang: SupportedLang,
  key: BridgeProtocolKey,
  vars?: Record<string, string | number>,
): string {
  const row = bridgeByLang[lang] ?? bridgeByLang['en-US'];
  const template = row[key] ?? bridgeByLang['en-US'][key];
  return interpolate(template, vars);
}

const logByLang: Record<SupportedLang, Record<LogMessageKey, string>> = {
  'en-US': enUS.logMessages as Record<LogMessageKey, string>,
  'zh-CN': zhCN.logMessages as Record<LogMessageKey, string>,
};

/** stderr log lines (follows `LANG`). */
export function logT(
  lang: SupportedLang,
  key: LogMessageKey,
  vars?: Record<string, string | number>,
): string {
  const row = logByLang[lang] ?? logByLang['en-US'];
  const template = row[key] ?? logByLang['en-US'][key];
  return interpolate(template, vars);
}
