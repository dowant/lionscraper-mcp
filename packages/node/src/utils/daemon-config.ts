import { getConfiguredPort } from './port.js';

/** Base URL for CLI / thin MCP to reach daemon (loopback, port from `PORT`). */
export function getDaemonHttpBaseUrl(): string {
  return `http://127.0.0.1:${getConfiguredPort()}`;
}

/** Optional shared secret; if set, HTTP requests must send `Authorization: Bearer <token>`. */
export function getDaemonAuthToken(): string | undefined {
  const t = process.env.DAEMON_AUTH_TOKEN?.trim();
  return t || undefined;
}
