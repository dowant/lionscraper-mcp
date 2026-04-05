import type { ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { portLang, t } from '../i18n/lang.js';
import { ClientErrorCode } from '../types/errors.js';

export type DaemonToolContent = { type: 'text'; text: string };

export interface DaemonCallResult {
  content: DaemonToolContent[];
  isError?: boolean;
}

export interface CallDaemonOptions {
  authToken?: string;
  progressToken?: string | number;
  onProgress?: (notification: ServerNotification) => Promise<void>;
  signal?: AbortSignal;
}

export interface DaemonHealthOk {
  ok: true;
  identity?: string;
  bridgePort: number;
  sessionCount: number;
}

function authHeaders(token: string | undefined): Record<string, string> {
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

function daemonUnreachableCallResult(cause?: string): DaemonCallResult {
  const L = portLang();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: false,
          error: {
            code: ClientErrorCode.DAEMON_UNREACHABLE,
            message: t(L, 'daemon_unreachable.message'),
            details: {
              startCommand: 'lionscraper daemon',
              hint: t(L, 'daemon_unreachable.hint'),
              ...(cause ? { cause } : {}),
            },
          },
        }),
      },
    ],
    isError: true,
  };
}

function invalidDaemonResponseResult(message: string, details?: Record<string, unknown>): DaemonCallResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: false,
          error: {
            code: ClientErrorCode.DAEMON_INVALID_RESPONSE,
            message,
            ...(details !== undefined && Object.keys(details).length > 0 ? { details } : {}),
          },
        }),
      },
    ],
    isError: true,
  };
}

async function processNdjsonLineArray(
  lineChunks: string[],
  onProgress: (notification: ServerNotification) => Promise<void>,
): Promise<DaemonCallResult> {
  let final: DaemonCallResult | null = null;

  for (const line of lineChunks) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: {
      type: string;
      notification?: ServerNotification;
      content?: DaemonToolContent[];
      isError?: boolean;
      error?: { message?: string };
    };
    try {
      obj = JSON.parse(trimmed) as typeof obj;
    } catch {
      return invalidDaemonResponseResult('Invalid JSON line in daemon NDJSON stream', {
        linePreview: trimmed.slice(0, 120),
      });
    }
    if (obj.type === 'progress' && obj.notification) {
      await onProgress(obj.notification);
    } else if (obj.type === 'result' && Array.isArray(obj.content)) {
      final = { content: obj.content, isError: obj.isError };
    } else if (obj.type === 'error') {
      return invalidDaemonResponseResult(obj.error?.message ?? 'Daemon tool error line in NDJSON stream');
    }
  }

  if (!final) {
    return invalidDaemonResponseResult('No result line in daemon NDJSON stream (incomplete response)');
  }
  return final;
}

async function readNdjsonStream(
  res: Response,
  onProgress: (notification: ServerNotification) => Promise<void>,
): Promise<DaemonCallResult> {
  if (!res.body) {
    return invalidDaemonResponseResult('Empty response body from daemon (streaming)');
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  const completeLines: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      completeLines.push(line);
    }
  }
  if (buffer.trim()) {
    completeLines.push(buffer);
  }

  return processNdjsonLineArray(completeLines, onProgress);
}

/** When Content-Type is not ndjson but body may still be NDJSON lines (misconfigured proxy, etc.). */
async function tryReadNdjsonFromTextBody(
  text: string,
  onProgress: (notification: ServerNotification) => Promise<void>,
): Promise<DaemonCallResult | null> {
  const rawLines = text.split('\n').filter((l) => l.trim());
  if (rawLines.length === 0) return null;
  let looksNdjson = false;
  for (const l of rawLines) {
    try {
      const o = JSON.parse(l) as { type?: string };
      if (o.type === 'progress' || o.type === 'result' || o.type === 'error') {
        looksNdjson = true;
        break;
      }
    } catch {
      /* ignore */
    }
  }
  if (!looksNdjson) return null;
  return processNdjsonLineArray(rawLines, onProgress);
}

