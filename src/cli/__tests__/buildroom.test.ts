import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
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

  it('runs deterministic collect, propose, and review without build authority', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });

    out.length = 0;
    await expect(run(['collect', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Research packet:');
    const research = store.listArtifacts('research_packet')[0];
    expect(research).toMatchObject({
      type: 'research_packet',
      status: 'completed',
      payload: {
        coverage: { partial: false },
        sourcePolicyResult: { allowed: true },
      },
    });

    out.length = 0;
    await expect(run(['propose', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Idea contract:');
    const idea = store.listArtifacts('idea_contract')[0];
    expect(idea.parentIds).toEqual([research.id]);

    out.length = 0;
    await expect(run(['review', idea.id, '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Main review:');
    const review = store.listArtifacts('main_review')[0];
    expect(review).toMatchObject({
      type: 'main_review',
      status: 'completed',
      parentIds: [idea.id],
      payload: {
        decision: 'approved_for_operator',
        lockedScope: {
          allowedPaths: ['docs/Auto-Buildroom/examples/**', 'tests/fixtures/auto-buildroom/**'],
        },
      },
    });
  });

  it('creates a build plan from approval without starting Builder runtime', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    await run(['collect', '--root', root]);
    await run(['propose', '--root', root]);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    const idea = store.listArtifacts('idea_contract')[0];
    await run(['review', idea.id, '--root', root]);
    const review = store.listArtifacts('main_review')[0];
    await run(['approve', review.id, '--root', root, '--operator', 'cli:user:local-operator']);
    const approval = store.listArtifacts('approval')[0];

    out.length = 0;
    await expect(run(['build', approval.id, '--root', root])).resolves.toBe(0);

    expect(out.join('\n')).toContain('Build plan:');
    expect(out.join('\n')).toContain('Builder runtime not started.');
    const plan = store.listArtifacts('build_plan')[0];
    expect(plan).toMatchObject({
      type: 'build_plan',
      status: 'ready',
      parentIds: [approval.id, review.id],
      payload: {
        approvalId: approval.id,
        reviewId: review.id,
        executionBoundary: 'not_started',
      },
    });
    expect(store.readArtifact(approval.id).payload.consumedAt).toBeNull();

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Approved not built: 0');
  });

  it('does not create duplicate build plans for the same approval', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: { allowedPaths: ['docs/**'], blockedPaths: ['.env'] },
      }),
    );
    await run(['approve', 'review_20260512_docs', '--root', root]);

    await expect(run(['build', 'approval_20260512_docs', '--root', root])).resolves.toBe(0);
    await expect(run(['build', 'approval_20260512_docs', '--root', root])).resolves.toBe(0);

    expect(store.listArtifacts('build_plan').map((plan) => plan.id)).toEqual([
      'plan_20260512_docs',
    ]);
    expect(out.join('\n')).toContain('Existing build plan: plan_20260512_docs');
  });

  it('rejects build from a review without approval', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: { allowedPaths: ['docs/**'], blockedPaths: ['.env'] },
      }),
    );

    await expect(run(['build', 'review_20260512_docs', '--root', root])).resolves.toBe(4);

    expect(err.join('\n')).toContain('Build requires an approval or build_plan artifact');
    expect(store.listArtifacts('build_plan')).toEqual([]);
  });

  it('blocks new stages when mode is off while status remains inspectable', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    updateRoomConfig((config) => ({ ...config, mode: 'off' }));

    await expect(run(['collect', '--root', root])).resolves.toBe(8);
    expect(err.join('\n')).toContain('Buildroom mode is off');

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Mode: off');
  });

  it('pauses and resumes stage execution while status remains inspectable', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);

    out.length = 0;
    await expect(run(['pause', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Buildroom paused');

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Paused: yes');

    err.length = 0;
    await expect(run(['collect', '--root', root])).resolves.toBe(8);
    expect(err.join('\n')).toContain('Buildroom is paused');

    out.length = 0;
    await expect(run(['resume', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Buildroom resumed');

    await expect(run(['collect', '--root', root])).resolves.toBe(0);
  });

  it('blocks build when kill switch is active', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: { allowedPaths: ['docs/**'], blockedPaths: ['.env'] },
      }),
    );
    await run(['approve', 'review_20260512_docs', '--root', root]);
    updateRoomConfig((config) => ({ ...config, killSwitchActive: true }));

    await expect(run(['build', 'approval_20260512_docs', '--root', root])).resolves.toBe(8);

    expect(err.join('\n')).toContain('Kill switch is active');
    expect(store.listArtifacts('build_plan')).toEqual([]);
  });

  it('validates config and artifact hashes', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    await run(['collect', '--root', root]);

    out.length = 0;
    await expect(run(['validate', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Buildroom validation: ok');
  });

  it('fails validation when an artifact hash no longer matches content', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    await run(['collect', '--root', root]);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    const research = store.listArtifacts('research_packet')[0];
    const path = store.pathForArtifact(research);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as BuildroomArtifact;
    raw.payload = { tampered: true };
    writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');

    await expect(run(['validate', '--root', root])).resolves.toBe(4);

    expect(err.join('\n')).toContain('Artifact hash mismatch');
  });

  it('creates QA and Trust receipts for an existing coder receipt', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('build_20260512_docs', 'coder_receipt', {
        runtimeStatus: 'completed',
        builderClaims: ['Updated operator guide.'],
        postRunPolicyResult: {
          allowed: true,
          changedFiles: ['docs/guide.md'],
          violations: [],
        },
      }),
    );

    out.length = 0;
    await expect(run(['qa', 'build_20260512_docs', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('QA report: qa_20260512_docs');
    expect(store.readArtifact('qa_20260512_docs')).toMatchObject({
      type: 'qa_report',
      parentIds: ['build_20260512_docs'],
      payload: {
        qaStatus: 'pass',
        evidence: [{ claim: 'Updated operator guide.', status: 'confirmed' }],
      },
    });

    out.length = 0;
    await expect(run(['trust', 'build_20260512_docs', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Trust report: trust_20260512_docs');
    expect(out.join('\n')).toContain('Trust: CLEAN');
    expect(store.readArtifact('delta_20260512_docs')).toMatchObject({
      type: 'verification_delta',
      parentIds: ['qa_20260512_docs', 'build_20260512_docs'],
    });
    expect(store.readArtifact('trust_20260512_docs')).toMatchObject({
      type: 'trust_report',
      status: 'clean',
      payload: { trustState: 'clean' },
    });

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Latest trust: clean');
    expect(out.join('\n')).toContain('QA pending: 0');
  });

  it('rejects trust when QA receipt is missing', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('build_20260512_docs', 'coder_receipt', {
        runtimeStatus: 'completed',
        builderClaims: ['Updated operator guide.'],
        postRunPolicyResult: { allowed: true, changedFiles: [], violations: [] },
      }),
    );

    await expect(run(['trust', 'build_20260512_docs', '--root', root])).resolves.toBe(5);

    expect(err.join('\n')).toContain('QA report not found for build_20260512_docs');
    expect(store.listArtifacts('trust_report')).toEqual([]);
  });

  it('renders and saves an operator report from latest trust receipt', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('build_20260512_docs', 'coder_receipt', {
        runtimeStatus: 'completed',
        builderClaims: ['Updated operator guide.'],
        postRunPolicyResult: { allowed: true, changedFiles: ['docs/guide.md'], violations: [] },
      }),
    );
    await run(['qa', 'build_20260512_docs', '--root', root]);
    await run(['trust', 'build_20260512_docs', '--root', root]);

    out.length = 0;
    await expect(run(['report', '--root', root, '--save'])).resolves.toBe(0);

    expect(out.join('\n')).toContain('Trust: CLEAN');
    expect(out.join('\n')).toContain('Receipt: trust_20260512_docs');
    const summary = store.readArtifact('summary_20260512_docs');
    expect(summary).toMatchObject({
      type: 'operator_summary',
      status: 'generated',
      parentIds: ['trust_20260512_docs'],
      payload: {
        reportType: 'trust',
        format: 'markdown',
        renderedFromIds: ['trust_20260512_docs'],
        trustStateAtRenderTime: 'clean',
      },
    });
    expect(summary.outputRefs[0]).toMatchObject({
      kind: 'file',
      ref: expect.stringContaining('summary_20260512_docs.md'),
    });
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

  function updateRoomConfig(
    update: (config: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    const path = join(
      root,
      '.anthroclaw',
      'auto-buildroom',
      'rooms',
      'anthroclaw-core',
      'buildroom.yml',
    );
    const config = parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
    writeFileSync(path, stringifyYaml(update(config)), 'utf8');
  }
});
