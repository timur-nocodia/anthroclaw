import { describe, expect, it } from 'vitest';
import {
  parsePiScheduledBuildroomCanaryArgs,
  runPiScheduledBuildroomCanaryCli,
} from '../pi-scheduled-buildroom-canary.js';

describe('Pi scheduled Buildroom canary CLI', () => {
  it('runs the deterministic scheduled work and Buildroom probe', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiScheduledBuildroomCanaryCli(['--json'], {
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.scheduled-buildroom',
      assertions: {
        cron: {
          created: true,
          listed: true,
          toggled: true,
          deliverToBound: true,
        },
        heartbeat: {
          completed: true,
          sessionKey: 'pi-scheduled-agent:heartbeat',
          delivered: true,
          stateRecorded: true,
          schedulerTriggered: true,
          requestCount: 2,
        },
        buildroom: {
          initialized: true,
          statusOk: true,
          paused: true,
          resumed: true,
          killSwitchOn: true,
          killSwitchOff: true,
          notificationRoutes: 1,
        },
        buildroomTools: {
          sessionSummaryArtifacts: 1,
          handoffArtifacts: 1,
          sourceSessionBound: true,
        },
        notifications: {
          delivered: 1,
          routes: 1,
          trustArtifacts: 1,
          textIncludesSafetyNotice: true,
        },
        artifacts: {
          contentHashesVerified: true,
        },
        pathPolicy: {
          allowedPathAccepted: true,
          blockedPathRejected: true,
          escapeRejected: true,
        },
        locks: {
          acquired: true,
          duplicateRejected: true,
          released: true,
        },
      },
    });
    expect(body.assertions.artifacts.total).toBeGreaterThanOrEqual(5);
    expect(body.assertions.pathPolicy.blocked).toContain('agents/**');
  });

  it('parses deterministic and forwarded compatibility flags', () => {
    expect(parsePiScheduledBuildroomCanaryArgs([
      '--',
      '--json',
      '--timeout-ms', '1000',
      '--allow-skip',
      '--keep-workspace',
      '--gateway',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
    ])).toMatchObject({
      json: true,
      timeoutMs: 1000,
      allowSkip: true,
      keepWorkspace: true,
    });
    expect(() => parsePiScheduledBuildroomCanaryArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
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
