import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HeartbeatStateStore } from '../state-store.js';

const tmpDirs: string[] = [];

function makeStore(): HeartbeatStateStore {
  const dir = mkdtempSync(join(tmpdir(), 'anthroclaw-heartbeat-state-'));
  tmpDirs.push(dir);
  return new HeartbeatStateStore(join(dir, 'heartbeat-state.json'));
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('HeartbeatStateStore', () => {
  it('persists last delivery target', () => {
    const store = makeStore();
    store.recordTarget('klavdia', {
      channel: 'telegram',
      peer_id: '48705953',
      account_id: 'default',
      thread_id: '42',
      session_key: 'klavdia:telegram:48705953',
    });

    expect(store.getLastTarget('klavdia')).toEqual({
      channel: 'telegram',
      peer_id: '48705953',
      account_id: 'default',
      thread_id: '42',
      session_key: 'klavdia:telegram:48705953',
    });
  });

  it('persists task last-run state across store instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'anthroclaw-heartbeat-state-'));
    tmpDirs.push(dir);
    const path = join(dir, 'heartbeat-state.json');

    const first = new HeartbeatStateStore(path);
    first.markTaskRun('klavdia', 'standup', 'ok', 1234);

    const second = new HeartbeatStateStore(path);
    expect(second.getTaskLastRun('klavdia', 'standup')).toBe(1234);
    expect(second.getAgent('klavdia').tasks.standup?.lastStatus).toBe('ok');
  });

  it('records delivery hash without storing response text', () => {
    const store = makeStore();
    store.recordDelivery('klavdia', 'Sensitive response text');

    const agentState = store.getAgent('klavdia');
    expect(agentState.lastDeliveredHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(agentState)).not.toContain('Sensitive response text');
  });
});
