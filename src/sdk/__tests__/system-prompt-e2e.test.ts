// End-to-end fixture for the v0.9 system-prompt resolution pipeline.
//
// Builds 4 real-shaped agent workspaces on disk under a single tmpdir —
// `agent_chat`, `agent_public`, `agent_trusted`, `agent_private` — each with
// a CLAUDE.md containing two `@-imports` plus the imported `SOUL.md` and
// `IDENTITY.md` files. For each agent it constructs a minimal Agent-shaped
// object (matching the helper pattern used in `system-prompt-composer.test.ts`)
// and asserts the system prompt body returned by `composeSystemPrompt`
// contains the resolved sentinel strings from each import.
//
// This is the regression-guard test for the full
//   Agent + workspaceRoot → CLAUDE.md → @-imports → resolver → composer
// pipeline. If any link in that chain regresses (resolver stops inlining,
// composer drops the agent CLAUDE.md, profile branch picks the wrong shape,
// etc.), this file's assertions fire.
//
// Approach: Option A from the plan — invoke `composeSystemPrompt` directly
// with a minimal `Pick<Agent, ...>` cast. This keeps the test focused on the
// system-prompt pipeline without dragging in `buildSdkOptions` (which would
// require a full AgentYml + ApprovalBroker + capability-cutoff stack). The
// equivalent `buildSdkOptions` integration is already covered by
// `options-profile.test.ts`'s "v0.9 #72" describe block.
//
// Spec: docs/superpowers/specs/2026-05-05-system-prompt-resolution-design.md
// Plan: docs/superpowers/plans/2026-05-05-system-prompt-resolution.md (Task 5)

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composeSystemPrompt } from '../system-prompt.js';
import { chatLikeOpenclawProfile } from '../../security/profiles/chat-like-openclaw.js';
import { publicProfile } from '../../security/profiles/public.js';
import { trustedProfile } from '../../security/profiles/trusted.js';
import { privateProfile } from '../../security/profiles/private.js';

import type { Agent } from '../../agent/agent.js';
import type { AgentYml } from '../../config/schema.js';

// ──────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ──────────────────────────────────────────────────────────────────────────────

const PROFILE_NAMES = ['chat', 'public', 'trusted', 'private'] as const;
type ProfileName = (typeof PROFILE_NAMES)[number];

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'system-prompt-e2e-'));
  for (const profileName of PROFILE_NAMES) {
    const dir = join(tmpRoot, `agent_${profileName}`);
    mkdirSync(dir);
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      '@./SOUL.md\n@./IDENTITY.md\n',
      'utf-8',
    );
    writeFileSync(
      join(dir, 'SOUL.md'),
      `# SOUL_${profileName}\n\nSoul body for ${profileName}.`,
      'utf-8',
    );
    writeFileSync(
      join(dir, 'IDENTITY.md'),
      `# IDENTITY_${profileName}\n\nIdentity body for ${profileName}.`,
      'utf-8',
    );
  }
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Build a minimal `Agent`-shaped object sufficient for `composeSystemPrompt`.
 * Matches the helper used in `system-prompt-composer.test.ts`. We do not need
 * the full Agent runtime (sessions, MCP servers, memory store, …) — the
 * composer only reads `id`, `workspacePath`, and `config.personality`.
 */
