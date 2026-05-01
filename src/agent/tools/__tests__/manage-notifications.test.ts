import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentConfigWriter } from '../../../config/writer.js';
import { createManageNotificationsTool } from '../manage-notifications.js';

function getHandler(t: unknown): (a: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}> {
  return (t as { handler: (a: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> }).handler;
}

function seedAgent(agentsDir: string, agentId: string, body = baseAgentYml()): void {
  mkdirSync(join(agentsDir, agentId), { recursive: true });
  writeFileSync(join(agentsDir, agentId, 'agent.yml'), body, 'utf-8');
}

function baseAgentYml(): string {
  return [
    '# test agent',
    'safety_profile: chat_like_openclaw',
    'routes:',
    '  - { channel: whatsapp }',
    '',
  ].join('\n');
}

describe('manage_notifications', () => {
  let agentsDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'mn-'));
    seedAgent(agentsDir, 'amina');
    seedAgent(agentsDir, 'klavdia');
  });
  afterEach(() => {
    rmSync(agentsDir, { recursive: true, force: true });
  });

  it('action=set_enabled toggles the flag and patches the file', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({
      agentId: 'amina',
      writer,
      canManage: () => true,
    });
    const r = await getHandler(t)({ action: { kind: 'set_enabled', enabled: true } });
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.content[0].text);
    expect(body).toMatchObject({ ok: true, changed: true, enabled: true });
    expect(writer.readSection('amina', 'notifications')).toMatchObject({ enabled: true });
  });

  it('action=add_route appends a named route', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    const r = await getHandler(t)({
      action: {
        kind: 'add_route',
        name: 'operator',
        route: { channel: 'telegram', account_id: 'control', peer_id: '48705953' },
      },
    });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(r.content[0].text)).toMatchObject({ ok: true, changed: true });
    const block = writer.readSection('amina', 'notifications') as { routes: Record<string, unknown> };
    expect(block.routes.operator).toMatchObject({
      channel: 'telegram',
      account_id: 'control',
      peer_id: '48705953',
    });
  });

  it('action=add_route is idempotent: first call changed=true, second call changed=false', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    const route = { channel: 'telegram' as const, account_id: 'c', peer_id: 'p' };
    const r1 = await getHandler(t)({ action: { kind: 'add_route', name: 'operator', route } });
    expect(JSON.parse(r1.content[0].text)).toMatchObject({ ok: true, changed: true });
    const r2 = await getHandler(t)({ action: { kind: 'add_route', name: 'operator', route } });
    expect(JSON.parse(r2.content[0].text)).toMatchObject({ ok: true, changed: false });
  });

  it('action=add_route on existing name with different value reports changed=true', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    const route1 = { channel: 'telegram' as const, account_id: 'c', peer_id: 'p1' };
    const route2 = { channel: 'telegram' as const, account_id: 'c', peer_id: 'p2' };
    await getHandler(t)({ action: { kind: 'add_route', name: 'operator', route: route1 } });
    const r2 = await getHandler(t)({ action: { kind: 'add_route', name: 'operator', route: route2 } });
    expect(JSON.parse(r2.content[0].text)).toMatchObject({ ok: true, changed: true });
  });

  it('action=set_enabled is idempotent: applying same value reports changed=false', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    const r1 = await getHandler(t)({ action: { kind: 'set_enabled', enabled: true } });
    expect(JSON.parse(r1.content[0].text)).toMatchObject({ ok: true, changed: true, enabled: true });
    const r2 = await getHandler(t)({ action: { kind: 'set_enabled', enabled: true } });
    expect(JSON.parse(r2.content[0].text)).toMatchObject({ ok: true, changed: false, enabled: true });
    const r3 = await getHandler(t)({ action: { kind: 'set_enabled', enabled: false } });
    expect(JSON.parse(r3.content[0].text)).toMatchObject({ ok: true, changed: true, enabled: false });
  });

  it('action=remove_route deletes by name; idempotent', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    await getHandler(t)({
      action: {
        kind: 'add_route',
        name: 'operator',
        route: { channel: 'telegram', account_id: 'c', peer_id: 'p' },
      },
    });
    const r1 = await getHandler(t)({ action: { kind: 'remove_route', name: 'operator' } });
    expect(JSON.parse(r1.content[0].text)).toMatchObject({ ok: true, changed: true });
    const r2 = await getHandler(t)({ action: { kind: 'remove_route', name: 'operator' } });
    expect(JSON.parse(r2.content[0].text)).toMatchObject({ ok: true, changed: false });
  });

  it('action=list_routes returns existing routes', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    await getHandler(t)({
      action: {
        kind: 'add_route',
        name: 'operator',
        route: { channel: 'telegram', account_id: 'c', peer_id: 'p' },
      },
    });
    const r = await getHandler(t)({ action: { kind: 'list_routes' } });
    const body = JSON.parse(r.content[0].text);
    expect(body.ok).toBe(true);
    expect(body.result.operator).toMatchObject({ channel: 'telegram' });
  });

  it('action=add_subscription appends and returns its index', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    await getHandler(t)({
      action: {
        kind: 'add_route',
        name: 'operator',
        route: { channel: 'telegram', account_id: 'c', peer_id: 'p' },
      },
    });
    const r = await getHandler(t)({
      action: {
        kind: 'add_subscription',
        subscription: { event: 'peer_pause_started', route: 'operator' },
      },
    });
    expect(JSON.parse(r.content[0].text)).toMatchObject({ ok: true, changed: true, index: 0 });
  });

  it('action=remove_subscription deletes by index', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    await getHandler(t)({
      action: {
        kind: 'add_route',
        name: 'operator',
        route: { channel: 'telegram', account_id: 'c', peer_id: 'p' },
      },
    });
    await getHandler(t)({
      action: {
        kind: 'add_subscription',
        subscription: { event: 'peer_pause_started', route: 'operator' },
      },
    });
    const r1 = await getHandler(t)({ action: { kind: 'remove_subscription', index: 0 } });
    expect(JSON.parse(r1.content[0].text)).toMatchObject({ ok: true, changed: true });
    const r2 = await getHandler(t)({ action: { kind: 'remove_subscription', index: 0 } });
    expect(JSON.parse(r2.content[0].text)).toMatchObject({ ok: true, changed: false });
  });

  it('action=list_subscriptions returns the array', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    await getHandler(t)({
      action: {
        kind: 'add_route',
        name: 'operator',
        route: { channel: 'telegram', account_id: 'c', peer_id: 'p' },
      },
    });
    await getHandler(t)({
      action: {
        kind: 'add_subscription',
        subscription: { event: 'peer_pause_started', route: 'operator' },
      },
    });
    const r = await getHandler(t)({ action: { kind: 'list_subscriptions' } });
    const body = JSON.parse(r.content[0].text);
    expect(body.ok).toBe(true);
    expect(body.result).toEqual([{ event: 'peer_pause_started', route: 'operator' }]);
  });

  it('action=test invokes dispatchTest with the resolved route', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const dispatchTest = vi.fn().mockResolvedValue(undefined);
    const t = createManageNotificationsTool({
      agentId: 'amina',
      writer,
      canManage: () => true,
      dispatchTest,
    });
    await getHandler(t)({
      action: {
        kind: 'add_route',
        name: 'operator',
        route: { channel: 'telegram', account_id: 'c', peer_id: 'p' },
      },
    });
    const r = await getHandler(t)({ action: { kind: 'test', route_name: 'operator' } });
    expect(JSON.parse(r.content[0].text)).toMatchObject({ ok: true, dispatched: true });
    expect(dispatchTest).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'amina',
        routeName: 'operator',
        route: expect.objectContaining({ channel: 'telegram' }),
      }),
    );
  });

  it('action=test with unknown route returns error', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    const r = await getHandler(t)({ action: { kind: 'test', route_name: 'nope' } });
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content[0].text)).toMatchObject({ ok: false });
  });

  it('rejects cross-agent target without manage permission', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({
      agentId: 'klavdia',
      writer,
      canManage: () => false,
    });
    const r = await getHandler(t)({
      target_agent_id: 'amina',
      action: { kind: 'set_enabled', enabled: true },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not authorized/);
  });

  it('allows cross-agent target when canManage returns true', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({
      agentId: 'klavdia',
      writer,
      canManage: (caller, target) => caller === 'klavdia' && target === 'amina',
    });
    const r = await getHandler(t)({
      target_agent_id: 'amina',
      action: { kind: 'set_enabled', enabled: true },
    });
    expect(r.isError).toBeFalsy();
    expect(writer.readSection('amina', 'notifications')).toMatchObject({ enabled: true });
  });

  it('rejects malformed input via Zod', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageNotificationsTool({ agentId: 'amina', writer, canManage: () => true });
    const r = await getHandler(t)({ action: { kind: 'add_route', name: '' } });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Invalid input/);
  });

});
