import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDiagnostics, type CheckResult } from '../../src/cli/doctor.js';

describe('runDiagnostics', () => {
  let tempDir: string;
  let dataDir: string;
  let agentsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'doctor-test-'));
    dataDir = join(tempDir, 'data');
    agentsDir = join(tempDir, 'agents');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function findCheck(results: CheckResult[], name: string): CheckResult {
    const check = results.find((r) => r.name === name);
    if (!check) throw new Error(`Check "${name}" not found in results`);
    return check;
  }

  // ─── Node version ──────────────────────────────────────────────

  it('reports Node version as ok (we are running on Node 22+)', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'test-agent'), { recursive: true });

    const results = await runDiagnostics({
      dataDir,
      agentsDir,
      globalConfig: { some: 'config' },
    });

    const check = findCheck(results, 'Node version');
    expect(check.status).toBe('ok');
    expect(check.message).toContain(process.version);
  });

  // ─── Data directory ────────────────────────────────────────────

  it('reports data directory as ok when it exists', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'test-agent'), { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    const check = findCheck(results, 'Data directory');
    expect(check.status).toBe('ok');
  });

  it('reports data directory as warn when missing', async () => {
    mkdirSync(join(agentsDir, 'test-agent'), { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    const check = findCheck(results, 'Data directory');
    expect(check.status).toBe('warn');
    expect(check.fix).toBe('Create directory');
  });

  // ─── Agents directory ──────────────────────────────────────────

  it('reports agents directory as ok with subdirectories', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'my-agent'), { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    const check = findCheck(results, 'Agents directory');
    expect(check.status).toBe('ok');
    expect(check.message).toContain('1 agent(s) found');
  });

  it('reports agents directory as error when missing', async () => {
    mkdirSync(dataDir, { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    const check = findCheck(results, 'Agents directory');
    expect(check.status).toBe('error');
  });

  it('reports agents directory as error with no subdirectories', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(agentsDir, { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    const check = findCheck(results, 'Agents directory');
    expect(check.status).toBe('error');
    expect(check.message).toContain('no agent subdirectories');
  });

  // ─── Config ────────────────────────────────────────────────────

  it('reports config as ok when globalConfig is truthy', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'agent'), { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: { key: 'val' } });
    const check = findCheck(results, 'Config file');
    expect(check.status).toBe('ok');
  });

  it('reports config as error when globalConfig is undefined', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'agent'), { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir });
    const check = findCheck(results, 'Config file');
    expect(check.status).toBe('error');
    expect(check.fix).toBe('Create config.yml');
  });

  // ─── Native SDK auth ───────────────────────────────────────────

  it('reports native SDK auth status based on env var', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'agent'), { recursive: true });

    const originalToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;

    // Test with token set
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'test-token';
    let results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    let check = findCheck(results, 'Native SDK auth');
    expect(check.status).toBe('ok');

    // Test with token unset. This may still be ok if ~/.claude exists locally,
    // so assert only the check shape and failure guidance when it errors.
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    check = findCheck(results, 'Native SDK auth');
    expect(['ok', 'error']).toContain(check.status);
    if (check.status === 'error') {
      expect(check.fix).toBe('Run claude login or set CLAUDE_CODE_OAUTH_TOKEN');
    }

    // Restore
    if (originalToken !== undefined) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = originalToken;
    }
  });

  // ─── Memory store ──────────────────────────────────────────────

  it('reports memory store as ok when memory.db exists', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'agent'), { recursive: true });
    writeFileSync(join(dataDir, 'memory.db'), '');

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    const check = findCheck(results, 'Memory store');
    expect(check.status).toBe('ok');
  });

  it('reports memory store as warn when not created', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'agent'), { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    const check = findCheck(results, 'Memory store');
    expect(check.status).toBe('warn');
    expect(check.message).toContain('not yet created');
  });

  // ─── Rate limits ───────────────────────────────────────────────

  it('reports rate limits as ok whether file exists or not', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'agent'), { recursive: true });

    // Without file
    let results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    let check = findCheck(results, 'Rate limits');
    expect(check.status).toBe('ok');
    expect(check.message).toContain('will be created');

    // With file
    writeFileSync(join(dataDir, 'rate-limits.json'), '{}');
    results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });
    check = findCheck(results, 'Rate limits');
    expect(check.status).toBe('ok');
  });

  // ─── Dependencies ──────────────────────────────────────────────

  it('reports dependencies as ok for installed packages', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'agent'), { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });

    const pino = findCheck(results, 'Dependency: pino');
    expect(pino.status).toBe('ok');

    const zod = findCheck(results, 'Dependency: zod');
    expect(zod.status).toBe('ok');

    const sqlite = findCheck(results, 'Dependency: better-sqlite3');
    expect(sqlite.status).toBe('ok');
  });

  // ─── Full run structure ────────────────────────────────────────

  it('returns all expected checks', async () => {
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(join(agentsDir, 'agent'), { recursive: true });

    const results = await runDiagnostics({ dataDir, agentsDir, globalConfig: true });

    const names = results.map((r) => r.name);
    expect(names).toContain('Node version');
    expect(names).toContain('Data directory');
    expect(names).toContain('Agents directory');
    expect(names).toContain('Config file');
    expect(names).toContain('Native SDK auth');
    expect(names).toContain('Memory store');
    expect(names).toContain('Rate limits');
    expect(names).toContain('Dependency: pino');
    expect(names).toContain('Dependency: zod');
    expect(names).toContain('Dependency: better-sqlite3');
    expect(results.length).toBe(10);
  });
});
