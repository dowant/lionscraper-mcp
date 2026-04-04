/**
 * Thin MCP stdio mode: process is invoked as `node mcp.js` with no further argv (MCP hosts).
 * Any extra token means the user intended the lionscraper CLI (e.g. scrape / daemon).
 */
export function isThinMcpStdioArgv(argv: string[]): boolean {
  return argv.length === 0;
}
