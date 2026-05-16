import { describe, expect, it } from 'vitest';
import {
  buildRuntimeV1DecisionJson,
  evaluateRuntimeV1Decision,
  parseRuntimeV1DecisionArgs,
  renderRuntimeV1DecisionPackage,
} from '../runtime-v1-decision-package.mjs';

describe('runtime v1 decision package helper', () => {
  it('blocks default rollout when canaries pass but operational gates are still pending', () => {
    const result = canaryResult('passed');
    const evaluation = evaluateRuntimeV1Decision(result);

    expect(evaluation.decision).toBe('BLOCKED');
    expect(evaluation.blockingFailures).toEqual([
      'production-canary-window',
      'pr-stack-merged',
    ]);
  });

  it('marks the package ready when canaries and operational gates pass', () => {
    const result = canaryResult('passed');
    const evaluation = evaluateRuntimeV1Decision(result, {
      productionCanary: 'passed',
      prStack: 'merged',
      browserUx: 'waived',
    });

    expect(evaluation.decision).toBe('READY');
    expect(evaluation.blockingFailures).toEqual([]);
  });

  it('renders failed scenario details and next actions', () => {
    const result = canaryResult('failed', {
      id: 'pi.gateway-channel-approval',
      status: 'failed',
      error: 'provider timeout',
    });
    const markdown = renderRuntimeV1DecisionPackage(result, {
      generatedAt: '2026-05-16T00:00:00.000Z',
    });

    expect(markdown).toContain('| decision | BLOCKED |');
    expect(markdown).toContain('| Full canary mode | passed | yes | Expected mode full; observed full. |');
    expect(markdown).toContain('| pi.gateway-channel-approval | smoke | failed |');
    expect(markdown).toContain('provider timeout');
    expect(markdown).toContain('Resolve incomplete or failed scenarios: pi.gateway-channel-approval.');
  });

  it('redacts provider keys and auth/model storage paths from markdown and json', () => {
    const result = canaryResult('failed', {
      id: 'pi.auth-model-preflight',
      status: 'failed',
      error: 'auth_path="/secure/pi-auth.json" models_path="/secure/pi-models.json" api_key="provider-key-secret"',
    });

    const markdown = renderRuntimeV1DecisionPackage(result);
    const json = JSON.stringify(buildRuntimeV1DecisionJson(result));

    expect(markdown).not.toContain('provider-key-secret');
    expect(markdown).not.toContain('/secure/pi-auth.json');
    expect(markdown).not.toContain('/secure/pi-models.json');
    expect(json).not.toContain('provider-key-secret');
    expect(json).not.toContain('/secure/pi-auth.json');
    expect(json).not.toContain('/secure/pi-models.json');
  });

  it('accepts the npm-script argument separator', () => {
    expect(parseRuntimeV1DecisionArgs([
      '--',
      '--input', '/tmp/in.json',
      '--summary', '/tmp/out.md',
      '--json', '/tmp/out.json',
      '--production-canary', 'passed',
      '--pr-stack', 'merged',
    ])).toMatchObject({
      inputPath: '/tmp/in.json',
      summaryPath: '/tmp/out.md',
      jsonPath: '/tmp/out.json',
      productionCanary: 'passed',
      prStack: 'merged',
    });
  });
});

function canaryResult(status: string, override?: Partial<Scenario>) {
  const scenarios: Scenario[] = [
    scenario('pi.auth-model-preflight', 'smoke', 'passed'),
    scenario('pi.workspace-tools-rewind', 'smoke', 'passed'),
    scenario('pi.gateway-channel-approval', 'smoke', 'passed'),
    scenario('pi.aggregate-real-auth', 'smoke', 'passed'),
    scenario('pi.sessions-memory-learning', 'scripted_canary', 'passed'),
    scenario('pi.plugins-context-tools', 'scripted_canary', 'passed'),
    scenario('pi.external-mcp-proxy', 'scripted_canary', 'passed'),
    scenario('pi.dashboard-operator', 'scripted_canary', 'passed'),
    scenario('pi.scheduled-buildroom', 'scripted_canary', 'passed'),
    scenario('pi.rollback-mixed-runtime', 'scripted_canary', 'passed'),
  ];
  if (override) {
    const index = scenarios.findIndex((entry) => entry.id === override.id);
    if (index >= 0) scenarios[index] = { ...scenarios[index], ...override };
  }
  return {
    status,
    runtime: 'pi',
    mode: 'full',
    durationMs: 100,
    scenarios,
  };
}

function scenario(id: string, kind: string, status: string): Scenario {
  return {
    id,
    kind,
    status,
    command: `pnpm ${id}`,
  };
}

interface Scenario {
  id: string;
  kind: string;
  status: string;
  command?: string;
  error?: string;
}
