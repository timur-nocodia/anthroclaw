import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parsePiProductionCanaryAgentArgs,
  runPiProductionCanaryAgentCli,
} from '../pi-production-canary-agent.js';

const SEED_YAML = [
  '# canary candidate',
  'model: claude-sonnet-4-6',
  'safety_profile: chat_like_anthroclaw',
  'routes:',
  '  - channel: telegram',
  '    scope: dm',
  '',
].join('\n');

describe('pi production canary agent CLI', () => {
  let agentsDir: string;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-pi-canary-agent-'));
    agentsDir = join(root, 'agents');
    mkdirSync(join(agentsDir, 'example'), { recursive: true });
    writeFileSync(join(agentsDir, 'example', 'agent.yml'), SEED_YAML, 'utf-8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports status without changing agent.yml', async () => {
    const stdout = createWriter();
    const code = await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--json',
    ], { stdout, stderr: createWriter() });

    expect(code).toBe(0);
    expect(JSON.parse(stdout.text())).toMatchObject({
      agentId: 'example',
      currentProvider: 'claude-agent-sdk',
      desiredProvider: null,
      applied: false,
      changed: false,
    });
    expect(readFileSync(join(agentsDir, 'example', 'agent.yml'), 'utf-8')).toBe(SEED_YAML);
  });

  it('accepts pnpm-style -- argument separators', () => {
    expect(parsePiProductionCanaryAgentArgs(['--', '--agent', 'example', '--enable-pi']))
      .toMatchObject({
        agentId: 'example',
        provider: 'pi',
      });
  });

  it('dry-runs Pi enablement by default', async () => {
    const stdout = createWriter();
    const code = await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--enable-pi',
      '--json',
    ], { stdout, stderr: createWriter() });

    expect(code).toBe(0);
    expect(JSON.parse(stdout.text())).toMatchObject({
      currentProvider: 'claude-agent-sdk',
      desiredProvider: 'pi',
      applied: false,
      changed: true,
      backupPath: null,
    });
    expect(readFileSync(join(agentsDir, 'example', 'agent.yml'), 'utf-8')).toBe(SEED_YAML);
    expect(readdirSync(join(agentsDir, 'example')).filter((f) => f.startsWith('agent.yml.bak-'))).toHaveLength(0);
  });

  it('applies Pi enablement with validation and backup', async () => {
    const stdout = createWriter();
    const code = await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--enable-pi',
      '--apply',
      '--json',
    ], { stdout, stderr: createWriter() });

    expect(code).toBe(0);
    const result = JSON.parse(stdout.text());
    expect(result).toMatchObject({
      currentProvider: 'claude-agent-sdk',
      desiredProvider: 'pi',
      applied: true,
      changed: true,
    });
    expect(result.backupPath).toContain('agent.yml.bak-');

    const after = readFileSync(join(agentsDir, 'example', 'agent.yml'), 'utf-8');
    expect(after).toContain('# canary candidate');
    expect(after).toContain('runtime:');
    expect(after).toContain('headless:');
    expect(after).toContain('provider: pi');
    expect(readdirSync(join(agentsDir, 'example')).filter((f) => f.startsWith('agent.yml.bak-'))).toHaveLength(1);
  });

  it('rolls back to claude-agent-sdk explicitly', async () => {
    await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--enable-pi',
      '--apply',
    ], { stdout: createWriter(), stderr: createWriter() });

    const stdout = createWriter();
    const code = await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--rollback',
      '--apply',
      '--json',
    ], { stdout, stderr: createWriter() });

    expect(code).toBe(0);
    expect(JSON.parse(stdout.text())).toMatchObject({
      currentProvider: 'pi',
      desiredProvider: 'claude-agent-sdk',
      applied: true,
      changed: true,
    });
    expect(readFileSync(join(agentsDir, 'example', 'agent.yml'), 'utf-8')).toContain('provider: claude-agent-sdk');
  });

  it('restores the exact pre-canary backup without leaving a runtime override', async () => {
    const enableStdout = createWriter();
    await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--enable-pi',
      '--apply',
      '--json',
    ], { stdout: enableStdout, stderr: createWriter() });
    const enableResult = JSON.parse(enableStdout.text());
    const backupPath = enableResult.backupPath as string;

    const dryRunStdout = createWriter();
    const dryRunCode = await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--restore-backup', backupPath,
      '--json',
    ], { stdout: dryRunStdout, stderr: createWriter() });

    expect(dryRunCode).toBe(0);
    expect(JSON.parse(dryRunStdout.text())).toMatchObject({
      currentProvider: 'pi',
      desiredProvider: 'claude-agent-sdk',
      applied: false,
      changed: true,
      restoredFromBackupPath: backupPath,
    });
    expect(readFileSync(join(agentsDir, 'example', 'agent.yml'), 'utf-8')).toContain('provider: pi');

    const restoreStdout = createWriter();
    const restoreCode = await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--restore-backup', backupPath,
      '--apply',
      '--json',
    ], { stdout: restoreStdout, stderr: createWriter() });

    expect(restoreCode).toBe(0);
    const restoreResult = JSON.parse(restoreStdout.text());
    expect(restoreResult).toMatchObject({
      currentProvider: 'pi',
      desiredProvider: 'claude-agent-sdk',
      applied: true,
      changed: true,
      restoredFromBackupPath: backupPath,
    });
    expect(restoreResult.backupPath).toContain('agent.yml.bak-restore-');
    expect(readFileSync(join(agentsDir, 'example', 'agent.yml'), 'utf-8')).toBe(SEED_YAML);
  });

  it('rejects restore backups outside the target agent directory', async () => {
    const stderr = createWriter();
    const code = await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'example',
      '--restore-backup', join(root, 'agent.yml.bak-outside'),
      '--apply',
    ], { stdout: createWriter(), stderr });

    expect(code).toBe(1);
    expect(stderr.text()).toContain('inside the target agent directory');
  });

  it('rejects unknown providers and missing agents', async () => {
    expect(() => parsePiProductionCanaryAgentArgs(['--provider', 'other']))
      .toThrow(/Unknown provider/);

    const stderr = createWriter();
    const code = await runPiProductionCanaryAgentCli([
      '--agents-dir', agentsDir,
      '--agent', 'ghost',
    ], { stdout: createWriter(), stderr });

    expect(code).toBe(2);
    expect(stderr.text()).toContain('agent.yml not found');
  });
});

function createWriter() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}
