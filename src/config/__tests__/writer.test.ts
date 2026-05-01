import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAgentConfigWriter } from '../writer.js';
import { createConfigAuditLog, type ConfigAuditLog } from '../audit.js';
import { logger } from '../../logger.js';

const SEED_YAML = [
  '# Amina lead bot',
  'safety_profile: chat_like_openclaw',
  'routes:',
  '  - { channel: whatsapp }',
  '',
].join('\n');

describe('AgentConfigWriter — basic shape', () => {
  it('exports the factory and surface API', () => {
    const writer = createAgentConfigWriter({ agentsDir: '/tmp/non-existent' });
    expect(typeof writer.patchSection).toBe('function');
    expect(typeof writer.readSection).toBe('function');
    expect(typeof writer.readFullConfig).toBe('function');
  });
});

describe('AgentConfigWriter — patchSection', () => {
  let agentsDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'acw-'));
    mkdirSync(join(agentsDir, 'amina'), { recursive: true });
    writeFileSync(join(agentsDir, 'amina', 'agent.yml'), SEED_YAML);
  });
  afterEach(() => rmSync(agentsDir, { recursive: true, force: true }));

  it('adds a new section with comment-preserving write', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const result = await writer.patchSection('amina', 'human_takeover', () => ({
      enabled: true,
      pause_ttl_minutes: 30,
    }));
    expect(result.prevValue).toBeUndefined();
    expect(result.newValue).toMatchObject({ enabled: true, pause_ttl_minutes: 30 });
    const after = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    expect(after).toContain('# Amina lead bot');
    expect(after).toContain('safety_profile: chat_like_openclaw');
    expect(after).toContain('human_takeover:');
    expect(after).toContain('enabled: true');
  });

  it('returns null patch removes the section', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    await writer.patchSection('amina', 'human_takeover', () => ({ enabled: true, pause_ttl_minutes: 30 }));
    const result = await writer.patchSection('amina', 'human_takeover', () => null);
    expect(result.newValue).toBeNull();
    const after = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    expect(after).not.toContain('human_takeover');
  });

  it('serializes concurrent writes per-agent', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const results = await Promise.all([
      writer.patchSection('amina', 'human_takeover', () => ({ enabled: true, pause_ttl_minutes: 30 })),
      writer.patchSection('amina', 'human_takeover', () => ({ enabled: true, pause_ttl_minutes: 60 })),
    ]);
    const final = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    expect(final).toContain('pause_ttl_minutes: 60');
    expect(results).toHaveLength(2);
  });

  it('throws AgentConfigNotFound if agent.yml missing', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    await expect(
      writer.patchSection('ghost', 'human_takeover', () => ({ enabled: true, pause_ttl_minutes: 30 })),
    ).rejects.toThrow(/ghost/);
  });

  it('readSection returns current value (or undefined when missing)', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    expect(writer.readSection('amina', 'human_takeover')).toBeUndefined();
    await writer.patchSection('amina', 'human_takeover', () => ({ enabled: true, pause_ttl_minutes: 30 }));
    expect(writer.readSection('amina', 'human_takeover')).toMatchObject({ enabled: true, pause_ttl_minutes: 30 });
  });

  it('readFullConfig returns full parsed YAML', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const cfg = writer.readFullConfig('amina') as Record<string, unknown>;
    expect(cfg.safety_profile).toBe('chat_like_openclaw');
  });
});

describe('AgentConfigWriter — schema validation + backups', () => {
  let agentsDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'acw-val-'));
    mkdirSync(join(agentsDir, 'amina'), { recursive: true });
    writeFileSync(join(agentsDir, 'amina', 'agent.yml'), SEED_YAML);
  });
  afterEach(() => rmSync(agentsDir, { recursive: true, force: true }));

  it('rejects patch that produces invalid YAML schema and leaves file unchanged', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const before = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    await expect(
      writer.patchSection('amina', 'human_takeover', () => ({
        enabled: true,
        pause_ttl_minutes: -1,
      })),
    ).rejects.toThrow(/pause_ttl_minutes/);
    const after = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    expect(after).toBe(before);
    expect(after).not.toContain('-1');
  });

  it('creates a timestamped backup before each write', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const result = await writer.patchSection('amina', 'human_takeover', () => ({
      enabled: true,
      pause_ttl_minutes: 30,
    }));
    const files = readdirSync(join(agentsDir, 'amina'));
    expect(files.some((f) => f.startsWith('agent.yml.bak-'))).toBe(true);
    expect(result.backupPath).toContain('agent.yml.bak-');
  });

  it('prunes backups beyond backupKeep', async () => {
    const writer = createAgentConfigWriter({ agentsDir, backupKeep: 3 });
    for (let i = 0; i < 5; i++) {
      await writer.patchSection('amina', 'human_takeover', () => ({
        enabled: i % 2 === 0,
        pause_ttl_minutes: 30 + i,
      }));
    }
    const backups = readdirSync(join(agentsDir, 'amina')).filter((f) =>
      f.startsWith('agent.yml.bak-'),
    );
    expect(backups).toHaveLength(3);
  });
});

