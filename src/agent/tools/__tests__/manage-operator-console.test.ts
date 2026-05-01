import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentConfigWriter } from '../../../config/writer.js';
import { createManageOperatorConsoleTool } from '../manage-operator-console.js';

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

function withOperatorConsole(opts: {
  enabled?: boolean;
  manages?: string[] | '*';
  capabilities?: string[];
}): string {
  const yaml = [baseAgentYml(), 'operator_console:'];
  if (opts.enabled !== undefined) yaml.push(`  enabled: ${opts.enabled}`);
  if (opts.manages !== undefined) {
    if (opts.manages === '*') yaml.push(`  manages: '*'`);
    else if (opts.manages.length === 0) yaml.push(`  manages: []`);
    else {
      yaml.push('  manages:');
      for (const m of opts.manages) yaml.push(`    - ${m}`);
    }
  }
  if (opts.capabilities !== undefined) {
    if (opts.capabilities.length === 0) yaml.push(`  capabilities: []`);
    else {
      yaml.push('  capabilities:');
      for (const c of opts.capabilities) yaml.push(`    - ${c}`);
    }
  }
  return yaml.join('\n') + '\n';
}

function seedAgent(agentsDir: string, agentId: string, body = baseAgentYml()): void {
  mkdirSync(join(agentsDir, agentId), { recursive: true });
  writeFileSync(join(agentsDir, agentId, 'agent.yml'), body, 'utf-8');
}

describe('manage_operator_console', () => {
  let agentsDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'moc-'));
    seedAgent(agentsDir, 'klavdia');
    seedAgent(agentsDir, 'amina');
  });
  afterEach(() => rmSync(agentsDir, { recursive: true, force: true }));

  it('rejects when both manages and manages_action are provided', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({ agentId: 'klavdia', writer, canManage: () => true });
    const r = await getHandler(t)({
      manages: ['amina'],
      manages_action: { kind: 'add', agent_id: 'larry' },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/mutually exclusive/);
  });

  it('manages_action=add appends to existing list', async () => {
    seedAgent(
      agentsDir,
      'klavdia',
      withOperatorConsole({ enabled: true, manages: ['amina'], capabilities: [] }),
    );
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({ agentId: 'klavdia', writer, canManage: () => true });
    const r = await getHandler(t)({ manages_action: { kind: 'add', agent_id: 'larry' } });
    expect(r.isError).toBeFalsy();
    const block = writer.readSection('klavdia', 'operator_console') as { manages: string[] };
    expect(block.manages).toEqual(['amina', 'larry']);
  });

  it('manages_action=add is idempotent (no duplicate)', async () => {
    seedAgent(
      agentsDir,
      'klavdia',
      withOperatorConsole({ enabled: true, manages: ['amina'], capabilities: [] }),
    );
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({ agentId: 'klavdia', writer, canManage: () => true });
    await getHandler(t)({ manages_action: { kind: 'add', agent_id: 'amina' } });
    const block = writer.readSection('klavdia', 'operator_console') as { manages: string[] };
    expect(block.manages).toEqual(['amina']);
  });

  it('manages_action=remove drops from list; idempotent on already-absent', async () => {
    seedAgent(
      agentsDir,
      'klavdia',
      withOperatorConsole({ enabled: true, manages: ['amina', 'larry'], capabilities: [] }),
    );
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({ agentId: 'klavdia', writer, canManage: () => true });
    await getHandler(t)({ manages_action: { kind: 'remove', agent_id: 'larry' } });
    const block1 = writer.readSection('klavdia', 'operator_console') as { manages: string[] };
    expect(block1.manages).toEqual(['amina']);
    await getHandler(t)({ manages_action: { kind: 'remove', agent_id: 'larry' } });
    const block2 = writer.readSection('klavdia', 'operator_console') as { manages: string[] };
    expect(block2.manages).toEqual(['amina']);
  });

  it('manages_action against "*" super-admin is no-op (preserves "*")', async () => {
    seedAgent(
      agentsDir,
      'klavdia',
      withOperatorConsole({ enabled: true, manages: '*', capabilities: [] }),
    );
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({ agentId: 'klavdia', writer, canManage: () => true });
    await getHandler(t)({ manages_action: { kind: 'remove', agent_id: 'amina' } });
    const block1 = writer.readSection('klavdia', 'operator_console') as { manages: string };
    expect(block1.manages).toBe('*');
    await getHandler(t)({ manages_action: { kind: 'add', agent_id: 'amina' } });
    const block2 = writer.readSection('klavdia', 'operator_console') as { manages: string };
    expect(block2.manages).toBe('*');
  });

  it('manages: "*" sets super-admin', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({ agentId: 'klavdia', writer, canManage: () => true });
    const r = await getHandler(t)({ enabled: true, manages: '*' });
    expect(r.isError).toBeFalsy();
    const block = writer.readSection('klavdia', 'operator_console') as { manages: string; enabled: boolean };
    expect(block.manages).toBe('*');
    expect(block.enabled).toBe(true);
  });

  it('partial capabilities array replaces full list', async () => {
    seedAgent(
      agentsDir,
      'klavdia',
      withOperatorConsole({
        enabled: true,
        manages: '*',
        capabilities: ['peer_pause', 'delegate', 'list_peers'],
      }),
    );
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({ agentId: 'klavdia', writer, canManage: () => true });
    const r = await getHandler(t)({ capabilities: ['peer_pause', 'escalate'] });
    expect(r.isError).toBeFalsy();
    const block = writer.readSection('klavdia', 'operator_console') as { capabilities: string[] };
    expect(block.capabilities).toEqual(['peer_pause', 'escalate']);
  });

  it('rejects unauthorized cross-agent target', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({
      agentId: 'klavdia',
      writer,
      canManage: () => false,
    });
    const r = await getHandler(t)({ target_agent_id: 'amina', enabled: true });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not authorized/);
  });

  it('reports applied diffs in response', async () => {
    seedAgent(
      agentsDir,
      'klavdia',
      withOperatorConsole({ enabled: false, manages: ['amina'], capabilities: [] }),
    );
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createManageOperatorConsoleTool({ agentId: 'klavdia', writer, canManage: () => true });
    const r = await getHandler(t)({
      enabled: true,
      manages_action: { kind: 'add', agent_id: 'larry' },
    });
    const body = JSON.parse(r.content[0].text);
    expect(body.applied.enabled).toEqual({ prev: false, new: true });
    expect(body.applied.manages).toEqual({ prev: ['amina'], new: ['amina', 'larry'] });
  });
});
