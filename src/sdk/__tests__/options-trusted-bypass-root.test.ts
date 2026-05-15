import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSdkOptions } from '../options.js';
import { chatLikeOpenclawProfile } from '../../security/profiles/chat-like-openclaw.js';
import type { Agent } from '../../agent/agent.js';

function makeAgentStub(workspaceDir: string): Agent {
  writeFileSync(join(workspaceDir, 'CLAUDE.md'), '# test agent', 'utf-8');
  return {
    id: 'test-agent',
    workspacePath: workspaceDir,
    safetyProfile: chatLikeOpenclawProfile,
    config: { model: 'claude-sonnet-4-6', sdk: undefined },
    mcpServer: { name: 'test-tools' },
    tools: [],
  } as unknown as Agent;
}

describe('buildSdkOptions trustedBypass — root vs non-root', () => {
  let tmpRoot: string;
  let getuidSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'tb-root-'));
  });

  afterEach(() => {
    getuidSpy?.mockRestore();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('uses bypassPermissions + dangerously-skip flag when running as a non-root user', () => {
    getuidSpy = vi.spyOn(process, 'getuid').mockReturnValue(1000);
    const agent = makeAgentStub(tmpRoot);
    const options = buildSdkOptions({ agent, trustedBypass: true });
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
  });

  it('falls back to default mode + auto-allow canUseTool under root (uid 0)', async () => {
    // The Claude CLI gates the whole bypass capability behind a root
    // check and exits with code 1 before any model call when it sees
    // permissionMode='bypassPermissions' (or the dangerous-skip flag)
    // under uid 0. Production runs as root for bubblewrap support, so
    // we swap to an equivalent-trust shape that doesn't trigger the
    // gate: default mode + auto-allow callback. The cutoff layer still
    // composes its capability gate on top of our callback.
    getuidSpy = vi.spyOn(process, 'getuid').mockReturnValue(0);
    const agent = makeAgentStub(tmpRoot);
    const options = buildSdkOptions({ agent, trustedBypass: true });
    expect(options.permissionMode).toBe('default');
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
    expect(typeof options.canUseTool).toBe('function');
    // The cutoff layer composes its own gate on top, so calling the
    // composed callback for an arbitrary tool will go through the
    // cutoff — but our upstream auto-allow at least never says deny.
    // Smoke-test that the composed function is callable and resolves.
    const fakeCtx = { signal: new AbortController().signal } as Parameters<NonNullable<typeof options.canUseTool>>[2];
    await expect(options.canUseTool!('Bash', {}, fakeCtx)).resolves.toBeDefined();
  });
});
