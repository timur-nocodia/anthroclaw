import { describe, expect, it, vi } from 'vitest';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import {
  AGENT_BUILTIN_TOOL_WHITELIST,
  scrubAgentEnv,
  composeToolGates,
} from '../cutoff.js';

describe('AGENT_BUILTIN_TOOL_WHITELIST', () => {
  it('contains exactly the safe built-ins', () => {
    expect(AGENT_BUILTIN_TOOL_WHITELIST).toEqual(
      ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
    );
  });

  const KNOWN_DANGEROUS_TOOLS = [
    'WebFetch',
    'WebSearch',
    'Task',
    'NotebookEdit',
    'KillShell',
    'BashOutput',
    'ExitPlanMode',
  ];
  it.each(KNOWN_DANGEROUS_TOOLS)(
    'does not include %s in built-in whitelist',
    (tool) => {
      expect(AGENT_BUILTIN_TOOL_WHITELIST as readonly string[]).not.toContain(
        tool,
      );
    },
  );
});

describe('scrubAgentEnv — property assertions for known credentials', () => {
  const KNOWN_DENIED = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_ACCESS_KEY_ID',
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'GITHUB_PAT',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_BOT_TOKEN_CONTENT_SM',
    'WHATSAPP_AUTH_DIR',
    'OPENCLAW_SUBAGENT_MCP_BRAVE_API_KEY',
    'OPENCLAW_SUBAGENT_MCP_EXA_API_KEY',
    'ANTHROCLAW_MASTER_KEY',
    'ANTHROCLAW_DB_PASSWORD',
    'ASSEMBLYAI_API_KEY',
    'BRAVE_API_KEY',
    'EXA_API_KEY',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'CF_API_KEY',
    'STRIPE_SECRET_KEY',
    'TWILIO_AUTH_TOKEN',
    'SUPABASE_SERVICE_ROLE_KEY',
    'DATABASE_URL',
    'REDIS_URL',
    'NOTION_API_KEY',
    'LINEAR_API_KEY',
    'GMAIL_OAUTH_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CALENDAR_ID',
    'SLACK_BOT_TOKEN',
    'DISCORD_TOKEN',
    'NPM_TOKEN',
    'SENTRY_AUTH_TOKEN',
    'DATADOG_API_KEY',
    'DD_API_KEY',
  ];

  const KNOWN_KEPT = [
    'PATH',
    'HOME',
    'USER',
    'LANG',
    'TZ',
    'NODE_ENV',
    'TERM',
    'SHELL',
    'PWD',
    'TMPDIR',
    'XDG_RUNTIME_DIR',
  ];

  it.each(KNOWN_DENIED)('denies %s', (key) => {
    expect(scrubAgentEnv({ [key]: 'value' })).toEqual({});
  });

  it.each(KNOWN_KEPT)('preserves %s', (key) => {
    const out = scrubAgentEnv({ [key]: 'value' });
    expect(out[key]).toBe('value');
  });

  it('matches case-insensitively', () => {
    expect(scrubAgentEnv({ anthropic_api_key: 'x' })).toEqual({});
    expect(scrubAgentEnv({ Anthropic_Api_Key: 'x' })).toEqual({});
    expect(scrubAgentEnv({ Path: '/usr/bin' })).toEqual({ Path: '/usr/bin' });
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
    expect('X_OK' in out).toBe(false);
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

  it('runs upstream first; if upstream returns ask, cutoff is not consulted', async () => {
    const askGate: CanUseTool = async () =>
      ({
        behavior: 'ask' as const,
        message: 'upstream-ask',
      } as any);
    const cutoffSpy = vi.fn(async () => ({ behavior: 'allow' as const }));
    const gate = composeToolGates(askGate, cutoffSpy);
    const r = await gate('Read', {}, { agentId: 'a', sessionId: 's' } as any);
    expect(r.behavior).toBe('ask');
    expect(cutoffSpy).not.toHaveBeenCalled();
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
