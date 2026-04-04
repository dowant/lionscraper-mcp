import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/bridge/session.js';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';

function createMockWs(readyState: number = 1): WebSocket {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    readyState,
    send: () => {},
    close: () => {},
    ping: () => {},
  }) as unknown as WebSocket;
}

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('should register a session', () => {
    const ws = createMockWs();
    const session = manager.register('device-1', 'chrome', '2.0.8', ['scrape'], ws);

    expect(session.deviceId).toBe('device-1');
    expect(session.browser).toBe('chrome');
    expect(session.extensionVersion).toBe('2.0.8');
    expect(manager.sessionCount).toBe(1);
  });

  it('should return active session', () => {
    const ws = createMockWs(1);
    manager.register('device-1', 'chrome', '2.0.8', ['scrape'], ws);

    const active = manager.getActiveSession();
    expect(active).not.toBeNull();
    expect(active!.deviceId).toBe('device-1');
  });

  it('should return null when no sessions', () => {
    expect(manager.getActiveSession()).toBeNull();
    expect(manager.hasConnectedExtension()).toBe(false);
  });

  it('should return null for closed sessions', () => {
    const ws = createMockWs(3); // CLOSED
    manager.register('device-1', 'chrome', '2.0.8', ['scrape'], ws);

    expect(manager.getActiveSession()).toBeNull();
  });

  it('should remove a session', () => {
    const ws = createMockWs();
    manager.register('device-1', 'chrome', '2.0.8', ['scrape'], ws);
    expect(manager.sessionCount).toBe(1);

    manager.remove('device-1');
    expect(manager.sessionCount).toBe(0);
  });

  it('should remove session by ws reference', () => {
    const ws = createMockWs();
    manager.register('device-1', 'chrome', '2.0.8', ['scrape'], ws);

    manager.removeByWs(ws);
    expect(manager.sessionCount).toBe(0);
  });

  it('should replace existing session for same device', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    manager.register('device-1', 'chrome', '2.0.8', ['scrape'], ws1);
    manager.register('device-1', 'chrome', '2.0.9', ['scrape'], ws2);

    expect(manager.sessionCount).toBe(1);
    const session = manager.getActiveSession();
    expect(session!.extensionVersion).toBe('2.0.9');
  });

  it('should return session info', () => {
    const ws = createMockWs();
    manager.register('device-1', 'edge', '2.0.8', ['scrape'], ws);

    const info = manager.getSessionInfo();
    expect(info).toEqual({
      deviceId: 'device-1',
      browser: 'edge',
      extensionVersion: '2.0.8',
    });
  });

  it('should clear all sessions', () => {
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    manager.register('device-1', 'chrome', '2.0.8', ['scrape'], ws1);
    manager.register('device-2', 'edge', '2.0.8', ['scrape'], ws2);
    expect(manager.sessionCount).toBe(2);

    manager.clear();
    expect(manager.sessionCount).toBe(0);
  });

  it('should sum pending bridge requests across sessions', () => {
    const ws = createMockWs();
    const session = manager.register('device-1', 'chrome', '2.0.8', ['scrape'], ws);

    void session.pendingRequests.add('req-a', 'scrape', 60_000).catch(() => {});
    void session.pendingRequests.add('req-b', 'scrape_emails', 60_000).catch(() => {});

    expect(manager.getTotalPendingBridgeRequests()).toBe(2);

    manager.clear();
  });
});
