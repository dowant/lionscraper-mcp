import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolHandler, type McpToolHandlerExtra } from '../src/mcp/handler.js';
import type { BridgeServer } from '../src/bridge/websocket.js';
import { BridgeErrorCode, createError, SystemErrorCode } from '../src/types/errors.js';
import type { BrowserEnv } from '../src/utils/browser-env.js';

function makeBridgeMock(sendToExtension: ReturnType<typeof vi.fn>): BridgeServer {
  return {
    isDraining: () => false,
    bridgePort: 13808,
    sessionManager: {
      hasConnectedExtension: () => true,
      sessionCount: 1,
      getSessionInfo: () => ({
        deviceId: 'dev',
        browser: 'chrome',
        extensionVersion: '9.9.9',
      }),
      getTotalPendingBridgeRequests: () => 0,
    },
    sendToExtension: sendToExtension,
  } as unknown as BridgeServer;
}

describe('ToolHandler handleTool BRIDGE_DISCONNECTED retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('retries and succeeds when second sendToExtension succeeds', async () => {
    const sendToExtension = vi
      .fn()
      .mockRejectedValueOnce(createError(BridgeErrorCode.BRIDGE_DISCONNECTED, 'Extension disconnected'))
      .mockResolvedValueOnce({ ok: true, data: [], meta: { url: 'x', elapsed: 0 } });

    const handler = new ToolHandler(makeBridgeMock(sendToExtension));
    const params = { url: 'https://www.example.com' };

    const promise = handler.handleTool('scrape', params);
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(sendToExtension).toHaveBeenCalledTimes(2);
    expect(sendToExtension).toHaveBeenNthCalledWith(
      1,
      'scrape',
      { url: 'https://www.example.com' },
      60_000,
      undefined,
    );
    const text = out.content[0]?.type === 'text' ? out.content[0].text : '';
    expect(JSON.parse(text).ok).toBe(true);
  });

  it('returns BRIDGE_DISCONNECTED after all attempts fail', async () => {
    const sendToExtension = vi.fn().mockRejectedValue(
      createError(BridgeErrorCode.BRIDGE_DISCONNECTED, 'Extension disconnected'),
    );

    const handler = new ToolHandler(makeBridgeMock(sendToExtension));
    const params = { url: 'https://www.example.com' };

    const promise = handler.handleTool('scrape', params);
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(sendToExtension).toHaveBeenCalledTimes(3);
    const text = out.content[0]?.type === 'text' ? out.content[0].text : '';
    const body = JSON.parse(text);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(BridgeErrorCode.BRIDGE_DISCONNECTED);
  });

  it('wraps non-LionScraper errors as EXTENSION_INTERNAL_ERROR without retry', async () => {
    const sendToExtension = vi.fn().mockRejectedValue(new Error('boom'));

    const handler = new ToolHandler(makeBridgeMock(sendToExtension));
    const out = await handler.handleTool('scrape', { url: 'https://www.example.com' });

    expect(sendToExtension).toHaveBeenCalledTimes(1);
    const text = out.content[0]?.type === 'text' ? out.content[0].text : '';
    const body = JSON.parse(text);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(SystemErrorCode.EXTENSION_INTERNAL_ERROR);
    expect(body.error.message).toBe('boom');
  });

  it('does not retry on BRIDGE_TIMEOUT', async () => {
    const sendToExtension = vi.fn().mockRejectedValue(
      createError(BridgeErrorCode.BRIDGE_TIMEOUT, 'timed out'),
    );

    const handler = new ToolHandler(makeBridgeMock(sendToExtension));
    const promise = handler.handleTool('scrape', { url: 'https://www.example.com' });
    await vi.runAllTimersAsync();
    await promise;

    expect(sendToExtension).toHaveBeenCalledTimes(1);
  });

  it('uses derived bridge timeout for multiple URLs and strips bridgeTimeoutMs from extension params', async () => {
    const sendToExtension = vi.fn().mockResolvedValue({ ok: true, data: [] });
    const handler = new ToolHandler(makeBridgeMock(sendToExtension));

    const out = await handler.handleTool('scrape', {
      url: ['https://a.com', 'https://b.com', 'https://c.com'],
      timeoutMs: 10_000,
    });

    expect(sendToExtension).toHaveBeenCalledWith(
      'scrape',
      { url: ['https://a.com', 'https://b.com', 'https://c.com'], timeoutMs: 10_000 },
      30_000,
      undefined,
    );
    const text = out.content[0]?.type === 'text' ? out.content[0].text : '';
    expect(JSON.parse(text).ok).toBe(true);
  });

  it('uses explicit bridgeTimeoutMs and does not forward it to extension', async () => {
    const sendToExtension = vi.fn().mockResolvedValue({ ok: true, data: [] });
    const handler = new ToolHandler(makeBridgeMock(sendToExtension));

    await handler.handleTool('scrape', {
      url: 'https://www.example.com',
      timeoutMs: 30_000,
      bridgeTimeoutMs: 500_000,
    });

    expect(sendToExtension).toHaveBeenCalledWith(
      'scrape',
      { url: 'https://www.example.com', timeoutMs: 30_000 },
      500_000,
      undefined,
    );
  });

  it('forwards lang in params to the extension', async () => {
    const sendToExtension = vi.fn().mockResolvedValue({ ok: true, data: [] });
    const handler = new ToolHandler(makeBridgeMock(sendToExtension));

    await handler.handleTool('scrape', {
      url: 'https://www.example.com',
      lang: 'zh-CN',
    });

    expect(sendToExtension).toHaveBeenCalledWith(
      'scrape',
      { url: 'https://www.example.com', lang: 'zh-CN' },
      60_000,
      undefined,
    );
  });

  it('forwards bridgeProgress to MCP notifications/progress when progressToken is set', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra = {
      _meta: { progressToken: 'pt-1' },
      sendNotification,
    } as unknown as McpToolHandlerExtra;

    const sendToExtension = vi.fn(
      async (
        _method: string,
        _params: Record<string, unknown>,
        _timeout: number,
        onProgress?: (p: { requestId: string; phase?: string; message?: string }) => void,
      ) => {
        onProgress?.({ requestId: 'x', phase: 'auto_identify', message: 'step' });
        return { ok: true, data: [] };
      },
    );

    const handler = new ToolHandler(makeBridgeMock(sendToExtension));
    await handler.handleTool('scrape', { url: 'https://www.example.com' }, extra);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const n = sendNotification.mock.calls[0][0] as { method: string; params: Record<string, unknown> };
    expect(n.method).toBe('notifications/progress');
    expect(n.params.progressToken).toBe('pt-1');
    expect(n.params.message).toBe('[auto_identify] step');
  });

  it('does not send MCP progress when progressToken is absent', async () => {
    const sendNotification = vi.fn().mockResolvedValue(undefined);
    const extra = {
      _meta: {},
      sendNotification,
    } as unknown as McpToolHandlerExtra;

    const sendToExtension = vi.fn(
      async (
        _m: string,
        _p: Record<string, unknown>,
        _t: number,
        onProgress?: (p: { requestId: string }) => void,
      ) => {
        onProgress?.({ requestId: 'x' });
        return { ok: true, data: [] };
      },
    );

    const handler = new ToolHandler(makeBridgeMock(sendToExtension));
    await handler.handleTool('scrape', { url: 'https://www.example.com' }, extra);

    expect(sendNotification).not.toHaveBeenCalled();
  });
});

