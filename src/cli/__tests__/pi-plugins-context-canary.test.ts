import { describe, expect, it } from 'vitest';
import {
  parsePiPluginsContextCanaryArgs,
  runPiPluginsContextCanaryCli,
} from '../pi-plugins-context-canary.js';

describe('Pi plugins/context canary CLI', () => {
  it('runs the scripted plugin/context canary', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiPluginsContextCanaryCli(['--json'], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      scenario: 'pi.plugins-context-tools',
      assertions: {
        gateway: true,
        enabledForAgent: true,
        disabledAgentTools: 0,
        readOnlyTool: true,
        policyTool: true,
        contextEngine: 'pi-canary-plugin',
        sessionAttribution: true,
        subagent: {
          runtime: 'pi-canary-headless',
          purpose: 'runSubagent',
          toolsDisabled: true,
        },
      },
    });
    expect(body.assertions.toolNames).toEqual([
      'pi-canary-plugin_inspect',
      'pi-canary-plugin_policy_gate',
    ]);
    expect(body.assertions.hooks).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('parses pi-v1 scripted compatibility flags', () => {
    expect(parsePiPluginsContextCanaryArgs([
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

    const code = await runPiPluginsContextCanaryCli(['--wat'], { stdout, stderr });

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
