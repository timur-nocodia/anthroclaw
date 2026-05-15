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

  it('sets allowDangerouslySkipPermissions when running as a non-root user', () => {
    getuidSpy = vi.spyOn(process, 'getuid').mockReturnValue(1000);
    const agent = makeAgentStub(tmpRoot);
    const options = buildSdkOptions({ agent, trustedBypass: true });
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBe(true);
  });

  it('OMITS allowDangerouslySkipPermissions when running as root (uid 0)', () => {
    // The Claude CLI refuses to start with this flag under root and
    // exits with code 1, breaking every trustedBypass call. Production
    // (Docker, uid 0 for bubblewrap) must rely on permissionMode alone.
    getuidSpy = vi.spyOn(process, 'getuid').mockReturnValue(0);
    const agent = makeAgentStub(tmpRoot);
    const options = buildSdkOptions({ agent, trustedBypass: true });
    expect(options.permissionMode).toBe('bypassPermissions');
    expect(options.allowDangerouslySkipPermissions).toBeUndefined();
  });
});
