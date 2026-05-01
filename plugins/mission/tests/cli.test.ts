import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMissionCli } from '../src/cli.js';

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text: string) => stdout.push(text),
      stderr: (text: string) => stderr.push(text),
    },
  };
}

describe('mission CLI', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mission-cli-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates and reads an active mission', async () => {
    const create = io();
    const createCode = await runMissionCli([
      'create',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
      '--title', 'Release 0.6',
      '--goal', 'Ship Mission State',
      '--state', 'CLI is next',
      '--next', 'add export',
    ], create.io);

    expect(createCode).toBe(0);
    expect(create.stdout[0]).toMatch(/Created mission mission_/);

    const status = io();
    const statusCode = await runMissionCli([
      'status',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
    ], status.io);

    expect(statusCode).toBe(0);
    expect(status.stdout.join('\n')).toContain('Release 0.6');
    expect(status.stdout.join('\n')).toContain('add export');
  });

  it('prints status as JSON', async () => {
    await runMissionCli([
      'create',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
      '--title', 'Ops',
      '--goal', 'Track operations',
    ], io().io);

    const out = io();
    const code = await runMissionCli([
      'status',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
      '--json',
    ], out.io);

    expect(code).toBe(0);
    const parsed = JSON.parse(out.stdout[0]) as { active: boolean; mission: { title: string } };
    expect(parsed.active).toBe(true);
    expect(parsed.mission.title).toBe('Ops');
  });

  it('exports active mission as markdown', async () => {
    await runMissionCli([
      'create',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
      '--title', 'Exportable',
      '--goal', 'Produce markdown snapshot',
    ], io().io);

    const out = io();
    const code = await runMissionCli([
      'export',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
    ], out.io);

    expect(code).toBe(0);
    expect(out.stdout[0]).toContain('# Exportable');
    expect(out.stdout[0]).toContain('## Current State');
  });

  it('archives without deleting mission data', async () => {
    const create = io();
    await runMissionCli([
      'create',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
      '--title', 'Temporary',
      '--goal', 'Archive me',
      '--json',
    ], create.io);
    const missionId = (JSON.parse(create.stdout[0]) as { mission: { id: string } }).mission.id;

    const archive = io();
    const archiveCode = await runMissionCli([
      'archive',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
      '--reason', 'done',
    ], archive.io);

    expect(archiveCode).toBe(0);
    expect(archive.stdout[0]).toContain('Archived mission');

    const status = io();
    await runMissionCli([
      'status',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
    ], status.io);
    expect(status.stdout[0]).toContain('No active mission');

    const exported = io();
    const exportCode = await runMissionCli([
      'export',
      '--data-dir', dataDir,
      '--agent', 'agent-1',
      '--mission', missionId,
      '--json',
    ], exported.io);
    expect(exportCode).toBe(0);
    const parsed = JSON.parse(exported.stdout[0]) as { mission: { status: string } };
    expect(parsed.mission.status).toBe('archived');
  });
});
