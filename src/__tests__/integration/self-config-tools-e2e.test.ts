import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentConfigWriter } from '../../config/writer.js';
import { createConfigAuditLog } from '../../config/audit.js';
import { createNotificationsEmitter } from '../../notifications/emitter.js';
import { createManageNotificationsTool } from '../../agent/tools/manage-notifications.js';
import { canManageAgent } from '../../security/cross-agent-perm.js';
import type { AgentNotificationsConfig } from '../../notifications/types.js';
import { Agent } from '../../agent/agent.js';

/**
 * Stage 2 integration test: chat tool → AgentConfigWriter → file mutation →
 * re-read → notifications emitter dispatches.
 *
 * We don't spin up the full Gateway/chokidar — chokidar is a costly
 * dependency to wire and the "reload after write" guarantee is already
 * exercised by the watcher's unit tests. Instead we simulate reload as a
 * single explicit re-read of the section after each tool call, which is
 * exactly what the gateway does on chokidar fire (`agent.reload`).
 *
 * The point of this test: prove the wiring at the
 *   `tool.handler → writer.patchSection → audit + reload boundary`
 * actually works end-to-end.
 */

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
    '  - { channel: telegram }',
    '',
  ].join('\n');
}

function seedAgent(agentsDir: string, agentId: string): void {
  mkdirSync(join(agentsDir, agentId), { recursive: true });
  writeFileSync(join(agentsDir, agentId, 'agent.yml'), baseAgentYml(), 'utf-8');
}

