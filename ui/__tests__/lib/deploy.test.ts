import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { DeployConfig, DeployEvent } from '@/lib/deploy';

/* ------------------------------------------------------------------ */
/*  Mock ssh2                                                          */
/* ------------------------------------------------------------------ */

let execCallback: ((cmd: string, cb: (err: Error | null, stream: unknown) => void) => void) | null = null;

vi.mock('ssh2', () => {
  class MockClient {
    on(event: string, callback: (...args: unknown[]) => void) {
      if (event === 'ready') {
        Promise.resolve().then(() => callback());
      }
      return this;
    }

    exec(cmd: string, cb: (err: Error | null, stream: unknown) => void) {
      if (execCallback) {
        execCallback(cmd, cb);
      }
    }

    connect() { /* noop */ }
    end() { /* noop */ }
  }

  return { Client: MockClient };
});

import { deployGateway } from '@/lib/deploy';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeConfig(overrides?: Partial<DeployConfig>): DeployConfig {
  return {
    identity: {
      name: 'test-gw',
      environment: 'staging',
      region: 'us-east',
      city: 'NYC',
      tags: ['test'],
    },
    target: {
      type: 'ssh',
      host: '10.0.0.99',
      port: 22,
      user: 'deploy',
      authMethod: 'key',
      sshKey: 'fake-private-key',
    },
    networking: {
      httpPort: 3000,
      webhookMode: 'longpoll',
    },
    release: {
      version: 'v1.0.0',
      repo: 'https://github.com/example/anthroclaw.git',
      upgradePolicy: 'manual',
    },
    agents: {
      source: 'blank',
    },
    policies: {
      backup: null,
      monitoring: true,
      logRetention: '30d',
      maxMediaGB: 10,
    },
    ...overrides,
  };
}

/** Simulate successful SSH command execution */
function simulateSuccess() {
  execCallback = (_cmd, cb) => {
    const streamHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const stream = {
      on(event: string, handler: (...args: unknown[]) => void) {
        streamHandlers[event] = streamHandlers[event] ?? [];
        streamHandlers[event].push(handler);
        return stream;
      },
      stderr: { on() { /* noop */ } },
    };
    cb(null, stream);
    Promise.resolve().then(() => {
      for (const h of streamHandlers['data'] ?? []) h(Buffer.from('ok\n'));
      for (const h of streamHandlers['close'] ?? []) h(0);
    });
  };
}

/** Simulate SSH command failure at a specific step */
function simulateFailureAtStep(failStep: number) {
  let callCount = 0;

  execCallback = (_cmd, cb) => {
    const currentCall = callCount++;
    const streamHandlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    const stream = {
      on(event: string, handler: (...args: unknown[]) => void) {
        streamHandlers[event] = streamHandlers[event] ?? [];
        streamHandlers[event].push(handler);
        return stream;
      },
      stderr: {
        on(event: string, handler: (d: Buffer) => void) {
          if (event === 'data' && currentCall === failStep) {
            Promise.resolve().then(() => handler(Buffer.from('command failed')));
          }
        },
      },
    };

    cb(null, stream);

    Promise.resolve().then(() => {
      if (currentCall === failStep) {
        // Fail with non-zero exit code
        for (const h of streamHandlers['close'] ?? []) h(1);
      } else {
        for (const h of streamHandlers['data'] ?? []) h(Buffer.from('ok\n'));
        for (const h of streamHandlers['close'] ?? []) h(0);
      }
    });
  };
}

