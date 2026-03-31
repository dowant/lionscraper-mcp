/** Default per-URL task timeout forwarded to the extension (`timeoutMs`). */
export const DEFAULT_PER_TASK_TIMEOUT_MS = 60_000;

/** Upper bound for WebSocket bridge wait so a single MCP call cannot block indefinitely. */
export const MAX_BRIDGE_TIMEOUT_MS = 3_600_000;

export function countUrls(url: unknown): number {
  if (Array.isArray(url)) return url.length;
  return 1;
}

/**
 * How long the MCP Server waits for one WebSocket response from the extension.
 * When `bridgeTimeoutMs` is set, it wins (capped). Otherwise: `timeoutMs * effectiveTaskCount + stagger`
 * where `effectiveTaskCount = max(1, urlCount) * max(1, maxPages)` (covers single-URL pagination),
 * and stagger is `(effectiveTaskCount - 1) * scrapeInterval` when `scrapeInterval` is provided.
 */
export function resolveBridgeTimeoutMs(params: Record<string, unknown>): number {
  const explicit = params.bridgeTimeoutMs;
  if (typeof explicit === 'number' && explicit >= 1000) {
    return Math.min(explicit, MAX_BRIDGE_TIMEOUT_MS);
  }

  const perTask =
    typeof params.timeoutMs === 'number' && params.timeoutMs >= 1000
      ? params.timeoutMs
      : DEFAULT_PER_TASK_TIMEOUT_MS;

  const urlCount = Math.max(1, countUrls(params.url));
  const maxPagesRaw = params.maxPages;
  const maxPages =
    typeof maxPagesRaw === 'number' && Number.isFinite(maxPagesRaw) && maxPagesRaw >= 1
      ? Math.min(Math.floor(maxPagesRaw), 10_000)
      : 1;
  const n = urlCount * maxPages;

  const interval =
    typeof params.scrapeInterval === 'number' && params.scrapeInterval >= 0 ? params.scrapeInterval : 0;
  const staggerMs = n > 1 ? (n - 1) * interval : 0;
  const estimated = perTask * n + staggerMs;

  return Math.min(MAX_BRIDGE_TIMEOUT_MS, Math.max(perTask, estimated));
}

/** Strip MCP-Server-only fields before forwarding params over the bridge. */
export function paramsForExtension(params: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...params };
  delete copy.bridgeTimeoutMs;
  return copy;
}
