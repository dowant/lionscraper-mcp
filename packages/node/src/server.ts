import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BridgeServer } from './bridge/websocket.js';
import { ToolHandler, type McpToolHandlerExtra } from './mcp/handler.js';
import { buildToolDefinitions } from './mcp/tools.js';
import { getToolMetadataLocale, logT, portLang } from './i18n/lang.js';
import { acquirePort, getConfiguredPort } from './utils/port.js';
import { writePortFile, cleanupPortFile } from './utils/config.js';
import { logger } from './utils/logger.js';
import { PACKAGE_VERSION } from './version.js';
import type { BridgeMethod } from './types/bridge.js';

export interface LionScraperServerOptions {
  /**
   * Called after {@link LionScraperServer.stop} when the WebSocket bridge finishes draining (port takeover).
   * The CLI should pass `() => process.exit(0)` so process exit is owned by the entry module; tests may use a no-op.
   */
  onAfterBridgeDrain: () => void;
}

export class LionScraperServer {
  private mcpServer: McpServer;
  private bridge: BridgeServer;
  private toolHandler: ToolHandler;
  private port: number = 0;
  private stopped = false;
  private readonly onAfterBridgeDrain: () => void;

  constructor(options: LionScraperServerOptions) {
    this.onAfterBridgeDrain = options.onAfterBridgeDrain;

    this.mcpServer = new McpServer(
      {
        name: 'lionscraper',
        version: PACKAGE_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.bridge = new BridgeServer();
    this.toolHandler = new ToolHandler(this.bridge);

    this.bridge.setShutdownHandler(() => {
      void this.handleShutdownRequest();
    });
  }

  private async handleShutdownRequest(): Promise<void> {
    try {
      await this.stop();
    } finally {
      this.onAfterBridgeDrain();
    }
  }

  async start(): Promise<void> {
    this.port = await acquirePort(getConfiguredPort());
    const L = portLang();
    logger.info(logT(L, 'wsBridgeWillUsePort', { port: this.port }));

    await this.bridge.start(this.port);

    writePortFile(this.port);

    logger.info(`\n${logT(L, 'bannerTop')}`);
    logger.info(logT(L, 'bannerTitle'));
    logger.info(logT(L, 'bannerWs', { url: `ws://127.0.0.1:${this.port}` }));
    logger.info(logT(L, 'bannerPortFile'));
    logger.info(`${logT(L, 'bannerBottom')}\n`);

    this.registerTools();

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);

    logger.info(logT(L, 'mcpConnectedStdio'));
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    const L = portLang();
    logger.info(logT(L, 'shuttingDownMcp'));

    try {
      await this.mcpServer.close();
    } catch (err) {
      logger.warn(logT(L, 'errorClosingMcp'), err);
    }

    await this.bridge.stop();
    cleanupPortFile();

    logger.info(logT(L, 'serverStopped'));
  }

  private registerTools(): void {
    const locale = getToolMetadataLocale();
    const toolDefinitions = buildToolDefinitions(locale);
    logger.info(logT(portLang(), 'mcpToolMetadataLocale', { locale }));

    const { ping, scrape, scrape_article, scrape_emails, scrape_phones, scrape_urls, scrape_images } = toolDefinitions;

    this.mcpServer.registerTool(
      ping.name,
      { description: ping.description, inputSchema: ping.schema },
      async (args: Record<string, unknown>, extra: McpToolHandlerExtra) =>
        this.toolHandler.handlePing(args, extra),
    );

    const scrapingTools = [
      scrape,
      scrape_article,
      scrape_emails,
      scrape_phones,
      scrape_urls,
      scrape_images,
    ] as const;

    for (const tool of scrapingTools) {
      this.mcpServer.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.schema },
        async (args: Record<string, unknown>, extra: McpToolHandlerExtra) => {
          return this.toolHandler.handleTool(tool.name as BridgeMethod, args, extra);
        },
      );
    }

    logger.info(logT(portLang(), 'registeredMcpTools', { count: scrapingTools.length + 1 }));
  }
}
