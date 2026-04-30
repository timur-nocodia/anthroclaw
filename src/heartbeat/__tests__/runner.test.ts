import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Agent } from '../../agent/agent.js';
import type { AgentYml } from '../../config/schema.js';
import { HEARTBEAT_FILENAME } from '../constants.js';
import { HeartbeatHistoryStore } from '../history.js';
import { HeartbeatRunner, type HeartbeatRunRequest } from '../runner.js';
import { HeartbeatStateStore } from '../state-store.js';

const tmpDirs: string[] = [];

function makeAgent(config: Partial<AgentYml['heartbeat']>, heartbeatContent?: string): Agent {
  const workspacePath = mkdtempSync(join(tmpdir(), 'anthroclaw-heartbeat-agent-'));
  tmpDirs.push(workspacePath);
  mkdirSync(workspacePath, { recursive: true });
  if (heartbeatContent !== undefined) {
    writeFileSync(join(workspacePath, HEARTBEAT_FILENAME), heartbeatContent, 'utf-8');
  }
  return {
    id: 'klavdia',
    workspacePath,
    config: {
      safety_profile: 'trusted',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      heartbeat: {
        enabled: true,
        every: '10m',
        target: 'none',
        isolated_session: true,
        show_ok: false,
        ack_token: 'HEARTBEAT_OK',
        prompt: 'Read HEARTBEAT.md and run due tasks only.',
        ...config,
      },
    } as AgentYml,
  } as Agent;
}

function makeStore(): HeartbeatStateStore {
  const dir = mkdtempSync(join(tmpdir(), 'anthroclaw-heartbeat-runner-'));
  tmpDirs.push(dir);
  return new HeartbeatStateStore(join(dir, 'heartbeat-state.json'));
}

