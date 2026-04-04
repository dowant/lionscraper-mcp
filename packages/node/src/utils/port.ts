import crypto from 'node:crypto';
import net from 'node:net';
import WebSocket from 'ws';
import { portLang, portT } from '../i18n/lang.js';
import { logger } from './logger.js';

// --- bind probe

/**
 * Returns true if this process can bind `127.0.0.1:port` (port appears free).
 */
export function canBindPort(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        reject(err);
      }
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, '127.0.0.1');
  });
}

// --- JSON-RPC probe / takeover

export type ProbeIntent = 'takeover' | 'status' | 'forceShutdown';

export interface ProbeResult {
  identity: string;
  version: string;
  busyJobs: number;
  draining: boolean;
}

function parseTakeoverTimeoutMs(): number {
  const raw = process.env.TIMEOUT;
  if (raw === undefined || raw === '') return 120_000;
  const v = parseInt(raw, 10);
  if (Number.isNaN(v)) return 120_000;
  return Math.max(0, v);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PROBE_CONNECT_TIMEOUT_MS = 3_000;

/**
 * After `error` / `close` on the probe socket, wait this long before giving up.
 * On Windows especially, `error` (e.g. ECONNRESET) may fire before or without a final `message`
 * even though the server already sent the JSON-RPC frame; bumping the timer on each event
 * gives in-flight data time to be delivered.
 */
const PROBE_CLOSE_GRACE_MS = 400;

/**
 * Sends a one-shot JSON-RPC `probe` to an existing listener on `127.0.0.1:port`.
 * Returns `null` if the connection fails or the response is invalid.
 */
export function probePort(
  port: number,
  intent: ProbeIntent,
  timeoutMs: number = PROBE_CONNECT_TIMEOUT_MS,
): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const id = crypto.randomUUID();
    let settled = false;
    let failTimer: ReturnType<typeof setTimeout> | null = null;

    const clearFailTimer = (): void => {
      if (failTimer !== null) {
        clearTimeout(failTimer);
        failTimer = null;
      }
    };

    const scheduleFailAfterGrace = (): void => {
      if (settled) return;
      clearFailTimer();
      failTimer = setTimeout(() => {
        failTimer = null;
        if (!settled) finish(null);
      }, PROBE_CLOSE_GRACE_MS);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearFailTimer();
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      resolve(null);
    }, timeoutMs);

    const finish = (result: ProbeResult | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearFailTimer();
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'probe',
          params: { intent },
        }),
      );
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString()) as {
          id?: string;
          result?: ProbeResult;
          error?: { message?: string };
        };
        if (msg.id !== id) return;
        if (msg.error) {
          finish(null);
          return;
        }
        if (msg.result && typeof msg.result.identity === 'string') {
          finish(msg.result);
        }
      } catch {
        /* ignore */
      }
    });

    ws.on('error', () => {
      scheduleFailAfterGrace();
    });

    ws.on('close', () => {
      scheduleFailAfterGrace();
    });
  });
}

function loopbackDaemonAuthHeaders(): Record<string, string> {
  const token = process.env.DAEMON_AUTH_TOKEN?.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function httpHealthIsLionScraper(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/health`, {
      headers: loopbackDaemonAuthHeaders(),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; identity?: string };
    return body.ok === true && body.identity === 'lionscraper';
  } catch {
    return false;
  }
}

async function httpPostDaemonShutdown(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/daemon/shutdown`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...loopbackDaemonAuthHeaders(),
      },
      body: '{}',
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitUntilPortFree(port: number, deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (await canBindPort(port)) return true;
    await sleep(100);
  }
  return await canBindPort(port);
}

const STOP_DAEMON_WAIT_MS = 8_000;

export type StopLionscraperResult = 'idle' | 'stopped';

/**
 * Stops a LionScraper daemon listening on `127.0.0.1:port` by sending a `forceShutdown` probe.
 * @returns `idle` if nothing was listening; `stopped` after the port is released.
 */
