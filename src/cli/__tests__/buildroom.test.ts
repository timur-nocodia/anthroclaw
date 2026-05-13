import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('reports not initialized status instead of raw filesystem errors', async () => {
    await expect(run(['status', '--root', root])).resolves.toBe(0);

    expect(err).toEqual([]);
    expect(out.join('\n')).toContain('Buildroom is not initialized');
    expect(out.join('\n')).toContain('.anthroclaw/auto-buildroom/');
    expect(out.join('\n')).toContain('anthroclaw buildroom init');
  });

  it('refuses init when operator identity is invalid', async () => {
    await expect(
      run(['init', '--root', root, '--room', 'anthroclaw-core', '--operator', 'telegram_chat:-1003931616911']),
    ).resolves.toBe(3);

    expect(err.join('\n')).toContain('Telegram chat/thread route is not operator identity');
  });

  it('initializes Telegram command, approval, and notification routes', async () => {
    await expect(
      run([
        'init',
        '--root',
        root,
        '--room',
        'anthroclaw-core',
        '--operator',
        'telegram_user:48705953',
        '--telegram-command-route',
        'telegram_chat:-1003931616911',
        '--telegram-approval-route',
        'telegram_chat:-1003931616911',
        '--telegram-notification-route',
        'telegram_thread:-1003931616911:2',
      ]),
    ).resolves.toBe(0);

    const config = parseYaml(readFileSync(
      join(root, '.anthroclaw', 'auto-buildroom', 'rooms', 'anthroclaw-core', 'buildroom.yml'),
      'utf8',
    )) as {
      operators: Array<{
        id: string;
        commandRoutes: string[];
        approvalRoutes: string[];
      }>;
      notifications: { routes: string[] };
    };

    expect(config.operators[0]).toMatchObject({
      id: 'telegram_user:48705953',
      commandRoutes: ['cli:local', 'telegram_chat:-1003931616911'],
      approvalRoutes: ['cli:local', 'telegram_chat:-1003931616911'],
    });
    expect(config.notifications.routes).toEqual(['telegram_thread:-1003931616911:2']);
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
        '--operator-route',
        'telegram_chat:-1003931616911',
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
        approvalRoute: 'telegram_chat:-1003931616911',
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

  it('blocks approval authority while the room is off, paused, or kill-switched', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: { allowedPaths: ['docs/**'], blockedPaths: ['.env'] },
      }),
    );

    updateRoomConfig((config) => ({ ...config, mode: 'off' }));
    await expect(run(['approve', 'review_20260512_docs', '--root', root])).resolves.toBe(8);
    expect(err.join('\n')).toContain('Buildroom mode is off');

    err.length = 0;
    updateRoomConfig((config) => ({ ...config, mode: 'manual_approval', paused: true }));
    await expect(run(['approve', 'review_20260512_docs', '--root', root])).resolves.toBe(8);
    expect(err.join('\n')).toContain('Buildroom is paused');

    err.length = 0;
    updateRoomConfig((config) => ({
      ...config,
      paused: false,
      killSwitchActive: true,
    }));
    await expect(run(['approve', 'review_20260512_docs', '--root', root])).resolves.toBe(8);
    expect(err.join('\n')).toContain('Kill switch is active');
    expect(store.listArtifacts('approval')).toEqual([]);
  });

  it('creates a rejection receipt and blocks later approval for that review', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: { allowedPaths: ['docs/**'], blockedPaths: ['.env'] },
      }),
    );

    await expect(run(['reject', 'review_20260512_docs', '--root', root])).resolves.toBe(0);

    expect(out.join('\n')).toContain('Rejected: review_20260512_docs');
    const decision = store.readArtifact('decision_20260512_docs');
    expect(decision).toMatchObject({
      type: 'operator_decision',
      status: 'rejected',
      parentIds: ['review_20260512_docs'],
      payload: {
        decision: 'reject',
        targetArtifactId: 'review_20260512_docs',
        decidedBy: 'cli:user:local-operator',
        decisionRoute: 'cli:local',
      },
    });

    err.length = 0;
    await expect(run(['approve', 'review_20260512_docs', '--root', root])).resolves.toBe(4);
    expect(err.join('\n')).toContain('Artifact was rejected by operator');
    expect(store.listArtifacts('approval')).toEqual([]);
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
    expect(out.join('\n')).toContain('State: approved');
    expect(out.join('\n')).toContain('Approved not built: 1');
  });

  it('executes Builder only when build receives explicit execute flag', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: { allowedPaths: ['docs/**'], blockedPaths: ['.env'] },
      }),
    );
    await run(['approve', 'review_20260512_docs', '--root', root]);
    const adapter = {
      runBuilder: vi.fn().mockResolvedValue({
        status: 'completed',
        resultText: 'Updated docs through native runtime.',
        runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
      }),
    };

    out.length = 0;
    await expect(
      run(['build', 'approval_20260512_docs', '--root', root, '--execute'], {
        builderAdapter: adapter,
        now: () => '2026-05-12T00:10:00.000Z',
      }),
    ).resolves.toBe(0);

    expect(adapter.runBuilder).toHaveBeenCalledTimes(1);
    expect(out.join('\n')).toContain('Builder receipt: build_20260512_docs');
    expect(out.join('\n')).toContain('Runtime: completed');
    expect(store.readArtifact('approval_20260512_docs')).toMatchObject({
      status: 'consumed',
      payload: { consumedAt: '2026-05-12T00:10:00.000Z' },
    });
    expect(store.readArtifact('build_20260512_docs')).toMatchObject({
      type: 'coder_receipt',
      parentIds: ['plan_20260512_docs', 'approval_20260512_docs'],
      payload: {
        runtimeStatus: 'completed',
        builderClaims: ['Updated docs through native runtime.'],
      },
    });
  });

  it('returns runtime failure code when explicit Builder execution writes error receipt', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: { allowedPaths: ['docs/**'], blockedPaths: ['.env'] },
      }),
    );
    await run(['approve', 'review_20260512_docs', '--root', root]);
    const adapter = {
      runBuilder: vi.fn().mockResolvedValue({
        status: 'failed',
        errorType: 'runtime_error',
        message: 'native approval required',
        runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
      }),
    };

    out.length = 0;
    await expect(
      run(['build', 'approval_20260512_docs', '--root', root, '--execute'], {
        builderAdapter: adapter,
        now: () => '2026-05-12T00:10:00.000Z',
      }),
    ).resolves.toBe(6);

    expect(out.join('\n')).toContain('Builder error: error_20260512_docs');
    expect(store.readArtifact('error_20260512_docs')).toMatchObject({
      type: 'error_receipt',
      status: 'failed',
      payload: {
        stage: 'builder',
        errorType: 'runtime_error',
        message: 'native approval required',
      },
    });
    expect(store.readArtifact('approval_20260512_docs')).toMatchObject({
      status: 'consumed',
      payload: { consumedAt: '2026-05-12T00:10:00.000Z' },
    });
  });

  it('does not consume approval when explicit build is blocked by pre-run policy', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: { allowedPaths: ['../outside/**'], blockedPaths: ['.env'] },
      }),
    );
    await run(['approve', 'review_20260512_docs', '--root', root]);
    await run(['build', 'approval_20260512_docs', '--root', root]);
    const adapter = {
      runBuilder: vi.fn().mockResolvedValue({
        status: 'completed',
        resultText: 'Should not run.',
        runtimeRefs: [],
      }),
    };

    out.length = 0;
    await expect(
      run(['build', 'plan_20260512_docs', '--root', root, '--execute'], {
        builderAdapter: adapter,
        now: () => '2026-05-12T00:10:00.000Z',
      }),
    ).resolves.toBe(6);

    expect(adapter.runBuilder).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain('Builder error: error_20260512_docs');
    expect(store.readArtifact('approval_20260512_docs')).toMatchObject({
      status: 'granted',
      payload: { consumedAt: null },
    });
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

  it('blocks build when an approval has been rejected by the operator', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    await run(['collect', '--root', root]);
    await run(['propose', '--root', root]);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    const idea = store.listArtifacts('idea_contract')[0];
    await run(['review', idea.id, '--root', root]);
    const review = store.listArtifacts('main_review')[0];
    await run(['approve', review.id, '--root', root]);
    const approval = store.listArtifacts('approval')[0];
    await run(['reject', approval.id, '--root', root]);

    out.length = 0;
    err.length = 0;
    await expect(run(['build', approval.id, '--root', root])).resolves.toBe(4);

    expect(err.join('\n')).toContain('Artifact was rejected by operator');
    expect(store.listArtifacts('build_plan')).toEqual([]);

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Approved not built: 0');
  });

  it('blocks build when the approved review is later rejected by the operator', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    await run(['collect', '--root', root]);
    await run(['propose', '--root', root]);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    const idea = store.listArtifacts('idea_contract')[0];
    await run(['review', idea.id, '--root', root]);
    const review = store.listArtifacts('main_review')[0];
    await run(['approve', review.id, '--root', root]);
    const approval = store.listArtifacts('approval')[0];
    await run(['reject', review.id, '--root', root]);

    out.length = 0;
    err.length = 0;
    await expect(run(['build', approval.id, '--root', root])).resolves.toBe(4);

    expect(err.join('\n')).toContain('Artifact was rejected by operator');
    expect(store.listArtifacts('build_plan')).toEqual([]);

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Approved not built: 0');
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

  it('updates mode and kill switch without starting workflow stages', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);

    out.length = 0;
    await expect(run(['mode', 'off', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Mode: off');

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Mode: off');

    out.length = 0;
    await expect(run(['kill-switch', 'on', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Kill switch: active');

    out.length = 0;
    await expect(run(['kill-switch', 'off', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('Kill switch: inactive');
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

  it('fails validation when a changed output file hash no longer matches worktree content', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    const workingDirectory = join(
      root,
      '.anthroclaw',
      'auto-buildroom',
      'rooms',
      'anthroclaw-core',
      'worktrees',
      'plan_20260512_docs',
    );
    mkdirSync(join(workingDirectory, 'docs'), { recursive: true });
    writeFileSync(join(workingDirectory, 'docs', 'guide.md'), 'actual docs', 'utf8');
    const build = artifact('build_20260512_docs', 'coder_receipt', {
      runtimeStatus: 'completed',
      workingDirectory,
      postRunPolicyResult: {
        allowed: true,
        changedFiles: ['docs/guide.md'],
        violations: [],
      },
    });
    build.outputRefs = [
      { kind: 'file', ref: 'docs/guide.md', hash: sha256('different docs') },
    ];
    store.writeArtifact(build);

    await expect(run(['validate', '--root', root])).resolves.toBe(4);

    expect(err.join('\n')).toContain('Output ref hash mismatch');
    expect(err.join('\n')).toContain('build_20260512_docs');
    expect(err.join('\n')).toContain('docs/guide.md');
  });

  it('fails validation when an artifact parent receipt is missing', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    const parent = store.writeArtifact(artifact('research_20260512_docs', 'research_packet', {}));
    store.writeArtifact({
      ...artifact('idea_20260512_docs', 'idea_contract', {}),
      parentIds: [parent.id],
    });
    unlinkSync(store.pathForArtifact(parent));

    await expect(run(['validate', '--root', root])).resolves.toBe(4);

    expect(err.join('\n')).toContain('Missing parent artifact');
    expect(err.join('\n')).toContain('research_20260512_docs');
  });

  it('creates QA and Trust receipts for an existing coder receipt', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      coderReceiptWithOutputHash({
        builderClaims: ['Updated operator guide.'],
        changedFiles: ['docs/guide.md'],
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

  it('derives status state from the active receipt chain', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      coderReceiptWithOutputHash({
        builderClaims: ['Updated operator guide.'],
        changedFiles: ['docs/guide.md'],
      }),
    );

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('State: qa_pending');

    await run(['qa', 'build_20260512_docs', '--root', root]);
    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('State: trust_pending');

    await run(['trust', 'build_20260512_docs', '--root', root]);
    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);
    expect(out.join('\n')).toContain('State: complete');
    expect(out.join('\n')).toContain('Latest trust: clean');
  });

  it('derives blocked status when an unresolved error receipt exists', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('error_20260512_docs', 'error_receipt', {
        stage: 'builder',
        errorType: 'runtime_error',
        message: 'native approval required',
        recoverable: true,
        retryAllowed: true,
      }),
    );

    out.length = 0;
    await expect(run(['status', '--root', root])).resolves.toBe(0);

    expect(out.join('\n')).toContain('State: blocked');
    expect(out.join('\n')).toContain('Unresolved errors: 1');
  });

  it('renders and saves an operator report from latest trust receipt', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      coderReceiptWithOutputHash({
        builderClaims: ['Updated operator guide.'],
        changedFiles: ['docs/guide.md'],
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
    expect(summary.outputRefs[0]?.hash).toBe(sha256(readFileSync(summary.outputRefs[0].ref, 'utf8')));
  });

  it('creates a retention recommendation without deleting audit receipts', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      coderReceiptWithOutputHash({
        builderClaims: ['Updated operator guide.'],
        changedFiles: ['docs/guide.md'],
      }),
    );
    await run(['qa', 'build_20260512_docs', '--root', root]);
    await run(['trust', 'build_20260512_docs', '--root', root]);

    out.length = 0;
    await expect(run(['retain', 'trust_20260512_docs', '--root', root])).resolves.toBe(0);

    expect(out.join('\n')).toContain('Retention review: retention_20260512_docs');
    expect(out.join('\n')).toContain('Recommendation: keep');
    expect(out.join('\n')).toContain('Destructive cleanup: not allowed');
    expect(store.readArtifact('trust_20260512_docs').type).toBe('trust_report');
    expect(store.readArtifact('retention_20260512_docs')).toMatchObject({
      type: 'retention_review',
      status: 'completed',
      parentIds: ['trust_20260512_docs'],
      payload: {
        recommendation: 'keep',
        destructiveCleanupAllowed: false,
      },
    });

    out.length = 0;
    await expect(run(['retain', 'trust_20260512_docs', '--root', root])).resolves.toBe(0);

    expect(out.join('\n')).toContain('Retention review: retention_20260512_docs');
    expect(store.listArtifacts('retention_review')).toHaveLength(1);
  });

  it('sends lifecycle notifications for configured notification routes', async () => {
    await run([
      'init',
      '--root',
      root,
      '--room',
      'anthroclaw-core',
      '--telegram-notification-route',
      'telegram_thread:-1003931616911:2',
    ]);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      coderReceiptWithOutputHash({
        builderClaims: ['Updated operator guide.'],
        changedFiles: ['docs/guide.md'],
      }),
    );
    await run(['qa', 'build_20260512_docs', '--root', root]);
    const notifications: Array<{ routes: string[]; text: string }> = [];

    await expect(run(['trust', 'build_20260512_docs', '--root', root], {
      notify: async (notification) => {
        notifications.push(notification);
      },
    })).resolves.toBe(0);

    expect(notifications).toEqual([{
      routes: ['telegram_thread:-1003931616911:2'],
      text: expect.stringContaining('Buildroom trust: CLEAN'),
    }]);
    expect(notifications[0].text).toContain('Notification only. Approval still requires explicit /buildroom commands.');
  });

  it('does not send lifecycle notifications for reused receipts', async () => {
    await run([
      'init',
      '--root',
      root,
      '--room',
      'anthroclaw-core',
      '--telegram-notification-route',
      'telegram_thread:-1003931616911:2',
    ]);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      coderReceiptWithOutputHash({
        builderClaims: ['Updated operator guide.'],
        changedFiles: ['docs/guide.md'],
      }),
    );
    const notifications: Array<{ routes: string[]; text: string }> = [];
    const deps = {
      notify: async (notification: { routes: string[]; text: string }) => {
        notifications.push(notification);
      },
    };

    await run(['qa', 'build_20260512_docs', '--root', root], deps);
    await run(['qa', 'build_20260512_docs', '--root', root], deps);
    await run(['trust', 'build_20260512_docs', '--root', root], deps);
    await run(['trust', 'build_20260512_docs', '--root', root], deps);
    await run(['retain', 'trust_20260512_docs', '--root', root], deps);
    await run(['retain', 'trust_20260512_docs', '--root', root], deps);

    expect(notifications.map((notification) => notification.text.split('\n')[0])).toEqual([
      'Buildroom: QA completed',
      'Buildroom trust: CLEAN',
      'Buildroom: retention review created',
    ]);
    expect(store.listArtifacts('qa_report')).toHaveLength(1);
    expect(store.listArtifacts('trust_report')).toHaveLength(1);
    expect(store.listArtifacts('retention_review')).toHaveLength(1);
  });

  it('blocks retention without a trust receipt target', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('idea_20260512_docs', 'idea_contract', {
        title: 'Draft idea',
      }),
    );

    await expect(run(['retain', 'idea_20260512_docs', '--root', root])).resolves.toBe(4);

    expect(err.join('\n')).toContain('Retention requires a trust_report artifact');
    expect(store.listArtifacts('retention_review')).toEqual([]);
  });

  it('blocks retention when the room is off', async () => {
    await run(['init', '--root', root, '--room', 'anthroclaw-core']);
    const store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
    store.writeArtifact(
      artifact('trust_20260512_docs', 'trust_report', {
        trustState: 'clean',
      }),
    );
    updateRoomConfig((config) => ({ ...config, mode: 'off' }));

    await expect(run(['retain', 'trust_20260512_docs', '--root', root])).resolves.toBe(8);

    expect(err.join('\n')).toContain('Buildroom mode is off');
    expect(store.listArtifacts('retention_review')).toEqual([]);
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

  function coderReceiptWithOutputHash(opts: {
    builderClaims: string[];
    changedFiles: string[];
  }): BuildroomArtifact {
    const build = artifact('build_20260512_docs', 'coder_receipt', {
      runtimeStatus: 'completed',
      builderClaims: opts.builderClaims,
      postRunPolicyResult: {
        allowed: true,
        changedFiles: opts.changedFiles,
        violations: [],
      },
    });
    build.outputRefs = opts.changedFiles.map((file) => ({
      kind: 'file',
      ref: file,
      hash: sha256(`${file}:content`),
    }));
    return build;
  }

  function run(
    argv: string[],
    deps?: Parameters<typeof runBuildroomCli>[2],
  ): Promise<number> {
    return runBuildroomCli(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    }, deps);
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

  function sha256(content: string): string {
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
  }
});
