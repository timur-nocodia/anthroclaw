import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileArtifactStore } from '../artifacts/store.js';
import { runBuildroomCli } from '../../cli/buildroom.js';

describe('Auto-Buildroom Mode B E2E', () => {
  let root: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-mode-b-'));
    out = [];
    err = [];
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs the local receipt loop through a real worktree mutation and retention recommendation', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });

    await run(['collect', '--root', root]);
    await run(['propose', '--root', root]);
    const idea = store.listArtifacts('idea_contract')[0];
    await run(['review', idea.id, '--root', root]);
    const review = store.listArtifacts('main_review')[0];
    await run(['approve', review.id, '--root', root, '--operator', 'cli:user:local-operator']);
    const approval = store.listArtifacts('approval')[0];

    const adapter = {
      runBuilder: vi.fn().mockImplementation(async (input: { workingDirectory: string }) => {
        const target = join(input.workingDirectory, 'docs', 'Auto-Buildroom', 'examples');
        mkdirSync(target, { recursive: true });
        writeFileSync(
          join(target, 'operator-summary.md'),
          '# Operator Summary Example\n\nReceipt chain is visible.\n',
          'utf8',
        );
        return {
          status: 'completed' as const,
          resultText: 'Updated operator summary example.',
          runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_mode_b_builder' }],
        };
      }),
    };

    out.length = 0;
    await expect(run(
      ['build', approval.id, '--root', root, '--execute'],
      { builderAdapter: adapter, now: () => '2026-05-12T00:10:00.000Z' },
    )).resolves.toBe(0);

    expect(adapter.runBuilder).toHaveBeenCalledTimes(1);
    expect(out.join('\n')).toContain('Builder receipt:');
    const build = store.listArtifacts('coder_receipt')[0];
    expect(build.outputRefs).toEqual([
      {
        kind: 'file',
        ref: 'docs/Auto-Buildroom/examples/operator-summary.md',
        hash: expect.stringMatching(/^sha256:/),
      },
    ]);
    expect(build.payload.postRunPolicyResult).toMatchObject({
      allowed: true,
      changedFiles: ['docs/Auto-Buildroom/examples/operator-summary.md'],
      violations: [],
    });

    await run(['qa', build.id, '--root', root]);
    await run(['trust', build.id, '--root', root]);
    await run(['report', '--root', root, '--save']);
    const trust = store.listArtifacts('trust_report')[0];
    await run(['retain', trust.id, '--root', root]);

    expect(store.listArtifacts('qa_report')).toHaveLength(1);
    expect(store.listArtifacts('verification_delta')).toHaveLength(1);
    expect(store.listArtifacts('trust_report')[0]).toMatchObject({
      status: 'clean',
      payload: { trustState: 'clean' },
    });
    const summary = store.listArtifacts('operator_summary')[0];
    expect(readFileSync(summary.outputRefs[0].ref, 'utf8')).toContain('Trust: CLEAN');
    expect(store.listArtifacts('retention_review')[0]).toMatchObject({
      status: 'completed',
      payload: {
        recommendation: 'keep',
        destructiveCleanupAllowed: false,
      },
    });

    out.length = 0;
    await run(['status', '--root', root]);
    expect(out.join('\n')).toContain('State: complete');
    expect(out.join('\n')).toContain('Latest trust: clean');
  });

  async function run(
    argv: string[],
    deps: Parameters<typeof runBuildroomCli>[2] = {},
  ): Promise<number> {
    return runBuildroomCli(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    }, deps);
  }
});