describe('self-config tools — Stage 2 integration', () => {
  let agentsDir: string;
  let auditDir: string;

  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'scte2e-'));
    auditDir = mkdtempSync(join(tmpdir(), 'scte2e-audit-'));
    seedAgent(agentsDir, 'klavdia');
    seedAgent(agentsDir, 'amina');
  });
  afterEach(() => {
    rmSync(agentsDir, { recursive: true, force: true });
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('chat tool → file write → simulated reload → notification fires through new route', async () => {
    const auditLog = createConfigAuditLog({ auditDir });
    const writer = createAgentConfigWriter({ agentsDir, auditLog });

    // Klavdia self-targets; no operator_console required.
    const tool = createManageNotificationsTool({
      agentId: 'klavdia',
      writer,
      canManage: () => true,
      sessionKey: 'telegram:control:dm:48705953',
    });

    // Build the notifications emitter with a sendMessage spy. This
    // stands in for the real channel adapter.
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const emitter = createNotificationsEmitter({ sendMessage });

    // Step 1: tool adds a route + subscription on klavdia's config.
    const r1 = await getHandler(tool)({
      action: {
        kind: 'add_route',
        name: 'operator',
        route: { channel: 'telegram', account_id: 'control', peer_id: '48705953' },
      },
    });
    expect(r1.isError).toBeFalsy();

    const r2 = await getHandler(tool)({
      action: { kind: 'set_enabled', enabled: true },
    });
    expect(r2.isError).toBeFalsy();

    const r3 = await getHandler(tool)({
      action: {
        kind: 'add_subscription',
        subscription: { event: 'peer_pause_started', route: 'operator' },
      },
    });
    expect(r3.isError).toBeFalsy();

    // Step 2: verify file was actually mutated (a reload-trigger event
    // would now fire on a real chokidar watcher).
    const yaml = readFileSync(join(agentsDir, 'klavdia', 'agent.yml'), 'utf-8');
    expect(yaml).toContain('notifications:');
    expect(yaml).toContain('operator:');
    expect(yaml).toContain('peer_pause_started');
    expect(yaml).toContain('# test agent'); // comment preserved

    // Step 3: simulate the reload — re-read the section and resubscribe
    // the emitter. This is what `agent.reload` does on chokidar fire.
    const reloaded = writer.readSection('klavdia', 'notifications') as AgentNotificationsConfig;
    emitter.subscribeAgent('klavdia', reloaded);

    // Step 4: trigger a peer_pause_started event for klavdia. The emitter
    // should resolve the route and call sendMessage.
    await emitter.emit('peer_pause_started', {
      agentId: 'klavdia',
      peerKey: 'wa:business:1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(sendMessage).toHaveBeenCalledOnce();
    const [route, text, meta] = sendMessage.mock.calls[0];
    expect(route).toMatchObject({
      channel: 'telegram', account_id: 'control', peer_id: '48705953',
    });
    expect(typeof text).toBe('string');
    expect(meta).toMatchObject({ event: 'peer_pause_started', agentId: 'klavdia' });
  });

  it('cross-agent management requires operator_console.manages whitelist', async () => {
    const writer = createAgentConfigWriter({ agentsDir });

    // Without operator_console: klavdia cannot manage amina.
    const denyTool = createManageNotificationsTool({
      agentId: 'klavdia',
      writer,
      canManage: (caller, target) =>
        canManageAgent({
          callerId: caller,
          targetId: target,
          operatorConsoleConfig: undefined,
        }),
    });
    const denied = await getHandler(denyTool)({
      target_agent_id: 'amina',
      action: { kind: 'set_enabled', enabled: true },
    });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toMatch(/not authorized/);

    // Amina's file remains untouched.
    const aminaYaml = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    expect(aminaYaml).not.toContain('notifications:');

    // With operator_console.manages: ['amina'], the same call succeeds.
    const allowTool = createManageNotificationsTool({
      agentId: 'klavdia',
      writer,
      canManage: (caller, target) =>
        canManageAgent({
          callerId: caller,
          targetId: target,
          operatorConsoleConfig: { enabled: true, manages: ['amina'] },
        }),
    });
    const allowed = await getHandler(allowTool)({
      target_agent_id: 'amina',
      action: { kind: 'set_enabled', enabled: true },
    });
    expect(allowed.isError).toBeFalsy();
    expect(writer.readSection('amina', 'notifications')).toMatchObject({ enabled: true });
  });

  it('audit log records both chat tool writes and ui writes with correct source tags', async () => {
    const auditLog = createConfigAuditLog({ auditDir });
    const writer = createAgentConfigWriter({ agentsDir, auditLog });

    // Chat-driven write via the manage_notifications tool.
    const tool = createManageNotificationsTool({
      agentId: 'klavdia',
      writer,
      canManage: () => true,
      sessionKey: 'telegram:control:dm:48705953',
    });
    await getHandler(tool)({
      action: { kind: 'set_enabled', enabled: true },
    });

    // UI-driven write — the UI route handler does this exact call shape
    // (see ui/app/api/agents/[agentId]/config/route.ts).
    await writer.patchSection(
      'klavdia',
      'human_takeover',
      () => ({ enabled: true }),
      { caller: 'ui', source: 'ui', action: 'ui_save_human_takeover' },
    );

    const recent = await auditLog.readRecent('klavdia', { limit: 10 });
    expect(recent.length).toBeGreaterThanOrEqual(2);
    const sources = new Set(recent.map((e) => e.source));
    expect(sources.has('chat')).toBe(true);
    expect(sources.has('ui')).toBe(true);

    const chatEntry = recent.find((e) => e.source === 'chat');
    expect(chatEntry).toMatchObject({
      callerAgent: 'klavdia',
      callerSession: 'telegram:control:dm:48705953',
      targetAgent: 'klavdia',
      section: 'notifications',
      action: 'notifications.set_enabled',
    });

    const uiEntry = recent.find((e) => e.source === 'ui');
    expect(uiEntry).toMatchObject({
      callerAgent: 'ui',
      targetAgent: 'klavdia',
      section: 'human_takeover',
      action: 'ui_save_human_takeover',
    });
  });
});

/**
 * Wiring guard. The 4 self-config tools live in the same switch as every
 * other built-in tool — but only fire when `Agent.load` receives the
 * `agentConfigWriter` option. A previous regression had the factories
 * present and the tests passing, but no agent ever saw the tools because
 * the gateway forgot to thread the writer through.
 *
 * This test uses the real `Agent.load` with `mcp_tools` declaring all four
 * tools. If any case is missing or its factory args break, this fails.
 */
describe('self-config tools — Agent.load wiring guard', () => {
  let agentsDir: string;
  let dataDir: string;
  let auditDir: string;

  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'wire-'));
    dataDir = mkdtempSync(join(tmpdir(), 'wire-data-'));
    auditDir = mkdtempSync(join(tmpdir(), 'wire-audit-'));
  });
  afterEach(() => {
    rmSync(agentsDir, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('registers all four self-config tools when listed in mcp_tools and writer is provided', async () => {
    const agentDir = join(agentsDir, 'klavdia');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'agent.yml'),
      [
        'safety_profile: private',
        'routes:',
        '  - { channel: telegram, scope: dm }',
        'allowlist:',
        '  telegram:',
        '    - "1"',
        'mcp_tools:',
        '  - manage_notifications',
        '  - manage_human_takeover',
        '  - manage_operator_console',
        '  - show_config',
        '',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(join(agentDir, 'CLAUDE.md'), 'You are klavdia.', 'utf-8');

    const auditLog = createConfigAuditLog({ auditDir });
    const writer = createAgentConfigWriter({ agentsDir, auditLog });

    const agent = await Agent.load(
      agentDir,
      dataDir,
      () => undefined, // no channel adapter
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      null,
      null,
      {
        agentConfigWriter: writer,
        configAuditLog: auditLog,
      },
    );

    const names = agent.tools.map((t) => t.name);
    expect(names).toContain('manage_notifications');
    expect(names).toContain('manage_human_takeover');
    expect(names).toContain('manage_operator_console');
    expect(names).toContain('show_config');
  });

  it('warns and omits self-config tools when agentConfigWriter is missing', async () => {
    const agentDir = join(agentsDir, 'amina');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'agent.yml'),
      [
        'safety_profile: private',
        'routes:',
        '  - { channel: telegram, scope: dm }',
        'allowlist:',
        '  telegram:',
        '    - "1"',
        'mcp_tools:',
        '  - manage_notifications',
        '  - show_config',
        '',
      ].join('\n'),
      'utf-8',
    );
    writeFileSync(join(agentDir, 'CLAUDE.md'), 'You are amina.', 'utf-8');

    const agent = await Agent.load(agentDir, dataDir, () => undefined);
    const names = agent.tools.map((t) => t.name);
    expect(names).not.toContain('manage_notifications');
    expect(names).not.toContain('show_config');
  });
});
