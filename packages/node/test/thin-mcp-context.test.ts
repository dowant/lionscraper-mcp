import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { createThinMcpServer } from '../src/mcp/thin-mcp-server.js';
import { registerThinMcpPrompts } from '../src/mcp/mcp-prompts.js';
import { getThinMcpServerInstructions, MCP_RESOURCE_URIS, registerThinMcpResources } from '../src/mcp/mcp-resources.js';
import { PACKAGE_VERSION } from '../src/version.js';

async function connectContextServer(): Promise<{ client: Client; mcpServer: McpServer }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpServer = new McpServer(
    { name: 'lionscraper', version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );
  registerThinMcpResources(mcpServer, 'en-US');
  registerThinMcpPrompts(mcpServer, 'en-US');
  await mcpServer.connect(serverTransport);
  const client = new Client({ name: 'vitest', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('thin MCP static resources and prompts', () => {
  it('lists and reads guide/reference resources including when-to-use and cli', async () => {
    const { client, mcpServer } = await connectContextServer();
    try {
      const { resources } = await client.listResources();
      const uris = new Set(resources.map((r) => r.uri));
      expect(uris.has(MCP_RESOURCE_URIS.connection)).toBe(true);
      expect(uris.has(MCP_RESOURCE_URIS.whenToUseTools)).toBe(true);
      expect(uris.has(MCP_RESOURCE_URIS.cli)).toBe(true);
      expect(uris.has(MCP_RESOURCE_URIS.tools)).toBe(true);
      expect(uris.has(MCP_RESOURCE_URIS.commonParams)).toBe(true);
      expect(resources.length).toBe(5);
      const read = await client.readResource({ uri: MCP_RESOURCE_URIS.connection });
      const first = read.contents[0];
      expect(first && 'text' in first && first.text.length).toBeGreaterThan(40);
      const when = await client.readResource({ uri: MCP_RESOURCE_URIS.whenToUseTools });
      const whenText = when.contents[0];
      expect(whenText && 'text' in whenText && whenText.text).toContain('WebFetch');
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });

  it('lists prompts and returns getPrompt messages', async () => {
    const { client, mcpServer } = await connectContextServer();
    try {
      const { prompts } = await client.listPrompts();
      const names = prompts.map((p) => p.name);
      expect(names).toContain('ping_then_scrape');
      expect(names).toContain('scrape_article');
      expect(names).toContain('multi_url_scrape');
      expect(names).toContain('troubleshoot_extension');
      expect(names).toContain('prefer_lionscraper_scraping');
      const r = await client.getPrompt({ name: 'troubleshoot_extension' });
      expect(r.messages.length).toBeGreaterThan(0);
      const m = r.messages[0];
      expect(m?.role).toBe('user');
      expect(m?.content.type).toBe('text');
      if (m?.content.type === 'text') {
        expect(m.content.text.length).toBeGreaterThan(20);
      }
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });
});

describe('thin MCP server instructions', () => {
  it('exposes non-empty locale instructions after connect', async () => {
    expect(getThinMcpServerInstructions('en-US').length).toBeGreaterThan(80);
    expect(getThinMcpServerInstructions('en-US')).toContain('LionScraper');
    expect(getThinMcpServerInstructions('zh-CN').length).toBeGreaterThan(80);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpServer = createThinMcpServer();
    await mcpServer.connect(serverTransport);
    const client = new Client({ name: 'vitest', version: '1.0.0' }, { capabilities: {} });
    await client.connect(clientTransport);
    try {
      const instr = client.getInstructions();
      expect(instr && instr.length).toBeGreaterThan(80);
      expect(instr).toContain('ping');
    } finally {
      await client.close();
      await mcpServer.close();
    }
  });
});
