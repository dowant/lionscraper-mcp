import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { BridgeProgressHandler } from '../bridge/protocol.js';
import type { BridgeServer } from '../bridge/websocket.js';
import type { BridgeMethod, BridgeProgressParams } from '../types/bridge.js';
import type { LionScraperError } from '../types/errors.js';
import {
  BridgeErrorCode,
  createBrowserNotInstalledError,
  createError,
  createExtensionNotConnectedError,
  isLionScraperError,
  SystemErrorCode,
  type ExtensionNotConnectedOptions,
} from '../types/errors.js';
import { logT, normalizeLang, portLang, t, type SupportedLang } from '../i18n/lang.js';
import { paramsForExtension, resolveBridgeTimeoutMs } from '../bridge/timeout.js';
import { logger } from '../utils/logger.js';
import { defaultBrowserEnv, type BrowserEnv, type BrowserKind } from '../utils/browser-env.js';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB (see JSON.stringify length check in formatSuccessResponse)

/** Extra attempts after the first send; total tries = 1 + this value. */
const BRIDGE_DISCONNECT_MAX_EXTRA_RETRIES = 2;
const BRIDGE_DISCONNECT_RETRY_DELAYS_MS = [400, 800, 1600] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const PING_POLL_INTERVAL_MS = 400;
const PING_WAIT_MS_MIN = 3_000;
const PING_WAIT_MS_MAX = 60_000;
const PING_WAIT_MS_DEFAULT = 20_000;

function resolveAutoLaunchBrowser(args?: Record<string, unknown>): boolean {
  if (args && Object.prototype.hasOwnProperty.call(args, 'autoLaunchBrowser')) {
    return args.autoLaunchBrowser === true;
  }
  const v = process.env.LIONSCRAPER_PING_AUTO_LAUNCH;
  if (v === '0' || v === 'false') return false;
  return true;
}

function resolvePostLaunchWaitMs(args?: Record<string, unknown>): number {
  const raw = args?.postLaunchWaitMs;
  const n =
    typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : PING_WAIT_MS_DEFAULT;
  return Math.min(PING_WAIT_MS_MAX, Math.max(PING_WAIT_MS_MIN, n));
}

async function waitForExtensionSession(
  getSessionInfo: () => { deviceId: string; browser: string; extensionVersion: string } | null,
  maxMs: number,
  intervalMs: number,
): Promise<number> {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (getSessionInfo() !== null) return Date.now() - start;
    const remaining = maxMs - (Date.now() - start);
    if (remaining <= 0) break;
    await sleep(Math.min(intervalMs, remaining));
  }
  return Date.now() - start;
}

/** Passed to tool callbacks by `@modelcontextprotocol/sdk` (stdio / MCP request scope). */
export type McpToolHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function getProgressToken(extra: McpToolHandlerExtra | undefined): string | number | undefined {
  if (!extra?._meta || typeof extra._meta !== 'object') return undefined;
  return (extra._meta as { progressToken?: string | number }).progressToken;
}

async function forwardBridgeProgressToMcp(
  extra: McpToolHandlerExtra,
  payload: BridgeProgressParams,
  seq: { n: number },
): Promise<void> {
  const token = getProgressToken(extra);
  if (token === undefined) return;

  const progress =
    typeof payload.progress === 'number' && Number.isFinite(payload.progress) ? payload.progress : ++seq.n;
  const total =
    typeof payload.total === 'number' && Number.isFinite(payload.total) ? payload.total : undefined;

  let message = payload.message;
  if (payload.phase) {
    message = message ? `[${payload.phase}] ${message}` : `[${payload.phase}]`;
  }

  const meta: Record<string, unknown> = {};
  if (payload.data !== undefined && typeof payload.data === 'object' && payload.data !== null) {
    meta.lionscraper = payload.data;
  }

  const notification = {
    method: 'notifications/progress' as const,
    params: {
      progressToken: token,
      progress,
      ...(total !== undefined ? { total } : {}),
      ...(message !== undefined ? { message } : {}),
      ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
    },
  };

  await extra.sendNotification(notification as ServerNotification);
}

export interface ToolHandlerDeps {
  browserEnv?: BrowserEnv;
}

export class ToolHandler {
  constructor(
    private bridge: BridgeServer,
    private readonly deps: ToolHandlerDeps = {},
  ) {}

  private get browserEnv(): BrowserEnv {
    return this.deps.browserEnv ?? defaultBrowserEnv;
  }

