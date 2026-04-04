#!/usr/bin/env node

import http from 'node:http';
import { BridgeService } from '../core/bridge-service.js';
import { attachDaemonApi } from './http-api.js';
import { getConfiguredPort } from '../utils/port.js';
import { logT, portLang } from '../i18n/lang.js';
import { logger, setLogLevel } from '../utils/logger.js';
import { PACKAGE_VERSION } from '../version.js';

export async function runDaemon(): Promise<void> {
  const L = portLang();
  const service = new BridgeService({
    onAfterBridgeDrain: () => process.exit(0),
  });

  const httpServer = http.createServer();
  attachDaemonApi(service, httpServer);

  try {
    await service.startSharedHttpServer(httpServer);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const port = getConfiguredPort();
    if (e.code === 'EADDRINUSE') {
      logger.error(logT(L, 'daemonPortInUse', { port }));
    } else {
      logger.error(logT(L, 'failedToStartServer'), err);
    }
    await service.stop();
    process.exit(1);
    return;
  }

  const port = service.listeningPort;
  logger.info(
    logT(L, 'daemonListening', {
      url: `http://127.0.0.1:${port}`,
      version: PACKAGE_VERSION,
    }),
  );

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(logT(L, 'shuttingDownMcp'));
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await service.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

/** Called from CLI router with argv already trimmed after `daemon`. */
export async function runDaemonFromCli(daemonArgv: string[]): Promise<void> {
  if (daemonArgv.includes('--debug')) {
    setLogLevel('debug');
  }
  await runDaemon();
}
