import { describe, expect, it } from 'vitest';
import {
  parsePiLeadsAgentDryRunArgs,
  runPiLeadsAgentDryRunCli,
} from '../pi-leads-agent-dry-run.js';

describe('Pi leads_agent dry-run CLI', () => {
  it('runs a safe customer-facing dry-run without real delivery', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiLeadsAgentDryRunCli(['--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.leads-agent-safe-dry-run',
      agentId: 'leads_agent',
      assertions: {
        simulatedCustomerRequest: true,
        publicProfileAllowsEscalate: true,
        publicProfileDeniesUnknownPluginTool: true,
        escalationLogged: true,
        escalationRows: 1,
        escalationAgentId: 'leads_agent',
        noRealCustomerDelivery: true,
        sendMessageNotInvoked: true,
        leadExportNotGenerated: true,
        externalMcpNotInvoked: true,
      },
    });
    expect(body.workspacePath).toBeUndefined();
  });

  it('parses flags narrowly', () => {
    expect(parsePiLeadsAgentDryRunArgs([
      '--',
      '--json',
      '--keep-workspace',
    ])).toMatchObject({
      json: true,
      keepWorkspace: true,
    });
    expect(() => parsePiLeadsAgentDryRunArgs(['--wat'])).toThrow(/Unknown argument/);
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
