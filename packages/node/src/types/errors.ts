import { EXTENSION_STORE_URL_CHROME, EXTENSION_STORE_URL_EDGE } from '../constants/extension-store.js';
import { t, type SupportedLang } from '../i18n/lang.js';
import type { BrowserKind } from '../utils/browser-env.js';

export enum BridgeErrorCode {
  BRIDGE_VERSION_MISMATCH = 'BRIDGE_VERSION_MISMATCH',
  BRIDGE_DISCONNECTED = 'BRIDGE_DISCONNECTED',
  BRIDGE_TIMEOUT = 'BRIDGE_TIMEOUT',
  BRIDGE_NOT_CONNECTED = 'BRIDGE_NOT_CONNECTED',
  EXTENSION_NOT_CONNECTED = 'EXTENSION_NOT_CONNECTED',
  /** Neither Google Chrome nor Microsoft Edge could be resolved on this machine (install path detection). */
  BROWSER_NOT_INSTALLED = 'BROWSER_NOT_INSTALLED',
  /** Another MCP process requested port takeover; this server is draining and rejects new tools. */
  SERVER_DRAINING = 'SERVER_DRAINING',
}

export enum PageErrorCode {
  PAGE_LOAD_TIMEOUT = 'PAGE_LOAD_TIMEOUT',
  PAGE_LOAD_FAILED = 'PAGE_LOAD_FAILED',
  PAGE_NOT_ACCESSIBLE = 'PAGE_NOT_ACCESSIBLE',
  PAGE_HTTP_ERROR = 'PAGE_HTTP_ERROR',
}

export enum ExtractErrorCode {
  EXTRACT_NO_DATA = 'EXTRACT_NO_DATA',
  EXTRACT_FAILED = 'EXTRACT_FAILED',
  CONTENT_SCRIPT_INJECT_FAILED = 'CONTENT_SCRIPT_INJECT_FAILED',
  CONTENT_SCRIPT_TIMEOUT = 'CONTENT_SCRIPT_TIMEOUT',
}

export enum SystemErrorCode {
  TAB_CREATE_FAILED = 'TAB_CREATE_FAILED',
  EXTENSION_INTERNAL_ERROR = 'EXTENSION_INTERNAL_ERROR',
  QUEUE_FULL = 'QUEUE_FULL',
  SW_RESTARTED = 'SW_RESTARTED',
}

export enum ConfigErrorCode {
  INVALID_URL = 'INVALID_URL',
  INVALID_PARAMS = 'INVALID_PARAMS',
  TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND',
  TEMPLATE_AMBIGUOUS = 'TEMPLATE_AMBIGUOUS',
}

/** Client ↔ daemon HTTP layer (not extension bridge). */
export enum ClientErrorCode {
  DAEMON_UNREACHABLE = 'DAEMON_UNREACHABLE',
  /** Malformed NDJSON, wrong Content-Type for streaming, or invalid JSON body while HTTP was OK. */
  DAEMON_INVALID_RESPONSE = 'DAEMON_INVALID_RESPONSE',
}

export type ErrorCode =
  | BridgeErrorCode
  | PageErrorCode
  | ExtractErrorCode
  | SystemErrorCode
  | ConfigErrorCode
  | ClientErrorCode;

export interface LionScraperError {
  code: string;
  message: string;
  details?: unknown;
}

export function isLionScraperError(err: unknown): err is LionScraperError {
  if (typeof err !== 'object' || err === null) return false;
  const o = err as Record<string, unknown>;
  return typeof o.code === 'string' && typeof o.message === 'string';
}

export function createError(code: ErrorCode, message: string, details?: unknown): LionScraperError {
  return { code, message, ...(details !== undefined && { details }) };
}

/** Optional bridge snapshot when the MCP process knows its WebSocket listen port (always set for Tool errors from this server). */
export interface ExtensionNotConnectedContext {
  bridgePort: number;
  sessionCount: number;
}

/** Set when the server spawned a browser tab to the extension store (Chrome first, else Edge). */
export interface ExtensionStoreLaunchInfo {
  browser: BrowserKind;
  url: string;
}

export interface ExtensionNotConnectedOptions {
  browserProbe?: Record<string, unknown>;
  extensionStoreLaunch?: ExtensionStoreLaunchInfo | null;
}

export function createExtensionNotConnectedError(
  context: ExtensionNotConnectedContext | undefined,
  lang: SupportedLang,
  options?: ExtensionNotConnectedOptions,
): LionScraperError {
  const troubleshooting = [
    t(lang, 'extension_not_connected.troubleshoot.1'),
    t(lang, 'extension_not_connected.troubleshoot.2'),
    t(lang, 'extension_not_connected.troubleshoot.3'),
    t(lang, 'extension_not_connected.troubleshoot.4'),
    ...(context !== undefined
      ? [t(lang, 'extension_not_connected.troubleshoot.5', { port: context.bridgePort })]
      : []),
  ];

  const details: Record<string, unknown> = {
    install: {
      chrome: EXTENSION_STORE_URL_CHROME,
      edge: EXTENSION_STORE_URL_EDGE,
    },
    troubleshooting,
  };

  if (context !== undefined) {
    details.bridge = {
      wsUrl: `ws://127.0.0.1:${context.bridgePort}`,
      listeningPort: context.bridgePort,
      registeredSessionCount: context.sessionCount,
    };
    let hint = t(lang, 'extension_not_connected.hint');
    if (context.bridgePort > 0) {
      details.daemonReachable = true;
    }

    const launch = options?.extensionStoreLaunch;
    if (launch) {
      details.extensionStoreOpened = true;
      details.extensionStoreBrowser = launch.browser;
      details.extensionStoreUrl = launch.url;
      const browserLabel = launch.browser === 'chrome' ? 'Chrome' : 'Microsoft Edge';
      hint = `${hint} ${t(lang, 'extension_not_connected.store_opened_hint', { browser: browserLabel })}`;
    }
    details.hint = hint;
  } else if (options?.extensionStoreLaunch != null) {
    const launch = options.extensionStoreLaunch;
    details.extensionStoreOpened = true;
    details.extensionStoreBrowser = launch.browser;
    details.extensionStoreUrl = launch.url;
  }

  if (options?.browserProbe !== undefined) {
    details.browserProbe = options.browserProbe;
  }

  return createError(
    BridgeErrorCode.EXTENSION_NOT_CONNECTED,
    t(lang, 'extension_not_connected.message'),
    details,
  );
}

export function createBrowserNotInstalledError(lang: SupportedLang): LionScraperError {
  return createError(BridgeErrorCode.BROWSER_NOT_INSTALLED, t(lang, 'browser_not_installed.message'), {
    install: {
      chrome: 'https://www.google.com/chrome/',
      edge: 'https://www.microsoft.com/edge',
    },
    extension: {
      chrome: EXTENSION_STORE_URL_CHROME,
      edge: EXTENSION_STORE_URL_EDGE,
    },
    hint: t(lang, 'browser_not_installed.hint'),
  });
}
