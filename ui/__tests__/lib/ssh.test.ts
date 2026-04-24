import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { FleetServer } from '@/lib/fleet';

/* ------------------------------------------------------------------ */
/*  Mock ssh2 Client                                                   */
/* ------------------------------------------------------------------ */

const mockExec = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();

vi.mock('ssh2', () => {
  class MockClient {
    on = mockOn;
    exec = mockExec;
    connect = mockConnect;
    end = mockEnd;
  }
  return { Client: MockClient };
});

import { sshExec, sshTestConnection } from '@/lib/ssh';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeServer(ssh?: FleetServer['ssh']): FleetServer {
  return {
    id: 'test-ssh',
    name: 'Test SSH Server',
    environment: 'production',
    region: 'eu-west',
    tags: [],
    url: 'https://test.example.com',
    apiKey: 'key-123',
    ssh,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sshExec', () => {
  it('rejects when server has no SSH config', async () => {
    const server = makeServer(undefined);

    await expect(sshExec(server, 'whoami')).rejects.toThrow(
      'No SSH config for server test-ssh',
    );
  });

  it('resolves with stdout/stderr/code on success', async () => {
    const server = makeServer({
      host: '10.0.0.1',
      port: 22,
      user: 'deploy',
      keyEncrypted: 'fake-key',
    });

    // Simulate: on('ready') → exec → stream events
    mockOn.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'ready') {
        // Trigger ready callback in next microtask
        Promise.resolve().then(() => callback());
      }
    });

    mockExec.mockImplementation(
      (_cmd: string, cb: (err: Error | null, stream: unknown) => void) => {
        const stderrHandlers: Array<(d: Buffer) => void> = [];
        const streamHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

        const stream = {
          on(event: string, handler: (...args: unknown[]) => void) {
            streamHandlers[event] = streamHandlers[event] ?? [];
            streamHandlers[event].push(handler);
            return stream;
          },
          stderr: {
            on(_event: string, handler: (d: Buffer) => void) {
              stderrHandlers.push(handler);
            },
          },
        };

        cb(null, stream);

        // Simulate data
        Promise.resolve().then(() => {
          for (const h of streamHandlers['data'] ?? []) {
            h(Buffer.from('hello\n'));
          }
          for (const h of stderrHandlers) {
            h(Buffer.from(''));
          }
          for (const h of streamHandlers['close'] ?? []) {
            h(0);
          }
        });
      },
    );

    const result = await sshExec(server, 'echo hello');

    expect(result.stdout).toBe('hello\n');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);

    // Verify connect was called with correct params
    expect(mockConnect).toHaveBeenCalledWith({
      host: '10.0.0.1',
      port: 22,
      username: 'deploy',
      privateKey: 'fake-key',
    });

    // Verify connection was closed
    expect(mockEnd).toHaveBeenCalled();
  });

  it('rejects when exec returns error', async () => {
    const server = makeServer({
      host: '10.0.0.1',
      port: 22,
      user: 'deploy',
    });

    mockOn.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'ready') {
        Promise.resolve().then(() => callback());
      }
    });

    mockExec.mockImplementation(
      (_cmd: string, cb: (err: Error | null) => void) => {
        cb(new Error('exec failed'));
      },
    );

    await expect(sshExec(server, 'bad-cmd')).rejects.toThrow('exec failed');
    expect(mockEnd).toHaveBeenCalled();
  });

  it('rejects when connection fails', async () => {
    const server = makeServer({
      host: 'unreachable.example.com',
      port: 22,
      user: 'deploy',
    });

    mockOn.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'error') {
        Promise.resolve().then(() => callback(new Error('Connection refused')));
      }
    });

    await expect(sshExec(server, 'whoami')).rejects.toThrow(
      'Connection refused',
    );
  });
});

describe('sshTestConnection', () => {
  it('returns { success, info?, error? } structure', async () => {
    // Simulate connection error
    mockOn.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'error') {
        Promise.resolve().then(() => callback(new Error('ECONNREFUSED')));
      }
    });

    const result = await sshTestConnection({
      host: '127.0.0.1',
      port: 22,
      user: 'test',
      password: 'test',
    });

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('error');
    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('returns success with system info on valid connection', async () => {
    mockOn.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
      if (event === 'ready') {
        Promise.resolve().then(() => callback());
      }
    });

    mockExec.mockImplementation(
      (_cmd: string, cb: (err: Error | null, stream: unknown) => void) => {
        const streamHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};

        const stream = {
          on(event: string, handler: (...args: unknown[]) => void) {
            streamHandlers[event] = streamHandlers[event] ?? [];
            streamHandlers[event].push(handler);
            return stream;
          },
          stderr: {
            on() { /* noop */ },
          },
        };

        cb(null, stream);

        Promise.resolve().then(() => {
          for (const h of streamHandlers['data'] ?? []) {
            h(Buffer.from('Linux box 5.15.0 x86_64\n4\n'));
          }
          for (const h of streamHandlers['close'] ?? []) {
            h(0);
          }
        });
      },
    );

    const result = await sshTestConnection({
      host: '10.0.0.5',
      port: 22,
      user: 'admin',
      key: 'fake-key',
    });

    expect(result.success).toBe(true);
    expect(result.info).toContain('Linux');
  });
});
