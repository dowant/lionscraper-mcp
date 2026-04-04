import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import { BridgeServer } from '../src/bridge/websocket.js';

const TEST_PORT = 18800;

/** Parsed JSON-RPC frame shape used in these integration tests. */
interface JsonRpcTestResponse {
  result?: unknown;
  error?: {
    message?: string;
    data?: { lionscraperCode?: string };
  };
}

describe('BridgeServer', () => {
  let server: BridgeServer;

  beforeEach(async () => {
    server = new BridgeServer();
    await server.start(TEST_PORT);
  });

  afterEach(async () => {
    await server.stop();
  });

  function connectWs(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${TEST_PORT}`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  function sendAndReceive(ws: WebSocket, msg: object): Promise<JsonRpcTestResponse> {
    return new Promise((resolve) => {
      ws.once('message', (data) => {
        resolve(JSON.parse(data.toString()) as JsonRpcTestResponse);
      });
      ws.send(JSON.stringify(msg));
    });
  }

  it('should accept WebSocket connections', async () => {
    const ws = await connectWs();
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('should handle register flow', async () => {
    const ws = await connectWs();

    const regResponse = await sendAndReceive(ws, {
      jsonrpc: '2.0',
      id: 'reg-1',
      method: 'register',
      params: {
        protocolVersion: 1,
        browser: 'chrome',
        extensionVersion: '2.0.8',
        deviceId: 'test-device',
        capabilities: ['scrape', 'scrape_article'],
      },
    });

    expect(regResponse.result).toEqual({ ok: true });
    expect(server.sessionManager.hasConnectedExtension()).toBe(true);
    ws.close();
  });

  it('should reject register with wrong protocol version', async () => {
    const ws = await connectWs();

    const response = await sendAndReceive(ws, {
      jsonrpc: '2.0',
      id: 'reg-1',
      method: 'register',
      params: {
        protocolVersion: 999,
        browser: 'chrome',
        extensionVersion: '2.0.8',
        deviceId: 'test-device',
        capabilities: [],
      },
    });

    expect(response.error).toBeDefined();
    expect(response.error?.data?.lionscraperCode).toBe('BRIDGE_VERSION_MISMATCH');
    ws.close();
  });

  it('should respond to ping after registration', async () => {
    const ws = await connectWs();

    await sendAndReceive(ws, {
      jsonrpc: '2.0',
      id: 'reg-1',
      method: 'register',
      params: {
        protocolVersion: 1,
        browser: 'chrome',
        extensionVersion: '2.0.8',
        deviceId: 'test-device',
        capabilities: [],
      },
    });

    const pingResponse = await sendAndReceive(ws, {
      jsonrpc: '2.0',
      id: 'ping-1',
      method: 'ping',
    });

    expect(pingResponse.result).toEqual({ pong: true });
    ws.close();
  });

  it('should forward bridge requests to extension and receive responses', async () => {
    const ws = await connectWs();

    await sendAndReceive(ws, {
      jsonrpc: '2.0',
      id: 'reg-1',
      method: 'register',
      params: {
        protocolVersion: 1,
        browser: 'chrome',
        extensionVersion: '2.0.8',
        deviceId: 'test-device',
        capabilities: ['scrape'],
      },
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'scrape') {
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: { ok: true, data: [{ title: 'Test' }] },
        }));
      }
    });

    const result = await server.sendToExtension('scrape', { url: 'https://example.com' }, 5000);
    expect(result).toEqual({ ok: true, data: [{ title: 'Test' }] });
    ws.close();
  });

  it('should clean up session on disconnect', async () => {
    const ws = await connectWs();

    await sendAndReceive(ws, {
      jsonrpc: '2.0',
      id: 'reg-1',
      method: 'register',
      params: {
        protocolVersion: 1,
        browser: 'chrome',
        extensionVersion: '2.0.8',
        deviceId: 'test-device',
        capabilities: [],
      },
    });

    expect(server.sessionManager.hasConnectedExtension()).toBe(true);

    ws.close();

    await new Promise((r) => setTimeout(r, 100));
    expect(server.sessionManager.sessionCount).toBe(0);
  });
});
