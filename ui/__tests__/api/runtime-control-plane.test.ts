import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NextRequest } from 'next/server';

const originalEnv = {
  OC_CONFIG: process.env.OC_CONFIG,
  OC_AGENTS_DIR: process.env.OC_AGENTS_DIR,
  OC_DATA_DIR: process.env.OC_DATA_DIR,
};

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

vi.mock('@/lib/route-handler', () => ({
  withAuth: async (handler: () => Promise<Response>) => {
    try {
      return await handler();
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) {
        return Response.json(
          {
            error: (err as { code: string }).code,
            message: err instanceof Error ? err.message : 'Validation error',
          },
          { status: 400 },
        );
      }
      throw err;
    }
  },
}));

vi.mock('@/lib/gateway', () => ({
  getGateway: vi.fn(async () => ({
    getStatus: mocks.getStatus,
  })),
}));

let tempRoot: string;

beforeEach(() => {
  vi.resetModules();
  mocks.getStatus.mockReset();

  tempRoot = mkdtempSync(join(tmpdir(), 'runtime-control-plane-'));
  const agentsDir = join(tempRoot, 'agents');
  const dataDir = join(tempRoot, 'data');
  const piAuthDir = join(tempRoot, 'pi-auth');
  const piModelsPath = join(tempRoot, 'models.json');

  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(piAuthDir, { recursive: true });
  writeFileSync(piModelsPath, '[]', 'utf-8');

  writeFileSync(
    join(tempRoot, 'config.yml'),
    [
      'defaults:',
      '  model: claude-sonnet-4-6',
      '  embedding_provider: off',
      '  embedding_model: ""',
      '  debounce_ms: 0',
      'runtime:',
      '  headless:',
      '    provider: pi',
      '    pi:',
      `      auth_path: ${JSON.stringify(piAuthDir)}`,
      `      models_path: ${JSON.stringify(piModelsPath)}`,
      'telegram:',
      '  accounts:',
      '    default:',
      '      token: runtime-test-secret-must-not-leak',
    ].join('\n'),
    'utf-8',
  );

  mkdirSync(join(agentsDir, 'pi_direct'), { recursive: true });
  writeFileSync(
    join(agentsDir, 'pi_direct', 'agent.yml'),
    ['id: pi_direct', 'runtime:', '  headless:', '    provider: pi'].join('\n'),
    'utf-8',
  );

  mkdirSync(join(agentsDir, 'uses_default'), { recursive: true });
  writeFileSync(join(agentsDir, 'uses_default', 'agent.yml'), 'id: uses_default\n', 'utf-8');

  mkdirSync(join(agentsDir, 'legacy_fallback'), { recursive: true });
  writeFileSync(
    join(agentsDir, 'legacy_fallback', 'agent.yml'),
    ['id: legacy_fallback', 'runtime:', '  headless:', '    provider: claude-agent-sdk'].join('\n'),
    'utf-8',
  );

  process.env.OC_CONFIG = join(tempRoot, 'config.yml');
  process.env.OC_AGENTS_DIR = agentsDir;
  process.env.OC_DATA_DIR = dataDir;
});

