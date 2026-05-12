import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '../../auto-buildroom/artifacts/store.js';
import type { BuildroomArtifact } from '../../auto-buildroom/artifacts/model.js';
import { runBuildroomCli } from '../buildroom.js';

describe('buildroom CLI', () => {
  let root: string;
  const out: string[] = [];
  const err: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-buildroom-cli-'));
    out.length = 0;
    err.length = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('initializes a manual approval room and reports status', async () => {
    await expect(
      run(['init', '--root', root, '--room', 'anthroclaw-core', '--operator', 'cli:user:local-operator']),
    ).resolves.toBe(0);

    expect(out.join('\n')).toContain('Buildroom initialized');
    expect(out.join('\n')).toContain('Mode: manual_approval');
    expect(out.join('\n')).toContain('External side effects: denied');

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);

    expect(out.join('\n')).toContain('Buildroom: anthroclaw-core');
    expect(out.join('\n')).toContain('Mode: manual_approval');
    expect(out.join('\n')).toContain('Kill switch: inactive');
    expect(out.join('\n')).toContain('Approved not built: 0');
  });

  it('refuses init when operator identity is invalid', async () => {
    await expect(
      run(['init', '--root', root, '--room', 'anthroclaw-core', '--operator', 'telegram_chat:-1003931616911']),
    ).resolves.toBe(3);

    expect(err.join('\n')).toContain('Telegram chat/thread route is not operator identity');
  });

  it('shows receipts and approves only locked Main Review artifacts', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: {
          allowedPaths: ['docs/Auto-Buildroom/**'],
          blockedPaths: ['.env', 'agents/**'],
        },
      }),
    );

    out.length = 0;
    await expect(run(['show', 'review_20260512_docs', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Receipt: review_20260512_docs');
    expect(out.join('\n')).toContain('Type: main_review');

    out.length = 0;
    await expect(
      run([
        'approve',
        'review_20260512_docs',
        '--root',
        root,
        '--operator',
        'cli:user:local-operator',
      ]),
    ).resolves.toBe(0);

    expect(out.join('\n')).toContain('Approval created: approval_20260512_docs');
    expect(out.join('\n')).toContain('Approval grants authority. Build consumes authority.');
    expect(store.readArtifact('approval_20260512_docs')).toMatchObject({
      type: 'approval',
      status: 'granted',
      parentIds: ['review_20260512_docs'],
      payload: {
        approvedBy: 'cli:user:local-operator',
        approvalRoute: 'cli:local',
      },
    });

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Approved not built: 1');
  });

  it('rejects CLI approval for raw ideas', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(artifact('idea_20260512_docs', 'idea_contract', { title: 'Raw idea' }));

    await expect(
      run(['approve', 'idea_20260512_docs', '--root', root, '--operator', 'cli:user:local-operator']),
    ).resolves.toBe(4);

    expect(err.join('\n')).toContain('Approval target must be a main_review artifact');
    expect(store.hasArtifact('approval_20260512_docs')).toBe(false);
  });

  function artifact(
    id: string,
    type: BuildroomArtifact['type'],
    payload: Record<string, unknown>,
  ): BuildroomArtifact {
    return {
      id,
      type,
      schemaVersion: 'auto-buildroom/v1',
      status: 'completed',
      createdAt: '2026-05-12T00:00:00.000Z',
      producer: { role: 'test', runId: `run_${id}` },
      room: { id: 'anthroclaw-core' },
      parentIds: [],
      inputRefs: [],
      outputRefs: [],
      runtimeRefs: [],
      traceId: `trace_${id}`,
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
        redactedFields: [],
      },
      contentHash: '',
      payload,
    };
  }

  function run(argv: string[]): Promise<number> {
    return runBuildroomCli(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    });
  }
});
