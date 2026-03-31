import crypto from 'node:crypto';
import type { BridgeMethod, BridgeProgressParams, BridgeRequest, BridgeResponse } from '../types/bridge.js';
import { BridgeErrorCode, createError, type LionScraperError } from '../types/errors.js';
import { t, type MessageId, type SupportedLang } from '../i18n/lang.js';
import { logger } from '../utils/logger.js';

/** PendingRequest.rejectAll reason → `t()` message id for BRIDGE_DISCONNECTED. */
export type DisconnectRejectId = Extract<MessageId, `disconnect.${string}`>;

export function createBridgeRequest(
  method: BridgeMethod,
  params?: Record<string, unknown>,
): BridgeRequest {
  return {
    jsonrpc: '2.0',
    id: crypto.randomUUID(),
    method,
    ...(params && { params }),
  };
}

export function createBridgeResponse(id: string, result: unknown): BridgeResponse {
  return { jsonrpc: '2.0', id, result };
}

export function createBridgeErrorResponse(
  id: string,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): BridgeResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data && { data }) },
  };
}

export type BridgeProgressHandler = (params: BridgeProgressParams) => void;

export interface PendingRequest {
  id: string;
  method: BridgeMethod;
  resolve: (value: unknown) => void;
  reject: (reason: LionScraperError) => void;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
  lang: SupportedLang;
  onProgress?: BridgeProgressHandler;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class PendingRequestManager {
  private pending = new Map<string, PendingRequest>();

  add(
    id: string,
    method: BridgeMethod,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    lang: SupportedLang = 'en-US',
    onProgress?: BridgeProgressHandler,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        logger.warn(`Bridge request timed out: ${id} (${method})`);
        reject(
          createError(
            BridgeErrorCode.BRIDGE_TIMEOUT,
            t(lang, 'bridge_timeout', { ms: timeoutMs }),
          ),
        );
      }, timeoutMs);

      this.pending.set(id, {
        id,
        method,
        resolve,
        reject,
        timer,
        createdAt: Date.now(),
        lang,
        onProgress,
      });
    });
  }

  /**
   * Forward Extension → Server bridgeProgress notification to the matching pending tool call.
   * @returns true if a pending request consumed this payload
   */
  dispatchProgress(requestId: string, params: BridgeProgressParams): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    try {
      pending.onProgress?.(params);
    } catch {
      /* ignore handler errors */
    }
    return true;
  }

  resolve(id: string, result: unknown): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.resolve(result);
    return true;
  }

  reject(id: string, error: LionScraperError): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(id);
    pending.reject(error);
    return true;
  }

  rejectAll(error: LionScraperError): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  /** Reject all pending bridge calls with BRIDGE_DISCONNECTED, localized per request `lang`. */
  rejectAllDisconnected(reason: DisconnectRejectId): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(
        createError(BridgeErrorCode.BRIDGE_DISCONNECTED, t(pending.lang, reason)),
      );
      this.pending.delete(id);
    }
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  get size(): number {
    return this.pending.size;
  }

  /**
   * Clears pending timers and map entries without resolving or rejecting the returned Promises from {@link add}.
   * For production shutdown paths use {@link rejectAll} or {@link rejectAllDisconnected} instead.
   */
  clear(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
    }
    this.pending.clear();
  }
}
