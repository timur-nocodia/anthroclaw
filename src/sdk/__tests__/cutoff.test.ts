import { describe, expect, it, vi } from 'vitest';
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';
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

describe('scrubAgentEnv — every ENV_VAR_DENYLIST entry is denied', () => {
  it.each([...ENV_VAR_DENYLIST])('denies %s', (key) => {
    expect(scrubAgentEnv({ [key]: 'value' })).toEqual({});
  });
});

describe('ENV_VAR_DENYLIST anchors — these MUST stay denied', () => {
  // Critical credentials. Removing any of these from the denylist must
  // be a deliberate, reviewed decision. The test catches accidental drops.
  const ANCHORS = [
    'ANTHROPIC_API_KEY',
    'ANTHROCLAW_MASTER_KEY',
    'JWT_SECRET',
    'ADMIN_PASSWORD',
    'DATABASE_URL',
    'OC_AGENTS_DIR',
    'OC_DATA_DIR',
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CALENDAR_ID',
  ];
  it.each(ANCHORS)('contains %s', (key) => {
    expect(ENV_VAR_DENYLIST as readonly string[]).toContain(key);
  });
});

describe('ENV_VAR_DENYLIST_PREFIXES — every entry actually filters', () => {
  it.each([...ENV_VAR_DENYLIST_PREFIXES])(
    'prefix %s denies a sample %sFOO',
    (prefix) => {
      const sample = `${prefix}FOO`;
      expect(scrubAgentEnv({ [sample]: 'value' })).toEqual({});
    },
  );
});

describe('ENV_VAR_DENYLIST_PREFIXES anchors — these MUST stay denied', () => {
  const ANCHORS = [
    'ANTHROCLAW_',
    'OPENCLAW_',
    'TELEGRAM_',
    'WHATSAPP_',
    'BRAVE_',
    'EXA_',
    'ASSEMBLYAI_',
    'GITHUB_',
    'GH_',
    'AWS_',
    'GCP_',
    'AZURE_',
    'CLOUDFLARE_',
    'STRIPE_',
    'TWILIO_',
    'SENTRY_',
    'DATADOG_',
  ];
  it.each(ANCHORS)('contains %s', (prefix) => {
    expect(ENV_VAR_DENYLIST_PREFIXES as readonly string[]).toContain(prefix);
  });
});

describe('scrubAgentEnv — benign vars are preserved', () => {
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
