import { z } from 'zod';
import { DEFAULT_HEARTBEAT_EVERY, DEFAULT_HEARTBEAT_PROMPT, HEARTBEAT_ACK_TOKEN } from '../heartbeat/constants.js';

// ─── Telegram / WhatsApp account schemas ───────────────────────────

const TelegramWebhookSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
});

const TelegramAccountSchema = z.object({
  token: z.string(),
  webhook: TelegramWebhookSchema.optional(),
});

const WhatsappAccountSchema = z.object({
  auth_dir: z.string(),
});

const DirectWebhookSchema = z.object({
  secret: z.string().min(1),
  enabled: z.boolean().default(false),
  deliver_to: z.object({
    channel: z.enum(['telegram', 'whatsapp']),
    peer_id: z.string(),
    account_id: z.string().optional(),
    thread_id: z.string().optional(),
  }),
  template: z.string().min(1),
  fields: z.array(z.string()).optional(),
  max_payload_bytes: z.number().int().min(1).max(131_072).default(32_768),
});

const SttProviderSchema = z.enum(['auto', 'assemblyai', 'openai', 'elevenlabs']);

const SttProviderCredentialSchema = z.object({
  api_key: z.string().optional(),
  model: z.string().optional(),
});

const SttConfigSchema = z.object({
  provider: SttProviderSchema.default('auto'),
  assemblyai: SttProviderCredentialSchema.optional(),
  openai: SttProviderCredentialSchema.optional(),
  elevenlabs: SttProviderCredentialSchema.optional(),
}).optional();

const FeatureFlagsSchema = z.object({
  sdk_active_input: z.boolean().default(false),
}).default({
  sdk_active_input: false,
});

// ─── GlobalConfigSchema ────────────────────────────────────────────

export const GlobalConfigSchema = z.object({
  telegram: z
    .object({
      accounts: z.record(z.string(), TelegramAccountSchema),
    })
    .optional(),
  whatsapp: z
    .object({
      accounts: z.record(z.string(), WhatsappAccountSchema),
    })
    .optional(),
  defaults: z.object({
    model: z.string().default('claude-sonnet-4-6'),
    embedding_provider: z
      .enum(['openai', 'local', 'off'])
      .default('openai'),
    embedding_model: z.string().default('text-embedding-3-small'),
    debounce_ms: z.number().int().min(0).default(5000).describe('Inbound message debounce delay in ms (0 to disable)'),
  }).default({
    model: 'claude-sonnet-4-6',
    embedding_provider: 'openai',
    embedding_model: 'text-embedding-3-small',
    debounce_ms: 5000,
  }),
  rate_limit: z.object({
    maxAttempts: z.number().int().min(1).default(10).describe('Max messages per window before lockout'),
    windowMs: z.number().int().min(1000).default(60_000).describe('Sliding window in ms'),
    lockoutMs: z.number().int().min(1000).default(300_000).describe('Lockout duration in ms after limit exceeded'),
  }).optional(),
  assemblyai: z.object({
    api_key: z.string(),
  }).optional(),
  stt: SttConfigSchema,
  brave: z.object({
    api_key: z.string(),
  }).optional(),
  exa: z.object({
    api_key: z.string(),
  }).optional(),
  webhooks: z.record(z.string(), DirectWebhookSchema).optional(),
  features: FeatureFlagsSchema,
  plugins: z.record(z.string(), z.object({
    defaults: z.record(z.string(), z.unknown()).optional(),
  }).passthrough()).optional(),
});

// ─── RouteSchema ───────────────────────────────────────────────────

export const RouteSchema = z.object({
  channel: z.enum(['telegram', 'whatsapp']),
  scope: z.enum(['dm', 'group', 'any']).default('any'),
  account: z.string().optional(),
  peers: z.array(z.string()).min(1).optional(),
  topics: z.array(z.string()).min(1).optional(),
  mention_only: z.boolean().default(false),
});

// ─── PairingSchema ─────────────────────────────────────────────────

