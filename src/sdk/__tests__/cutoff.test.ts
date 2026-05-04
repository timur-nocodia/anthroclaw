import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CanUseTool, Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk';
import {
  AGENT_BUILTIN_TOOL_WHITELIST,
  ENV_VAR_DENYLIST,
  ENV_VAR_DENYLIST_PREFIXES,
  scrubAgentEnv,
  composeToolGates,
  applyCutoffOptions,
  agentToolGate,
  buildAllowedToolNames,
} from '../cutoff.js';
import type { Agent } from '../../agent/agent.js';
import { logger } from '../../logger.js';

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

  // ── updatedInput threading (CR-2) ─────────────────────────────────────────
  it('upstream allows with updatedInput; cutoff allows without — final result preserves upstream updatedInput', async () => {
    const upstream: CanUseTool = async () => ({
      behavior: 'allow',
      updatedInput: { redacted: true, secret: '<redacted>' },
    });
    const cutoff: CanUseTool = async () => ({ behavior: 'allow' });
    const gate = composeToolGates(upstream, cutoff);
    const r = await gate('Read', { secret: 'leak' }, {} as any);
    expect(r.behavior).toBe('allow');
    if (r.behavior === 'allow') {
      expect(r.updatedInput).toEqual({ redacted: true, secret: '<redacted>' });
    }
  });

  it('upstream allows with updatedInput; cutoff allows with its own updatedInput — cutoff wins (final say)', async () => {
    const upstream: CanUseTool = async () => ({
      behavior: 'allow',
      updatedInput: { from: 'upstream' },
    });
    const cutoff: CanUseTool = async () => ({
      behavior: 'allow',
      updatedInput: { from: 'cutoff' },
    });
    const gate = composeToolGates(upstream, cutoff);
    const r = await gate('Read', { from: 'caller' }, {} as any);
    expect(r.behavior).toBe('allow');
    if (r.behavior === 'allow') {
      expect(r.updatedInput).toEqual({ from: 'cutoff' });
    }
  });

  it('cutoff sees upstream\'s updatedInput as effective input (verified via spy)', async () => {
    const upstream: CanUseTool = async () => ({
      behavior: 'allow',
      updatedInput: { transformed: true },
    });
    const cutoffSpy = vi.fn<CanUseTool>(async () => ({ behavior: 'allow' as const }));
    const gate = composeToolGates(upstream, cutoffSpy);
    await gate('Read', { transformed: false, original: true }, { sessionId: 's' } as any);
    expect(cutoffSpy).toHaveBeenCalledTimes(1);
    // The second arg passed to cutoff must be the updatedInput from upstream,
    // NOT the original input. Otherwise upstream's redaction is silently dropped.
    expect(cutoffSpy.mock.calls[0][1]).toEqual({ transformed: true });
  });

  it('upstream allows without updatedInput; cutoff sees the original input', async () => {
    const upstream: CanUseTool = async () => ({ behavior: 'allow' });
    const cutoffSpy = vi.fn<CanUseTool>(async () => ({ behavior: 'allow' as const }));
    const gate = composeToolGates(upstream, cutoffSpy);
    const original = { foo: 'bar' };
    await gate('Read', original, {} as any);
    expect(cutoffSpy.mock.calls[0][1]).toBe(original);
  });

  it('no upstream; cutoff allow with own updatedInput is preserved', async () => {
    const cutoff: CanUseTool = async () => ({
      behavior: 'allow',
      updatedInput: { from: 'cutoff-only' },
    });
    const gate = composeToolGates(undefined, cutoff);
    const r = await gate('Read', {}, {} as any);
    expect(r.behavior).toBe('allow');
    if (r.behavior === 'allow') {
      expect(r.updatedInput).toEqual({ from: 'cutoff-only' });
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// applyCutoffOptions / agentToolGate / buildAllowedToolNames
// ────────────────────────────────────────────────────────────────────────────

function stubAgent(overrides: { id?: string; config?: Partial<Agent['config']> } = {}): Agent {
  return {
    id: overrides.id ?? 'test-agent',
    config: {
      model: 'claude-sonnet-4-6',
      mcp_tools: ['memory_search', 'send_message'],
      external_mcp_servers: undefined,
      ...overrides.config,
    },
  } as unknown as Agent;
}

describe('buildAllowedToolNames', () => {
  it('returns whitelist + mcp_tools + glob entries (one per external server)', () => {
    const agent = stubAgent({
      config: {
        mcp_tools: ['memory_search', 'send_message'],
        external_mcp_servers: {
          gmail: { type: 'http', url: 'https://x' } as any,
          calendar: { type: 'http', url: 'https://y' } as any,
        } as any,
      },
    });
    const names = buildAllowedToolNames(agent);
    for (const t of AGENT_BUILTIN_TOOL_WHITELIST) {
      expect(names).toContain(t);
    }
    expect(names).toContain('memory_search');
    expect(names).toContain('send_message');
    expect(names).toContain('mcp__gmail__*');
    expect(names).toContain('mcp__calendar__*');
  });

  it('empty agent yields just whitelist', () => {
    const agent = stubAgent({ config: { mcp_tools: undefined, external_mcp_servers: undefined } });
    const names = buildAllowedToolNames(agent);
    expect(names).toEqual([...AGENT_BUILTIN_TOOL_WHITELIST]);
  });

  it('includes glob for agent.mcpServer.name when present', () => {
    const agent = {
      id: 'klavdia',
      config: { mcp_tools: ['memory_search'], external_mcp_servers: undefined },
      mcpServer: { name: 'klavdia-tools' },
    } as unknown as Agent;
    const names = buildAllowedToolNames(agent);
    expect(names).toContain('mcp__klavdia-tools__*');
    expect(names).toContain('memory_search');
  });
});

describe('agentToolGate', () => {
  it('allows AGENT_BUILTIN_TOOL_WHITELIST entries', async () => {
    const gate = agentToolGate(stubAgent());
    for (const t of AGENT_BUILTIN_TOOL_WHITELIST) {
      const r = await gate(t, {}, {} as any);
      expect(r.behavior).toBe('allow');
    }
  });

  it('allows entries in agent.config.mcp_tools', async () => {
    const gate = agentToolGate(stubAgent({ config: { mcp_tools: ['memory_search', 'manage_cron'] } }));
    expect((await gate('memory_search', {}, {} as any)).behavior).toBe('allow');
    expect((await gate('manage_cron', {}, {} as any)).behavior).toBe('allow');
  });

  it('allows tools under the agent\'s own in-process SDK MCP server prefix', async () => {
    const agent = {
      id: 'klavdia',
      config: { mcp_tools: ['memory_search'], external_mcp_servers: undefined },
      mcpServer: { name: 'klavdia-tools' },
    } as unknown as Agent;
    const gate = agentToolGate(agent);
    expect((await gate('mcp__klavdia-tools__memory_search', {}, {} as any)).behavior).toBe('allow');
    expect((await gate('mcp__klavdia-tools__send_message', {}, {} as any)).behavior).toBe('allow');
  });

  it('allows tools matching mcp__<server>__* for each external_mcp_servers entry', async () => {
    const gate = agentToolGate(stubAgent({
      config: {
        external_mcp_servers: {
          notion: { type: 'http', url: 'https://x' } as any,
        } as any,
      },
    }));
    expect((await gate('mcp__notion__search', {}, {} as any)).behavior).toBe('allow');
    expect((await gate('mcp__notion__create_page', {}, {} as any)).behavior).toBe('allow');
  });

  it('denies anything else with helpful message + decisionReason', async () => {
    const gate = agentToolGate(stubAgent());
    const r = await gate('mcp__claude_ai_Google_Calendar__list_events', {}, {} as any);
    expect(r.behavior).toBe('deny');
    if (r.behavior === 'deny') {
      expect(r.message).toContain('not declared');
      // `decisionReason` is an extra-property convention used by the gateway's
      // hook listeners; the SDK runtime ignores it. Cast to access.
      expect((r as Record<string, unknown>).decisionReason).toMatchObject({
        type: 'other',
        reason: 'capability_cutoff',
      });
    }
  });

  it('denies WebFetch / WebSearch / Task by default (not in whitelist)', async () => {
    const gate = agentToolGate(stubAgent());
    for (const t of ['WebFetch', 'WebSearch', 'Task', 'NotebookEdit']) {
      const r = await gate(t, {}, {} as any);
      expect(r.behavior).toBe('deny');
    }
  });

  it('does not allow unrelated tools just because some external server is configured', async () => {
    const gate = agentToolGate(stubAgent({
      config: {
        external_mcp_servers: {
          gmail: { type: 'http', url: 'https://x' } as any,
        } as any,
      },
    }));
    const r = await gate('mcp__notion__search', {}, {} as any);
    expect(r.behavior).toBe('deny');
  });

  // TQ-4: substring confusion — `mcp__foo__*` glob must not allow `mcp__foobar__*`.
  // The implementation strips the trailing `*` to get the prefix `mcp__foo__`,
  // which (because of the trailing double-underscore) is NOT a prefix of
  // `mcp__foobar__list`. This test guards against any future refactor that
  // accidentally drops the underscore boundary.
  it('mcp__foo__* glob does not match mcp__foobar__* (substring confusion guard)', async () => {
    const gate = agentToolGate(stubAgent({
      config: {
        external_mcp_servers: {
          foo: { type: 'http', url: 'https://x' } as any,
        } as any,
      },
    }));
    expect((await gate('mcp__foo__list', {}, {} as any)).behavior).toBe('allow');
    expect((await gate('mcp__foobar__list', {}, {} as any)).behavior).toBe('deny');
  });
});

describe('applyCutoffOptions', () => {
  let prevAgentsDir: string | undefined;
  let agentsRoot: string;

  beforeEach(() => {
    agentsRoot = mkdtempSync(join(tmpdir(), 'cutoff-options-'));
    prevAgentsDir = process.env.OC_AGENTS_DIR;
    process.env.OC_AGENTS_DIR = agentsRoot;
  });
  afterEach(() => {
    process.env.OC_AGENTS_DIR = prevAgentsDir;
    rmSync(agentsRoot, { recursive: true, force: true });
  });

  it('forces enabledMcpjsonServers to []', () => {
    // `enabledMcpjsonServers` is not on the top-level Options type — the
    // SDK consumes it via settingSources. We forcibly set it anyway as
    // defence-in-depth (see applyCutoffOptions). Use casts to bypass the
    // strict type.
    const out = applyCutoffOptions(
      { enabledMcpjsonServers: ['leak'] } as unknown as SdkOptions,
      stubAgent(),
    );
    expect((out as Record<string, unknown>).enabledMcpjsonServers).toEqual([]);
  });

  it('forces settingSources to []', () => {
    const out = applyCutoffOptions(
      { settingSources: ['user', 'project'] } as SdkOptions,
      stubAgent(),
    );
    expect(out.settingSources).toEqual([]);
  });

  it('forces additionalDirectories to []', () => {
    const out = applyCutoffOptions(
      { additionalDirectories: ['/etc'] } as SdkOptions,
      stubAgent(),
    );
    expect(out.additionalDirectories).toEqual([]);
  });

  it('sets cwd to agentWorkspaceDir(agent.id)', () => {
    const out = applyCutoffOptions(
      { cwd: '/somewhere/else' } as SdkOptions,
      stubAgent({ id: 'test-agent' }),
    );
    expect(out.cwd).toBe(resolve(agentsRoot, 'test-agent'));
  });

  it('strips denylisted env vars; preserves harmless ones (TZ)', () => {
    const out = applyCutoffOptions(
      { env: { ANTHROPIC_API_KEY: 'leak', GOOGLE_CALENDAR_ID: 'leak2', TZ: 'UTC' } } as SdkOptions,
      stubAgent(),
    );
    expect(out.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.env?.GOOGLE_CALENDAR_ID).toBeUndefined();
    expect(out.env?.TZ).toBe('UTC');
  });

  it('falls back to process.env when base.env is undefined', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'Etc/UTC';
    try {
      const out = applyCutoffOptions({} as SdkOptions, stubAgent());
      expect(out.env).toBeDefined();
      // env was scrubbed (denylisted keys absent)
      expect(out.env?.ANTHROPIC_API_KEY).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it('does NOT modify mcpServers — passes through base.mcpServers unchanged', () => {
    const baseMcp = {
      'agent-tools': { name: 'agent-tools', instance: {} } as any,
      external_foo: { type: 'http', url: 'https://x' } as any,
    };
    const out = applyCutoffOptions(
      { mcpServers: baseMcp } as SdkOptions,
      stubAgent({ config: { external_mcp_servers: undefined } }),
    );
    expect(out.mcpServers).toBe(baseMcp);
  });

  it('does NOT modify allowedTools — passes through base.allowedTools unchanged', () => {
    const allowed = ['Read', 'Write', 'mcp__agent-tools__memory_search'];
    const out = applyCutoffOptions(
      { allowedTools: allowed } as SdkOptions,
      stubAgent(),
    );
    expect(out.allowedTools).toBe(allowed);
  });

  it('canUseTool is composed: deny-everything upstream short-circuits before cutoff', async () => {
    const upstream: CanUseTool = async () => ({
      behavior: 'deny',
      message: 'upstream-deny',
      decisionReason: { type: 'other', reason: 'upstream' },
    });
    const out = applyCutoffOptions({ canUseTool: upstream } as SdkOptions, stubAgent());
    expect(out.canUseTool).toBeDefined();
    // 'Read' would be allowed by cutoff — but upstream denies first.
    const r = await out.canUseTool!('Read', {}, {} as any);
    expect(r.behavior).toBe('deny');
    if (r.behavior === 'deny') expect(r.message).toBe('upstream-deny');
  });

  it('canUseTool composed: when upstream allows, cutoff has final say (denies undeclared)', async () => {
    const upstream: CanUseTool = async () => ({ behavior: 'allow' });
    const out = applyCutoffOptions({ canUseTool: upstream } as SdkOptions, stubAgent());
    const r = await out.canUseTool!('mcp__claude_ai_Gmail__search_threads', {}, {} as any);
    expect(r.behavior).toBe('deny');
  });

  it('canUseTool composed: when upstream undefined, cutoff gate alone applies', async () => {
    const out = applyCutoffOptions({} as SdkOptions, stubAgent());
    expect(out.canUseTool).toBeDefined();
    expect((await out.canUseTool!('Read', {}, {} as any)).behavior).toBe('allow');
    expect((await out.canUseTool!('mcp__claude_ai_Google_Calendar__list_events', {}, {} as any)).behavior).toBe('deny');
  });

  it('is idempotent — applying twice yields the same shape (modulo function identity)', async () => {
    const agent = stubAgent();
    const once = applyCutoffOptions({ settingSources: ['user'] as any, additionalDirectories: ['/x'] } as SdkOptions, agent);
    const twice = applyCutoffOptions(once, agent);
    expect(twice.settingSources).toEqual([]);
    expect(twice.additionalDirectories).toEqual([]);
    expect((twice as Record<string, unknown>).enabledMcpjsonServers).toEqual([]);
    expect(twice.cwd).toBe(once.cwd);
    expect(twice.env).toEqual(once.env);
    // mcpServers / allowedTools pass-through preserves whatever was there
    expect(twice.mcpServers).toBe(once.mcpServers);
    expect(twice.allowedTools).toBe(once.allowedTools);

    // ── Behavioral idempotency (TQ-1) ──────────────────────────────────────
    // Structural equality is not enough — the JSDoc claims runtime semantics
    // are identical after double-application. Verify by exercising both
    // composed canUseTool gates with the same inputs and asserting matching
    // results AND matching warn-log output (no double-warn from re-wrapping).
    expect(typeof once.canUseTool).toBe('function');
    expect(typeof twice.canUseTool).toBe('function');

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as any);
    try {
      // Allow case: 'Read' is in the built-in whitelist.
      warnSpy.mockClear();
      const onceAllow = await once.canUseTool!('Read', {}, {} as any);
      const onceAllowWarns = warnSpy.mock.calls.length;
      warnSpy.mockClear();
      const twiceAllow = await twice.canUseTool!('Read', {}, {} as any);
      const twiceAllowWarns = warnSpy.mock.calls.length;
      expect(onceAllow).toEqual({ behavior: 'allow' });
      expect(twiceAllow).toEqual({ behavior: 'allow' });
      expect(twiceAllowWarns).toBe(onceAllowWarns);

      // Deny case: cross-agent calendar tool.
      const denyTool = 'mcp__claude_ai_Google_Calendar__list_events';
      warnSpy.mockClear();
      const onceDeny = await once.canUseTool!(denyTool, {}, {} as any);
      const onceDenyWarns = warnSpy.mock.calls.length;
      warnSpy.mockClear();
      const twiceDeny = await twice.canUseTool!(denyTool, {}, {} as any);
      const twiceDenyWarns = warnSpy.mock.calls.length;
      expect(onceDeny.behavior).toBe('deny');
      expect(twiceDeny.behavior).toBe('deny');
      if (onceDeny.behavior === 'deny' && twiceDeny.behavior === 'deny') {
        expect(twiceDeny.message).toBe(onceDeny.message);
      }
      // Each invocation should produce exactly one warn — re-wrapping must
      // NOT cause the inner gate to fire twice.
      expect(onceDenyWarns).toBe(1);
      expect(twiceDenyWarns).toBe(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('preserves unrelated base options (model, systemPrompt, maxTurns)', () => {
    const out = applyCutoffOptions(
      {
        model: 'claude-haiku-4-5',
        systemPrompt: 'be brief',
        maxTurns: 7,
      } as SdkOptions,
      stubAgent(),
    );
    expect(out.model).toBe('claude-haiku-4-5');
    expect(out.systemPrompt).toBe('be brief');
    expect(out.maxTurns).toBe(7);
  });
});
