import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ensureLocalDaemonRunning } from '../client/daemon-lifecycle.js';
import { createThinMcpServer } from './thin-mcp-server.js';
import { logT, portLang } from '../i18n/lang.js';
import { logger, setLogLevel } from '../utils/logger.js';

let shutdownPromise: Promise<void> | null = null;

export async function startThinMcpStdio(): Promise<void> {
  if (process.argv.includes('--debug')) {
    setLogLevel('debug');
  }

  try {
    await ensureLocalDaemonRunning();
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
    return;
  }

  const mcpServer = createThinMcpServer();
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);

  logger.info(logT(portLang(), 'mcpConnectedStdio'));

  const shutdown = async () => {
    if (shutdownPromise) return;
    shutdownPromise = (async () => {
      try {
        await mcpServer.close();
      } catch (err) {
        logger.warn(logT(portLang(), 'errorClosingMcp'), err);
      }
      process.exit(0);
    })();
  };

  process.stdin.on('end', () => {
    logger.info(logT(portLang(), 'stdinClosedShuttingDown'));
    void shutdown();
  });

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}