  private extensionNotConnectedError(lang: SupportedLang, options?: ExtensionNotConnectedOptions) {
    return createExtensionNotConnectedError(
      {
        bridgePort: this.bridge.bridgePort,
        sessionCount: this.bridge.sessionManager.sessionCount,
      },
      lang,
      options,
    );
  }

  async handlePing(
    args?: Record<string, unknown>,
    _extra?: McpToolHandlerExtra,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const lang = normalizeLang(args?.lang);
    if (this.bridge.isDraining()) {
      const error = createError(BridgeErrorCode.SERVER_DRAINING, t(lang, 'server_draining.requests'));
      return this.formatErrorResponse(error);
    }

    const getSession = () => this.bridge.sessionManager.getSessionInfo();
    let sessionInfo = getSession();

    if (sessionInfo) {
      const result = {
        ok: true,
        bridgeOk: true,
        browser: sessionInfo.browser,
        extensionVersion: sessionInfo.extensionVersion,
      };
      return this.formatSuccessResponse(result, lang);
    }

    const chromePath = await this.browserEnv.detectChromeInstall();
    const edgePath = await this.browserEnv.detectEdgeInstall();

    if (!chromePath && !edgePath) {
      return this.formatErrorResponse(createBrowserNotInstalledError(lang));
    }

    const candidates: Array<{ kind: BrowserKind; path: string }> = [];
    if (chromePath) candidates.push({ kind: 'chrome', path: chromePath });
    if (edgePath) candidates.push({ kind: 'edge', path: edgePath });

    const autoLaunch = resolveAutoLaunchBrowser(args);
    const waitMs = resolvePostLaunchWaitMs(args);

    type LastProbe = {
      selectedBrowser: BrowserKind;
      browserRunning: boolean;
      autoLaunchBrowser?: false;
      browserLaunched?: boolean;
      waitedMs?: number;
      executablePath?: string;
      nextStep?: string;
    };
    let lastProbe: LastProbe | null = null;

    for (const { kind, path } of candidates) {
      sessionInfo = getSession();
      if (sessionInfo) {
        const result = {
          ok: true,
          bridgeOk: true,
          browser: sessionInfo.browser,
          extensionVersion: sessionInfo.extensionVersion,
        };
        return this.formatSuccessResponse(result, lang);
      }

      const running = await this.browserEnv.isBrowserRunning(kind);

      if (!running) {
        if (!autoLaunch) {
          lastProbe = {
            selectedBrowser: kind,
            browserRunning: false,
            autoLaunchBrowser: false,
            executablePath: path,
          };
          continue;
        }

        const launchPid = this.browserEnv.launchBrowser(path, kind);
        const waitedMs = await waitForExtensionSession(getSession, waitMs, PING_POLL_INTERVAL_MS);
        sessionInfo = getSession();
        if (sessionInfo) {
          return this.formatSuccessResponse(
            {
              ok: true,
              bridgeOk: true,
              browser: sessionInfo.browser,
              extensionVersion: sessionInfo.extensionVersion,
              diagnostics: {
                browserAssist: true,
                selectedBrowser: kind,
                launched: true,
                waitedMs,
              },
            },
            lang,
          );
        }

        if (launchPid != null) {
          await this.browserEnv.quitLaunchedBrowser(launchPid);
        }

        lastProbe = {
          selectedBrowser: kind,
          browserRunning: false,
          browserLaunched: true,
          waitedMs,
          executablePath: path,
          nextStep: 'install_or_enable_lionscraper_extension_or_check_bridge_port',
        };
        continue;
      }

      lastProbe = {
        selectedBrowser: kind,
        browserRunning: true,
        nextStep: 'install_or_enable_lionscraper_extension_or_check_bridge_port',
      };
    }

    return this.formatErrorResponse(
      this.extensionNotConnectedError(lang, {
        browserProbe: lastProbe ?? {
          selectedBrowser: candidates[candidates.length - 1]!.kind,
          browserRunning: false,
        },
      }),
    );
  }