function makeHistoryStore(): HeartbeatHistoryStore {
  const dir = mkdtempSync(join(tmpdir(), 'anthroclaw-heartbeat-history-'));
  tmpDirs.push(dir);
  return new HeartbeatHistoryStore(join(dir, 'output'), join(dir, 'runs.jsonl'));
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('HeartbeatRunner', () => {
  it('skips effectively empty HEARTBEAT.md without waking the model', async () => {
    const agent = makeAgent({}, '# HEARTBEAT\n\n## Tasks\n');
    const store = makeStore();
    let calls = 0;
    const runner = new HeartbeatRunner({
      listAgents: () => [agent],
      stateStore: store,
      isSessionActive: () => false,
      runHeartbeat: async () => {
        calls += 1;
        return { response: 'unexpected', delivered: false };
      },
      nowMs: () => 10_000,
    });

    runner.start();
    await runner.runDue('manual');
    runner.stop();

    expect(calls).toBe(0);
  });

  it('skips when no task is due', async () => {
    const agent = makeAgent({}, `
tasks:
  - name: standup
    interval: 1h
    prompt: Prepare standup.
`);
    const store = makeStore();
    store.markTaskRun('klavdia', 'standup', 'ok', 10_000);
    let calls = 0;
    const runner = new HeartbeatRunner({
      listAgents: () => [agent],
      stateStore: store,
      isSessionActive: () => false,
      runHeartbeat: async () => {
        calls += 1;
        return { response: 'unexpected', delivered: false };
      },
      nowMs: () => 20_000,
    });

    runner.start();
    await runner.runDue('manual');
    runner.stop();

    expect(calls).toBe(0);
  });

  it('runs due tasks through a deterministic synthetic heartbeat request', async () => {
    const agent = makeAgent({}, `
Operational notes stay in context.

tasks:
  - name: standup
    interval: 10m
    prompt: Prepare standup from metrics.
`);
    const store = makeStore();
    let request: HeartbeatRunRequest | undefined;
    const runner = new HeartbeatRunner({
      listAgents: () => [agent],
      stateStore: store,
      isSessionActive: () => false,
      runHeartbeat: async (req) => {
        request = req;
        return { response: 'Standup is ready.', delivered: true };
      },
      nowMs: () => 700_000,
    });

    runner.start();
    await runner.runDue('manual');
    runner.stop();

    expect(request?.sessionKey).toBe('klavdia:heartbeat:700000');
    expect(request?.runId).toBe('heartbeat-klavdia-700000');
    expect(request?.taskNames).toEqual(['standup']);
    expect(request?.prompt).toContain('Operational notes stay in context.');
    expect(request?.prompt).toContain('Prepare standup from metrics.');
    expect(store.getAgent('klavdia').tasks.standup?.lastStatus).toBe('ok');
    expect(store.getAgent('klavdia').lastDeliveredHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses the stable heartbeat session when isolation is disabled', async () => {
    const agent = makeAgent({ isolated_session: false }, `
tasks:
  - name: check
    interval: 10m
    prompt: Check something.
`);
    const store = makeStore();
    let sessionKey = '';
    const runner = new HeartbeatRunner({
      listAgents: () => [agent],
      stateStore: store,
      isSessionActive: () => false,
      runHeartbeat: async (req) => {
        sessionKey = req.sessionKey;
        return { response: 'HEARTBEAT_OK', delivered: false };
      },
      nowMs: () => 42_000,
    });

    runner.start();
    await runner.runDue('manual');
    runner.stop();

    expect(sessionKey).toBe('klavdia:heartbeat');
    expect(store.getAgent('klavdia').tasks.check?.lastStatus).toBe('skipped');
  });

  it('resolves the last delivery target when configured', async () => {
    const agent = makeAgent({ target: 'last' }, `
tasks:
  - name: reminder
    interval: 10m
    prompt: Remind the user.
`);
    const store = makeStore();
    store.recordTarget('klavdia', {
      channel: 'telegram',
      peer_id: '48705953',
      account_id: 'default',
      thread_id: '11',
    });
    let request: HeartbeatRunRequest | undefined;
    const runner = new HeartbeatRunner({
      listAgents: () => [agent],
      stateStore: store,
      isSessionActive: () => false,
      runHeartbeat: async (req) => {
        request = req;
        return { response: 'Reminder delivered.', delivered: true };
      },
      nowMs: () => 100_000,
    });

    runner.start();
    await runner.runDue('manual');
    runner.stop();

    expect(request?.target).toEqual({
      channel: 'telegram',
      peer_id: '48705953',
      account_id: 'default',
      thread_id: '11',
    });
  });

  it('injects script output into the model prompt and writes output history', async () => {
    const agent = makeAgent({}, `
tasks:
  - name: metrics
    interval: 10m
    prompt: Analyze metric changes.
    script: scripts/check.js
`);
    mkdirSync(join(agent.workspacePath, 'scripts'), { recursive: true });
    writeFileSync(join(agent.workspacePath, 'scripts', 'check.js'), `
console.log('conversion rate changed from 4% to 7%');
`, 'utf-8');
    const store = makeStore();
    const historyStore = makeHistoryStore();
    let request: HeartbeatRunRequest | undefined;
    const runner = new HeartbeatRunner({
      listAgents: () => [agent],
      stateStore: store,
      historyStore,
      isSessionActive: () => false,
      runHeartbeat: async (req) => {
        request = req;
        return { response: 'Metric report delivered.', delivered: true };
      },
      nowMs: () => 300_000,
    });

    runner.start();
    await runner.runDue('manual');
    runner.stop();

    expect(request?.prompt).toContain('Script stdout');
    expect(request?.prompt).toContain('conversion rate changed from 4% to 7%');
    const runs = historyStore.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe('delivered');
    expect(runs[0]?.outputPath).toBeTruthy();
    expect(historyStore.readOutput(runs[0]!.outputPath!)).toBe('Metric report delivered.');
  });

  it('skips the model when a script returns wakeAgent=false', async () => {
    const agent = makeAgent({}, `
tasks:
  - name: metrics
    interval: 10m
    prompt: Analyze metric changes.
    script: scripts/quiet.js
`);
    mkdirSync(join(agent.workspacePath, 'scripts'), { recursive: true });
    writeFileSync(join(agent.workspacePath, 'scripts', 'quiet.js'), `
console.log('no metric changes');
console.log(JSON.stringify({ wakeAgent: false }));
`, 'utf-8');
    const store = makeStore();
    const historyStore = makeHistoryStore();
    let calls = 0;
    const runner = new HeartbeatRunner({
      listAgents: () => [agent],
      stateStore: store,
      historyStore,
      isSessionActive: () => false,
      runHeartbeat: async () => {
        calls += 1;
        return { response: 'unexpected', delivered: false };
      },
      nowMs: () => 300_000,
    });

    runner.start();
    await runner.runDue('manual');
    runner.stop();

    expect(calls).toBe(0);
    expect(store.getAgent('klavdia').tasks.metrics?.lastStatus).toBe('skipped');
    expect(historyStore.listRuns()[0]?.status).toBe('skipped_wake_gate');
  });
});
