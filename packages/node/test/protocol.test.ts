import { describe, it, expect, vi } from 'vitest';
import { PendingRequestManager } from '../src/bridge/protocol.js';

describe('PendingRequestManager bridge progress', () => {
  it('invokes onProgress for matching requestId until resolve', async () => {
    const mgr = new PendingRequestManager();
    const onProgress = vi.fn();
    const done = mgr.add('req-1', 'scrape', 60_000, 'en-US', onProgress);

    expect(mgr.dispatchProgress('req-1', { requestId: 'req-1', phase: 'auto_identify' })).toBe(true);
    expect(onProgress).toHaveBeenCalledTimes(1);

    mgr.resolve('req-1', { ok: true });
    await expect(done).resolves.toEqual({ ok: true });

    expect(mgr.dispatchProgress('req-1', { requestId: 'req-1' })).toBe(false);
  });

  it('returns false when no pending matches requestId', () => {
    const mgr = new PendingRequestManager();
    expect(mgr.dispatchProgress('missing', { requestId: 'missing' })).toBe(false);
  });

  it('keeps pending open when only dispatchProgress is used', async () => {
    const mgr = new PendingRequestManager();
    const onProgress = vi.fn();
    const done = mgr.add('r2', 'scrape', 60_000, 'en-US', onProgress);
    mgr.dispatchProgress('r2', { requestId: 'r2', progress: 1, total: 3 });
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ progress: 1, total: 3 }));
    mgr.resolve('r2', 42);
    await expect(done).resolves.toBe(42);
  });
});
