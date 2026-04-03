import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'node:net';
import { canBindPort } from '../src/utils/port.js';
import { acquirePort, DEFAULT_PORT, getConfiguredPort } from '../src/utils/port.js';

describe('canBindPort', () => {
  it('returns true when the port is free', async () => {
    await expect(canBindPort(45_678)).resolves.toBe(true);
  });

  it('returns false when the port is already bound', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => {
      server.listen(45_679, '127.0.0.1', () => resolve());
    });

    try {
      await expect(canBindPort(45_679)).resolves.toBe(false);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('getConfiguredPort', () => {
  const original = process.env.PORT;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = original;
    }
  });

  it('returns DEFAULT_PORT when env is unset', () => {
    delete process.env.PORT;
    expect(getConfiguredPort()).toBe(DEFAULT_PORT);
  });

  it('returns parsed PORT when set', () => {
    process.env.PORT = '20000';
    expect(getConfiguredPort()).toBe(20_000);
  });
});

describe('acquirePort', () => {
  const original = process.env.PORT;

  beforeEach(() => {
    delete process.env.PORT;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = original;
    }
  });

  it('returns the configured port when it can be bound', async () => {
    const port = await acquirePort(45_680);
    expect(port).toBe(45_680);
  });

  // Note: acquirePort() when the port is held by a non-WebSocket process is covered by manual
  // testing; automated tests would need a mock WS or risk long takeover timeouts if the probe
  // mis-identifies the listener.
});