export const PairingSchema = z.object({
  mode: z.enum(['code', 'approve', 'open', 'off']).default('off'),
  code: z.string().optional(),
  approver_chat_id: z.string().optional(),
}).superRefine((val, ctx) => {
  if (val.mode === 'code' && !val.code) {
    ctx.addIssue({ code: 'custom', message: 'code is required when mode is "code"', path: ['code'] });
  }
  if (val.mode === 'approve' && !val.approver_chat_id) {
    ctx.addIssue({ code: 'custom', message: 'approver_chat_id is required when mode is "approve"', path: ['approver_chat_id'] });
  }
});

// ─── HookConfigSchema ──────────────────────────────────────────────

export const HookConfigSchema = z.object({
  event: z.enum([
    'on_message_received',
    'on_before_query',
    'on_after_query',
    'on_session_reset',
    'on_cron_fire',
    'on_memory_write',
    'on_tool_use',
    'on_tool_result',
    'on_tool_error',
    'on_permission_request',
    'on_elicitation',
    'on_elicitation_result',
    'on_sdk_notification',
    'on_subagent_start',
    'on_subagent_stop',
  ]),
  action: z.enum(['webhook', 'script']),
  url: z.string().url().optional(),
  command: z.string().optional(),
  timeout_ms: z.number().int().min(100).default(5000),
}).superRefine((val, ctx) => {
  if (val.action === 'webhook' && !val.url) {
    ctx.addIssue({ code: 'custom', message: 'url is required when action is "webhook"', path: ['url'] });
  }
  if (val.action === 'script' && !val.command) {
    ctx.addIssue({ code: 'custom', message: 'command is required when action is "script"', path: ['command'] });
  }
});

// ─── CronJobSchema ─────────────────────────────────────────────────

export const CronJobSchema = z.object({
  id: z.string(),
  schedule: z.string().describe('Cron expression, e.g. "0 9 * * *" or "*/15 * * * *"'),
  prompt: z.string().describe('Prompt to send to the agent when job fires'),
  deliver_to: z.object({
    channel: z.enum(['telegram', 'whatsapp']),
    peer_id: z.string(),
    account_id: z.string().optional(),
  }).optional().describe('Where to send the response. If omitted, response is logged only.'),
  enabled: z.boolean().default(true),
});

// ─── AgentYmlSchema ────────────────────────────────────────────────

const ThinkingConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('adaptive') }),
  z.object({ type: z.literal('enabled'), budgetTokens: z.number().int().min(1).optional() }),
  z.object({ type: z.literal('disabled') }),
]).describe('Controls extended thinking behavior');

const EffortLevelSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']).describe('Reasoning effort level');

const SdkPermissionPolicySchema = z.object({
  mode: z.enum(['default', 'acceptEdits', 'dontAsk']).default('default').optional(),
  default_behavior: z.enum(['allow', 'deny']).default('deny').optional(),
  allow_mcp: z.boolean().default(true).optional(),
  allow_bash: z.boolean().default(true).optional(),
  allow_web: z.boolean().default(true).optional(),
  allowed_mcp_tools: z.array(z.string()).optional(),
  denied_bash_patterns: z.array(z.string()).optional(),
}).optional();

const SdkSandboxSchema = z.object({
  enabled: z.boolean().optional(),
  failIfUnavailable: z.boolean().optional(),
  autoAllowBashIfSandboxed: z.boolean().optional(),
  allowUnsandboxedCommands: z.boolean().optional(),
  network: z.object({
    allowedDomains: z.array(z.string()).optional(),
    deniedDomains: z.array(z.string()).optional(),
    allowManagedDomainsOnly: z.boolean().optional(),
    allowUnixSockets: z.array(z.string()).optional(),
    allowAllUnixSockets: z.boolean().optional(),
    allowLocalBinding: z.boolean().optional(),
    allowMachLookup: z.array(z.string()).optional(),
    httpProxyPort: z.number().int().optional(),
    socksProxyPort: z.number().int().optional(),
  }).optional(),
  filesystem: z.object({
    allowWrite: z.array(z.string()).optional(),
    denyWrite: z.array(z.string()).optional(),
    denyRead: z.array(z.string()).optional(),
    allowRead: z.array(z.string()).optional(),
    allowManagedReadPathsOnly: z.boolean().optional(),
  }).optional(),
}).optional();

