import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Gateway } from '../src/gateway.js';
import { metrics } from '../src/metrics/collector.js';
import { MetricsStore } from '../src/metrics/store.js';

describe('Gateway session mailbox filters', () => {
  let tmpDir: string;
  let store: MetricsStore;
  let gw: Gateway;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gateway-mailbox-'));
    store = new MetricsStore(join(tmpDir, 'metrics.sqlite'));
    metrics._reset();
    metrics.setStore(store);
    gw = new Gateway();
    (gw as any).agents.set('agent', {
      workspacePath: tmpDir,
      getSessionId: () => undefined,
      getSessionIdByValue: () => undefined,
      listSessionMappings: () => [{
        sessionKey: 'web:agent:s1',
        sessionId: 's1',
        messageCount: 3,
        lastUsed: 2_000,
        started: 1_000,
      }],
    });
    (gw as any).sdkSessionService = {
      listAgentSessions: async (_agent: unknown, params: { limit?: number; offset?: number } = {}) => {
        const rows = [
          { sessionId: 's1', summary: 'Alpha session', lastModified: 2_000, cwd: tmpDir },
          { sessionId: 's2', summary: 'Beta session', lastModified: 1_000, cwd: tmpDir },
        ];
        const start = params.offset ?? 0;
        const end = params.limit ? start + params.limit : undefined;
        return rows.slice(start, end);
      },
      getAgentSessionTitle: async (_agent: unknown, sessionId: string) => (
        sessionId === 's1' ? 'Deploy Alpha' : undefined
      ),
      getAgentSessionLabels: async (_agent: unknown, sessionId: string) => (
        sessionId === 's1' ? ['prod', 'release'] : ['incident']
      ),
      setAgentSessionLabels: async (_agent: unknown, _sessionId: string, labels: string[]) => labels,
      getAgentSessionMessages: async (_agent: unknown, sessionId: string) => (
        sessionId === 's1'
          ? [
              { type: 'user', uuid: 'u1', sessionId: 's1', text: 'please deploy alpha', message: {} },
              { type: 'assistant', uuid: 'a1', sessionId: 's1', text: 'alpha deployed', message: {} },
            ]
          : [
              { type: 'user', uuid: 'u2', sessionId: 's2', text: 'debug payments', message: {} },
              { type: 'assistant', uuid: 'a2', sessionId: 's2', text: 'payments failed', message: {} },
            ]
      ),
    };

    metrics.recordAgentRunStart({
      runId: 'run-1',
      startedAt: 1_500,
      agentId: 'agent',
      sessionKey: 'web:agent:s1',
      sdkSessionId: 's1',
      source: 'web',
      channel: 'web',
      status: 'running',
    });
    metrics.recordAgentRunStart({
      runId: 'run-2',
      startedAt: 900,
      agentId: 'agent',
      sessionKey: 'telegram:agent:s2',
      sdkSessionId: 's2',
      source: 'channel',
      channel: 'telegram',
      peerId: 'peer-2',
      status: 'running',
    });
    metrics.recordAgentRunFinish({
      runId: 'run-2',
      completedAt: 1_100,
      status: 'failed',
      sdkSessionId: 's2',
      error: 'tool failed',
    });
  });

  afterEach(() => {
    metrics._reset();
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('searches session title and previews', async () => {
    await expect(gw.listAgentSessions('agent', { search: 'deploy' })).resolves.toMatchObject([
      { sessionId: 's1', summary: 'Deploy Alpha' },
    ]);
    await expect(gw.listAgentSessions('agent', { search: 'payments failed' })).resolves.toMatchObject([
      { sessionId: 's2' },
    ]);
    await expect(gw.listAgentSessions('agent', { search: 'release' })).resolves.toMatchObject([
      { sessionId: 's1', labels: ['prod', 'release'] },
    ]);
  });

  it('filters by source, channel, status, active state, and errors', async () => {
    await expect(gw.listAgentSessions('agent', { source: 'web' })).resolves.toMatchObject([
      { sessionId: 's1' },
    ]);
    await expect(gw.listAgentSessions('agent', { channel: 'telegram', status: 'failed' })).resolves.toMatchObject([
      { sessionId: 's2' },
    ]);
    await expect(gw.listAgentSessions('agent', { active: 'active' })).resolves.toMatchObject([
      { sessionId: 's1' },
    ]);
    await expect(gw.listAgentSessions('agent', { hasErrors: true })).resolves.toMatchObject([
      { sessionId: 's2' },
    ]);
    await expect(gw.listAgentSessions('agent', { label: 'incident' })).resolves.toMatchObject([
      { sessionId: 's2', labels: ['incident'] },
    ]);
  });

  it('filters by modification range', async () => {
    await expect(gw.listAgentSessions('agent', { modifiedAfter: 1_500 })).resolves.toMatchObject([
      { sessionId: 's1' },
    ]);
    await expect(gw.listAgentSessions('agent', { modifiedBefore: 1_500 })).resolves.toMatchObject([
      { sessionId: 's2' },
    ]);
  });

  it('updates session labels through sidecar metadata', async () => {
    await expect(gw.setAgentSessionLabels('agent', 's1', ['prod', 'release'])).resolves.toEqual({
      sessionId: 's1',
      labels: ['prod', 'release'],
    });
  });
});
