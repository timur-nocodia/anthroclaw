import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { stringify as stringifyYaml } from 'yaml';

// ─── Auth bypass ──────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long!!';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'testpassword123';

vi.mock('@/lib/require-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/require-auth')>('@/lib/require-auth');
  return {
    ...actual,
    requireAuth: vi.fn().mockResolvedValue({ email: 'admin@test.com', authMethod: 'cookie' }),
  };
});

// ─── Per-test agents-dir fixture ─────────────────────────────────────
let tmpRoot: string;
let agentsDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'safety-validate-test-'));
  const fakeUi = join(tmpRoot, 'ui');
  mkdirSync(fakeUi, { recursive: true });
  agentsDir = join(tmpRoot, 'agents');
  mkdirSync(agentsDir, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(fakeUi);
  vi.resetModules();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

function writeAgentYml(id: string, body: Record<string, unknown>): void {
  const dir = join(agentsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), stringifyYaml(body), 'utf-8');
}

async function callPost(
  agentId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const { POST } = await import(
    '@/app/api/agents/[agentId]/validate-safety-profile/route'
  );
  const req = new NextRequest(`http://localhost/api/agents/${agentId}/validate-safety-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST(req, { params: Promise.resolve({ agentId }) });
  const data = await res.json();
  return { status: res.status, data };
}

describe('POST /api/agents/[agentId]/validate-safety-profile', () => {
  it('returns ok:true for a valid private agent with a single allowlist peer', async () => {
    writeAgentYml('agent1', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      safety_profile: 'private',
      allowlist: { telegram: ['user1'] },
    });

    const { status, data } = await callPost('agent1', { safety_profile: 'private' });
    expect(status).toBe(200);
    expect((data as { ok: boolean }).ok).toBe(true);
  });

  it('returns ok:true for a valid public agent', async () => {
    writeAgentYml('agent2', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      safety_profile: 'public',
    });

    const { status, data } = await callPost('agent2', { safety_profile: 'public' });
    expect(status).toBe(200);
    expect((data as { ok: boolean }).ok).toBe(true);
  });

  it('returns ok:false when bypass is set on a non-private profile', async () => {
    writeAgentYml('agent3', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      safety_profile: 'trusted',
      safety_overrides: { permission_mode: 'bypass' },
    });

    const { status, data } = await callPost('agent3', {
      safety_profile: 'trusted',
      safety_overrides: { permission_mode: 'bypass' },
    });
    expect(status).toBe(200);
    const typed = data as { ok: boolean; error?: string };
    expect(typed.ok).toBe(false);
    expect(typed.error).toMatch(/bypass/);
  });

  it('includes warnings array in response', async () => {
    writeAgentYml('agent4', {
      model: 'claude-sonnet-4-6',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      safety_profile: 'private',
    });

    const { data } = await callPost('agent4', { safety_profile: 'private' });
    expect(Array.isArray((data as { warnings: unknown[] }).warnings)).toBe(true);
  });

  it('falls back gracefully when agent does not exist yet', async () => {
    const { status, data } = await callPost('nonexistent', { safety_profile: 'private' });
    // Should not 404 — agent not found means we validate with an empty base config
    expect(status).toBe(200);
    expect((data as { ok: boolean }).ok).toBeDefined();
  });
});