const SdkAgentConfigSchema = z.object({
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()).optional(),
  permissions: SdkPermissionPolicySchema,
  sandbox: SdkSandboxSchema,
  promptSuggestions: z.boolean().optional(),
  agentProgressSummaries: z.boolean().optional(),
  includePartialMessages: z.boolean().optional(),
  includeHookEvents: z.boolean().optional(),
  enableFileCheckpointing: z.boolean().optional(),
  fallbackModel: z.string().optional(),
}).optional();

const ExternalMcpServerSchema = z.union([
  z.object({
    type: z.literal('stdio').default('stdio').optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    allowed_tools: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('sse'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    allowed_tools: z.array(z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).optional(),
    allowed_tools: z.array(z.string()).optional(),
  }),
]);

const ReplyToModeSchema = z.enum(['always', 'incoming_reply_only', 'never']);

const ChannelBehaviorRuleSchema = z.object({
  prompt: z.string().min(1).max(8000).optional(),
  reply_to_mode: ReplyToModeSchema.optional(),
});

const ChannelContextSchema = z.object({
  reply_to_mode: ReplyToModeSchema.default('always').optional(),
  telegram: z.object({
    wildcard: ChannelBehaviorRuleSchema.optional(),
    peers: z.record(z.string(), ChannelBehaviorRuleSchema).optional(),
    topics: z.record(z.string(), ChannelBehaviorRuleSchema).optional(),
  }).optional(),
  whatsapp: z.object({
    wildcard: ChannelBehaviorRuleSchema.optional(),
    direct: z.record(z.string(), ChannelBehaviorRuleSchema).optional(),
    groups: z.record(z.string(), ChannelBehaviorRuleSchema).optional(),
  }).optional(),
}).optional();

const SubagentRolePolicySchema = z.object({
  kind: z.enum(['explorer', 'worker', 'custom']).default('custom').optional(),
  write_policy: z.enum(['allow', 'deny', 'claim_required']).default('allow').optional(),
  description: z.string().max(1000).optional(),
});

const SubagentPolicySchema = z.object({
  allow: z.array(z.string()).default([]),
  max_spawn_depth: z.number().int().min(0).default(1).optional(),
  conflict_mode: z.enum(['soft', 'strict']).default('soft').optional(),
  roles: z.record(z.string(), SubagentRolePolicySchema).optional(),
}).optional();

const MemoryExtractionSchema = z.object({
  enabled: z.boolean().default(false),
  max_candidates: z.number().int().min(1).max(10).default(5),
  max_input_chars: z.number().int().min(500).max(20_000).default(6000),
}).optional();

const LearningConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(['off', 'propose', 'auto_private']).default('off'),
  review_interval_turns: z.number().int().min(1).max(500).default(10),
  skill_review_min_tool_calls: z.number().int().min(1).max(500).default(8),
  max_actions_per_review: z.number().int().min(1).max(20).default(8),
  max_input_chars: z.number().int().min(1_000).max(128_000).default(24_000),
  artifacts: z.object({
    max_files: z.number().int().min(0).max(200).default(32),
    max_file_bytes: z.number().int().min(1_024).max(1_048_576).default(65_536),
    max_total_bytes: z.number().int().min(1_024).max(4_194_304).default(262_144),
    max_prompt_chars: z.number().int().min(1_000).max(128_000).default(24_000),
    max_snippet_chars: z.number().int().min(500).max(64_000).default(4_000),
  }).default({
    max_files: 32,
    max_file_bytes: 65_536,
    max_total_bytes: 262_144,
    max_prompt_chars: 24_000,
    max_snippet_chars: 4_000,
  }),
}).default({
  enabled: false,
  mode: 'off',
  review_interval_turns: 10,
  skill_review_min_tool_calls: 8,
  max_actions_per_review: 8,
  max_input_chars: 24_000,
  artifacts: {
    max_files: 32,
    max_file_bytes: 65_536,
    max_total_bytes: 262_144,
    max_prompt_chars: 24_000,
    max_snippet_chars: 4_000,
  },
});

