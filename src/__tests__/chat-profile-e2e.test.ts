import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentYmlSchema } from '../config/schema.js';
import { getProfile, getDefaultProfile } from '../security/profiles/index.js';
import { CHAT_PERSONALITY_BASELINE } from '../security/profiles/chat-personality-baseline.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'chat-e2e-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('chat_like_openclaw end-to-end', () => {
  it('default scaffold profile matches chat profile registry entry', () => {
    const defaultName = getDefaultProfile();
    expect(defaultName).toBe('chat_like_openclaw');
    const profile = getProfile(defaultName);
    expect(profile.name).toBe('chat_like_openclaw');
  });

  it('agent.yml with chat profile parses + validates', () => {
    const config = {
      model: 'claude-sonnet-4-6',
      safety_profile: 'chat_like_openclaw',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      personality: 'Be a warm friendly companion.',
    };
    const result = AgentYmlSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('chat profile baseline mentions "messaging" and "warm"', () => {
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toContain('messaging');
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toContain('warm');
  });

  it('chat profile system prompt does NOT contain "be concise" or claude_code preset markers', () => {
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).not.toContain('be concise');
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).not.toContain('no preamble');
  });

  it('agents/example config (production) validates as chat_like_openclaw', async () => {
    const { readFileSync } = await import('node:fs');
    const { parse } = await import('yaml');
    const path = join(process.cwd(), 'agents/example/agent.yml');
    const raw = readFileSync(path, 'utf-8');
    const cfg = parse(raw);
    expect(cfg.safety_profile).toBe('chat_like_openclaw');
    const result = AgentYmlSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });
});
