import { describe, it, expect } from 'vitest';
import {
  GlobalConfigSchema,
  AgentYmlSchema,
  RouteSchema,
  PairingSchema,
} from '../../src/config/schema.js';
import type { GlobalConfig, AgentYml, Route, Pairing } from '../../src/config/schema.js';

// ─── GlobalConfigSchema ────────────────────────────────────────────

describe('GlobalConfigSchema', () => {
  it('accepts a valid minimal config (just a telegram token)', () => {
    const input = {
      telegram: {
        accounts: {
          main: { token: 'bot123:ABC' },
        },
      },
    };
    const result = GlobalConfigSchema.parse(input);
    expect(result.telegram!.accounts.main.token).toBe('bot123:ABC');
  });

  it('rejects a telegram account with missing token', () => {
    const input = {
      telegram: {
        accounts: {
          main: {},
        },
      },
    };
    expect(() => GlobalConfigSchema.parse(input)).toThrow();
  });

  it('accepts a full config with whatsapp + defaults', () => {
    const input = {
      telegram: {
        accounts: {
          main: {
            token: 'bot123:ABC',
            webhook: { url: 'https://example.com/webhook', secret: 's3cret' },
          },
        },
      },
      whatsapp: {
        accounts: {
          wa1: { auth_dir: '/tmp/wa-auth' },
        },
      },
      defaults: {
        model: 'claude-opus-4-6',
        embedding_provider: 'local',
        embedding_model: 'nomic-embed-text',
      },
    };
    const result = GlobalConfigSchema.parse(input);
    expect(result.telegram!.accounts.main.webhook!.url).toBe('https://example.com/webhook');
    expect(result.telegram!.accounts.main.webhook!.secret).toBe('s3cret');
    expect(result.whatsapp!.accounts.wa1.auth_dir).toBe('/tmp/wa-auth');
    expect(result.defaults.model).toBe('claude-opus-4-6');
    expect(result.defaults.embedding_provider).toBe('local');
    expect(result.defaults.embedding_model).toBe('nomic-embed-text');
  });

  it('applies default values for defaults fields', () => {
    const input = {
      telegram: {
        accounts: { main: { token: 'tok' } },
      },
      defaults: {},
    };
    const result = GlobalConfigSchema.parse(input);
    expect(result.defaults.model).toBe('claude-sonnet-4-6');
    expect(result.defaults.embedding_provider).toBe('openai');
    expect(result.defaults.embedding_model).toBe('text-embedding-3-small');
  });

  it('rejects invalid embedding_provider', () => {
    const input = {
      defaults: { embedding_provider: 'cohere' },
    };
    expect(() => GlobalConfigSchema.parse(input)).toThrow();
  });

  it('accepts config with no fields (everything optional)', () => {
    const result = GlobalConfigSchema.parse({});
    expect(result.defaults.model).toBe('claude-sonnet-4-6');
    expect(result.defaults.embedding_provider).toBe('openai');
    expect(result.defaults.embedding_model).toBe('text-embedding-3-small');
    expect(result.features.sdk_active_input).toBe(false);
  });

  it('accepts feature flags with SDK active input defaulting off', () => {
    const result = GlobalConfigSchema.parse({
      features: {
        sdk_active_input: true,
      },
    });

    expect(result.features.sdk_active_input).toBe(true);
  });

  it('ignores legacy credentials.anthropic config in strict-native mode', () => {
    const result = GlobalConfigSchema.parse({
      telegram: {
        accounts: {
          main: { token: 'tok' },
        },
      },
      credentials: {
        anthropic: {
          keys: ['sk-ant-key-1', 'sk-ant-key-2'],
          strategy: 'round_robin',
          cooldown_ms: 3600000,
        },
      },
    });

    expect('credentials' in result).toBe(false);
    expect(result.telegram!.accounts.main.token).toBe('tok');
  });

  it('populates defaults when defaults block is entirely absent', () => {
    const result = GlobalConfigSchema.parse({
      telegram: { accounts: { default: { token: 'tok' } } },
    });
    expect(result.defaults.model).toBe('claude-sonnet-4-6');
    expect(result.defaults.embedding_provider).toBe('openai');
  });

  it('accepts STT provider configuration', () => {
    const result = GlobalConfigSchema.parse({
      stt: {
        provider: 'auto',
        openai: {
          api_key: 'openai-key',
          model: 'gpt-4o-mini-transcribe',
        },
        elevenlabs: {
          api_key: 'eleven-key',
          model: 'scribe_v2',
        },
      },
    });

    expect(result.stt!.provider).toBe('auto');
    expect(result.stt!.openai!.model).toBe('gpt-4o-mini-transcribe');
    expect(result.stt!.elevenlabs!.model).toBe('scribe_v2');
  });

  it('accepts telegram webhook without secret', () => {
    const input = {
      telegram: {
        accounts: {
          main: {
            token: 'tok',
            webhook: { url: 'https://example.com/hook' },
          },
        },
      },
    };
    const result = GlobalConfigSchema.parse(input);
    expect(result.telegram!.accounts.main.webhook!.url).toBe('https://example.com/hook');
    expect(result.telegram!.accounts.main.webhook!.secret).toBeUndefined();
  });
});