const HeartbeatConfigSchema = z.object({
  enabled: z.boolean().default(false),
  every: z.string().default(DEFAULT_HEARTBEAT_EVERY).describe('Heartbeat cadence, e.g. "10m", "1h", "1d"'),
  target: z.enum(['last', 'none']).default('last'),
  isolated_session: z.boolean().default(true),
  show_ok: z.boolean().default(false),
  ack_token: z.string().min(1).default(HEARTBEAT_ACK_TOKEN),
  prompt: z.string().min(1).default(DEFAULT_HEARTBEAT_PROMPT),
}).optional();

const SafetyOverridesSchema = z.object({
  allow_tools: z.array(z.string()).optional(),
  deny_tools: z.array(z.string()).optional(),
  permission_mode: z.enum(['default', 'bypass']).optional(),
  sandbox: SdkSandboxSchema.optional(),
}).strict();

export type SafetyOverrides = z.infer<typeof SafetyOverridesSchema>;

export const HumanTakeoverSchema = z.object({
  enabled: z.boolean().default(false),
  pause_ttl_minutes: z.number().int().positive().default(30),
  channels: z.array(z.enum(['whatsapp', 'telegram'])).default(['whatsapp']),
  ignore: z
    .array(z.enum(['reactions', 'receipts', 'typing', 'protocol']))
    .default(['reactions', 'receipts', 'typing', 'protocol']),
  notification_throttle_minutes: z.number().int().nonnegative().default(5),
});

// ─── NotificationsSchema ───────────────────────────────────────────
//
// Per-agent notifications config. Off-by-default — agents that omit
// the block produce no notifications. `routes` is a name → target map;
// each `subscriptions[].route` references one of those names.
//
// `throttle` is intentionally freeform string ('5m', '30s', '1h') to
// keep the YAML ergonomic; the emitter parses it leniently and treats
// malformed values as no-throttle (with a logged warning).

const NotificationEventNameSchema = z.enum([
  'peer_pause_started',
  'peer_pause_ended',
  'peer_pause_intervened_during_generation',
  'peer_pause_summary_daily',
  'agent_error',
  'iteration_budget_exhausted',
  'escalation_needed',
]);

const NotificationRouteSchema = z.object({
  channel: z.enum(['telegram', 'whatsapp']),
  account_id: z.string().min(1),
  peer_id: z.string().min(1),
});

const NotificationSubscriptionSchema = z.object({
  event: NotificationEventNameSchema,
  route: z.string().min(1),
  schedule: z.string().min(1).optional(),
  throttle: z.string().min(1).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
});

export const NotificationsSchema = z.object({
  enabled: z.boolean().default(false),
  routes: z.record(z.string(), NotificationRouteSchema).default({}),
  subscriptions: z.array(NotificationSubscriptionSchema).default([]),
});

