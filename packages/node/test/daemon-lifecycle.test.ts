import { describe, expect, it, vi, afterEach } from 'vitest';

const spawnMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    unref: vi.fn(),
  }),
);

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}));

describe('ensureLocalDaemonRunning', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LIONSCRAPER_AUTO_DAEMON;
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('does not spawn when health succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({ ok: true, identity: 'lionscraper', bridgePort: 13808, sessionCount: 0 }),
      }),
    );
    const { ensureLocalDaemonRunning } = await import('../src/client/daemon-lifecycle.js');
    const r = await ensureLocalDaemonRunning();
    expect(r.didSpawn).toBe(false);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('spawns daemon when health fails then succeeds', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        n += 1;
        if (n === 1) {
          throw new Error('ECONNREFUSED');
        }
        return {
          ok: true,
          text: async () =>
          JSON.stringify({ ok: true, identity: 'lionscraper', bridgePort: 13808, sessionCount: 0 }),
        };
      }),
    );
    const { ensureLocalDaemonRunning } = await import('../src/client/daemon-lifecycle.js');
    const r = await ensureLocalDaemonRunning();
    expect(r.didSpawn).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe(process.execPath);
    const argv = spawnMock.mock.calls[0][1] as string[];
    expect(argv[0]).toMatch(/lionscraper\.js$/);
    expect(argv).toContain('daemon');
  });

  it('does not spawn when LIONSCRAPER_AUTO_DAEMON=0', async () => {
    process.env.LIONSCRAPER_AUTO_DAEMON = '0';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const { ensureLocalDaemonRunning } = await import('../src/client/daemon-lifecycle.js');
    await expect(ensureLocalDaemonRunning()).rejects.toThrow();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('treats health with bridgePort 0 as down and spawns', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        n += 1;
        if (n === 1) {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                ok: true,
                identity: 'lionscraper',
                bridgePort: 0,
                sessionCount: 0,
              }),
          };
        }
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ ok: true, identity: 'lionscraper', bridgePort: 13808, sessionCount: 0 }),
        };
      }),
    );
    const { ensureLocalDaemonRunning } = await import('../src/client/daemon-lifecycle.js');
    const r = await ensureLocalDaemonRunning();
    expect(r.didSpawn).toBe(true);
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});
