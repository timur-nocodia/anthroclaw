import { mkdtempSync, rmSync } from 'node:fs';
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
          blockedPaths: ['.env'],
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