function mkAgentLike(id: string, workspaceRoot: string): Agent {
  const config = {} as unknown as AgentYml;
  return {
    id,
    workspacePath: workspaceRoot,
    config,
  } as unknown as Agent;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('system-prompt e2e — all 4 profiles resolve agent CLAUDE.md with @-imports', () => {
  it('chat_like_openclaw — resolves SOUL.md and IDENTITY.md into the string body', () => {
    const agent = mkAgentLike('agent_chat', join(tmpRoot, 'agent_chat'));
    const body = composeSystemPrompt(agent, chatLikeOpenclawProfile);
    expect(typeof body).toBe('string');
    const sp = body as string;
    expect(sp).toContain('SOUL_chat');
    expect(sp).toContain('Soul body for chat');
    expect(sp).toContain('IDENTITY_chat');
    expect(sp).toContain('Identity body for chat');
  });

  it('public — resolves SOUL.md and IDENTITY.md into the string body', () => {
    const agent = mkAgentLike('agent_public', join(tmpRoot, 'agent_public'));
    const body = composeSystemPrompt(agent, publicProfile);
    expect(typeof body).toBe('string');
    const sp = body as string;
    expect(sp).toContain('SOUL_public');
    expect(sp).toContain('Soul body for public');
    expect(sp).toContain('IDENTITY_public');
    expect(sp).toContain('Identity body for public');
    // Profile baseline still leads.
    if (publicProfile.systemPrompt.mode !== 'string') {
      throw new Error('expected publicProfile to be string mode');
    }
    expect(sp.startsWith(publicProfile.systemPrompt.text)).toBe(true);
  });

  it('trusted — resolves SOUL.md and IDENTITY.md into preset.append (excludeDynamicSections=true)', () => {
    const agent = mkAgentLike('agent_trusted', join(tmpRoot, 'agent_trusted'));
    const body = composeSystemPrompt(agent, trustedProfile);
    expect(body).toMatchObject({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
    });
    const append = (body as { append?: string }).append;
    expect(typeof append).toBe('string');
    expect(append).toContain('SOUL_trusted');
    expect(append).toContain('Soul body for trusted');
    expect(append).toContain('IDENTITY_trusted');
    expect(append).toContain('Identity body for trusted');
  });

  it('private — resolves SOUL.md and IDENTITY.md into preset.append (excludeDynamicSections=false)', () => {
    const agent = mkAgentLike('agent_private', join(tmpRoot, 'agent_private'));
    const body = composeSystemPrompt(agent, privateProfile);
    expect(body).toMatchObject({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: false,
    });
    const append = (body as { append?: string }).append;
    expect(typeof append).toBe('string');
    expect(append).toContain('SOUL_private');
    expect(append).toContain('Soul body for private');
    expect(append).toContain('IDENTITY_private');
    expect(append).toContain('Identity body for private');
  });

  it('byte-level structural assertion: resolved content order matches CLAUDE.md @-import order', () => {
    // CLAUDE.md declares `@./SOUL.md` BEFORE `@./IDENTITY.md`. The resolver
    // must inline in declaration order — SOUL_<profile> must appear before
    // IDENTITY_<profile> in every profile's body. A regression that swaps
    // the two (e.g. resolver iterates a Set rather than an Array) would
    // fail this check while string-`toContain` assertions above still pass.
    for (const profileName of PROFILE_NAMES) {
      const agentDir = join(tmpRoot, `agent_${profileName}`);
      const agent = mkAgentLike(`agent_${profileName}`, agentDir);
      const profile =
        profileName === 'chat'
          ? chatLikeOpenclawProfile
          : profileName === 'public'
          ? publicProfile
          : profileName === 'trusted'
          ? trustedProfile
          : privateProfile;
      const body = composeSystemPrompt(agent, profile);
      const haystack: string =
        typeof body === 'string'
          ? body
          : ((body as { append?: string }).append ?? '');
      const soulIdx = haystack.indexOf(`SOUL_${profileName}`);
      const identityIdx = haystack.indexOf(`IDENTITY_${profileName}`);
      expect(soulIdx, `SOUL_${profileName} must be present`).toBeGreaterThanOrEqual(0);
      expect(identityIdx, `IDENTITY_${profileName} must be present`).toBeGreaterThanOrEqual(0);
      expect(
        soulIdx,
        `SOUL_${profileName} must precede IDENTITY_${profileName} for profile=${profileName}`,
      ).toBeLessThan(identityIdx);
    }
  });
});