// ─── RouteSchema ───────────────────────────────────────────────────

describe('RouteSchema', () => {
  it('accepts a valid telegram route with defaults', () => {
    const result = RouteSchema.parse({ channel: 'telegram' });
    expect(result.channel).toBe('telegram');
    expect(result.scope).toBe('any');
    expect(result.mention_only).toBe(false);
  });

  it('accepts a whatsapp route with all fields', () => {
    const result = RouteSchema.parse({
      channel: 'whatsapp',
      scope: 'group',
      account: 'wa1',
      peers: ['peer1', 'peer2'],
      mention_only: true,
    });
    expect(result.channel).toBe('whatsapp');
    expect(result.scope).toBe('group');
    expect(result.account).toBe('wa1');
    expect(result.peers).toEqual(['peer1', 'peer2']);
    expect(result.mention_only).toBe(true);
  });

  it('rejects an invalid channel', () => {
    expect(() => RouteSchema.parse({ channel: 'discord' })).toThrow();
  });

  // default scope and mention_only are already covered in the first test above
});

// ─── PairingSchema ─────────────────────────────────────────────────

describe('PairingSchema', () => {
  it('accepts a valid pairing with code mode', () => {
    const result = PairingSchema.parse({ mode: 'code', code: 'ABCDEF' });
    expect(result.mode).toBe('code');
    expect(result.code).toBe('ABCDEF');
  });

  it('applies default mode "off"', () => {
    const result = PairingSchema.parse({});
    expect(result.mode).toBe('off');
  });

  it('rejects an invalid pairing mode', () => {
    expect(() => PairingSchema.parse({ mode: 'magic' })).toThrow();
  });

  it('accepts approve mode with approver_chat_id', () => {
    const result = PairingSchema.parse({ mode: 'approve', approver_chat_id: '12345' });
    expect(result.approver_chat_id).toBe('12345');
  });

  it('accepts open mode', () => {
    const result = PairingSchema.parse({ mode: 'open' });
    expect(result.mode).toBe('open');
  });

  it('rejects mode code without code field', () => {
    const result = PairingSchema.safeParse({ mode: 'code' });
    expect(result.success).toBe(false);
  });

  it('rejects mode approve without approver_chat_id', () => {
    const result = PairingSchema.safeParse({ mode: 'approve' });
    expect(result.success).toBe(false);
  });
});

// ─── AgentYmlSchema ────────────────────────────────────────────────

