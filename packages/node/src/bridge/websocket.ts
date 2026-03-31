import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  isBridgeProgressNotification,
  isBridgeResponse,
  isExtensionBridgeRequest,
  type BridgeProgressNotification,
  type BridgeRequest,
  type BridgeResponse,
  type RegisterParams,
} from '../types/bridge.js';
import { BridgeErrorCode, createError, createExtensionNotConnectedError } from '../types/errors.js';
import { bridgeT, logT, normalizeLang, portLang, t } from '../i18n/lang.js';
import {
  createBridgeResponse,
  createBridgeErrorResponse,
  createBridgeRequest,
  type BridgeProgressHandler,
} from './protocol.js';
import { SessionManager, type Session } from './session.js';
import { logger } from '../utils/logger.js';
import { PACKAGE_VERSION } from '../version.js';
import type { BridgeMethod } from '../types/bridge.js';

const REGISTER_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export class BridgeServer {
  private wss: WebSocketServer | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private listenPort = 0;
  /** When true, new MCP tool calls are rejected; existing bridge requests may still complete. */
  private draining = false;
  private shutdownHandler: (() => void) | null = null;

  readonly sessionManager: SessionManager;

  constructor() {
    this.sessionManager = new SessionManager();
  }

  /** @internal Notifies {@link LionScraperServer} after drain or force takeover; process exit is handled by the CLI entry. */
  setShutdownHandler(handler: () => void): void {
    this.shutdownHandler = handler;
  }

  isDraining(): boolean {
    return this.draining;
  }

  /** WebSocket listen port for this process; 0 before start or after stop. */
  get bridgePort(): number {
    return this.listenPort;
  }

  async start(port: number): Promise<void> {
    this.listenPort = port;
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host: '127.0.0.1', port });

      this.wss.on('listening', () => {
        const L = portLang();
        logger.info(logT(L, 'wsListening', { url: `ws://127.0.0.1:${port}` }));
        logger.info(logT(L, 'bridgeStderrHint'));
        this.startHeartbeat();
        resolve();
      });

      this.wss.on('error', (err) => {
        logger.error(logT(portLang(), 'wsServerError'), err);
        reject(err);
      });

      this.wss.on('connection', (ws) => {
        this.handleConnection(ws);
      });
    });
  }

  async stop(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    this.sessionManager.clear();
    this.listenPort = 0;

    if (this.wss) {
      return new Promise((resolve) => {
        this.wss!.close(() => {
          logger.info(logT(portLang(), 'wsServerStopped'));
          this.wss = null;
          resolve();
        });
      });
    }
  }

  sendToExtension(
    method: BridgeMethod,
    params: Record<string, unknown>,
    timeoutMs?: number,
    onBridgeProgress?: BridgeProgressHandler,
  ): Promise<unknown> {
    const lang = normalizeLang(params.lang);
    if (this.draining) {
      return Promise.reject(
        createError(BridgeErrorCode.SERVER_DRAINING, t(lang, 'server_draining.new_tasks')),
      );
    }

    const session = this.sessionManager.getActiveSession();
    if (!session) {
      return Promise.reject(
        createExtensionNotConnectedError(
          {
            bridgePort: this.listenPort,
            sessionCount: this.sessionManager.sessionCount,
          },
          lang,
        ),
      );
    }

    const request = createBridgeRequest(method, params);
    const promise = session.pendingRequests.add(request.id, method, timeoutMs, lang, onBridgeProgress);

    this.sendMessage(session.ws, request);
    return promise.finally(() => {
      this.maybeDrainComplete();
    });
  }

  private handleConnection(ws: WebSocket): void {
    logger.info(logT(portLang(), 'newWebSocketConnection'));

    let registered = false;
    let currentSession: Session | null = null;

    const registerTimeout = setTimeout(() => {
      if (!registered) {
        const L = portLang();
        logger.warn(
          logT(L, 'registerTimeoutWarn', { ms: REGISTER_TIMEOUT_MS, port: this.listenPort }),
        );
        ws.close(4001, bridgeT(L, 'registerTimeoutClose'));
      }
    }, REGISTER_TIMEOUT_MS);

    ws.on('message', (data) => {
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString()) as unknown;
      } catch {
        logger.warn(logT(portLang(), 'invalidJsonFromExtension'));
        return;
      }

      if (!registered) {
        this.handlePreRegisterMessage(ws, msg, registerTimeout, (session) => {
          registered = true;
          currentSession = session;
        });
        return;
      }

      const session = currentSession;
      if (!session) {
        logger.warn(logT(portLang(), 'registeredWithoutSessionState'));
        return;
      }

      this.handleMessage(ws, msg, session);
    });

    ws.on('close', (code, reason) => {
      clearTimeout(registerTimeout);
      if (currentSession) {
        this.sessionManager.removeByWs(ws);
        currentSession = null;
      }
      logger.info(
        logT(portLang(), 'wsConnectionClosed', { code, reason: reason.toString() }),
      );
    });

    ws.on('error', (err) => {
      logger.error(logT(portLang(), 'wsConnectionError'), err);
    });
  }

  private handlePreRegisterMessage(
    ws: WebSocket,
    msg: unknown,
    registerTimeout: ReturnType<typeof setTimeout>,
    onRegistered: (session: Session) => void,
  ): void {
    if (isBridgeProgressNotification(msg)) {
      logger.debug(logT(portLang(), 'bridgeProgressIgnoredPreRegister'));
      return;
    }

    if (!isExtensionBridgeRequest(msg)) {
      logger.warn(logT(portLang(), 'expectedRegisterGotResponse'));
      return;
    }

    const request = msg;

    if (request.method === 'probe') {
      this.handleProbe(ws, request, registerTimeout);
      return;
    }

    if (request.method === 'register') {
      clearTimeout(registerTimeout);
      const session = this.handleRegister(ws, request);
      if (session) {
        onRegistered(session);
      }
      return;
    }

    const L = portLang();
    logger.warn(logT(L, 'unexpectedMethodBeforeRegister', { method: request.method }));
    this.sendMessage(ws, createBridgeErrorResponse(
      request.id,
      -32600,
      bridgeT(L, 'mustRegisterFirst'),
    ));
  }

  private handleRegister(ws: WebSocket, request: BridgeRequest): Session | null {
    const L = portLang();
    const params = request.params as unknown as RegisterParams;

    if (!params) {
      this.sendMessage(ws, createBridgeErrorResponse(
        request.id,
        -32602,
        bridgeT(L, 'missingRegisterParams'),
      ));
      return null;
    }

    if (params.protocolVersion !== PROTOCOL_VERSION) {
      this.sendMessage(ws, createBridgeErrorResponse(
        request.id,
        -32000,
        bridgeT(L, 'protocolVersionMismatch', {
          expected: PROTOCOL_VERSION,
          got: params.protocolVersion,
        }),
        { lionscraperCode: BridgeErrorCode.BRIDGE_VERSION_MISMATCH },
      ));
      ws.close(4002, bridgeT(L, 'protocolMismatchClose'));
      return null;
    }

    const session = this.sessionManager.register(
      params.deviceId,
      params.browser,
      params.extensionVersion,
      params.capabilities,
      ws,
    );

    this.sendMessage(ws, createBridgeResponse(request.id, { ok: true }));
    return session;
  }

  private handleMessage(ws: WebSocket, msg: unknown, session: Session): void {
    if (isBridgeProgressNotification(msg)) {
      this.handleBridgeProgress(msg, session);
      return;
    }

    if (isBridgeResponse(msg)) {
      const resolved = session.pendingRequests.resolve(
        msg.id,
        msg.error ? { ok: false, error: msg.error } : msg.result,
      );
      if (!resolved) {
        logger.warn(logT(portLang(), 'unknownRequestResponse', { id: msg.id }));
      }
      return;
    }

    if (isExtensionBridgeRequest(msg)) {
      if (msg.method === 'ping') {
        this.sendMessage(ws, createBridgeResponse(msg.id, { pong: true }));
        return;
      }
      logger.warn(logT(portLang(), 'unexpectedMethodFromExtension', { method: msg.method }));
      return;
    }

    logger.debug(logT(portLang(), 'ignoredExtensionMessage'));
  }

  private handleBridgeProgress(msg: BridgeProgressNotification, session: Session): void {
    const params = msg.params;
    if (!params || typeof params.requestId !== 'string' || params.requestId.length === 0) {
      logger.debug(logT(portLang(), 'bridgeProgressInvalidPayload'));
      return;
    }

    const matched = session.pendingRequests.dispatchProgress(params.requestId, params);
    if (!matched) {
      logger.debug(logT(portLang(), 'bridgeProgressNoPending', { requestId: params.requestId }));
    }
  }

  private sendMessage(ws: WebSocket, msg: BridgeRequest | BridgeResponse): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;

      for (const ws of this.wss.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        ws.ping();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private buildProbeResult(): {
    identity: string;
    version: string;
    busyJobs: number;
    draining: boolean;
  } {
    return {
      identity: 'lionscraper',
      version: PACKAGE_VERSION,
      busyJobs: this.sessionManager.getTotalPendingBridgeRequests(),
      draining: this.draining,
    };
  }

  private handleProbe(
    ws: WebSocket,
    request: BridgeRequest,
    registerTimeout: ReturnType<typeof setTimeout>,
  ): void {
    clearTimeout(registerTimeout);

    const intent = (request.params as { intent?: string } | undefined)?.intent;

    if (intent === 'forceShutdown') {
      const result = { ...this.buildProbeResult(), ok: true as const };
      this.sendMessage(ws, createBridgeResponse(request.id, result));
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      setImmediate(() => {
        this.forceShutdownFromProbe();
      });
      return;
    }

    if (intent === 'takeover') {
      if (!this.draining) {
        this.draining = true;
        logger.info(logT(portLang(), 'mcpServerDrainingMode'));
      }
      const takeoverResult = this.buildProbeResult();
      this.sendMessage(ws, createBridgeResponse(request.id, takeoverResult));
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      setImmediate(() => {
        this.maybeDrainComplete();
      });
      return;
    }

    if (intent !== 'status' && intent !== undefined) {
      this.sendMessage(
        ws,
        createBridgeErrorResponse(
          request.id,
          -32602,
          bridgeT(portLang(), 'unknownProbeIntent', { intent: String(intent) }),
        ),
      );
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      return;
    }

    const result = this.buildProbeResult();
    this.sendMessage(ws, createBridgeResponse(request.id, result));
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }

  private maybeDrainComplete(): void {
    if (!this.draining) return;
    if (this.sessionManager.getTotalPendingBridgeRequests() > 0) return;
    logger.info(logT(portLang(), 'drainingCompleteShutdown'));
    const fn = this.shutdownHandler;
    if (fn) {
      setImmediate(() => {
        fn();
      });
    }
  }

  private forceShutdownFromProbe(): void {
    logger.warn(logT(portLang(), 'forceShutdownViaProbe'));
    this.draining = true;
    this.sessionManager.clear();
    this.shutdownHandler?.();
  }
}
