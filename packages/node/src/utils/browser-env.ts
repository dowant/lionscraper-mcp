import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

import {
  EXTENSION_STORE_URL_CHROME,
  EXTENSION_STORE_URL_EDGE,
} from '../constants/extension-store.js';

const execFileAsync = promisify(execFile);

export type BrowserKind = 'chrome' | 'edge';

export interface BrowserEnv {
  detectChromeInstall(): Promise<string | null>;
  detectEdgeInstall(): Promise<string | null>;
  isBrowserRunning(kind: BrowserKind): Promise<boolean>;
  /**
   * Start browser for ping; returns the spawned process PID so {@link quitLaunchedBrowser} can tear down
   * a failed launch. Returns null if spawn did not yield a PID.
   */
  launchBrowser(executablePath: string, _kind: BrowserKind): number | null;
  /** Best-effort: end the process tree rooted at `pid` (e.g. ping launched browser but extension never registered). */
  quitLaunchedBrowser(pid: number): Promise<void>;
}

function winPathVar(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

function winChromeCandidates(): string[] {
  const pf = winPathVar('ProgramFiles');
  const pf86 = winPathVar('ProgramFiles(x86)');
  const local = winPathVar('LocalAppData');
  const out: string[] = [];
  const tail = '\\Google\\Chrome\\Application\\chrome.exe';
  if (pf) out.push(`${pf}${tail}`);
  if (pf86) out.push(`${pf86}${tail}`);
  if (local) out.push(`${local}\\Google\\Chrome\\Application\\chrome.exe`);
  return out;
}

function winEdgeCandidates(): string[] {
  const pf = winPathVar('ProgramFiles');
  const pf86 = winPathVar('ProgramFiles(x86)');
  const tail = '\\Microsoft\\Edge\\Application\\msedge.exe';
  const out: string[] = [];
  if (pf86) out.push(`${pf86}${tail}`);
  if (pf) out.push(`${pf}${tail}`);
  return out;
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

async function winRegChromePath(): Promise<string | null> {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
  ];
  for (const key of keys) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key, '/ve'], { windowsHide: true });
      const m = stdout.match(/REG_SZ\s+(.+)/);
      if (m) {
        const candidate = m[1].trim();
        if (candidate && existsSync(candidate)) return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function winRegEdgePath(): Promise<string | null> {
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
  ];
  for (const key of keys) {
    try {
      const { stdout } = await execFileAsync('reg', ['query', key, '/ve'], { windowsHide: true });
      const m = stdout.match(/REG_SZ\s+(.+)/);
      if (m) {
        const candidate = m[1].trim();
        if (candidate && existsSync(candidate)) return candidate;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function whichFirstUnix(commands: string[]): Promise<string | null> {
  for (const c of commands) {
    try {
      const { stdout } = await execFileAsync('sh', ['-c', `command -v "${c.replace(/"/g, '\\"')}" 2>/dev/null`], {
        windowsHide: true,
      });
      const line = stdout.trim().split('\n')[0]?.trim();
      if (line && existsSync(line)) return line;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function detectChromeInstallImpl(): Promise<string | null> {
  const { platform } = process;
  if (platform === 'win32') {
    const fromReg = await winRegChromePath();
    if (fromReg) return fromReg;
    return firstExisting(winChromeCandidates());
  }
  if (platform === 'darwin') {
    return firstExisting(['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']);
  }
  return whichFirstUnix(['google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium']);
}

async function detectEdgeInstallImpl(): Promise<string | null> {
  const { platform } = process;
  if (platform === 'win32') {
    const fromReg = await winRegEdgePath();
    if (fromReg) return fromReg;
    return firstExisting(winEdgeCandidates());
  }
  if (platform === 'darwin') {
    return firstExisting(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']);
  }
  return whichFirstUnix(['microsoft-edge-stable', 'microsoft-edge', 'msedge']);
}

async function winTasklistHas(imageName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FI', `IMAGENAME eq ${imageName}`, '/NH'], {
      windowsHide: true,
    });
    return stdout.toLowerCase().includes(imageName.toLowerCase());
  } catch {
    return false;
  }
}

async function darwinPgrepExact(processName: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-x', processName], { windowsHide: true });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function linuxPgrepPattern(pattern: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-c', pattern], { windowsHide: true });
    const n = parseInt(stdout.trim(), 10);
    return Number.isFinite(n) && n > 0;
  } catch {
    return false;
  }
}

async function isBrowserRunningImpl(kind: BrowserKind): Promise<boolean> {
  const { platform } = process;
  if (platform === 'win32') {
    return kind === 'chrome' ? winTasklistHas('chrome.exe') : winTasklistHas('msedge.exe');
  }
  if (platform === 'darwin') {
    return kind === 'chrome' ? darwinPgrepExact('Google Chrome') : darwinPgrepExact('Microsoft Edge');
  }
  if (kind === 'chrome') {
    if (await linuxPgrepPattern('chrome')) return true;
    return linuxPgrepPattern('chromium');
  }
  return linuxPgrepPattern('msedge') || linuxPgrepPattern('microsoft-edge');
}

function launchBrowserImpl(executablePath: string, _kind: BrowserKind): number | null {
  const child = spawn(executablePath, [], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const pid = child.pid;
  if (pid === undefined) {
    return null;
  }
  child.on('error', () => {
    /* spawn errors are surfaced to caller via missing session + optional quit no-op */
  });
  child.unref();
  return pid;
}

/** Spawn browser with a single URL argument (extension store). Returns false if spawn did not yield a PID. */
function spawnBrowserWithUrl(executablePath: string, url: string): boolean {
  const child = spawn(executablePath, [url], {
    stdio: 'ignore',
    windowsHide: true,
  });
  if (child.pid === undefined) {
    return false;
  }
  child.on('error', () => {
    /* ignore */
  });
  child.unref();
  return true;
}

/**
 * Opens the LionScraper extension store in Chrome if installed, else in Edge.
 * Returns null if neither browser is detected or both spawns fail.
 */
export async function tryOpenExtensionStoreInstallPage(
  browserEnv: BrowserEnv,
): Promise<{ browser: BrowserKind; url: string } | null> {
  const chromePath = await browserEnv.detectChromeInstall();
  if (chromePath && spawnBrowserWithUrl(chromePath, EXTENSION_STORE_URL_CHROME)) {
    return { browser: 'chrome', url: EXTENSION_STORE_URL_CHROME };
  }
  const edgePath = await browserEnv.detectEdgeInstall();
  if (edgePath && spawnBrowserWithUrl(edgePath, EXTENSION_STORE_URL_EDGE)) {
    return { browser: 'edge', url: EXTENSION_STORE_URL_EDGE };
  }
  return null;
}

async function quitLaunchedBrowserImpl(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } catch {
      /* ignore — already exited or access denied */
    }
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    /* ignore ESRCH */
  }
}

export const defaultBrowserEnv: BrowserEnv = {
  detectChromeInstall: detectChromeInstallImpl,
  detectEdgeInstall: detectEdgeInstallImpl,
  isBrowserRunning: isBrowserRunningImpl,
  launchBrowser: launchBrowserImpl,
  quitLaunchedBrowser: quitLaunchedBrowserImpl,
};
