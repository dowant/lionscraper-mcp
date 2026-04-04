import { writeFileSync } from 'node:fs';
import { runDaemonFromCli } from '../daemon/daemon-main.js';
import { portLang, portT } from '../i18n/lang.js';
import { callDaemonTool, daemonHealth } from '../client/daemon-client.js';
import { ensureLocalDaemonRunning } from '../client/daemon-lifecycle.js';
import { getDaemonAuthToken, getDaemonHttpBaseUrl } from '../utils/daemon-config.js';
import { getConfiguredPort, stopLionscraperOnPort } from '../utils/port.js';
import { buildInvocationFromArgv, parseApiUrl, parseOutputFlags } from './build-tool-args.js';
import { PACKAGE_VERSION } from '../version.js';
import { setLogLevel } from '../utils/logger.js';
import { BridgeErrorCode, ClientErrorCode } from '../types/errors.js';

function printHelp(): void {
  process.stderr.write(`LionScraper CLI (daemon + HTTP control plane)

Usage:
  lionscraper daemon [--debug]           Start bridge + HTTP API (keep running)
  lionscraper stop                     Stop daemon on PORT (WebSocket forceShutdown probe)
  lionscraper scrape [options]         Run a scrape* tool via daemon HTTP
  lionscraper ping [options]           Run ping via daemon HTTP
  lionscraper --help | -h              Show this help
  lionscraper --version                Print version

Scrape options (subset):
  -u, --url <url>              Target URL (repeat for multiple)
  --method scrape|article|emails|phones|urls|images   (default: scrape)
  --lang en-US|zh-CN
  --delay, --timeout-ms, --bridge-timeout-ms, --max-pages, ...
  --format json|pretty         (default: json)
  --raw                        Print tool text block as-is
  -o, --output <file>          Write stdout result to file
  --api-url <base>             Daemon HTTP base (default: http://127.0.0.1:$PORT, PORT default 13808)

Before scrape/ping: start the daemon in another terminal (or rely on auto-start when not using --api-url):
  lionscraper daemon

MCP (Trae/Cursor): use command "lionscraper-mcp" or node dist/mcp.js (stdio → daemon HTTP on same PORT).
HTTP and WebSocket share PORT (default 13808); set PORT in MCP env to match the extension bridgePort.
`);
}

async function runToolCli(subcmdArgs: string[], mode: 'scrape' | 'ping'): Promise<void> {
  const apiOverride = parseApiUrl(subcmdArgs);
  const baseUrl = apiOverride ?? getDaemonHttpBaseUrl();
  const auth = getDaemonAuthToken();
  let didSpawnDaemon = false;

  try {
    if (!apiOverride) {
      const ensured = await ensureLocalDaemonRunning();
      didSpawnDaemon = ensured.didSpawn;
    } else {
      await daemonHealth(baseUrl, auth);
    }
  } catch {
    process.stderr.write(
      `Error: cannot reach LionScraper daemon at ${baseUrl}.\nStart it with: lionscraper daemon\n`,
    );
    process.exit(1);
    return;
  }

  const { name, arguments: toolArgs } = buildInvocationFromArgv(subcmdArgs, mode);
  const outOpts = parseOutputFlags(subcmdArgs);

  if (mode === 'scrape' && toolArgs.url === undefined) {
    process.stderr.write('Error: missing --url (-u)\n');
    process.exit(1);
    return;
  }

  const LCli = portLang();
  if (mode === 'scrape' && didSpawnDaemon) {
    process.stderr.write(`${portT(LCli, 'cliAutoPingAfterSpawn')}\n`);
    const pingArgs: Record<string, unknown> = {};
    if (toolArgs.lang === 'zh-CN' || toolArgs.lang === 'en-US') {
      pingArgs.lang = toolArgs.lang;
    }
    await callDaemonTool(baseUrl, 'ping', pingArgs, { authToken: auth });
  } else if (mode === 'ping' && didSpawnDaemon) {
    process.stderr.write(`${portT(LCli, 'cliPingAfterDaemonSpawn')}\n`);
  }

  const result = await callDaemonTool(baseUrl, name, toolArgs, { authToken: auth });

  const text = result.content[0]?.type === 'text' ? result.content[0].text : JSON.stringify(result.content);

  try {
    const errBody = JSON.parse(text) as {
      error?: { code?: string };
      details?: { daemonReachable?: boolean };
      ok?: boolean;
    };
    if (errBody?.error?.code === ClientErrorCode.DAEMON_UNREACHABLE) {
      process.stderr.write(`${portT(LCli, 'cliDaemonUnreachableStderr')}\n`);
    }
    if (
      (mode === 'scrape' || mode === 'ping') &&
      errBody?.ok === false &&
      errBody?.error?.code === BridgeErrorCode.EXTENSION_NOT_CONNECTED &&
      errBody?.details?.daemonReachable === true
    ) {
      process.stderr.write(`${portT(LCli, 'cliExtensionNotConnectedStderr')}\n`);
    }
  } catch {
    /* not JSON */
  }
  let payload: string;
  if (outOpts.raw) {
    payload = text;
  } else {
    try {
      const parsed = JSON.parse(text) as unknown;
      payload =
        outOpts.format === 'pretty' ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
    } catch {
      payload = text;
    }
  }

  if (outOpts.outputPath) {
    writeFileSync(outOpts.outputPath, payload, 'utf8');
  } else {
    process.stdout.write(`${payload}\n`);
  }

  if (result.isError) {
    process.exit(2);
  }

  try {
    const j = JSON.parse(text) as { ok?: boolean };
    if (j && j.ok === false) {
      process.exit(2);
    }
  } catch {
    /* ignore */
  }
}

async function runStopCli(): Promise<void> {
  const L = portLang();
  const port = getConfiguredPort();
  try {
    const result = await stopLionscraperOnPort(port);
    if (result === 'idle') {
      process.stderr.write(`${portT(L, 'cliDaemonNotRunning', { port })}\n`);
      return;
    }
    process.stderr.write(`${portT(L, 'cliDaemonStopped', { port })}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
}

export async function runLionscraperCli(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('--debug')) {
    setLogLevel('debug');
  }

  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    printHelp();
    process.exit(0);
    return;
  }

  if (argv[0] === '--version' || argv[0] === '-v') {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }

  if (argv[0] === 'daemon') {
    await runDaemonFromCli(argv.slice(1));
    return;
  }

  if (argv[0] === 'stop') {
    await runStopCli();
    return;
  }

  if (argv[0] === 'scrape') {
    await runToolCli(argv.slice(1), 'scrape');
    return;
  }

  if (argv[0] === 'ping') {
    await runToolCli(argv.slice(1), 'ping');
    return;
  }

  // Shorthand: lionscraper -u URL ...  → scrape
  if (argv.some((a) => a === '-u' || a === '--url')) {
    await runToolCli(argv, 'scrape');
    return;
  }

  process.stderr.write(`Unknown command: ${argv[0]}\n`);
  printHelp();
  process.exit(1);
}