describe('AgentYmlSchema', () => {
  it('accepts a valid minimal agent (just routes)', () => {
    const input = {
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' as const }],
    };
    const result = AgentYmlSchema.parse(input);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].channel).toBe('telegram');
    expect(result.routes[0].scope).toBe('any');
    expect(result.routes[0].mention_only).toBe(false);
  });

  it('rejects routes with zero entries', () => {
    expect(() => AgentYmlSchema.parse({ routes: [] })).toThrow();
  });

  it('accepts a full agent with all fields', () => {
    const input = {
      safety_profile: 'trusted' as const,
      model: 'claude-opus-4-6',
      routes: [
        { channel: 'telegram', scope: 'dm' },
        { channel: 'whatsapp', scope: 'group', mention_only: true },
      ],
      pairing: { mode: 'code' as const, code: 'SECRET' },
      allowlist: {
        telegram: ['user1', 'user2'],
        whatsapp: ['number1'],
      },
      mcp_tools: ['web-search', 'calculator'],
      external_mcp_servers: {
        calendar: {
          type: 'stdio' as const,
          command: 'npx',
          args: ['google-calendar-mcp'],
          env: { GOOGLE_CLIENT_ID: 'id' },
          allowed_tools: ['calendar_daily_brief'],
        },
      },
      subagents: { allow: ['researcher', 'coder'] },
    };
    const result = AgentYmlSchema.parse(input);
    expect(result.model).toBe('claude-opus-4-6');
    expect(result.routes).toHaveLength(2);
    expect(result.pairing!.mode).toBe('code');
    expect(result.pairing!.code).toBe('SECRET');
    expect(result.allowlist!.telegram).toEqual(['user1', 'user2']);
    expect(result.mcp_tools).toEqual(['web-search', 'calculator']);
    expect(result.external_mcp_servers!.calendar.allowed_tools).toEqual(['calendar_daily_brief']);
    expect(result.subagents!.allow).toEqual(['researcher', 'coder']);
  });

  it('rejects an agent with invalid channel in route', () => {
    expect(() =>
      AgentYmlSchema.parse({
        safety_profile: 'trusted',
        routes: [{ channel: 'discord' }],
      }),
    ).toThrow();
  });

  it('rejects an agent with invalid pairing mode', () => {
    expect(() =>
      AgentYmlSchema.parse({
        safety_profile: 'trusted',
        routes: [{ channel: 'telegram' }],
        pairing: { mode: 'magic' },
      }),
    ).toThrow();
  });

  it('accepts session_policy field', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      session_policy: 'daily',
    });
    expect(result.session_policy).toBe('daily');
  });

  it('accepts subagent role policy fields', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      subagents: {
        allow: ['researcher', 'coder'],
        max_spawn_depth: 1,
        conflict_mode: 'soft',
        roles: {
          researcher: {
            kind: 'explorer',
            write_policy: 'deny',
          },
          coder: {
            kind: 'worker',
            write_policy: 'claim_required',
          },
        },
      },
    });

    expect(result.subagents!.max_spawn_depth).toBe(1);
    expect(result.subagents!.roles!.researcher.kind).toBe('explorer');
    expect(result.subagents!.roles!.coder.write_policy).toBe('claim_required');
  });

  it('defaults session_policy to never', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
    });
    expect(result.session_policy).toBe('never');
  });

  it('accepts auto_compress config', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      auto_compress: { enabled: true, threshold_messages: 20 },
    });
    expect(result.auto_compress!.enabled).toBe(true);
    expect(result.auto_compress!.threshold_messages).toBe(20);
  });

  it('accepts iteration_budget config', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      iteration_budget: { max_tool_calls: 50, timeout_ms: 60000, grace_message: false },
    });
    expect(result.iteration_budget!.max_tool_calls).toBe(50);
    expect(result.iteration_budget!.timeout_ms).toBe(60000);
    expect(result.iteration_budget!.grace_message).toBe(false);
  });

  it('accepts post-run memory extraction config with defaults', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      memory_extraction: { enabled: true },
    });
    expect(result.memory_extraction).toEqual({
      enabled: true,
      max_candidates: 5,
      max_input_chars: 6000,
    });
  });

  it('ignores legacy skills config in strict-native mode', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      skills: { config: { 'api.key': 'test' }, disabled: ['heavy-skill'] },
    });
    expect('skills' in result).toBe(false);
  });

  it('ignores legacy fallbacks config in strict-native mode', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      fallbacks: ['claude-sonnet-4-6', 'claude-haiku-3-5'],
    });
    expect('fallbacks' in result).toBe(false);
  });

  it('accepts sdk config for native agent-sdk features', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      sdk: {
        allowedTools: ['Read', 'Bash'],
        disallowedTools: ['WebSearch'],
        permissions: {
          mode: 'dontAsk',
          default_behavior: 'deny',
          allow_mcp: true,
          allow_bash: true,
          allow_web: false,
          allowed_mcp_tools: ['memory_search'],
          denied_bash_patterns: ['npm publish'],
        },
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          network: {
            allowedDomains: ['example.com'],
          },
        },
        promptSuggestions: true,
        agentProgressSummaries: true,
        includePartialMessages: true,
        includeHookEvents: true,
        enableFileCheckpointing: true,
        fallbackModel: 'claude-haiku-4-5',
      },
    });

    expect(result.sdk!.allowedTools).toEqual(['Read', 'Bash']);
    expect(result.sdk!.disallowedTools).toEqual(['WebSearch']);
    expect(result.sdk!.permissions!.mode).toBe('dontAsk');
    expect(result.sdk!.permissions!.allow_web).toBe(false);
    expect(result.sdk!.permissions!.allowed_mcp_tools).toEqual(['memory_search']);
    expect(result.sdk!.permissions!.denied_bash_patterns).toEqual(['npm publish']);
    expect(result.sdk!.sandbox!.enabled).toBe(true);
    expect(result.sdk!.sandbox!.network!.allowedDomains).toEqual(['example.com']);
    expect(result.sdk!.promptSuggestions).toBe(true);
    expect(result.sdk!.agentProgressSummaries).toBe(true);
    expect(result.sdk!.includePartialMessages).toBe(true);
    expect(result.sdk!.includeHookEvents).toBe(true);
    expect(result.sdk!.enableFileCheckpointing).toBe(true);
    expect(result.sdk!.fallbackModel).toBe('claude-haiku-4-5');
  });

  it('accepts SDK lifecycle hook events', () => {
    const result = AgentYmlSchema.parse({
      safety_profile: 'trusted' as const,
      routes: [{ channel: 'telegram' }],
      hooks: [
        {
          event: 'on_memory_write',
          action: 'webhook',
          url: 'https://example.com/tool-hook',
          timeout_ms: 1000,
        },
        {
          event: 'on_elicitation',
          action: 'script',
          command: 'echo "$HOOK_MCPSERVERNAME"',
          timeout_ms: 1000,
        },
      ],
    });

    expect(result.hooks![0].event).toBe('on_memory_write');
    expect(result.hooks![1].event).toBe('on_elicitation');
  });

  it('rejects invalid session_policy', () => {
    expect(() => AgentYmlSchema.parse({
      safety_profile: 'trusted',
      routes: [{ channel: 'telegram' }],
      session_policy: 'biweekly',
    })).toThrow();
  });
});

// ─── Type inference smoke tests ────────────────────────────────────

describe('Type inference (compile-time checks)', () => {
  it('GlobalConfig type is assignable from parse result', () => {
    // compile-time check: assignment would fail if types diverge
    const _config: GlobalConfig = GlobalConfigSchema.parse({});
    void _config;
  });

  it('AgentYml type is assignable from parse result', () => {
    const _agent: AgentYml = AgentYmlSchema.parse({
      safety_profile: 'trusted',
      routes: [{ channel: 'telegram' }],
    });
    void _agent;
  });

  it('Route type is assignable from parse result', () => {
    const _route: Route = RouteSchema.parse({ channel: 'whatsapp' });
    void _route;
  });

  it('Pairing type is assignable from parse result', () => {
    const _pairing: Pairing = PairingSchema.parse({});
    void _pairing;
  });
});
