import type { ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BridgeService } from '../core/bridge-service.js';
import type { BridgeMethod } from '../types/bridge.js';
import type { McpToolHandlerExtra } from '../mcp/handler.js';
import { getToolMetadataLocale } from '../i18n/lang.js';
import { validateToolInput } from '../mcp/validate-tool-input.js';
import { getDaemonAuthToken } from '../utils/daemon-config.js';
import { logger } from '../utils/logger.js';

const TOOL_NAMES = new Set<string>([
  'ping',
  'scrape',
  'scrape_article',
  'scrape_emails',
  'scrape_phones',
  'scrape_urls',
  'scrape_images',
]);

const BRIDGE_METHODS = new Set<BridgeMethod>([
  'scrape',
  'scrape_article',
  'scrape_emails',
  'scrape_phones',
  'scrape_urls',
  'scrape_images',
]);

export interface CallBody {
  name?: string;
  arguments?: Record<string, unknown>;
  /** When set with NDJSON Accept, progress notifications are streamed. */
  progressToken?: string | number;
}

function unauthorized(res: ServerResponse): void {
  res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing bearer token' } }));
}

function badRequest(res: ServerResponse, message: string): void {
  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, error: { code: 'BAD_REQUEST', message } }));
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<CallBody | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CallBody;
  } catch {
    return null;
  }
}

function checkAuth(req: IncomingMessage): boolean {
  const token = getDaemonAuthToken();
  if (!token) return true;
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return false;
  return h.slice(7) === token;
}

function wantsNdjsonStream(req: IncomingMessage, body: CallBody): boolean {
  const accept = (req.headers.accept ?? '').toLowerCase();
  const stream = body.progressToken !== undefined && body.progressToken !== null;
  return stream && accept.includes('application/x-ndjson');
}

function createToolExtraNdjson(
  res: ServerResponse,
  progressToken: string | number,
  signal: AbortSignal,
): McpToolHandlerExtra {
  const writeLine = (obj: unknown) => {
    res.write(`${JSON.stringify(obj)}\n`);
  };

  return {
    signal,
    requestId: 0,
    _meta: { progressToken },
    sendNotification: async (notification: ServerNotification) => {
      writeLine({ type: 'progress', notification });
    },
    sendRequest: async () => {
      throw new Error('sendRequest not supported in daemon HTTP');
    },
  } as RequestHandlerExtra<ServerRequest, ServerNotification> as McpToolHandlerExtra;
}

function createToolExtraNoProgress(signal: AbortSignal): McpToolHandlerExtra {
  return {
    signal,
    requestId: 0,
    sendNotification: async () => {
      /* no progress sink */
    },
    sendRequest: async () => {
      throw new Error('sendRequest not supported in daemon HTTP');
    },
  } as RequestHandlerExtra<ServerRequest, ServerNotification> as McpToolHandlerExtra;
}

async function handleToolsCall(
  service: BridgeService,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!checkAuth(req)) {
    unauthorized(res);
    return;
  }

  const body = await readJsonBody(req);
  if (body === null) {
    badRequest(res, 'Invalid JSON body');
    return;
  }

  const name = body.name;
  if (!name || typeof name !== 'string' || !TOOL_NAMES.has(name)) {
    badRequest(res, 'Unknown or missing tool name');
    return;
  }

  const rawArgs = body.arguments && typeof body.arguments === 'object' ? body.arguments : {};
  const validationError = validateToolInput(name, rawArgs as Record<string, unknown>, getToolMetadataLocale());
  if (validationError) {
    badRequest(res, `Invalid arguments: ${validationError}`);
    return;
  }
  const args = rawArgs as Record<string, unknown>;
  const ac = new AbortController();
  const signal = ac.signal;
  req.on('close', () => ac.abort());

  const stream = wantsNdjsonStream(req, body);

  if (stream) {
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Transfer-Encoding': 'chunked',
    });
    const extra = createToolExtraNdjson(res, body.progressToken!, signal);
    try {
      const result =
        name === 'ping'
          ? await service.toolHandler.handlePing(args, extra)
          : await service.toolHandler.handleTool(name as BridgeMethod, args, extra);
      res.write(`${JSON.stringify({ type: 'result', ...result })}\n`);
    } catch (err) {
      logger.error('daemon tool call failed', err);
      res.write(
        `${JSON.stringify({
          type: 'error',
          error: { message: err instanceof Error ? err.message : String(err) },
        })}\n`,
      );
    }
    res.end();
    return;
  }

  const extra = createToolExtraNoProgress(signal);
  try {
    const result =
      name === 'ping'
        ? await service.toolHandler.handlePing(args, extra)
        : BRIDGE_METHODS.has(name as BridgeMethod)
          ? await service.toolHandler.handleTool(name as BridgeMethod, args, extra)
          : null;
    if (result === null) {
      badRequest(res, 'Invalid tool for bridge');
      return;
    }
    json(res, 200, result);
  } catch (err) {
    logger.error('daemon tool call failed', err);
    json(res, 500, {
      ok: false,
      error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
    });
  }
}

function handleHealth(service: BridgeService, req: IncomingMessage, res: ServerResponse): void {
  if (!checkAuth(req)) {
    unauthorized(res);
    return;
  }
  json(res, 200, {
    ok: true,
    identity: 'lionscraper',
    implementation: 'node',
    bridgePort: service.listeningPort,
    sessionCount: service.bridge.sessionManager.sessionCount,
  });
}

/**
 * Attach HTTP API routes to a Node HTTP server instance (caller creates server with host 127.0.0.1).
 */
export function attachDaemonApi(service: BridgeService, server: import('node:http').Server): void {
  server.on('request', (req, res) => {
    // WebSocket upgrade uses GET with `Upgrade: websocket`; answering 404 here breaks the handshake
    // (bridge shares this HTTP server on the same PORT).
    if (String(req.headers.upgrade ?? '').toLowerCase() === 'websocket') {
      return;
    }
    const url = req.url?.split('?')[0] ?? '';
    if (req.method === 'GET' && url === '/v1/health') {
      handleHealth(service, req, res);
      return;
    }
    if (req.method === 'POST' && url === '/v1/daemon/shutdown') {
      if (!checkAuth(req)) {
        unauthorized(res);
        return;
      }
      req.resume();
      json(res, 200, { ok: true });
      setImmediate(() => {
        service.bridge.requestShutdownFromLoopbackHttp();
      });
      return;
    }
    if (req.method === 'POST' && url === '/v1/tools/call') {
      void handleToolsCall(service, req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
  });
}
