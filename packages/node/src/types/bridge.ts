export const PROTOCOL_VERSION = 1;

export const BRIDGE_PROGRESS_METHOD = 'bridgeProgress' as const;

export type BridgeMethod =
  | 'probe'
  | 'register'
  | 'ping'
  | 'pong'
  | 'scrape'
  | 'scrape_article'
  | 'scrape_emails'
  | 'scrape_phones'
  | 'scrape_urls'
  | 'scrape_images';

export interface BridgeRequest {
  jsonrpc: '2.0';
  id: string;
  method: BridgeMethod;
  params?: Record<string, unknown>;
}

export interface BridgeResponse {
  jsonrpc: '2.0';
  id: string;
  result?: unknown;
  error?: BridgeJsonRpcError;
}

export interface BridgeJsonRpcError {
  code: number;
  message: string;
  data?: {
    lionscraperCode?: string;
    [key: string]: unknown;
  };
}

export interface RegisterParams {
  protocolVersion: number;
  browser: string;
  extensionVersion: string;
  deviceId: string;
  capabilities: string[];
}

/** Extension → Server JSON-RPC Notification (no `id`). See docs/mcp.md §4.6. */
export interface BridgeProgressParams {
  requestId: string;
  phase?: string;
  message?: string;
  progress?: number;
  total?: number;
  data?: Record<string, unknown>;
}

export type BridgeProgressNotificationMethod = typeof BRIDGE_PROGRESS_METHOD;

export interface BridgeProgressNotification {
  jsonrpc: '2.0';
  method: BridgeProgressNotificationMethod;
  params?: BridgeProgressParams;
}

/** Messages Extension may send after register (response or progress notification). */
export type BridgeExtensionOutboundMessage = BridgeResponse | BridgeProgressNotification;

export type BridgeMessage = BridgeRequest | BridgeResponse;

export function isBridgeRequest(msg: BridgeMessage): msg is BridgeRequest {
  return 'method' in msg && 'id' in msg && (msg as BridgeRequest).id !== undefined && (msg as BridgeRequest).id !== null;
}

export function isBridgeResponse(msg: unknown): msg is BridgeResponse {
  if (msg === null || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (m.jsonrpc !== '2.0') return false;
  if (typeof m.id !== 'string') return false;
  if (typeof m.method === 'string') return false;
  return m.result !== undefined || m.error !== undefined;
}

/** Extension → Server request with `id` (e.g. `register`, `ping`). */
export function isExtensionBridgeRequest(msg: unknown): msg is BridgeRequest {
  if (msg === null || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (m.jsonrpc !== '2.0') return false;
  if (typeof m.id !== 'string') return false;
  return typeof m.method === 'string';
}

export function isBridgeProgressNotification(msg: unknown): msg is BridgeProgressNotification {
  if (msg === null || typeof msg !== 'object') return false;
  const m = msg as Record<string, unknown>;
  if (m.jsonrpc !== '2.0') return false;
  if (m.method !== BRIDGE_PROGRESS_METHOD) return false;
  if ('id' in m && m.id !== undefined && m.id !== null) return false;
  return true;
}
