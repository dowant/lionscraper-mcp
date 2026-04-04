import type { Server as HttpServer } from 'node:http';
import { BridgeServer } from '../bridge/websocket.js';
import { ToolHandler } from '../mcp/handler.js';
import { acquirePort, getConfiguredPort } from '../utils/port.js';
import { writePortFile, cleanupPortFile } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { logT, portLang } from '../i18n/lang.js';

export interface BridgeServiceOptions {
  /**
   * After bridge drain (probe takeover), invoked so the process can exit.
   * Daemon passes `() => process.exit(0)`; tests may use no-op.
   */
  onAfterBridgeDrain: () => void;
}

/**
 * WebSocket bridge + {@link ToolHandler} only (no MCP stdio).
 * Used by the daemon and testable in isolation.
 */
export class BridgeService {
  readonly bridge: BridgeServer;
  readonly toolHandler: ToolHandler;
  private port = 0;
  private stopped = false;
  private readonly onAfterBridgeDrain: () => void;

  constructor(options: BridgeServiceOptions) {
    this.onAfterBridgeDrain = options.onAfterBridgeDrain;
    this.bridge = new BridgeServer();
    this.toolHandler = new ToolHandler(this.bridge);
    this.bridge.setShutdownHandler(() => {
      void this.handleShutdownRequest();
    });
  }

  get listeningPort(): number {
    return this.port;
  }

  private async handleShutdownRequest(): Promise<void> {
    try {
      await this.stop();
    } finally {
      this.onAfterBridgeDrain();
    }
  }

  /**
   * Binds HTTP + WebSocket on one `PORT`: attach bridge to `httpServer`, then listen.
   * Caller must create `http.createServer()` and attach HTTP routes before calling this.
   */
  async startSharedHttpServer(httpServer: HttpServer): Promise<void> {
    this.port = await acquirePort(getConfiguredPort());
    const L = portLang();
    logger.info(logT(L, 'wsBridgeWillUsePort', { port: this.port }));

    this.bridge.attachToHttpServer(httpServer, this.port);

    await new Promise<void>((resolve, reject) => {
      const onErr = (err: Error) => {
        httpServer.off('error', onErr);
        reject(err);
      };
      httpServer.once('error', onErr);
      httpServer.listen(this.port, '127.0.0.1', () => {
        httpServer.off('error', onErr);
        this.bridge.onSharedServerListening(this.port);
        resolve();
      });
    });

    writePortFile(this.port);

    logger.info(`\n${logT(L, 'bannerTop')}`);
    logger.info(logT(L, 'bannerTitle'));
    logger.info(logT(L, 'bannerWs', { url: `ws://127.0.0.1:${this.port}` }));
    logger.info(logT(L, 'bannerHttpSamePort', { url: `http://127.0.0.1:${this.port}` }));
    logger.info(logT(L, 'bannerPortFile'));
    logger.info(`${logT(L, 'bannerBottom')}\n`);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    const L = portLang();
    logger.info(logT(L, 'shuttingDownMcp'));

    await this.bridge.stop();
    this.port = 0;
    cleanupPortFile();

    logger.info(logT(L, 'serverStopped'));
  }
}
