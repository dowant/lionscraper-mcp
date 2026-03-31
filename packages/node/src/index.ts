#!/usr/bin/env node

import { LionScraperServer } from './server.js';
import { logT, portLang } from './i18n/lang.js';
import { logger, setLogLevel } from './utils/logger.js';

const server = new LionScraperServer({
  onAfterBridgeDrain: () => process.exit(0),
});

/** Ensures stop/exit runs at most once (stdin end + signal may both fire). */
let shutdownPromise: Promise<void> | null = null;

function shutdown(): void {
  if (shutdownPromise) return;
  shutdownPromise = (async () => {
    try {
      await server.stop();
    } catch (err) {
      logger.error(logT(portLang(), 'errorDuringShutdown'), err);
    }
    process.exit(0);
  })();
}

async function main(): Promise<void> {
  const debugFlag = process.argv.includes('--debug');
  if (debugFlag) {
    setLogLevel('debug');
  }

  await server.start();

  // MCP client disconnect closes the stdio pipe → stdin ends; release WebSocket port + port file.
  process.stdin.on('end', () => {
    logger.info(logT(portLang(), 'stdinClosedShuttingDown'));
    shutdown();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  logger.error(logT(portLang(), 'uncaughtException'), err);
  shutdown();
});

process.on('unhandledRejection', (reason) => {
  logger.error(logT(portLang(), 'unhandledRejection'), reason);
  shutdown();
});

main().catch((err) => {
  logger.error(logT(portLang(), 'failedToStartServer'), err);
  process.exit(1);
});
