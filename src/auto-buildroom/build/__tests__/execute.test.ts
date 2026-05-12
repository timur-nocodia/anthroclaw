import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileArtifactStore } from '../../artifacts/store.js';
import type { BuildroomArtifact } from '../../artifacts/model.js';
import { initializeBuildroomStorage } from '../../storage/init.js';
import { createApprovalArtifact, createBuildPlanArtifact } from '../../policy/authority.js';
import { executeBuildPlan } from '../execute.js';

describe('executeBuildPlan', () => {
  let root: string;
  let store: FileArtifactStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'anthroclaw-build-execute-'));
    initializeBuildroomStorage({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      operatorId: 'cli:user:local-operator',
    });
    store = new FileArtifactStore({ projectRoot: root, roomId: 'anthroclaw-core' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('executes a build plan through the runtime adapter and writes coder receipt', async () => {
    const { plan } = seedPlan();
    const adapter = {
      runBuilder: vi.fn().mockResolvedValue({
        status: 'completed',
        resultText: 'Changed docs.',
        runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
      }),
    };

    const receipt = await executeBuildPlan({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      planId: plan.id,
      adapter,
      now: '2026-05-12T00:10:00.000Z',
    });

    expect(adapter.runBuilder).toHaveBeenCalledTimes(1);
    expect(adapter.runBuilder.mock.calls[0][0]).toMatchObject({
      idempotencyKey: 'anthroclaw-core:approval_20260512_docs:plan_20260512_docs',
      scopeSummary: expect.stringContaining('docs/**'),
    });
    expect(receipt).toMatchObject({
      id: 'build_20260512_docs',
      type: 'coder_receipt',
      status: 'submitted',
      parentIds: [plan.id, 'approval_20260512_docs'],
      runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
      payload: {
        runtimeStatus: 'completed',
        builderClaims: ['Changed docs.'],
      },
    });
    expect(store.readArtifact(receipt.id)).toMatchObject({ id: receipt.id });
    expect(store.readArtifact('approval_20260512_docs')).toMatchObject({
      status: 'consumed',
      payload: {
        consumedAt: '2026-05-12T00:10:00.000Z',
      },
    });
  });

  it('writes an error receipt when native runtime fails', async () => {
    const { plan } = seedPlan();
    const adapter = {
      runBuilder: vi.fn().mockResolvedValue({
        status: 'failed',
        errorType: 'runtime_error',
        message: 'permission denied',
        runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
      }),
    };

    const receipt = await executeBuildPlan({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      planId: plan.id,
      adapter,
      now: '2026-05-12T00:10:00.000Z',
    });

    expect(receipt).toMatchObject({
      id: 'error_20260512_docs',
      type: 'error_receipt',
      status: 'failed',
      parentIds: [plan.id, 'approval_20260512_docs'],
      payload: {
        stage: 'builder',
        errorType: 'runtime_error',
        message: 'permission denied',
        retryAllowed: true,
      },
    });
    expect(store.readArtifact('approval_20260512_docs')).toMatchObject({
      status: 'consumed',
      payload: {
        consumedAt: '2026-05-12T00:10:00.000Z',
      },
    });
  });

  it('records post-run path policy violations from runtime changed files', async () => {
    const { plan } = seedPlan();
    const adapter = {
      runBuilder: vi.fn().mockResolvedValue({
        status: 'completed',
        resultText: 'Changed an agent prompt.',
        changedFiles: ['agents/example/AGENTS.md'],
        runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
      }),
    };

    const receipt = await executeBuildPlan({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      planId: plan.id,
      adapter,
      now: '2026-05-12T00:10:00.000Z',
    });

    expect(receipt).toMatchObject({
      type: 'coder_receipt',
      payload: {
        postRunPolicyResult: {
          allowed: false,
          checkedPaths: ['agents/example/AGENTS.md'],
          blockedPaths: ['agents/example/AGENTS.md'],
          violations: [
            {
              path: 'agents/example/AGENTS.md',
              reason: 'blocked_path',
              matchedPattern: 'agents/**',
            },
          ],
        },
      },
    });
  });

  it('computes changed files independently from the working directory diff', async () => {
    const { plan } = seedPlan();
    const adapter = {
      runBuilder: vi.fn().mockImplementation(async (input: { workingDirectory: string }) => {
        mkdirSync(join(input.workingDirectory, 'docs'), { recursive: true });
        writeFileSync(join(input.workingDirectory, 'docs', 'guide.md'), 'updated docs', 'utf8');
        return {
          status: 'completed',
          resultText: 'Updated docs.',
          runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
        };
      }),
    };

    const receipt = await executeBuildPlan({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      planId: plan.id,
      adapter,
      now: '2026-05-12T00:10:00.000Z',
    });

    expect(receipt).toMatchObject({
      type: 'coder_receipt',
      payload: {
        postRunPolicyResult: {
          allowed: true,
          checkedPaths: ['docs/guide.md'],
          changedFiles: ['docs/guide.md'],
          violations: [],
        },
      },
    });
  });

  it('prepares the runtime working directory with approved input files', async () => {
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'guide.md'), 'existing docs', 'utf8');
    const { plan } = seedPlan();
    const adapter = {
      runBuilder: vi.fn().mockImplementation(async (input: { workingDirectory: string }) => {
        expect(readFileSync(join(input.workingDirectory, 'docs', 'guide.md'), 'utf8')).toBe(
          'existing docs',
        );
        return {
          status: 'completed',
          resultText: 'Read approved docs.',
          runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
        };
      }),
    };

    await executeBuildPlan({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      planId: plan.id,
      adapter,
      now: '2026-05-12T00:10:00.000Z',
    });

    expect(adapter.runBuilder).toHaveBeenCalledTimes(1);
  });

  it('blocks before runtime when build plan scope contains path escapes', async () => {
    const { approval, plan } = seedPlan();
    const tamperedPlan = store.readArtifact(plan.id);
    tamperedPlan.payload = {
      ...tamperedPlan.payload,
      scope: {
        allowedPaths: ['../secrets/**'],
        blockedPaths: ['.env'],
      },
    };
    store.writeArtifact({ ...tamperedPlan, contentHash: '' });
    const adapter = {
      runBuilder: vi.fn().mockResolvedValue({
        status: 'completed',
        resultText: 'Should not run.',
        runtimeRefs: [],
      }),
    };

    const receipt = await executeBuildPlan({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      planId: plan.id,
      adapter,
      now: '2026-05-12T00:10:00.000Z',
    });

    expect(adapter.runBuilder).not.toHaveBeenCalled();
    expect(receipt).toMatchObject({
      id: 'error_20260512_docs',
      type: 'error_receipt',
      status: 'failed',
      parentIds: [plan.id, approval.id],
      payload: {
        stage: 'builder',
        targetArtifactId: plan.id,
        errorType: 'policy_violation',
        recoverable: false,
        retryAllowed: false,
      },
    });
    expect(store.readArtifact(approval.id)).toMatchObject({
      status: 'granted',
      payload: { consumedAt: null },
    });
  });

  it('does not rerun adapter when coder receipt already exists for the plan', async () => {
    const { plan } = seedPlan();
    const adapter = {
      runBuilder: vi.fn().mockResolvedValue({
        status: 'completed',
        resultText: 'Changed docs.',
        runtimeRefs: [{ runtime: 'native-agent-sdk', sessionId: 'session_builder_1' }],
      }),
    };

    const first = await executeBuildPlan({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      planId: plan.id,
      adapter,
      now: '2026-05-12T00:10:00.000Z',
    });
    const second = await executeBuildPlan({
      projectRoot: root,
      roomId: 'anthroclaw-core',
      planId: plan.id,
      adapter,
      now: '2026-05-12T00:11:00.000Z',
    });

    expect(adapter.runBuilder).toHaveBeenCalledTimes(1);
    expect(second.id).toBe(first.id);
  });

  function seedPlan(): { review: BuildroomArtifact; approval: BuildroomArtifact; plan: BuildroomArtifact } {
    const review = store.writeArtifact(
      artifact('review_20260512_docs', 'main_review', {
        decision: 'approved_for_operator',
        lockedScope: {
          allowedPaths: ['docs/**'],
          blockedPaths: ['.env', 'agents/**'],
        },
      }),
    );
    const approval = store.writeArtifact(
      createApprovalArtifact({
        review,
        operator: { id: 'cli:user:local-operator', route: 'cli:local' },
        now: '2026-05-12T00:00:00.000Z',
      }),
    );
    const plan = store.writeArtifact(
      createBuildPlanArtifact({
        approval,
        review,
        now: '2026-05-12T00:05:00.000Z',
      }),
    );
    return { review, approval, plan };
  }

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
      traceId: 'trace_20260512_docs',
      redaction: {
        rawTranscriptsIncluded: false,
        secretsRedacted: true,
        redactedFields: [],
      },
      contentHash: '',
      payload,
    };
  }
});
