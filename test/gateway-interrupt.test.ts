import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Gateway } from '../src/gateway.js';
import { metrics } from '../src/metrics/collector.js';
import { MetricsStore } from '../src/metrics/store.js';

describe('Gateway interruptAgentRun', () => {
  let tmpDir: string;
  let store: MetricsStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gateway-interrupt-'));
    store = new MetricsStore(join(tmpDir, 'metrics.sqlite'));
    metrics._reset();
    metrics.setStore(store);
  });

  afterEach(() => {
    metrics._reset();
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('interrupts by run id through the SDK control registry and records the result', async () => {
    const gw = new Gateway();
    (gw as any).agents.set('agent', {});
    metrics.recordAgentRunStart({
      runId: 'run-1',
      agentId: 'agent',
      sessionKey: 'web:agent:session-1',
      sdkSessionId: 'session-1',
      source: 'web',
      channel: 'web',
      status: 'running',
    });

    const interrupt = vi.fn(async () => {});
    const abort = new AbortController();
    const abortSpy = vi.spyOn(abort, 'abort');
    gw._controlRegistry.register(['run-1', 'web:agent:session-1', 'session-1'], { interrupt, close: vi.fn() } as any, abort);

    const result = await gw.interruptAgentRun('agent', 'run-1', 'web');

    expect(result).toMatchObject({
      targetId: 'run-1',
      runId: 'run-1',
      sessionKey: 'web:agent:session-1',
      sdkSessionId: 'session-1',
      interrupted: true,
    });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(metrics.listInterrupts({ runId: 'run-1' })).toMatchObject([{
      agentId: 'agent',
      runId: 'run-1',
      targetId: 'run-1',
      requestedBy: 'web',
      result: 'interrupted',
    }]);
  });

  it('records a failed interrupt without an active control handle', async () => {
    const gw = new Gateway();
    (gw as any).agents.set('agent', {});

    const result = await gw.interruptAgentRun('agent', 'missing-run', 'web');

    expect(result).toMatchObject({
      targetId: 'missing-run',
      interrupted: false,
    });
    expect(metrics.listInterrupts({ targetId: 'missing-run' })).toMatchObject([{
      agentId: 'agent',
      targetId: 'missing-run',
      requestedBy: 'web',
      result: 'failed',
    }]);
  });
});
