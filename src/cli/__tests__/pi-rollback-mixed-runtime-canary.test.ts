import { describe, expect, it } from 'vitest';
import {
  parsePiRollbackMixedRuntimeCanaryArgs,
  runPiRollbackMixedRuntimeCanaryCli,
} from '../pi-rollback-mixed-runtime-canary.js';

describe('Pi rollback mixed-runtime canary CLI', () => {
  it('runs the scripted rollback and mixed-runtime canary', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiRollbackMixedRuntimeCanaryCli(['--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.rollback-mixed-runtime',
      assertions: {
        perAgentPiOptIn: {
          runtime: 'pi',
          usesPi: true,
        },
        globalPiDefault: {
          runtime: 'pi',
          usesPi: true,
        },
        perAgentClaudeOptOut: {
          runtime: 'claude-agent-sdk',
          usesPi: false,
        },
        rollbackStartedOnPi: true,
        rollbackToClaude: {
          runtime: 'claude-agent-sdk',
          usesPi: false,
        },
        gatewayBadPiFailure: {
          failedRuns: 1,
          succeededRuns: 0,
          errorContextRecorded: true,
        },
        badPiAuthFailedLoudly: true,
        sessionVisibilityPreserved: true,
      },
    });
    expect(body.assertions.detailMessageCount).toBeGreaterThanOrEqual(2);
    expect(body.assertions.runRows).toBeGreaterThanOrEqual(1);
    expect(body.assertions.routeRows).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('parses pi-v1 scripted compatibility flags', () => {
    expect(parsePiRollbackMixedRuntimeCanaryArgs([
      '--json',
      '--model', 'test/model',
      '--auth-path', '/secure/auth.json',
      '--models-path', '/secure/models.json',
      '--timeout-ms', '1234',
      '--allow-skip',
      '--keep-workspace',
    ])).toMatchObject({
      json: true,
      model: 'test/model',
      authPath: '/secure/auth.json',
      modelsPath: '/secure/models.json',
      timeoutMs: 1234,
      allowSkip: true,
      keepWorkspace: true,
    });
  });

  it('returns usage errors for unknown flags', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiRollbackMixedRuntimeCanaryCli(['--wat'], { stdout, stderr });

    expect(code).toBe(2);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('Unknown argument: --wat');
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
