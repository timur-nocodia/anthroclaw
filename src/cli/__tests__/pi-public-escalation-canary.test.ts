import { describe, expect, it } from 'vitest';
import {
  parsePiPublicEscalationCanaryArgs,
  runPiPublicEscalationCanaryCli,
} from '../pi-public-escalation-canary.js';

describe('Pi public escalation canary CLI', () => {
  it('runs the deterministic public escalation policy probe', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiPublicEscalationCanaryCli(['--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.public-escalation',
      assertions: {
        mcpMetaRegistered: true,
        publicProfileAllowsEscalate: true,
        allowedMcpToolsFilterAllowsLocalName: true,
        publicProfileDeniesUnknownPluginTool: true,
        escalationLogged: true,
        escalationRows: 1,
        escalationAgentId: 'leads_agent',
        escalationUrgency: 'urgent',
      },
    });
    expect(body.assertions.escalationSummary).toContain('Excel export');
    expect(body.workspacePath).toBeUndefined();
  });

  it('parses deterministic and pi-v1 compatibility flags', () => {
    expect(parsePiPublicEscalationCanaryArgs([
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
    expect(() => parsePiPublicEscalationCanaryArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
  });

  it('returns usage errors for unknown flags', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiPublicEscalationCanaryCli(['--wat'], { stdout, stderr });

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
