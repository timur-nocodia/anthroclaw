import { describe, expect, it } from 'vitest';
import {
  parsePiDashboardOperatorCanaryArgs,
  runPiDashboardOperatorCanaryCli,
} from '../pi-dashboard-operator-canary.js';

describe('Pi dashboard operator canary CLI', () => {
  it('runs the deterministic operator API probe without leaking Pi storage paths', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiDashboardOperatorCanaryCli([
      '--json',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
    ], {
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).not.toContain('/secure/pi-auth.json');
    expect(stdout.text()).not.toContain('/secure/pi-models.json');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.dashboard-operator',
      assertions: {
        gatewayStatus: {
          agents: 1,
          activeSessions: 1,
          channelsInspectable: true,
        },
        agentConfig: {
          runtimeProvider: 'pi',
          authPathRedacted: true,
          modelsPathRedacted: true,
          enabledPlugins: ['operator-console'],
          externalMcpServers: ['operator_notes'],
        },
        sessions: {
          rows: 1,
          detailsMessages: 2,
          provenanceRunId: 'pi-dashboard-run-1',
        },
        runs: {
          rows: 1,
          status: 'succeeded',
          routeDecisions: 1,
          interrupts: 1,
        },
        learning: {
          reviews: 1,
          actions: 1,
          artifacts: 1,
          decisions: 1,
        },
        plugins: {
          loaded: 1,
          toolCount: 2,
        },
        agentPlugins: {
          known: 1,
          enabled: 1,
        },
        mcp: {
          externalServerPresent: true,
        },
        diagnostics: {
          contentPolicy: 'metadata-only',
          runs: 1,
          routeDecisions: 1,
          interrupts: 1,
          integrationAuditEvents: 1,
          memoryInfluenceEvents: 1,
          secretsRedacted: true,
        },
      },
    });
  });

  it('parses aggregate compatibility flags narrowly', () => {
    expect(parsePiDashboardOperatorCanaryArgs([
      '--',
      '--json',
      '--model', 'test/model',
      '--auth-path', '/secure/pi-auth.json',
      '--models-path', '/secure/pi-models.json',
      '--timeout-ms', '1000',
      '--allow-skip',
      '--keep-workspace',
      '--gateway',
    ])).toMatchObject({
      json: true,
      model: 'test/model',
      authPath: '/secure/pi-auth.json',
      modelsPath: '/secure/pi-models.json',
      timeoutMs: 1000,
      allowSkip: true,
      keepWorkspace: true,
    });
    expect(() => parsePiDashboardOperatorCanaryArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
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
