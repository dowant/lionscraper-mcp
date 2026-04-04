import { describe, expect, it, vi, afterEach } from 'vitest';
import { callDaemonTool, daemonHealth } from '../src/client/daemon-client.js';
import { ClientErrorCode } from '../src/types/errors.js';

describe('callDaemonTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses JSON result on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }),
      }),
    );

    const r = await callDaemonTool('http://127.0.0.1:13808', 'ping', {});
    expect(r.content[0]?.text).toBe('{"ok":true}');
  });

  it('returns isError body on HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ ok: false, error: { message: 'down' } }),
      }),
    );

    const r = await callDaemonTool('http://127.0.0.1:13808', 'scrape', { url: 'https://a.com' });
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('down');
  });

  it('returns DAEMON_UNREACHABLE when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const r = await callDaemonTool('http://127.0.0.1:13808', 'ping', {});
    expect(r.isError).toBe(true);
    const j = JSON.parse(r.content[0]?.text ?? '{}') as { error?: { code?: string } };
    expect(j.error?.code).toBe(ClientErrorCode.DAEMON_UNREACHABLE);
  });

  it('returns DAEMON_UNREACHABLE on HTTP 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'down',
      }),
    );
    const r = await callDaemonTool('http://127.0.0.1:13808', 'scrape', { url: 'https://a.com' });
    expect(r.isError).toBe(true);
    const j = JSON.parse(r.content[0]?.text ?? '{}') as { error?: { code?: string } };
    expect(j.error?.code).toBe(ClientErrorCode.DAEMON_UNREACHABLE);
  });
});

describe('daemonHealth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when bridgePort is 0', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ ok: true, identity: 'lionscraper', bridgePort: 0, sessionCount: 0 }),
      }),
    );
    await expect(daemonHealth('http://127.0.0.1:1')).rejects.toThrow(/bridgePort/i);
  });

  it('throws when identity is not lionscraper', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ ok: true, identity: 'other', bridgePort: 13808, sessionCount: 0 }),
      }),
    );
    await expect(daemonHealth('http://127.0.0.1:1')).rejects.toThrow(/identity/i);
  });
});
