import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(
  process.cwd(),
  'app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx',
);

describe('agent config page — chat profile constants', () => {
  const source = readFileSync(PAGE_PATH, 'utf-8');

  it('SAFETY_PROFILES array includes chat_like_openclaw', () => {
    expect(source).toMatch(/value:\s*["']chat_like_openclaw["']/);
  });

  it('chat option appears before public/trusted/private in SAFETY_PROFILES', () => {
    // Extract the SAFETY_PROFILES array block to scope ordering checks within it
    const profilesMatch = source.match(/const SAFETY_PROFILES\s*=\s*\[[\s\S]*?\];/);
    expect(profilesMatch).toBeTruthy();
    const profilesBlock = profilesMatch![0];
    const chatIdx = profilesBlock.indexOf('"chat_like_openclaw"');
    const publicIdx = profilesBlock.indexOf('"public"');
    const trustedIdx = profilesBlock.indexOf('"trusted"');
    const privateIdx = profilesBlock.indexOf('"private"');
    expect(chatIdx).toBeGreaterThan(0);
    expect(chatIdx).toBeLessThan(publicIdx);
    expect(chatIdx).toBeLessThan(trustedIdx);
    expect(chatIdx).toBeLessThan(privateIdx);
  });

  it('SAFETY_PROFILE_TOOLTIP has chat_like_openclaw entry', () => {
    expect(source).toMatch(/chat_like_openclaw:\s*\n?\s*["'`]/);
  });

  it('chat tooltip mentions warm conversational tone', () => {
    const match = source.match(/chat_like_openclaw:[\s\S]{0,800}?["']\s*,/);
    expect(match).toBeTruthy();
    if (match) {
      const block = match[0].toLowerCase();
      expect(block).toMatch(/warm|conversational/);
      expect(block).toContain('default for new agents');
    }
  });

  it('useState fallback for safety_profile defaults to chat_like_openclaw', () => {
    expect(source).toMatch(/agent\.safety_profile\s*\?\?\s*['"]chat_like_openclaw['"]/);
  });

  it('AgentConfig type widens safety_profile to include chat_like_openclaw', () => {
    expect(source).toMatch(/safety_profile\?:[^;\n]*chat_like_openclaw/);
  });

  it('personality field appears in cfg state initializer', () => {
    expect(source).toMatch(/personality:\s*agent\.personality/);
  });

  it('Personality textarea is conditional on chat profile', () => {
    expect(source).toMatch(
      /cfg\.safety_profile\s*===\s*['"]chat_like_openclaw['"]\s*&&[\s\S]{0,200}<Field[\s\S]{0,200}label=["']Personality["']/,
    );
  });
});