export async function stopLionscraperOnPort(
  port: number = getConfiguredPort(),
): Promise<StopLionscraperResult> {
  const L = portLang();
  if (await canBindPort(port)) {
    return 'idle';
  }

  const status = await probePort(port, 'status', PROBE_CONNECT_TIMEOUT_MS);
  let verifiedLion = status?.identity === 'lionscraper';
  if (!verifiedLion) {
    verifiedLion = await httpHealthIsLionScraper(port);
    if (verifiedLion) {
      logger.info(portT(L, 'stopVerifiedViaHttpHealth', { port }));
    }
  }
  if (!verifiedLion) {
    throw new Error(portT(L, 'nonLionScraperInUse', { port }));
  }

  const forced = await probePort(port, 'forceShutdown', PROBE_CONNECT_TIMEOUT_MS);
  if (!forced) {
    const httpOk = await httpPostDaemonShutdown(port);
    if (httpOk) {
      logger.info(portT(L, 'stopRequestedHttpShutdown', { port }));
    } else {
      logger.warn(portT(L, 'forceShutdownNoResponse'));
    }
  }

  const ok = await waitUntilPortFree(port, STOP_DAEMON_WAIT_MS);
  if (!ok) {
    throw new Error(portT(L, 'stillInUseAfterForce', { port }));
  }
  return 'stopped';
}

/**
 * When the port is held by another LionScraper MCP Server: request draining / shutdown so this
 * process can bind. Uses `TIMEOUT` (ms, default 120000; `0` = immediate force).
 */
export async function takeOverPort(port: number): Promise<void> {
  const L = portLang();
  const takeoverTimeoutMs = parseTakeoverTimeoutMs();

  const first = await probePort(port, 'takeover', PROBE_CONNECT_TIMEOUT_MS);
  if (!first || first.identity !== 'lionscraper') {
    throw new Error(portT(L, 'nonLionScraperInUse', { port }));
  }

  if (takeoverTimeoutMs === 0) {
    logger.warn(portT(L, 'takeoverTimeoutZeroWarn'));
    const forced = await probePort(port, 'forceShutdown', PROBE_CONNECT_TIMEOUT_MS);
    if (!forced) {
      logger.warn(portT(L, 'forceShutdownNoResponse'));
    }
    const ok = await waitUntilPortFree(port, 8_000);
    if (!ok) {
      throw new Error(portT(L, 'stillInUseAfterForce', { port }));
    }
    return;
  }

  const deadline = Date.now() + takeoverTimeoutMs;
  while (Date.now() < deadline) {
    if (await canBindPort(port)) {
      return;
    }
    await sleep(200);

    const status = await probePort(port, 'status', PROBE_CONNECT_TIMEOUT_MS);
    if (!status) {
      if (await canBindPort(port)) return;
      continue;
    }
    if (status.identity !== 'lionscraper') {
      throw new Error(portT(L, 'identityChanged', { port }));
    }
  }

  logger.warn(portT(L, 'takeoverTimedOutWarn', { takeoverTimeoutMs }));
  await probePort(port, 'forceShutdown', PROBE_CONNECT_TIMEOUT_MS);
  const ok = await waitUntilPortFree(port, 8_000);
  if (!ok) {
    throw new Error(portT(L, 'stillInUseAfterForce', { port }));
  }
}

// --- configured port / acquire

/** Default WebSocket bridge port (single fixed port). Override with `PORT`. */
export const DEFAULT_PORT = 13808;

function parseEnvPort(envValue: string | undefined, fallback: number): number {
  if (envValue === undefined || envValue === '') return fallback;
  const p = parseInt(envValue, 10);
  if (Number.isNaN(p) || p < 1 || p > 65535) {
    const L = portLang();
    logger.warn(portT(L, 'invalidEnvPort', { envValue, fallback }));
    return fallback;
  }
  return p;
}

/** Resolved default from `process.env.PORT` or {@link DEFAULT_PORT}. */
export function getConfiguredPort(): number {
  return parseEnvPort(process.env.PORT, DEFAULT_PORT);
}

/**
 * Ensures `port` is available for the WebSocket server: binds if free, or runs
 * LionScraper takeover (probe + optional wait + force) when another process holds the port.
 */
export async function acquirePort(port: number = getConfiguredPort()): Promise<number> {
  const L = portLang();
  if (await canBindPort(port)) {
    return port;
  }

  logger.info(portT(L, 'inUseAttemptingTakeover', { port }));
  await takeOverPort(port);

  const bindDeadline = Date.now() + 10_000;
  while (Date.now() < bindDeadline) {
    if (await canBindPort(port)) {
      return port;
    }
    await sleep(100);
  }

  throw new Error(portT(L, 'bindFailedAfterTakeover', { port }));
}
