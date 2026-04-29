import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportLearningArtifacts } from '../artifacts.js';

describe('exportLearningArtifacts', () => {
  let root: string;
  let workspacePath: string;
  let dataDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-artifacts-'));
    workspacePath = join(root, 'workspace');
    dataDir = join(root, 'data');
    mkdirSync(join(workspacePath, 'src'), { recursive: true });
    mkdirSync(join(workspacePath, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(workspacePath, 'src', 'agent.md'), 'Token: sk-ant-api03-abcdefghijklmnopqrstuvwxyz\nKeep this workflow.\n');
    writeFileSync(join(workspacePath, '.env'), 'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz\n');
    writeFileSync(join(workspacePath, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
    writeFileSync(join(workspacePath, 'image.bin'), Buffer.from([0, 1, 2, 3, 4]));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exports redacted files, snippets, and a manifest', () => {
    const result = exportLearningArtifacts({
      dataDir,
      workspacePath,
      agentId: 'agent/a',
      runId: 'run:1',
      createdAt: 123,
      files: [
        { path: 'src/agent.md', reason: 'correction context' },
        { path: '.env', reason: 'must be ignored' },
        { path: 'node_modules/pkg/index.js', reason: 'must be ignored' },
        { path: 'image.bin', reason: 'must be ignored' },
      ],
      snippets: [
        {
          id: 'conversation',
          title: 'User correction',
          text: 'User said token=abcdefghijklmnopqrstuvwxyz1234567890 should never leak.',
          reason: 'latest correction',
        },
      ],
    });

    expect(result.manifest).toMatchObject({
      version: 1,
      agentId: 'agent/a',
      runId: 'run:1',
      createdAt: 123,
    });
    expect(result.manifest.files).toHaveLength(1);
    expect(result.manifest.files[0]).toMatchObject({
      sourcePath: 'src/agent.md',
      artifactPath: 'files/src/agent.md',
      reason: 'correction context',
    });
    expect(result.manifest.snippets).toHaveLength(1);
    expect(result.manifest.omitted.map((entry) => entry.reason)).toEqual(expect.arrayContaining([
      'ignored_env',
      'ignored_node_modules',
      'binary_or_media',
    ]));

    const exported = readFileSync(join(result.outputDir, 'files', 'src', 'agent.md'), 'utf8');
    expect(exported).toContain('****');
    expect(exported).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(result.manifest.promptContext).toContain('## File: src/agent.md');
    expect(result.manifest.promptContext).toContain('## Snippet: User correction');

    const manifestJson = readFileSync(result.manifestPath, 'utf8');
    expect(JSON.parse(manifestJson)).toEqual(result.manifest);
  });

  it('enforces workspace and size limits', () => {
    writeFileSync(join(workspacePath, 'src', 'large.txt'), 'x'.repeat(20));
    writeFileSync(join(root, 'outside.txt'), 'outside');

    const result = exportLearningArtifacts({
      dataDir,
      workspacePath,
      agentId: 'agent-a',
      runId: 'run-2',
      createdAt: 200,
      files: [
        { path: '../outside.txt', reason: 'outside' },
        { path: 'src/large.txt', reason: 'too large' },
        { path: 'src/agent.md', reason: 'allowed' },
      ],
      limits: {
        maxFileBytes: 18,
        maxTotalBytes: 128,
      },
    });

    expect(result.manifest.files).toHaveLength(0);
    expect(result.manifest.omitted).toEqual(expect.arrayContaining([
      { path: '../outside.txt', reason: 'outside_workspace' },
      { path: 'src/large.txt', reason: 'max_file_bytes_exceeded' },
      { path: 'src/agent.md', reason: 'max_file_bytes_exceeded' },
    ]));
  });

  it('writes deterministic manifest content when inputs and createdAt are stable', () => {
    const first = exportLearningArtifacts({
      dataDir,
      workspacePath,
      agentId: 'agent-a',
      runId: 'run-stable',
      createdAt: 300,
      files: [{ path: 'src/agent.md', reason: 'context' }],
      snippets: [{ id: 'b', text: 'two', reason: 'second' }, { id: 'a', text: 'one', reason: 'first' }],
    });
    const firstJson = readFileSync(first.manifestPath, 'utf8');

    rmSync(first.outputDir, { recursive: true, force: true });

    const second = exportLearningArtifacts({
      dataDir,
      workspacePath,
      agentId: 'agent-a',
      runId: 'run-stable',
      createdAt: 300,
      files: [{ path: 'src/agent.md', reason: 'context' }],
      snippets: [{ id: 'b', text: 'two', reason: 'second' }, { id: 'a', text: 'one', reason: 'first' }],
    });

    expect(readFileSync(second.manifestPath, 'utf8')).toBe(firstJson);
  });
});