afterEach(() => {
  if (originalEnv.OC_CONFIG === undefined) delete process.env.OC_CONFIG;
  else process.env.OC_CONFIG = originalEnv.OC_CONFIG;
  if (originalEnv.OC_AGENTS_DIR === undefined) delete process.env.OC_AGENTS_DIR;
  else process.env.OC_AGENTS_DIR = originalEnv.OC_AGENTS_DIR;
  if (originalEnv.OC_DATA_DIR === undefined) delete process.env.OC_DATA_DIR;
  else process.env.OC_DATA_DIR = originalEnv.OC_DATA_DIR;

  rmSync(tempRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('runtime control plane API', () => {
  it('returns Pi runtime status without exposing credential material', async () => {
    mocks.getStatus.mockReturnValueOnce({
      uptime: 12_345,
      activeSessions: 2,
      runtimeDefaults: {
        headlessProvider: 'pi',
        gatewayHarness: 'runtime-v1',
      },
    });

    const { GET } = await import('@/app/api/runtime/status/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.harness.id).toBe('runtime-v1');
    expect(body.defaultProvider).toBe('pi');
    expect(body.pi.packageName).toBe('@earendil-works/pi-coding-agent');
    expect(body.pi.authConfigured).toBe(true);
    expect(body.pi.modelsConfigured).toBe(true);
    expect(body.agents.total).toBe(3);
    expect(body.agents.byEffectiveProvider.pi).toBe(2);
    expect(body.agents.byEffectiveProvider['claude-agent-sdk']).toBe(1);
    expect(body.gateway.uptime).toBe(12_345);
    expect(body.gateway.activeSessions).toBe(2);
    expect(body.legacy.claudeAgentSdk.primary).toBe(false);
    expect(JSON.stringify(body)).not.toContain('runtime-test-secret-must-not-leak');
  });

  it('reports missing Pi readiness paths without throwing', async () => {
    writeFileSync(
      join(tempRoot, 'config.yml'),
      [
        'runtime:',
        '  headless:',
        '    provider: pi',
        '    pi:',
        '      auth_path: ./missing-auth',
        '      models_path: ./missing-models.json',
      ].join('\n'),
      'utf-8',
    );
    mocks.getStatus.mockReturnValueOnce({ runtimeDefaults: { headlessProvider: 'pi' } });

    const { GET } = await import('@/app/api/runtime/status/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.defaultProvider).toBe('pi');
    expect(body.pi.authConfigured).toBe(false);
    expect(body.pi.modelsConfigured).toBe(false);
  });

  it('returns gate registry metadata from backend registry without compatibility commands', async () => {
    const { GET } = await import('@/app/api/runtime/gates/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.gates.some((gate: { id: string }) => gate.id === 'controlled-live-turn')).toBe(true);
    expect(JSON.stringify(body)).not.toContain('runtime:pi-timur-agent');
    expect(JSON.stringify(body)).not.toContain('timur_agent');

    const controlledLiveTurn = body.gates.find((gate: { id: string }) => gate.id === 'controlled-live-turn');
    expect(controlledLiveTurn.execution.requiredFlags).toEqual(['agent-id', 'peer-id', 'thread-id']);
    expect(controlledLiveTurn.execution.supportsDryRun).toBe(true);
    expect(controlledLiveTurn.execution.approval).toBe('required-for-live');
  });

  it('returns runtime model registry with configured Pi and legacy compatibility groups', async () => {
    writeFileSync(
      join(tempRoot, 'models.json'),
      JSON.stringify([
        { provider: 'openai', id: 'gpt-5-mini', name: 'GPT 5 Mini' },
        { provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      ]),
      'utf-8',
    );

    const { GET } = await import('@/app/api/runtime/models/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.defaultProvider).toBe('pi');
    expect(body.groups.find((group: { id: string }) => group.id === 'pi')).toMatchObject({
      enabled: true,
      source: {
        kind: 'configured',
        modelsConfigured: true,
      },
    });
    expect(body.options.map((option: { id: string }) => option.id)).toContain('openai/gpt-5-mini');
    expect(body.options.map((option: { id: string }) => option.id)).toContain('claude-sonnet-4-6');
    expect(body.groups.find((group: { id: string }) => group.id === 'legacy-claude')).toMatchObject({
      compatibility: true,
    });
  });

  it('enables OpenCode model group when OpenCode is the default provider', async () => {
    writeFileSync(
      join(tempRoot, 'config.yml'),
      [
        'defaults:',
        '  model: anthropic/claude-sonnet-4-6',
        'runtime:',
        '  headless:',
        '    provider: opencode',
      ].join('\n'),
      'utf-8',
    );

    const { GET } = await import('@/app/api/runtime/models/route');
    const res = await GET();
    const body = await res.json();
    const opencodeGroup = body.groups.find((group: { id: string }) => group.id === 'opencode');

    expect(res.status).toBe(200);
    expect(body.defaultProvider).toBe('opencode');
    expect(opencodeGroup).toMatchObject({
      enabled: true,
      models: [
        expect.objectContaining({
          id: 'anthropic/claude-sonnet-4-6',
          runtime: 'opencode',
        }),
      ],
    });
  });

  it('validates runtime gate args with structured missing and unknown flags', async () => {
    const { POST } = await import('@/app/api/runtime/gates/validate/route');
    const res = await POST(jsonRequest('/api/runtime/gates/validate', {
      gateId: 'controlled-live-turn',
      args: {
        'agent-id': 'agent_a',
        'peer-id': 'telegram:default:123',
        unexpected: true,
      },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.missingRequiredFlags).toEqual(['thread-id']);
    expect(body.unknownFlags).toEqual(['unexpected']);
  });

  it('plans a dry-run-only runtime gate command without executing it', async () => {
    const { POST } = await import('@/app/api/runtime/gates/plan/route');
    const res = await POST(jsonRequest('/api/runtime/gates/plan', {
      gateId: 'controlled-live-turn',
      args: {
        'agent-id': 'agent_a',
        'peer-id': 'telegram:default:123',
        'thread-id': '456',
        'dry-run': true,
        json: true,
      },
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRunOnly).toBe(true);
    expect(body.command).toBe('runtime:pi-controlled-live-turn-gate');
    expect(body.argv).toEqual([
      '--agent-id',
      'agent_a',
      '--dry-run',
      '--json',
      '--peer-id',
      'telegram:default:123',
      '--thread-id',
      '456',
    ]);
  });

  it('returns a structured validation error for unknown runtime gates', async () => {
    const { POST } = await import('@/app/api/runtime/gates/validate/route');
    const res = await POST(jsonRequest('/api/runtime/gates/validate', {
      gateId: 'does-not-exist',
      args: {},
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('unknown_gate');
    expect(body.message).toContain('does-not-exist');
  });

  it('returns read-only Pi expansion status with policy evaluation', async () => {
    const agentsDir = join(tempRoot, 'expansion-agents');
    const packetsDir = join(tempRoot, 'expansion-packets');
    writeExpansionAgent(agentsDir, 'closed_agent', [
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    peers: ["42"]',
      'safety_profile: chat_like_openclaw',
      'mcp_onboarding:',
      '  enabled: false',
    ].join('\n'));
    writeExpansionAgent(agentsDir, 'ready_agent', [
      'routes:',
      '  - channel: telegram',
      '    scope: group',
      'safety_profile: chat_like_openclaw',
    ].join('\n'));
    writeExpansionPacket(packetsDir, 'closed_agent', 'Status: closed\n\n- [x] closed evidence\n');
    const readyPacket = 'Status: ready_for_execution\n\n- [x] automated evidence\n- [ ] manual evidence\n';
    writeExpansionPacket(packetsDir, 'ready_agent', readyPacket);

    const { GET } = await import('@/app/api/runtime/expansion-status/route');
    const url = new URL('/api/runtime/expansion-status', 'http://localhost');
    url.searchParams.set('agentsDir', agentsDir);
    url.searchParams.set('packetsDir', packetsDir);
    url.searchParams.set('failOnOpen', 'true');
    const res = await GET(new NextRequest(url));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('attention');
    expect(body.summary).toMatchObject({
      totalAgents: 2,
      closedAgents: 1,
      openAgents: 1,
      evidenceProgressPercent: 67,
    });
    expect(body.policy).toMatchObject({
      failOnOpen: true,
      passed: false,
      reason: 'open expansion work remains',
    });
    expect(body.summary.openEvidenceByKind.manual).toBe(1);
    expect(readFileSync(join(packetsDir, 'ready_agent.md'), 'utf-8')).toBe(readyPacket);
  });
});

function jsonRequest(path: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function writeExpansionAgent(root: string, agentId: string, body: string): void {
  const dir = join(root, agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), body, 'utf-8');
}

function writeExpansionPacket(root: string, agentId: string, body: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, `${agentId}.md`), body, 'utf-8');
}
