import { WebSocket } from 'ws';
import { PendingRequestManager, type DisconnectRejectId } from './protocol.js';
import { logger } from '../utils/logger.js';

export interface Session {
  deviceId: string;
  browser: string;
  extensionVersion: string;
  capabilities: string[];
  ws: WebSocket;
  registeredAt: number;
  pendingRequests: PendingRequestManager;
}

/**
 * Tracks extension WebSocket sessions keyed by `deviceId`.
 * Tool calls use {@link SessionManager.getActiveSession}: only one extension is expected to be connected at a time;
 * if multiple devices register, the first map iteration order with an open socket wins (undefined for multi-device routing).
 */
export class SessionManager {
  private sessions = new Map<string, Session>();

  register(
    deviceId: string,
    browser: string,
    extensionVersion: string,
    capabilities: string[],
    ws: WebSocket,
  ): Session {
    const existing = this.sessions.get(deviceId);
    if (existing) {
      logger.info(`Replacing existing session for device: ${deviceId}`);
      this.cleanupSession(existing, 'disconnect.replaced');
    }

    const session: Session = {
      deviceId,
      browser,
      extensionVersion,
      capabilities,
      ws,
      registeredAt: Date.now(),
      pendingRequests: new PendingRequestManager(),
    };

    this.sessions.set(deviceId, session);
    logger.info(`Session registered: ${deviceId} (${browser} ${extensionVersion})`);
    return session;
  }

  remove(deviceId: string): void {
    const session = this.sessions.get(deviceId);
    if (session) {
      this.cleanupSession(session, 'disconnect.extension_gone');
      this.sessions.delete(deviceId);
      logger.info(`Session removed: ${deviceId}`);
    }
  }

  removeByWs(ws: WebSocket): void {
    for (const [deviceId, session] of this.sessions) {
      if (session.ws === ws) {
        this.remove(deviceId);
        return;
      }
    }
  }

  /** First registered session whose socket is open; see class note on single-extension expectation. */
  getActiveSession(): Session | null {
    for (const session of this.sessions.values()) {
      if (session.ws.readyState === WebSocket.OPEN) {
        return session;
      }
    }
    return null;
  }

  getSessionByDeviceId(deviceId: string): Session | null {
    return this.sessions.get(deviceId) ?? null;
  }

  hasConnectedExtension(): boolean {
    return this.getActiveSession() !== null;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Sum of pending Extension bridge requests across all sessions (in-flight tools). */
  getTotalPendingBridgeRequests(): number {
    let n = 0;
    for (const session of this.sessions.values()) {
      n += session.pendingRequests.size;
    }
    return n;
  }

  getSessionInfo(): { deviceId: string; browser: string; extensionVersion: string } | null {
    const session = this.getActiveSession();
    if (!session) return null;
    return {
      deviceId: session.deviceId,
      browser: session.browser,
      extensionVersion: session.extensionVersion,
    };
  }

  private cleanupSession(session: Session, disconnectReason: DisconnectRejectId): void {
    session.pendingRequests.rejectAllDisconnected(disconnectReason);
  }

  clear(): void {
    for (const session of this.sessions.values()) {
      this.cleanupSession(session, 'disconnect.server_shutdown');
    }
    this.sessions.clear();
  }
}
