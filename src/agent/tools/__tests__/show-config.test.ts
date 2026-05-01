import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentConfigWriter } from '../../../config/writer.js';
import { createConfigAuditLog } from '../../../config/audit.js';
import { createShowConfigTool } from '../show-config.js';

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

function seedAgent(agentsDir: string, agentId: string, body = baseAgentYml()): void {
  mkdirSync(join(agentsDir, agentId), { recursive: true });
  writeFileSync(join(agentsDir, agentId, 'agent.yml'), body, 'utf-8');
}

function withHumanTakeover(enabled: boolean): string {
  return [
    baseAgentYml(),
    'human_takeover:',
    `  enabled: ${enabled}`,
    '',
  ].join('\n');
}

describe('show_config', () => {
  let agentsDir: string;
  let auditDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'sc-'));
    auditDir = mkdtempSync(join(tmpdir(), 'sc-audit-'));
    seedAgent(agentsDir, 'amina');
    seedAgent(agentsDir, 'klavdia');
  });
  afterEach(() => {
    rmSync(agentsDir, { recursive: true, force: true });
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('returns requested section with schema defaults applied', async () => {
    seedAgent(agentsDir, 'amina', withHumanTakeover(true));
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createShowConfigTool({
      agentId: 'amina', writer, canManage: () => true,
    });
    const r = await getHandler(t)({ sections: ['human_takeover'] });
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.content[0].text);
    expect(body.agent_id).toBe('amina');
    expect(body.sections.human_takeover).toMatchObject({
      enabled: true,
      pause_ttl_minutes: 30,
      channels: ['whatsapp'],
      notification_throttle_minutes: 5,
    });
  });

  it('"all" returns all three sections with defaults applied', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createShowConfigTool({
      agentId: 'amina', writer, canManage: () => true,
    });
    const r = await getHandler(t)({ sections: ['all'] });
    const body = JSON.parse(r.content[0].text);
    expect(body.sections.notifications).toMatchObject({ enabled: false, routes: {}, subscriptions: [] });
    expect(body.sections.human_takeover).toMatchObject({ enabled: false });
    expect(body.sections.operator_console).toMatchObject({ enabled: false, manages: [] });
  });

  it('omitting sections returns all three', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createShowConfigTool({
      agentId: 'amina', writer, canManage: () => true,
    });
    const r = await getHandler(t)({});
    const body = JSON.parse(r.content[0].text);
    expect(Object.keys(body.sections).sort()).toEqual(
      ['human_takeover', 'notifications', 'operator_console'],
    );
  });

  it('self-target works without manage permission', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createShowConfigTool({
      agentId: 'amina', writer, canManage: () => false,
    });
    const r = await getHandler(t)({ sections: ['notifications'] });
    expect(r.isError).toBeFalsy();
  });

  it('cross-agent target requires manage permission', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createShowConfigTool({
      agentId: 'klavdia', writer, canManage: () => false,
    });
    const r = await getHandler(t)({
      target_agent_id: 'amina',
      sections: ['notifications'],
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not authorized/);
  });

  it('cross-agent target succeeds when authorized', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const t = createShowConfigTool({
      agentId: 'klavdia',
      writer,
      canManage: (caller, target) => caller === 'klavdia' && target === 'amina',
    });
    const r = await getHandler(t)({
      target_agent_id: 'amina',
      sections: ['notifications'],
    });
    expect(r.isError).toBeFalsy();
    const body = JSON.parse(r.content[0].text);
    expect(body.agent_id).toBe('amina');
  });

  it('includes last_modified from audit log when present', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const auditLog = createConfigAuditLog({ auditDir });
    await auditLog.append({
      callerAgent: 'klavdia',
      callerSession: 'telegram:control:dm:48705953',
      targetAgent: 'amina',
      section: 'human_takeover',
      action: 'human_takeover.patch',
      prev: null,
      new: { enabled: true },
      source: 'chat',
    });
    const t = createShowConfigTool({
      agentId: 'amina', writer, auditLog, canManage: () => true,
    });
    const r = await getHandler(t)({ sections: ['human_takeover'] });
    const body = JSON.parse(r.content[0].text);
    expect(body.last_modified).toMatchObject({
      section: 'human_takeover',
      by: 'klavdia',
      source: 'chat',
    });
    expect(body.last_modified.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('omits last_modified when no audit history', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const auditLog = createConfigAuditLog({ auditDir });
    const t = createShowConfigTool({
      agentId: 'amina', writer, auditLog, canManage: () => true,
    });
    const r = await getHandler(t)({});
    const body = JSON.parse(r.content[0].text);
    expect(body.last_modified).toBeUndefined();
  });
});
