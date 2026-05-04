import { describe, expect, it } from 'vitest';
import {
  AGENT_BUILTIN_TOOL_WHITELIST,
  ENV_VAR_DENYLIST,
  ENV_VAR_DENYLIST_PREFIXES,
  scrubAgentEnv,
  composeToolGates,
} from '../cutoff.js';

describe('AGENT_BUILTIN_TOOL_WHITELIST', () => {
  it('contains exactly the safe built-ins', () => {
    expect(AGENT_BUILTIN_TOOL_WHITELIST).toEqual(
      ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
    );
  });
});

describe('ENV_VAR_DENYLIST and prefixes are exported', () => {
  it('exports both', () => {
    expect(ENV_VAR_DENYLIST.length).toBeGreaterThan(0);
    expect(ENV_VAR_DENYLIST_PREFIXES.length).toBeGreaterThan(0);
  });
});

describe('scrubAgentEnv', () => {
  it('removes exact-match denylist vars', () => {
    const out = scrubAgentEnv({
      GOOGLE_CALENDAR_ID: 'leak',
      ANTHROCLAW_MASTER_KEY: 'secret',
      TZ: 'UTC',
    });
    expect(out.GOOGLE_CALENDAR_ID).toBeUndefined();
    expect(out.ANTHROCLAW_MASTER_KEY).toBeUndefined();
    expect(out.TZ).toBe('UTC');
  });

  it('removes prefix-matched vars', () => {
    const out = scrubAgentEnv({
      ANTHROPIC_API_KEY: 'k',
      OPENAI_API_KEY: 'k',
      AWS_ACCESS_KEY_ID: 'k',
      GITHUB_TOKEN: 'k',
      PATH: '/usr/bin',
    });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.OPENAI_API_KEY).toBeUndefined();
    expect(out.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
  });

  it('preserves benign env', () => {
    const out = scrubAgentEnv({
      NODE_ENV: 'production',
      LANG: 'en_US.UTF-8',
      USER: 'node',
    });
    expect(out).toEqual({ NODE_ENV: 'production', LANG: 'en_US.UTF-8', USER: 'node' });
  });

  it('handles undefined values without including them as defined', () => {
    const out = scrubAgentEnv({ X_OK: undefined, Y_OK: 'v' });
    expect(out.X_OK).toBeUndefined();
    expect(out.Y_OK).toBe('v');
  });
});

describe('composeToolGates', () => {
  const allow = async () => ({ behavior: 'allow' as const });
  const denyA = async () => ({
    behavior: 'deny' as const,
    message: 'upstream-deny',
    decisionReason: { type: 'other' as const, reason: 'upstream' },
  });
  const denyB = async () => ({
    behavior: 'deny' as const,
    message: 'cutoff-deny',
    decisionReason: { type: 'other' as const, reason: 'cutoff' },
  });

  it('runs upstream first; if upstream denies, returns its decision (cutoff not consulted)', async () => {
    const gate = composeToolGates(denyA, denyB);
    const r = await gate('Read', {}, { agentId: 'a', sessionId: 's' } as any);
    expect(r.behavior).toBe('deny');
    if (r.behavior === 'deny') expect(r.message).toBe('upstream-deny');
  });

  it('runs cutoff after upstream allow; cutoff has final say', async () => {
    const gate = composeToolGates(allow, denyB);
    const r = await gate('Read', {}, { agentId: 'a', sessionId: 's' } as any);
    expect(r.behavior).toBe('deny');
    if (r.behavior === 'deny') expect(r.message).toBe('cutoff-deny');
  });

  it('handles undefined upstream — runs only cutoff', async () => {
    const gate = composeToolGates(undefined, denyB);
    expect((await gate('x', {}, {} as any)).behavior).toBe('deny');
  });

  it('allows when both gates allow', async () => {
    const gate = composeToolGates(allow, allow);
    expect((await gate('x', {}, {} as any)).behavior).toBe('allow');
  });
});
