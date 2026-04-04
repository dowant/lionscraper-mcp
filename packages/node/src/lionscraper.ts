#!/usr/bin/env node

import { logT, portLang } from './i18n/lang.js';
import { logger } from './utils/logger.js';
import { runLionscraperCli } from './cli/router.js';

process.on('uncaughtException', (err) => {
  logger.error(logT(portLang(), 'uncaughtException'), err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error(logT(portLang(), 'unhandledRejection'), reason);
  process.exit(1);
});

runLionscraperCli().catch((err) => {
  logger.error(logT(portLang(), 'failedToStartServer'), err);
  process.exit(1);
});
