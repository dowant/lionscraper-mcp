import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { daemonHealth } from './daemon-client.js';
import { getDaemonAuthToken, getDaemonHttpBaseUrl } from '../utils/daemon-config.js';
import { logT, portLang } from '../i18n/lang.js';
import { logger } from '../utils/logger.js';

const HEALTH_POLL_MS = 350;
const HEALTH_MAX_WAIT_MS = 20_000;

function resolveLionscraperJsPath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const parts = dir.split(path.sep);
  const distIdx = parts.lastIndexOf('dist');
  if (distIdx >= 0) {
    return path.join(...parts.slice(0, distIdx + 1), 'lionscraper.js');
  }
  return path.join(dir, '..', '..', 'dist', 'lionscraper.js');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealthy(baseUrl: string, auth: string | undefined): Promise<boolean> {
  const deadline = Date.now() + HEALTH_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      await daemonHealth(baseUrl, auth);
      return true;
    } catch {
      await sleep(HEALTH_POLL_MS);
    }
  }
  return false;
}

export interface EnsureLocalDaemonResult {
  /** True if this call spawned a new background `lionscraper daemon` (was not already healthy). */
  didSpawn: boolean;
}

/**
 * Ensures the local daemon responds on `getDaemonHttpBaseUrl()` (same `PORT` as this process).
 * If `LIONSCRAPER_AUTO_DAEMON` is `0`, only probes health.
 */
export async function ensureLocalDaemonRunning(): Promise<EnsureLocalDaemonResult> {
  const baseUrl = getDaemonHttpBaseUrl();
  const auth = getDaemonAuthToken();
  const L = portLang();

  try {
    await daemonHealth(baseUrl, auth);
    return { didSpawn: false };
  } catch {
    /* need spawn */
  }

  if (process.env.LIONSCRAPER_AUTO_DAEMON === '0') {
    throw new Error(logT(L, 'daemonUnreachableNoAuto', { baseUrl }));
  }

  const lionscraperJs = resolveLionscraperJsPath();
  const args = ['daemon'];
  if (process.argv.includes('--debug')) {
    args.push('--debug');
  }

  logger.info(logT(L, 'autoDaemonSpawning', { path: lionscraperJs }));

  try {
    const child = spawn(process.execPath, [lionscraperJs, ...args], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: process.env,
    });
    child.unref();
  } catch (err) {
    throw new Error(logT(L, 'autoDaemonSpawnFailed', { message: err instanceof Error ? err.message : String(err) }));
  }

  const ok = await waitForHealthy(baseUrl, auth);
  if (!ok) {
    throw new Error(logT(L, 'autoDaemonTimeout', { baseUrl }));
  }
  return { didSpawn: true };
}
