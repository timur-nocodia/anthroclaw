import { describe, expect, it } from 'vitest';
import {
  parsePiExternalMcpCanaryArgs,
  runPiExternalMcpCanaryCli,
} from '../pi-external-mcp-canary.js';

describe('Pi external MCP canary CLI', () => {
  it('runs the scripted external MCP proxy canary', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiExternalMcpCanaryCli(['--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).not.toContain('pi-external-mcp-canary-token');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.external-mcp-proxy',
      assertions: {
        credentialHeadersResolved: true,
        credentialStoreReads: 1,
        exposedTools: ['mcp__canary_mcp__lookup'],
        disallowedToolHidden: true,
        piCustomToolDefined: true,
        piCustomToolExecuted: true,
        piPolicyDenied: true,
        upstreamCalls: 1,
        redaction: true,
        agentSchemaValidated: true,
      },
    });
  });

  it('parses pi-v1 scripted compatibility flags', () => {
    expect(parsePiExternalMcpCanaryArgs([
      '--json',
      '--gateway',
      '--model', 'test/model',
      '--auth-path', '/secure/auth.json',
      '--models-path', '/secure/models.json',
      '--timeout-ms', '1234',
      '--allow-skip',
      '--keep-workspace',
    ])).toMatchObject({
      json: true,
      gateway: true,
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

    const code = await runPiExternalMcpCanaryCli(['--wat'], { stdout, stderr });

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
