import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SupportedLang } from '../i18n/lang.js';
import enUS from '../locale/en-US.json' with { type: 'json' };
import zhCN from '../locale/zh-CN.json' with { type: 'json' };

export const MCP_RESOURCE_URIS = {
  connection: 'lionscraper://guide/connection',
  whenToUseTools: 'lionscraper://guide/when-to-use-tools',
  cli: 'lionscraper://guide/cli',
  tools: 'lionscraper://reference/tools',
  commonParams: 'lionscraper://reference/common-params',
} as const;

type McpContextCopy = (typeof enUS)['mcpContext'];

function mcpContext(locale: SupportedLang): McpContextCopy {
  return locale === 'zh-CN' ? zhCN.mcpContext : enUS.mcpContext;
}

/** MCP `initialize` instructions (may be injected into the client system prompt). */
export function getThinMcpServerInstructions(locale: SupportedLang): string {
  return mcpContext(locale).serverInstructions;
}

/**
 * Static MCP resources (markdown). No daemon HTTP — safe to list/read before the bridge is up.
 */
export function registerThinMcpResources(mcpServer: McpServer, locale: SupportedLang): void {
  const c = mcpContext(locale);

  const reg = (internalName: string, uri: string, title: string, body: string) => {
    mcpServer.registerResource(internalName, uri, { title, description: title }, async (u) => ({
      contents: [{ uri: u.toString(), mimeType: 'text/markdown', text: body }],
    }));
  };

  reg('guide_connection', MCP_RESOURCE_URIS.connection, c.resourceConnectionTitle, c.resourceConnectionBody);
  reg('guide_when_to_use_tools', MCP_RESOURCE_URIS.whenToUseTools, c.resourceWhenToUseToolsTitle, c.resourceWhenToUseToolsBody);
  reg('guide_cli', MCP_RESOURCE_URIS.cli, c.resourceCliTitle, c.resourceCliBody);
  reg('reference_tools', MCP_RESOURCE_URIS.tools, c.resourceToolsTitle, c.resourceToolsBody);
  reg('reference_common_params', MCP_RESOURCE_URIS.commonParams, c.resourceCommonParamsTitle, c.resourceCommonParamsBody);
}