export const AgentYmlSchema = z.object({
  model: z.string().optional(),
  thinking: ThinkingConfigSchema.optional(),
  effort: EffortLevelSchema.optional(),
  maxTurns: z.number().int().min(1).optional().describe('Maximum conversation turns per query'),
  maxBudgetUsd: z.number().min(0.01).optional().describe('Maximum USD budget per query'),
  timezone: z.string().default('UTC').describe('IANA timezone for timestamps, e.g. "Asia/Almaty"'),
  routes: z.array(RouteSchema).min(1),
  safety_profile: z.enum(['public', 'trusted', 'private', 'chat_like_openclaw']),
  safety_overrides: SafetyOverridesSchema.optional(),
  personality: z
    .string()
    .optional()
    .describe('Personality baseline override for chat_like_openclaw profile. Empty/missing → uses CHAT_PERSONALITY_BASELINE. Has no effect on other profiles (info-warning emitted by validator).'),
  pairing: PairingSchema.optional(),
  allowlist: z.record(z.string(), z.array(z.string())).optional(),
  mcp_tools: z.array(z.string().min(1)).optional(),
  external_mcp_servers: z.record(z.string(), ExternalMcpServerSchema).optional(),
  memory_extraction: MemoryExtractionSchema,
  learning: LearningConfigSchema,
  heartbeat: HeartbeatConfigSchema,
  subagents: SubagentPolicySchema,
  cron: z.array(CronJobSchema).optional(),
  hooks: z.array(HookConfigSchema).optional(),
  maxSessions: z.number().int().min(1).default(100).describe('Maximum number of cached sessions before LRU eviction'),
  queue_mode: z.enum(['collect', 'serial', 'steer', 'interrupt']).default('collect'),
  session_policy: z.enum(['never', 'hourly', 'daily', 'weekly']).default('never'),
  channel_context: ChannelContextSchema,
  auto_compress: z.object({
    enabled: z.boolean().default(true),
    threshold_messages: z.number().int().min(5).default(30),
  }).optional(),
  iteration_budget: z.object({
    max_tool_calls: z.number().int().min(1).default(30),
    timeout_ms: z.number().int().min(5000).default(120_000),
    absolute_timeout_ms: z.number().int().min(5000).optional(),
    grace_message: z.boolean().default(true),
  }).optional(),
  quick_commands: z.record(z.string(), z.object({
    command: z.string(),
    timeout: z.number().int().min(1).default(30),
  })).optional(),
  group_sessions: z.enum(['shared', 'per_user']).default('shared'),
  display: z.object({
    toolProgress: z.enum(['all', 'new', 'off']).optional(),
    streaming: z.boolean().optional(),
    toolPreviewLength: z.number().int().min(0).optional(),
    showReasoning: z.boolean().optional(),
    /**
     * Forward SDK task lifecycle notifications (e.g. "Task completed: …") to the
     * end user via the channel. Off by default — these are framework-internal
     * progress events that look like debug output in a real chat. Opt in only
     * for tooling/dev agents where the operator wants live task visibility.
     */
    taskNotifications: z.boolean().default(false),
  }).optional(),
  sdk: SdkAgentConfigSchema,
  /**
   * Per-agent plugin enable/disable config.
   * Keyed by plugin name. Task 9 will replace this with a proper typed schema.
   */
  plugins: z.record(
    z.string(),
    z.object({ enabled: z.boolean().optional() }).passthrough(),
  ).optional(),
  human_takeover: HumanTakeoverSchema.optional(),
  notifications: NotificationsSchema.optional(),
}).superRefine((val, ctx) => {
  if (val.learning.enabled && val.learning.mode === 'off') {
    ctx.addIssue({
      code: 'custom',
      message: 'learning.enabled=true requires learning.mode to be "propose" or "auto_private"',
      path: ['learning', 'mode'],
    });
  }
  if (val.learning.mode === 'auto_private' && val.safety_profile !== 'private') {
    ctx.addIssue({
      code: 'custom',
      message: 'learning.mode=auto_private is only allowed with safety_profile=private',
      path: ['learning', 'mode'],
    });
  }
});

// ─── Exported types ────────────────────────────────────────────────

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type AgentYml = z.infer<typeof AgentYmlSchema>;
export type HumanTakeoverConfig = z.infer<typeof HumanTakeoverSchema>;
export type NotificationsConfig = z.infer<typeof NotificationsSchema>;
export type Route = z.infer<typeof RouteSchema>;
export type Pairing = z.infer<typeof PairingSchema>;
export type CronJob = z.infer<typeof CronJobSchema>;
export type HookConfig = z.infer<typeof HookConfigSchema>;
export type ReplyToMode = z.infer<typeof ReplyToModeSchema>;
export type ChannelContextConfig = NonNullable<z.infer<typeof ChannelContextSchema>>;
export type SubagentRolePolicy = z.infer<typeof SubagentRolePolicySchema>;
export type SubagentPolicy = NonNullable<z.infer<typeof SubagentPolicySchema>>;
export type SdkPermissionPolicy = z.infer<typeof SdkPermissionPolicySchema>;
export type SdkSandboxConfig = z.infer<typeof SdkSandboxSchema>;
export type SdkAgentConfig = z.infer<typeof SdkAgentConfigSchema>;
export type MemoryExtractionConfig = z.infer<typeof MemoryExtractionSchema>;
export type LearningConfig = z.infer<typeof LearningConfigSchema>;
export type HeartbeatConfig = NonNullable<z.infer<typeof HeartbeatConfigSchema>>;
export type AllowlistConfig = Record<string, string[]>;