  async handleTool(
    method: BridgeMethod,
    params: Record<string, unknown>,
    extra?: McpToolHandlerExtra,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const lang = normalizeLang(params.lang);
    if (this.bridge.isDraining()) {
      const error = createError(BridgeErrorCode.SERVER_DRAINING, t(lang, 'server_draining.new_tasks'));
      return this.formatErrorResponse(error);
    }

    if (!this.bridge.sessionManager.hasConnectedExtension()) {
      const error = this.extensionNotConnectedError(lang);
      return this.formatErrorResponse(error);
    }

    const bridgeTimeoutMs = resolveBridgeTimeoutMs(params);
    const extensionParams = paramsForExtension(params);

    for (let attempt = 0; attempt <= BRIDGE_DISCONNECT_MAX_EXTRA_RETRIES; attempt++) {
      try {
        const progressSeq = { n: 0 };
        const onBridgeProgress: BridgeProgressHandler | undefined = extra
          ? (p: BridgeProgressParams) => {
              void forwardBridgeProgressToMcp(extra, p, progressSeq).catch(() => {
                /* ignore MCP progress delivery errors */
              });
            }
          : undefined;

        const result = await this.bridge.sendToExtension(
          method,
          extensionParams,
          bridgeTimeoutMs,
          onBridgeProgress,
        );
        return this.formatSuccessResponse(result, lang);
      } catch (err) {
        const error: LionScraperError = isLionScraperError(err)
          ? err
          : createError(
              SystemErrorCode.EXTENSION_INTERNAL_ERROR,
              err instanceof Error ? err.message : String(err),
            );

        const willRetry =
          error.code === BridgeErrorCode.BRIDGE_DISCONNECTED && attempt < BRIDGE_DISCONNECT_MAX_EXTRA_RETRIES;

        if (willRetry) {
          const delayMs =
            BRIDGE_DISCONNECT_RETRY_DELAYS_MS[attempt] ??
            BRIDGE_DISCONNECT_RETRY_DELAYS_MS[BRIDGE_DISCONNECT_RETRY_DELAYS_MS.length - 1];
          const L = portLang();
          logger.info(
            logT(L, 'toolBridgeDisconnectedRetry', {
              method,
              attempt: attempt + 1,
              maxAttempts: BRIDGE_DISCONNECT_MAX_EXTRA_RETRIES + 1,
              delayMs,
            }),
          );
          await sleep(delayMs);
          continue;
        }

        logger.error(logT(portLang(), 'toolFailed', { method }), error);
        return this.formatErrorResponse(error);
      }
    }

    throw new Error(`Tool ${method}: unreachable after bridge disconnect retries`);
  }

  private formatSuccessResponse(
    result: unknown,
    lang: SupportedLang,
  ): { content: Array<{ type: 'text'; text: string }> } {
    let json = JSON.stringify(result);

    if (json.length > MAX_RESPONSE_BYTES) {
      json = this.truncateResult(result, lang);
    }

    return {
      content: [{ type: 'text', text: json }],
    };
  }

  private formatErrorResponse(error: LionScraperError): { content: Array<{ type: 'text'; text: string }> } {
    const errorResult = {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined && { details: error.details }),
      },
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(errorResult) }],
    };
  }

  private truncateResult(result: unknown, lang: SupportedLang): string {
    if (typeof result !== 'object' || result === null) {
      const s = JSON.stringify(result);
      return s.length <= MAX_RESPONSE_BYTES ? s : s.slice(0, MAX_RESPONSE_BYTES);
    }

    const obj = result as Record<string, unknown>;
    const copy: Record<string, unknown> = { ...obj, truncated: true };

    if (copy.meta && typeof copy.meta === 'object') {
      (copy.meta as Record<string, unknown>).truncated = true;
    }

    const size = (): number => JSON.stringify(copy).length;

    if (Array.isArray(copy.data)) {
      const arr = copy.data as unknown[];
      while (arr.length > 1 && size() > MAX_RESPONSE_BYTES) {
        arr.pop();
      }
    } else if (copy.data && typeof copy.data === 'object') {
      const data = copy.data as Record<string, unknown>;
      if (Array.isArray(data.dataList)) {
        while (data.dataList.length > 1 && size() > MAX_RESPONSE_BYTES) {
          data.dataList.pop();
        }
      }
    }

    if (size() > MAX_RESPONSE_BYTES) {
      if (Array.isArray(copy.data)) {
        (copy.data as unknown[]).length = 0;
      } else if (copy.data && typeof copy.data === 'object') {
        const data = copy.data as Record<string, unknown>;
        if (Array.isArray(data.dataList)) {
          data.dataList = [];
        }
      }
    }

    let json = JSON.stringify(copy);
    if (json.length > MAX_RESPONSE_BYTES) {
      json = JSON.stringify({
        ok: typeof obj.ok === 'boolean' ? obj.ok : false,
        truncated: true,
        message: t(lang, 'mcp_tool.response_truncated_after_limit'),
      });
    }
    return json;
  }
}
