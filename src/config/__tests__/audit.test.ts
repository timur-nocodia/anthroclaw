import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createConfigAuditLog } from '../audit.js';

describe('ConfigAuditLog', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audit-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends a JSONL entry per write with snake_case keys', async () => {
    const log = createConfigAuditLog({ auditDir: dir });
    await log.append({
      callerAgent: 'klavdia',
      callerSession: 'telegram:control:dm:48705953',
      targetAgent: 'amina',
      section: 'notifications',
      action: 'add_subscription',
      prev: null,
      new: { event: 'peer_pause_started', route: 'operator' },
      source: 'chat',
    });
    const file = readFileSync(join(dir, 'amina.jsonl'), 'utf-8');
    const lines = file.trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({
      caller_agent: 'klavdia',
      caller_session: 'telegram:control:dm:48705953',
      target_agent: 'amina',
      section: 'notifications',
      action: 'add_subscription',
      source: 'chat',
    });
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rotates file at maxFileBytes', async () => {
    const log = createConfigAuditLog({ auditDir: dir, maxFileBytes: 200, maxFiles: 3 });
    for (let i = 0; i < 10; i++) {
      await log.append({
        callerAgent: 'klavdia',
        targetAgent: 'amina',
        section: 'notifications',
        action: 'noop',
        prev: null,
        new: { i },
        source: 'chat',
      });
    }
    const files = readdirSync(dir).filter((f) => f.startsWith('amina.jsonl'));
    expect(files.length).toBeGreaterThan(1);
    expect(files.length).toBeLessThanOrEqual(3);
  });

  it('readRecent returns most recent N entries newest-first', async () => {
    let now = Date.parse('2026-05-01T10:00:00Z');
    const log = createConfigAuditLog({ auditDir: dir, clock: () => new Date(now) });
    for (let i = 0; i < 5; i++) {
      await log.append({
        callerAgent: 'k',
        targetAgent: 'amina',
        section: 'human_takeover',
        action: 'noop',
        prev: null,
        new: { i },
        source: 'chat',
      });
      now += 1000;
    }
    const recent = await log.readRecent('amina', { limit: 3 });
    expect(recent).toHaveLength(3);
    expect(recent[0].new).toMatchObject({ i: 4 });
  });

  it('readRecent filters by section', async () => {
    const log = createConfigAuditLog({ auditDir: dir });
    await log.append({
      callerAgent: 'k',
      targetAgent: 'amina',
      section: 'notifications',
      action: 'noop',
      prev: null,
      new: { i: 0 },
      source: 'chat',
    });
    await log.append({
      callerAgent: 'k',
      targetAgent: 'amina',
      section: 'human_takeover',
      action: 'noop',
      prev: null,
      new: { i: 1 },
      source: 'chat',
    });
    const ht = await log.readRecent('amina', { section: 'human_takeover' });
    expect(ht).toHaveLength(1);
    expect(ht[0].new).toMatchObject({ i: 1 });
  });

  it('readRecent returns empty when no log file', async () => {
    const log = createConfigAuditLog({ auditDir: dir });
    expect(await log.readRecent('ghost')).toEqual([]);
  });

  it('readRecent skips malformed lines and entries with invalid section', async () => {
    // Hand-craft a log file with a mix of valid + corrupt + tampered lines.
    // The deserializer must drop bad rows rather than coerce them.
    const path = join(dir, 'amina.jsonl');
    appendFileSync(
      path,
      [
        // Valid entry.
        JSON.stringify({
          ts: '2026-05-01T10:00:00.000Z',
          caller_agent: 'k',
          target_agent: 'amina',
          section: 'human_takeover',
          action: 'noop',
          prev: null,
          new: { i: 1 },
          source: 'chat',
        }),
        // Invalid JSON.
        '{not valid json',
        // Tampered: section is not in VALID_SECTIONS.
        JSON.stringify({
          ts: '2026-05-01T10:00:01.000Z',
          caller_agent: 'k',
          target_agent: 'amina',
          section: 'evil_payload',
          action: 'noop',
          prev: null,
          new: { i: 2 },
          source: 'chat',
        }),
        // Missing required field (target_agent).
        JSON.stringify({ ts: '2026-05-01T10:00:02.000Z', section: 'human_takeover' }),
        // Another valid entry.
        JSON.stringify({
          ts: '2026-05-01T10:00:03.000Z',
          caller_agent: 'k',
          target_agent: 'amina',
          section: 'notifications',
          action: 'noop',
          prev: null,
          new: { i: 3 },
          source: 'chat',
        }),
        '',
      ].join('\n'),
      'utf-8',
    );
    const log = createConfigAuditLog({ auditDir: dir });
    const entries = await log.readRecent('amina');
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => (e.new as { i: number }).i).sort()).toEqual([1, 3]);
    expect(entries.every((e) => e.section === 'human_takeover' || e.section === 'notifications')).toBe(true);
  });
});
