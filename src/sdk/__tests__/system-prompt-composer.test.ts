import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { composeSystemPrompt } from '../system-prompt.js';
import { CHAT_PERSONALITY_BASELINE } from '../../security/profiles/chat-personality-baseline.js';
import { publicProfile } from '../../security/profiles/public.js';
import { trustedProfile } from '../../security/profiles/trusted.js';
import { privateProfile } from '../../security/profiles/private.js';
import { chatLikeOpenclawProfile } from '../../security/profiles/chat-like-openclaw.js';

import type { Agent } from '../../agent/agent.js';
import type { AgentYml } from '../../config/schema.js';

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

let workspaceRoot: string;

beforeEach(() => {
  workspaceRoot = mkdtempSync(join(tmpdir(), 'system-prompt-composer-'));
});

afterEach(() => {
  rmSync(workspaceRoot, { recursive: true, force: true });
});

function writeClaudeMd(content: string): void {
  writeFileSync(join(workspaceRoot, 'CLAUDE.md'), content, 'utf-8');
}

function writeWorkspaceFile(rel: string, content: string): void {
  writeFileSync(join(workspaceRoot, rel), content, 'utf-8');
}

function mkAgent(opts: { id: string; workspaceRoot: string; personality?: string }): Agent {
  const config = { personality: opts.personality } as unknown as AgentYml;
  return {
    id: opts.id,
    workspacePath: opts.workspaceRoot,
    config,
  } as unknown as Agent;
}

const SEPARATOR = '\n\n─────────\n\n';

// ──────────────────────────────────────────────────────────────────────────────
// Tests numbered per plan §2 (17–27)
// ──────────────────────────────────────────────────────────────────────────────

describe('composeSystemPrompt — chat_like_openclaw profile', () => {
  // 17
  it('chat_like_openclaw + agent CLAUDE.md → baseline + separator + CLAUDE.md', () => {
    writeClaudeMd('# My agent rules\n\nBe helpful.');
    const agent = mkAgent({ id: 'a1', workspaceRoot });
    const result = composeSystemPrompt(agent, chatLikeOpenclawProfile);
    expect(result).toBe(
      `${CHAT_PERSONALITY_BASELINE}${SEPARATOR}# My agent rules\n\nBe helpful.`,
    );
  });

  // 18
  it('chat_like_openclaw + no CLAUDE.md → just CHAT_PERSONALITY_BASELINE', () => {
    const agent = mkAgent({ id: 'a2', workspaceRoot });
    const result = composeSystemPrompt(agent, chatLikeOpenclawProfile);
    expect(result).toBe(CHAT_PERSONALITY_BASELINE);
  });

  // 19
  it('chat_like_openclaw + custom personality → custom + separator + CLAUDE.md', () => {
    writeClaudeMd('Agent specific rules.');
    const agent = mkAgent({
      id: 'a3',
      workspaceRoot,
      personality: 'I am a pirate. Arrr.',
    });
    const result = composeSystemPrompt(agent, chatLikeOpenclawProfile);
    expect(result).toBe(`I am a pirate. Arrr.${SEPARATOR}Agent specific rules.`);
  });
});

describe('composeSystemPrompt — public profile', () => {
  // 20
  it('public + agent CLAUDE.md → profile.text + separator + CLAUDE.md', () => {
    writeClaudeMd('Agent details.');
    const agent = mkAgent({ id: 'a4', workspaceRoot });
    const result = composeSystemPrompt(agent, publicProfile);
    // publicProfile.systemPrompt is { mode: 'string', text: ... } — narrow it.
    if (publicProfile.systemPrompt.mode !== 'string') {
      throw new Error('expected publicProfile to be string mode');
    }
    expect(result).toBe(
      `${publicProfile.systemPrompt.text}${SEPARATOR}Agent details.`,
    );
  });

  // 21
  it('public + no CLAUDE.md → profile.text alone', () => {
    const agent = mkAgent({ id: 'a5', workspaceRoot });
    const result = composeSystemPrompt(agent, publicProfile);
    if (publicProfile.systemPrompt.mode !== 'string') {
      throw new Error('expected publicProfile to be string mode');
    }
    expect(result).toBe(publicProfile.systemPrompt.text);
  });
});

describe('composeSystemPrompt — trusted profile (preset mode)', () => {
  // 22
  it('trusted + agent CLAUDE.md → preset object with append: CLAUDE.md', () => {
    writeClaudeMd('Trusted agent CLAUDE.md content.');
    const agent = mkAgent({ id: 'a6', workspaceRoot });
    const result = composeSystemPrompt(agent, trustedProfile);
    expect(result).toEqual({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
      append: 'Trusted agent CLAUDE.md content.',
    });
  });

  // 23
  it('trusted + no CLAUDE.md → preset object WITHOUT append', () => {
    const agent = mkAgent({ id: 'a7', workspaceRoot });
    const result = composeSystemPrompt(agent, trustedProfile);
    expect(result).toEqual({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
    });
    expect(result).not.toHaveProperty('append');
  });
});

describe('composeSystemPrompt — private profile (preset mode)', () => {
  // 24
  it('private + agent CLAUDE.md → preset object with append + excludeDynamicSections=false', () => {
    writeClaudeMd('Private agent CLAUDE.md content.');
    const agent = mkAgent({ id: 'a8', workspaceRoot });
    const result = composeSystemPrompt(agent, privateProfile);
    expect(result).toEqual({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: false,
      append: 'Private agent CLAUDE.md content.',
    });
  });

  // 25
  it('private + no CLAUDE.md → preset object WITHOUT append', () => {
    const agent = mkAgent({ id: 'a9', workspaceRoot });
    const result = composeSystemPrompt(agent, privateProfile);
    expect(result).toEqual({
      type: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: false,
    });
    expect(result).not.toHaveProperty('append');
  });
});

describe('composeSystemPrompt — integration with @-import resolver', () => {
  // 26
  it('chat_like_openclaw + CLAUDE.md with @./SOUL.md import → resolved content inlined', () => {
    writeWorkspaceFile('SOUL.md', 'I am SOUL — the agent essence.');
    writeClaudeMd('header line\n@./SOUL.md\nfooter line');
    const agent = mkAgent({ id: 'a10', workspaceRoot });
    const result = composeSystemPrompt(agent, chatLikeOpenclawProfile);
    expect(typeof result).toBe('string');
    expect(result).toContain('I am SOUL — the agent essence.');
    // The inlined content should sit between header and footer.
    expect(result).toContain('header line\nI am SOUL — the agent essence.\nfooter line');
    // Personality baseline still leads.
    expect(result as string).toMatch(new RegExp(`^${escapeRegex(CHAT_PERSONALITY_BASELINE)}`));
  });

  // 27
  it('public + CLAUDE.md with @./RULES.md import → resolved content inlined', () => {
    writeWorkspaceFile('RULES.md', 'Rule 1: be terse.');
    writeClaudeMd('top\n@./RULES.md\nbottom');
    const agent = mkAgent({ id: 'a11', workspaceRoot });
    const result = composeSystemPrompt(agent, publicProfile);
    expect(typeof result).toBe('string');
    expect(result).toContain('Rule 1: be terse.');
    expect(result).toContain('top\nRule 1: be terse.\nbottom');
    if (publicProfile.systemPrompt.mode !== 'string') {
      throw new Error('expected publicProfile to be string mode');
    }
    expect(result as string).toMatch(
      new RegExp(`^${escapeRegex(publicProfile.systemPrompt.text)}`),
    );
  });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