function makePingBridge(sessionRef: {
  info: { deviceId: string; browser: string; extensionVersion: string } | null;
}): BridgeServer {
  return {
    isDraining: () => false,
    bridgePort: 13808,
    sessionManager: {
      hasConnectedExtension: () => sessionRef.info !== null,
      sessionCount: sessionRef.info ? 1 : 0,
      getSessionInfo: () => sessionRef.info,
      getTotalPendingBridgeRequests: () => 0,
    },
    sendToExtension: vi.fn(),
  } as unknown as BridgeServer;
}

function mockBrowserEnv(partial: Partial<BrowserEnv>): BrowserEnv {
  return {
    detectChromeInstall: async () => null,
    detectEdgeInstall: async () => null,
    isBrowserRunning: async () => false,
    launchBrowser: vi.fn(() => 4242),
    quitLaunchedBrowser: vi.fn().mockResolvedValue(undefined),
    ...partial,
  };
}

describe('ToolHandler handlePing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns bridgeOk when extension session already exists', async () => {
    const sessionRef = {
      info: { deviceId: 'd', browser: 'chrome', extensionVersion: '1.0.0' },
    };
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({}),
    });
    const out = await handler.handlePing({ lang: 'en-US' });
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.ok).toBe(true);
    expect(body.bridgeOk).toBe(true);
    expect(body.browser).toBe('chrome');
    expect(body.extensionVersion).toBe('1.0.0');
  });

  it('returns BROWSER_NOT_INSTALLED when Chrome and Edge are not detected', async () => {
    const sessionRef = { info: null as { deviceId: string; browser: string; extensionVersion: string } | null };
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({
        detectChromeInstall: async () => null,
        detectEdgeInstall: async () => null,
      }),
    });
    const out = await handler.handlePing({});
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('BROWSER_NOT_INSTALLED');
  });

  it('returns EXTENSION_NOT_CONNECTED with browserProbe when browser running but no session', async () => {
    vi.useFakeTimers();
    const sessionRef = { info: null as { deviceId: string; browser: string; extensionVersion: string } | null };
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({
        detectChromeInstall: async () => '/fake/chrome',
        detectEdgeInstall: async () => null,
        isBrowserRunning: async () => true,
      }),
    });
    const promise = handler.handlePing({ lang: 'en-US', postLaunchWaitMs: 3000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    const out = await promise;
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('EXTENSION_NOT_CONNECTED');
    expect(body.error.details.browserProbe).toMatchObject({
      selectedBrowser: 'chrome',
      browserRunning: true,
      waitedMs: 3000,
    });
  });

  it('succeeds when browser already running and session appears during wait', async () => {
    vi.useFakeTimers();
    const sessionRef = { info: null as { deviceId: string; browser: string; extensionVersion: string } | null };
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({
        detectChromeInstall: async () => '/fake/chrome',
        detectEdgeInstall: async () => null,
        isBrowserRunning: async () => true,
      }),
    });
    const promise = handler.handlePing({ postLaunchWaitMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    sessionRef.info = { deviceId: 'd', browser: 'chrome', extensionVersion: '2.0.0' };
    await vi.advanceTimersByTimeAsync(400);
    const out = await promise;
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.ok).toBe(true);
    expect(body.diagnostics?.launched).toBe(false);
    expect(body.diagnostics?.selectedBrowser).toBe('chrome');
    expect(body.diagnostics?.waitedMs).toBeGreaterThanOrEqual(0);
  });

  it('launches browser, waits, and succeeds when session appears', async () => {
    vi.useFakeTimers();
    const sessionRef = { info: null as { deviceId: string; browser: string; extensionVersion: string } | null };
    const launchBrowser = vi.fn(() => 9001);
    const quitLaunchedBrowser = vi.fn().mockResolvedValue(undefined);
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({
        detectChromeInstall: async () => '/fake/chrome',
        detectEdgeInstall: async () => null,
        isBrowserRunning: async () => false,
        launchBrowser,
        quitLaunchedBrowser,
      }),
    });

    const promise = handler.handlePing({ postLaunchWaitMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(launchBrowser).toHaveBeenCalledWith('/fake/chrome', 'chrome');

    sessionRef.info = { deviceId: 'd', browser: 'chrome', extensionVersion: '2.0.0' };
    await vi.advanceTimersByTimeAsync(500);
    const out = await promise;
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.ok).toBe(true);
    expect(body.diagnostics?.launched).toBe(true);
    expect(body.diagnostics?.waitedMs).toBeGreaterThanOrEqual(0);
    expect(quitLaunchedBrowser).not.toHaveBeenCalled();
  });

  it('quits Chrome after failed launch then launches Edge and succeeds', async () => {
    vi.useFakeTimers();
    const sessionRef = { info: null as { deviceId: string; browser: string; extensionVersion: string } | null };
    const launchBrowser = vi.fn().mockReturnValueOnce(111).mockReturnValueOnce(222);
    const quitLaunchedBrowser = vi.fn().mockResolvedValue(undefined);
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({
        detectChromeInstall: async () => '/fake/chrome',
        detectEdgeInstall: async () => '/fake/edge',
        isBrowserRunning: async () => false,
        launchBrowser,
        quitLaunchedBrowser,
      }),
    });

    const promise = handler.handlePing({ postLaunchWaitMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(launchBrowser).toHaveBeenNthCalledWith(1, '/fake/chrome', 'chrome');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(quitLaunchedBrowser).toHaveBeenCalledWith(111);
    expect(launchBrowser).toHaveBeenNthCalledWith(2, '/fake/edge', 'edge');

    sessionRef.info = { deviceId: 'd', browser: 'edge', extensionVersion: '2.0.0' };
    await vi.advanceTimersByTimeAsync(500);
    const out = await promise;
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.ok).toBe(true);
    expect(body.browser).toBe('edge');
    expect(body.diagnostics?.selectedBrowser).toBe('edge');
    expect(body.diagnostics?.launched).toBe(true);
    expect(quitLaunchedBrowser).toHaveBeenCalledTimes(1);
  });

  it('quits both browsers when Chrome and Edge launches both fail to register', async () => {
    vi.useFakeTimers();
    const sessionRef = { info: null as { deviceId: string; browser: string; extensionVersion: string } | null };
    const launchBrowser = vi.fn().mockReturnValueOnce(11).mockReturnValueOnce(22);
    const quitLaunchedBrowser = vi.fn().mockResolvedValue(undefined);
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({
        detectChromeInstall: async () => '/fake/chrome',
        detectEdgeInstall: async () => '/fake/edge',
        isBrowserRunning: async () => false,
        launchBrowser,
        quitLaunchedBrowser,
      }),
    });

    const promise = handler.handlePing({ postLaunchWaitMs: 3000 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    const out = await promise;
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('EXTENSION_NOT_CONNECTED');
    expect(body.error.details.browserProbe?.selectedBrowser).toBe('edge');
    expect(quitLaunchedBrowser).toHaveBeenNthCalledWith(1, 11);
    expect(quitLaunchedBrowser).toHaveBeenNthCalledWith(2, 22);
    expect(launchBrowser).toHaveBeenCalledTimes(2);
  });

  it('skips running Chrome without quit and launches Edge when session appears', async () => {
    vi.useFakeTimers();
    const sessionRef = { info: null as { deviceId: string; browser: string; extensionVersion: string } | null };
    const launchBrowser = vi.fn(() => 333);
    const quitLaunchedBrowser = vi.fn().mockResolvedValue(undefined);
    const isBrowserRunning = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({
        detectChromeInstall: async () => '/fake/chrome',
        detectEdgeInstall: async () => '/fake/edge',
        isBrowserRunning,
        launchBrowser,
        quitLaunchedBrowser,
      }),
    });

    const promise = handler.handlePing({ postLaunchWaitMs: 10_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(isBrowserRunning).toHaveBeenNthCalledWith(1, 'chrome');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(isBrowserRunning).toHaveBeenNthCalledWith(2, 'edge');
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(launchBrowser).toHaveBeenCalledWith('/fake/edge', 'edge');

    sessionRef.info = { deviceId: 'd', browser: 'edge', extensionVersion: '2.0.0' };
    await vi.advanceTimersByTimeAsync(400);
    const out = await promise;
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.ok).toBe(true);
    expect(quitLaunchedBrowser).not.toHaveBeenCalled();
    expect(launchBrowser).toHaveBeenCalledTimes(1);
  });

  it('does not launch when autoLaunchBrowser is false', async () => {
    const sessionRef = { info: null as { deviceId: string; browser: string; extensionVersion: string } | null };
    const launchBrowser = vi.fn();
    const quitLaunchedBrowser = vi.fn().mockResolvedValue(undefined);
    const handler = new ToolHandler(makePingBridge(sessionRef), {
      browserEnv: mockBrowserEnv({
        detectChromeInstall: async () => '/fake/chrome',
        detectEdgeInstall: async () => null,
        isBrowserRunning: async () => false,
        launchBrowser,
        quitLaunchedBrowser,
      }),
    });
    const out = await handler.handlePing({ autoLaunchBrowser: false });
    expect(launchBrowser).not.toHaveBeenCalled();
    expect(quitLaunchedBrowser).not.toHaveBeenCalled();
    const body = JSON.parse(out.content[0].type === 'text' ? out.content[0].text : '{}');
    expect(body.error.details.browserProbe).toMatchObject({
      autoLaunchBrowser: false,
      browserRunning: false,
      selectedBrowser: 'chrome',
    });
  });

});