describe('AgentConfigWriter — audit integration', () => {
  let agentsDir: string;
  let auditDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'acw-aud-'));
    auditDir = mkdtempSync(join(tmpdir(), 'acw-aud-log-'));
    mkdirSync(join(agentsDir, 'amina'), { recursive: true });
    writeFileSync(join(agentsDir, 'amina', 'agent.yml'), SEED_YAML);
  });
  afterEach(() => {
    rmSync(agentsDir, { recursive: true, force: true });
    rmSync(auditDir, { recursive: true, force: true });
  });

  it('emits audit entry with caller context after each successful write', async () => {
    const auditLog = createConfigAuditLog({ auditDir });
    const writer = createAgentConfigWriter({ agentsDir, auditLog });
    await writer.patchSection(
      'amina',
      'human_takeover',
      () => ({ enabled: true, pause_ttl_minutes: 30 }),
      { caller: 'klavdia', callerSession: 'tg:control:dm:1', source: 'chat', action: 'set_enabled' },
    );
    const entries = await auditLog.readRecent('amina');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      callerAgent: 'klavdia',
      callerSession: 'tg:control:dm:1',
      targetAgent: 'amina',
      section: 'human_takeover',
      action: 'set_enabled',
      source: 'chat',
    });
    expect(entries[0].new).toMatchObject({ enabled: true });
  });

  it('does not emit audit entry on failed validation', async () => {
    const auditLog = createConfigAuditLog({ auditDir });
    const writer = createAgentConfigWriter({ agentsDir, auditLog });
    await expect(
      writer.patchSection(
        'amina',
        'human_takeover',
        () => ({ enabled: true, pause_ttl_minutes: -5 }),
        { caller: 'klavdia', source: 'chat' },
      ),
    ).rejects.toThrow();
    const entries = await auditLog.readRecent('amina');
    expect(entries).toHaveLength(0);
  });

  it('audit log append failure does not reject the committed write', async () => {
    // Audit log that always rejects. Write is already committed by the time
    // append runs, so the caller MUST get a resolved result and the file
    // MUST be on disk. A rejected audit append would force the UI/caller to
    // retry, producing redundant writes + extra backups.
    const failingAudit: ConfigAuditLog = {
      append: () => Promise.reject(new Error('audit dir not writable')),
      readRecent: () => Promise.resolve([]),
    };
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as unknown as void);
    try {
      const writer = createAgentConfigWriter({ agentsDir, auditLog: failingAudit });
      const result = await writer.patchSection('amina', 'human_takeover', () => ({
        enabled: true,
        pause_ttl_minutes: 30,
      }));
      expect(result.newValue).toMatchObject({ enabled: true, pause_ttl_minutes: 30 });
      const after = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
      expect(after).toContain('human_takeover:');
      expect(after).toContain('pause_ttl_minutes: 30');
      // The warn-and-swallow path emitted a structured warning.
      const warnedAuditFailure = warnSpy.mock.calls.some((call) => {
        const ctx = call[0] as Record<string, unknown> | undefined;
        const msg = call[1];
        return (
          typeof msg === 'string' &&
          msg.includes('audit log append failed') &&
          ctx !== undefined &&
          (ctx as { agentId?: unknown }).agentId === 'amina'
        );
      });
      expect(warnedAuditFailure).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('AgentConfigWriter — clock injection', () => {
  let agentsDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'acw-clk-'));
    mkdirSync(join(agentsDir, 'amina'), { recursive: true });
    writeFileSync(join(agentsDir, 'amina', 'agent.yml'), SEED_YAML);
  });
  afterEach(() => rmSync(agentsDir, { recursive: true, force: true }));

  it('uses injected clock for backup filename timestamp and writtenAt', async () => {
    const fixed = Date.parse('2026-05-01T12:34:56.789Z');
    const writer = createAgentConfigWriter({ agentsDir, clock: () => fixed });
    const result = await writer.patchSection('amina', 'human_takeover', () => ({
      enabled: true,
      pause_ttl_minutes: 30,
    }));
    expect(result.writtenAt).toBe('2026-05-01T12:34:56.789Z');
    // Backup filename embeds the same timestamp (with `:` and `.` flattened
    // to `-`). The seq suffix still helps with same-millisecond collisions.
    expect(result.backupPath).toContain('agent.yml.bak-2026-05-01T12-34-56-789Z-');
  });
});
