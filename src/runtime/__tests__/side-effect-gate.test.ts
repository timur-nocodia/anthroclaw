import { describe, expect, it } from 'vitest';
import {
  validateRuntimeSideEffectGateSpec,
  type RuntimeSideEffectGateSpec,
} from '../side-effect-gate.js';

describe('RuntimeSideEffectGate contract', () => {
  it('accepts a reusable gate spec with agent identity supplied as input', () => {
    const result = validateRuntimeSideEffectGateSpec(validSpec());

    expect(result).toEqual({
      ok: true,
      errors: [],
      warnings: [],
    });
  });

  it('rejects gate ids that bake in a concrete agent id', () => {
    const result = validateRuntimeSideEffectGateSpec({
      ...validSpec(),
      gateId: 'timur-agent-live-send-message',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('gateId must describe a reusable capability and must not include agentId.');
  });

  it('requires dry-run, approval, policy, effect, and metrics assertions for write gates', () => {
    const result = validateRuntimeSideEffectGateSpec({
      ...validSpec(),
      dryRunSupported: false,
      approvalRequired: false,
      policyAssertions: [],
      expectedEffects: [],
      metrics: {
        runStarted: true,
        runCompleted: false,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'side-effect gates must support dry-run before live execution.',
      'non-read-only side-effect gates must require explicit approval.',
      'side-effect gates must declare policy assertions.',
      'side-effect gates must declare expected effects.',
      'side-effect gates must assert run start and completion metrics.',
    ]));
  });

  it('warns when evidence markers include concrete agent identity', () => {
    const result = validateRuntimeSideEffectGateSpec({
      ...validSpec(),
      markerPrefix: 'TIMUR_AGENT_LIVE_SEND_MESSAGE_OK',
    });

    expect(result.ok).toBe(true);
    expect(result.warnings).toContain('markerPrefix includes agentId; prefer passing agent-specific markers only from evidence fixtures.');
  });
});

function validSpec(): RuntimeSideEffectGateSpec {
  return {
    gateId: 'live-send-message',
    agentId: 'timur_agent',
    runtime: 'pi',
    risk: 'external_write',
    action: 'message.send',
    target: {
      channel: 'telegram',
      accountId: 'default',
      peerId: '48705953',
    },
    markerPrefix: 'LIVE_SEND_MESSAGE_OK',
    dryRunSupported: true,
    approvalRequired: true,
    policyAssertions: [
      {
        id: 'route-bound',
        description: 'Delivery target is bound to the configured route.',
        required: true,
      },
    ],
    expectedEffects: [
      {
        id: 'single-message',
        kind: 'message.send',
        description: 'Exactly one message is sent to the approved target.',
        target: {
          channel: 'telegram',
          accountId: 'default',
          peerId: '48705953',
        },
        maxCount: 1,
      },
    ],
    cleanupChecks: [
      {
        id: 'no-persisted-config',
        description: 'The gate does not mutate persistent agent config.',
        required: true,
      },
    ],
    metrics: {
      runStarted: true,
      runCompleted: true,
      toolStarted: ['send_message'],
      toolCompleted: ['send_message'],
      noFailedTools: true,
    },
  };
}