describe('ToolHandler i18n errors', () => {
  it('returns Chinese EXTENSION_NOT_CONNECTED when lang is zh-CN', async () => {
    const bridge = {
      isDraining: () => false,
      bridgePort: 13808,
      sessionManager: {
        hasConnectedExtension: () => false,
        sessionCount: 0,
        getSessionInfo: () => null,
        getTotalPendingBridgeRequests: () => 0,
      },
      sendToExtension: vi.fn(),
    } as unknown as BridgeServer;

    const handler = new ToolHandler(bridge);
    const out = await handler.handleTool('scrape', { url: 'https://x.com', lang: 'zh-CN' });
    const text = out.content[0]?.type === 'text' ? out.content[0].text : '';
    const body = JSON.parse(text);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('EXTENSION_NOT_CONNECTED');
    expect(body.error.message).toContain('未连接');
  });

  it('returns Chinese truncation fallback message when lang is zh-CN', async () => {
    const huge = 'x'.repeat(Math.floor(2.5 * 1024 * 1024));
    const sendToExtension = vi.fn().mockResolvedValue({ ok: true, blob: huge });
    const handler = new ToolHandler(makeBridgeMock(sendToExtension));

    const out = await handler.handleTool('scrape', {
      url: 'https://www.example.com',
      lang: 'zh-CN',
    });
    const text = out.content[0]?.type === 'text' ? out.content[0].text : '';
    const body = JSON.parse(text);
    expect(body.truncated).toBe(true);
    expect(body.message).toContain('截断');
  });
});
