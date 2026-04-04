import http from 'node:http';
import net from 'node:net';
import { describe, it, expect, afterEach } from 'vitest';
import { BridgeService } from '../src/core/bridge-service.js';
import { attachDaemonApi } from '../src/daemon/http-api.js';
import { canBindPort, probePort } from '../src/utils/port.js';

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('no port')));
        return;
      }
      const p = addr.port;
      server.close(() => resolve(p));
    });
  });
}

describe('daemon HTTP API + WebSocket on one server', () => {
  const originalPort = process.env.PORT;

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = originalPort;
    }
  });

  it('WebSocket probe reaches the bridge (GET / must not 404 the upgrade)', async () => {
    const port = await reserveLoopbackPort();
    process.env.PORT = String(port);

    const httpServer = http.createServer();
    const service = new BridgeService({
      onAfterBridgeDrain: () => {},
    });
    attachDaemonApi(service, httpServer);

    await service.startSharedHttpServer(httpServer);

    try {
      const r = await probePort(port, 'status');
      expect(r?.identity).toBe('lionscraper');

      const healthRes = await fetch(`http://127.0.0.1:${port}/v1/health`);
      expect(healthRes.ok).toBe(true);
      const health = (await healthRes.json()) as {
        ok: boolean;
        identity?: string;
        bridgePort: number;
      };
      expect(health.ok).toBe(true);
      expect(health.identity).toBe('lionscraper');
      expect(health.bridgePort).toBe(port);
    } finally {
      await service.stop();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('POST /v1/daemon/shutdown stops the listener (loopback HTTP shutdown path)', async () => {
    const port = await reserveLoopbackPort();
    process.env.PORT = String(port);

    const httpServer = http.createServer();
    const service = new BridgeService({
      onAfterBridgeDrain: () => {
        httpServer.close(() => {});
      },
    });
    attachDaemonApi(service, httpServer);
    await service.startSharedHttpServer(httpServer);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/daemon/shutdown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { ok?: boolean };
      expect(body.ok).toBe(true);

      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (await canBindPort(port)) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(await canBindPort(port)).toBe(true);
    } finally {
      await service.stop().catch(() => {});
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }
  });
});
