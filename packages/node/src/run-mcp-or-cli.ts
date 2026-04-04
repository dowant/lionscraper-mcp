import { isThinMcpStdioArgv } from './cli/mcp-bin-argv.js';
import { logT, portLang } from './i18n/lang.js';
import { logger } from './utils/logger.js';

/**
 * `mcp.js` (package `main`) defaults to thin MCP over stdio when argv has no tokens after the script
 * (how MCP hosts invoke the binary). If any CLI args are present — e.g. `lionscraper scrape -u …`
 * when the global/npx shim mistakenly points at `mcp.js` — run the same CLI as `lionscraper.js`.
 */
export async function runMcpOrCli(): Promise<void> {
  const argv = process.argv.slice(2);
  if (!isThinMcpStdioArgv(argv)) {
    process.on('uncaughtException', (err) => {
      logger.error(logT(portLang(), 'uncaughtException'), err);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
      logger.error(logT(portLang(), 'unhandledRejection'), reason);
      process.exit(1);
    });
    const { runLionscraperCli } = await import('./cli/router.js');
    await runLionscraperCli().catch((err) => {
      logger.error(logT(portLang(), 'failedToStartServer'), err);
      process.exit(1);
    });
    return;
  }
  await import('./entry-thin-stdio.js');
}
