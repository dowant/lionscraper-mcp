import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { callDaemonTool, daemonHealth } from '../client/daemon-client.js';
import { ensureLocalDaemonRunning } from '../client/daemon-lifecycle.js';
import { getDaemonAuthToken, getDaemonHttpBaseUrl } from '../utils/daemon-config.js';
import { ClientErrorCode } from '../types/errors.js';
import { registerThinMcpPrompts } from './mcp-prompts.js';
import { getThinMcpServerInstructions, registerThinMcpResources } from './mcp-resources.js';
import { buildToolDefinitions } from './tools.js';
import { getToolMetadataLocale, logT, portLang } from '../i18n/lang.js';
import { logger } from '../utils/logger.js';
import { PACKAGE_VERSION } from '../version.js';
import type { BridgeMethod } from '../types/bridge.js';
import type { McpToolHandlerExtra } from './handler.js';
import type { CallToolResult, ServerNotification } from '@modelcontextprotocol/sdk/types.js';

function getProgressToken(extra: McpToolHandlerExtra): string | number | undefined {
  if (!extra._meta || typeof extra._meta !== 'object') return undefined;
  return (extra._meta as { progressToken?: string | number }).progressToken;
}

/** Old daemons omit `development` on ping; merge from GET /v1/health `implementation`. */
async function enrichPingDevelopmentIfNeeded(
  name: string,
  baseUrl: string,
  authToken: string | undefined,
  result: CallToolResult,
  signal: AbortSignal | undefined,
): Promise<CallToolResult> {
  if (name !== 'ping' || result.isError) return result;
  const first = result.content[0];
  if (!first || first.type !== 'text') return result;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(first.text) as Record<string, unknown>;
  } catch {
    return result;
  }
  if (body.ok !== true || body.development != null) return result;
  let dev: 'node' | 'python' = 'node';
  try {
    const h = await daemonHealth(baseUrl, authToken, signal);
    if (h.implementation === 'node' || h.implementation === 'python') dev = h.implementation;
  } catch {
    /* keep dev = 'node' for this npm thin MCP */
  }
  body.development = dev;
  return {
    ...result,
    content: [{ type: 'text', text: JSON.stringify(body) }],
  };
}

/**
 * MCP over stdio that forwards tool calls to a running `lionscraper daemon` via loopback HTTP.
 */
export function createThinMcpServer(): McpServer {
  const locale = getToolMetadataLocale();
  const mcpServer = new McpServer(
    {
      name: 'lionscraper',
      version: PACKAGE_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: getThinMcpServerInstructions(locale),
    },
  );
  const toolDefinitions = buildToolDefinitions(locale);
  const L = portLang();
  logger.info(logT(L, 'mcpToolMetadataLocale', { locale }));

  const baseUrl = getDaemonHttpBaseUrl();
  const authToken = getDaemonAuthToken();

  const isDaemonUnreachable = (r: Awaited<ReturnType<typeof callDaemonTool>>): boolean => {
    if (!r.isError) return false;
    const payload = r.content[0]?.type === 'text' ? r.content[0].text : '';
    try {
      const j = JSON.parse(payload) as { error?: { code?: string } };
      return j?.error?.code === ClientErrorCode.DAEMON_UNREACHABLE;
    } catch {
      return false;
    }
  };

  const forward = async (
    name: string,
    args: Record<string, unknown>,
    extra: McpToolHandlerExtra,
  ): Promise<CallToolResult> => {
    const progressToken = getProgressToken(extra);
    const options = {
      authToken,
      signal: extra.signal,
      progressToken,
      onProgress:
        progressToken !== undefined
          ? async (n: ServerNotification) => {
              await extra.sendNotification(n);
            }
          : undefined,
    };

    try {
      let result = await callDaemonTool(baseUrl, name, args, options);
      if (isDaemonUnreachable(result)) {
        try {
          await ensureLocalDaemonRunning();
          result = await callDaemonTool(baseUrl, name, args, options);
        } catch {
          /* keep first result */
        }
      }
      return (await enrichPingDevelopmentIfNeeded(
        name,
        baseUrl,
        authToken,
        result as CallToolResult,
        options.signal,
      )) as CallToolResult;
    } catch (err) {
      logger.warn('thin MCP tool forward failed', err);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: { message: err instanceof Error ? err.message : String(err) },
            }),
          },
        ],
        isError: true,
      } as CallToolResult;
    }
  };

  const { ping, scrape, scrape_article, scrape_emails, scrape_phones, scrape_urls, scrape_images } =
    toolDefinitions;

  mcpServer.registerTool(
    ping.name,
    { description: ping.description, inputSchema: ping.schema },
    async (args: Record<string, unknown>, extra: McpToolHandlerExtra) => forward(ping.name, args, extra),
  );

  const scrapingTools = [
    scrape,
    scrape_article,
    scrape_emails,
    scrape_phones,
    scrape_urls,
    scrape_images,
  ] as const;

  for (const tool of scrapingTools) {
    mcpServer.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: Record<string, unknown>, extra: McpToolHandlerExtra) =>
        forward(tool.name as BridgeMethod, args, extra),
    );
  }

  registerThinMcpResources(mcpServer, locale);
  registerThinMcpPrompts(mcpServer, locale);

  logger.info(logT(portLang(), 'registeredMcpTools', { count: scrapingTools.length + 1 }));
  logger.info(logT(portLang(), 'thinMcpForwardingTo', { url: baseUrl }));

  return mcpServer;
}
