import { describe, it, expect } from 'vitest';
import { isThinMcpStdioArgv } from '../src/cli/mcp-bin-argv.js';

describe('isThinMcpStdioArgv', () => {
  it('is true only for empty argv (stdio MCP)', () => {
    expect(isThinMcpStdioArgv([])).toBe(true);
    expect(isThinMcpStdioArgv(['scrape'])).toBe(false);
    expect(isThinMcpStdioArgv(['scrape', '-u', 'https://x.com'])).toBe(false);
  });
});