/**
 * POST /v1/tools/call on the LionScraper daemon HTTP control plane.
 * Network failures are returned as {@link ClientErrorCode.DAEMON_UNREACHABLE} (not thrown).
 * Malformed streaming or JSON bodies use {@link ClientErrorCode.DAEMON_INVALID_RESPONSE}.
 */
export async function callDaemonTool(
  baseUrl: string,
  name: string,
  args: Record<string, unknown>,
  options: CallDaemonOptions = {},
): Promise<DaemonCallResult> {
  try {
    return await callDaemonToolUnsafe(baseUrl, name, args, options);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return daemonUnreachableCallResult(cause);
  }
}

async function callDaemonToolUnsafe(
  baseUrl: string,
  name: string,
  args: Record<string, unknown>,
  options: CallDaemonOptions,
): Promise<DaemonCallResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/tools/call`;
  const useStream =
    options.progressToken !== undefined && options.progressToken !== null && options.onProgress !== undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(options.authToken),
  };
  if (useStream) {
    headers.Accept = 'application/x-ndjson';
  }

  const body = JSON.stringify({
    name,
    arguments: args,
    ...(useStream ? { progressToken: options.progressToken } : {}),
  });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    signal: options.signal,
  });

  if (useStream && res.ok) {
    const ct = (res.headers.get('content-type') ?? '').toLowerCase();
    if (ct.includes('ndjson')) {
      return readNdjsonStream(res, options.onProgress!);
    }
    const text = await res.text();
    const fromNdjson = await tryReadNdjsonFromTextBody(text, options.onProgress!);
    if (fromNdjson) return fromNdjson;
    try {
      return JSON.parse(text) as DaemonCallResult;
    } catch {
      return invalidDaemonResponseResult(
        'Expected application/x-ndjson from daemon for streaming tool call, but body was not valid NDJSON or JSON',
        { contentType: res.headers.get('content-type') ?? '', snippet: text.slice(0, 200) },
      );
    }
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status >= 500) {
      return daemonUnreachableCallResult(text || `HTTP ${res.status}`);
    }
    try {
      const j = JSON.parse(text) as { error?: { message?: string }; ok?: boolean };
      const msg = j.error?.message ?? (text || `HTTP ${res.status}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: false, error: { message: msg, status: res.status } }) }],
        isError: true,
      };
    } catch {
      return {
        content: [{ type: 'text', text: text || `HTTP ${res.status}` }],
        isError: true,
      };
    }
  }

  try {
    return JSON.parse(text) as DaemonCallResult;
  } catch {
    return invalidDaemonResponseResult('Invalid JSON from daemon (non-streaming response)', {
      snippet: text.slice(0, 200),
    });
  }
}

/**
 * GET /v1/health — requires a LionScraper daemon with WebSocket bridge ready (`bridgePort` > 0).
 */
export async function daemonHealth(
  baseUrl: string,
  authToken?: string,
  signal?: AbortSignal,
): Promise<DaemonHealthOk> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/health`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { ...authHeaders(authToken) },
      signal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `HTTP ${res.status}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON from daemon health endpoint');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid daemon health response');
  }

  const o = parsed as Record<string, unknown>;
  if (o.ok !== true) {
    throw new Error('Daemon health reports not ready');
  }

  if (o.identity !== undefined && o.identity !== 'lionscraper') {
    throw new Error('Not a LionScraper daemon (identity mismatch)');
  }

  const bridgePort = o.bridgePort;
  if (typeof bridgePort !== 'number' || !Number.isFinite(bridgePort) || bridgePort <= 0) {
    throw new Error('Daemon WebSocket bridge is not ready (invalid bridgePort)');
  }

  const rawSc = o.sessionCount;
  const sessionCount =
    typeof rawSc === 'number' && Number.isFinite(rawSc) ? Math.max(0, Math.floor(rawSc)) : 0;

  return {
    ok: true,
    bridgePort,
    sessionCount,
    ...(typeof o.identity === 'string' ? { identity: o.identity } : {}),
  };
}
