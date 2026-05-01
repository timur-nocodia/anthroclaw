import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentConfigWriter } from '../../../config/writer.js';
import { createManageHumanTakeoverTool } from '../manage-human-takeover.js';

function getHandler(t: unknown): (a: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}> {
  return (t as { handler: (a: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  }> }).handler;
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

function withTakeover(block: Record<string, unknown>): string {
  const yaml = [baseAgentYml(), 'human_takeover:'];
  for (const [k, v] of Object.entries(block)) {
    if (Array.isArray(v)) {
      yaml.push(`  ${k}:`);
      for (const item of v) yaml.push(`    - ${item}`);
    } else {
      yaml.push(`  ${k}: ${v}`);
    }
  }
  return yaml.join('\n') + '\n';
}

function seedAgent(agentsDir: string, agentId: string, body = baseAgentYml()): void {
  mkdirSync(join(agentsDir, agentId), { recursive: true });
  writeFileSync(join(agentsDir, agentId, 'agent.yml'), body, 'utf-8');
}

describe('manage_human_takeover', () => {
  let agentsDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'mht-'));
    seedAgent(agentsDir, 'amina');
    seedAgent(agentsDir, 'klavdia');
  });
  afterEach(() => rmSync(agentsDir, { recursive: true, force: true }));

  it('seeds defaults when enabling on a missing block', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageHumanTakeoverTool({ agentId: 'amina', writer, canManage: () => true });
    const r = await getHandler(t)({ enabled: true });
    expect(r.isError).toBeFalsy();
    const block = writer.readSection('amina', 'human_takeover') as Record<string, unknown>;
    expect(block).toMatchObject({
      enabled: true,
      pause_ttl_minutes: 30,
      channels: ['whatsapp'],
      notification_throttle_minutes: 5,
    });
    expect((block.ignore as string[]).sort()).toEqual(['protocol', 'reactions', 'receipts', 'typing']);
  });

  it('preserves other fields when patching enabled only', async () => {
    seedAgent(
      agentsDir,
      'amina',
      withTakeover({ enabled: false, pause_ttl_minutes: 60, channels: ['whatsapp'] }),
    );
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageHumanTakeoverTool({ agentId: 'amina', writer, canManage: () => true });
    const r = await getHandler(t)({ enabled: true });
    expect(r.isError).toBeFalsy();
    const block = writer.readSection('amina', 'human_takeover') as Record<string, unknown>;
    expect(block).toMatchObject({
      enabled: true,
      pause_ttl_minutes: 60,
      channels: ['whatsapp'],
    });
  });

  it('null on a field resets it to schema default', async () => {
    seedAgent(
      agentsDir,
      'amina',
      withTakeover({ enabled: true, pause_ttl_minutes: 90 }),
    );
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageHumanTakeoverTool({ agentId: 'amina', writer, canManage: () => true });
    const r = await getHandler(t)({ pause_ttl_minutes: null });
    expect(r.isError).toBeFalsy();
    const block = writer.readSection('amina', 'human_takeover') as Record<string, unknown>;
    expect(block.pause_ttl_minutes).toBe(30);
    // enabled stays untouched
    expect(block.enabled).toBe(true);
  });

  it('reports applied diffs in the response', async () => {
    seedAgent(agentsDir, 'amina', withTakeover({ enabled: false, pause_ttl_minutes: 60 }));
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageHumanTakeoverTool({ agentId: 'amina', writer, canManage: () => true });
    const r = await getHandler(t)({ enabled: true, pause_ttl_minutes: 45 });
    const body = JSON.parse(r.content[0].text);
    expect(body.applied.enabled).toEqual({ prev: false, new: true });
    expect(body.applied.pause_ttl_minutes).toEqual({ prev: 60, new: 45 });
    expect(body.applied.channels).toBeUndefined();
  });

  it('rejects unauthorized cross-agent target', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageHumanTakeoverTool({
      agentId: 'klavdia',
      writer,
      canManage: () => false,
    });
    const r = await getHandler(t)({ target_agent_id: 'amina', enabled: true });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not authorized/);
  });

  it('allows authorized cross-agent target', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageHumanTakeoverTool({
      agentId: 'klavdia',
      writer,
      canManage: (caller, target) => caller === 'klavdia' && target === 'amina',
    });
    const r = await getHandler(t)({ target_agent_id: 'amina', enabled: true });
    expect(r.isError).toBeFalsy();
    expect(writer.readSection('amina', 'human_takeover')).toMatchObject({ enabled: true });
  });

  it('rejects malformed input via Zod', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageHumanTakeoverTool({ agentId: 'amina', writer, canManage: () => true });
    const r = await getHandler(t)({ pause_ttl_minutes: -5 });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Invalid input/);
  });
});