/** Collect all events from the async generator */
async function collectEvents(
  gen: AsyncGenerator<DeployEvent>,
): Promise<DeployEvent[]> {
  const events: DeployEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  execCallback = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deployGateway', () => {
  it('yields correct step sequence on success', async () => {
    simulateSuccess();

    const config = makeConfig();
    const events = await collectEvents(deployGateway(config));

    // 8 steps × 2 (running + done) = 16 step events + 1 done event = 17
    const stepEvents = events.filter((e) => e.type === 'step');
    const doneEvents = events.filter((e) => e.type === 'done');
    const errorEvents = events.filter((e) => e.type === 'error');

    expect(errorEvents).toHaveLength(0);
    expect(doneEvents).toHaveLength(1);

    // 8 steps, each with running + done = 16
    expect(stepEvents).toHaveLength(16);

    // Verify step ordering: running/done alternation
    for (let i = 0; i < 8; i++) {
      const running = stepEvents[i * 2];
      const done = stepEvents[i * 2 + 1];

      expect(running.type).toBe('step');
      if (running.type === 'step') {
        expect(running.index).toBe(i + 1);
        expect(running.total).toBe(8);
        expect(running.status).toBe('running');
      }

      expect(done.type).toBe('step');
      if (done.type === 'step') {
        expect(done.index).toBe(i + 1);
        expect(done.status).toBe('done');
        expect(done.elapsed).toBeDefined();
        expect(typeof done.elapsed).toBe('number');
      }
    }

    // Verify step labels
    const labels = stepEvents
      .filter((e) => e.type === 'step' && e.status === 'running')
      .map((e) => (e as Extract<DeployEvent, { type: 'step' }>).label);

    expect(labels).toEqual([
      'Connecting via SSH',
      'Installing Node.js 22',
      'Installing pnpm',
      'Cloning repository',
      'Installing dependencies',
      'Configuring environment',
      'Setting up systemd + reverse proxy',
      'Starting and verifying health',
    ]);
  });

  it('yields done with correct URL (host:port when no domain)', async () => {
    simulateSuccess();

    const config = makeConfig();
    const events = await collectEvents(deployGateway(config));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.url).toBe('http://10.0.0.99:3000');
      expect(done.credentials.email).toBe('admin@anthroclaw.local');
      expect(done.credentials.note).toContain('.env');
    }
  });

  it('yields done with https URL when domain is provided', async () => {
    simulateSuccess();

    const config = makeConfig({
      networking: {
        domain: 'gw.example.com',
        httpPort: 3000,
        webhookMode: 'webhook',
      },
    });
    const events = await collectEvents(deployGateway(config));
    const done = events.find((e) => e.type === 'done');

    expect(done).toBeDefined();
    if (done?.type === 'done') {
      expect(done.url).toBe('https://gw.example.com');
    }
  });

  it('yields error on failed step and stops execution', async () => {
    // Fail on step 0 (first SSH exec call = SSH connect test)
    simulateFailureAtStep(0);

    const config = makeConfig();
    const events = await collectEvents(deployGateway(config));

    // Should have: step 1 running, step 1 error, then error event
    const stepEvents = events.filter((e) => e.type === 'step');
    const errorEvents = events.filter((e) => e.type === 'error');
    const doneEvents = events.filter((e) => e.type === 'done');

    expect(doneEvents).toHaveLength(0); // No done — failed
    expect(errorEvents).toHaveLength(1);

    if (errorEvents[0]?.type === 'error') {
      expect(errorEvents[0].step).toBe(1);
      expect(errorEvents[0].message).toBeDefined();
    }

    // Should have running + error for step 1 only
    expect(stepEvents.length).toBeLessThanOrEqual(2);

    const runningStep = stepEvents.find(
      (e) => e.type === 'step' && e.status === 'running',
    );
    expect(runningStep).toBeDefined();
    if (runningStep?.type === 'step') {
      expect(runningStep.index).toBe(1);
    }
  });

  it('yields error with message from the failed command', async () => {
    simulateFailureAtStep(0);

    const config = makeConfig();
    const events = await collectEvents(deployGateway(config));

    const errorStep = events.find(
      (e) => e.type === 'step' && e.status === 'error',
    );
    expect(errorStep).toBeDefined();
    if (errorStep?.type === 'step') {
      expect(errorStep.message).toBeDefined();
      expect(typeof errorStep.message).toBe('string');
    }
  });
});
