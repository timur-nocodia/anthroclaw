import { z } from 'zod';

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
  brave: z.object({
    api_key: z.string(),
  }).optional(),
  exa: z.object({
    api_key: z.string(),
  }).optional(),
  webhooks: z.record(z.string(), DirectWebhookSchema).optional(),
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
    'on_tool_use',
    'on_tool_result',
    'on_tool_error',
    'on_permission_request',
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

export const AgentYmlSchema = z.object({
  model: z.string().optional(),
  thinking: ThinkingConfigSchema.optional(),
  effort: EffortLevelSchema.optional(),
  maxTurns: z.number().int().min(1).optional().describe('Maximum conversation turns per query'),
  maxBudgetUsd: z.number().min(0.01).optional().describe('Maximum USD budget per query'),
  timezone: z.string().default('UTC').describe('IANA timezone for timestamps, e.g. "Asia/Almaty"'),
  routes: z.array(RouteSchema).min(1),
  pairing: PairingSchema.optional(),
  allowlist: z.record(z.string(), z.array(z.string())).optional(),
  mcp_tools: z.array(z.string()).optional(),
  subagents: SubagentPolicySchema,
  cron: z.array(CronJobSchema).optional(),
  hooks: z.array(HookConfigSchema).optional(),
  maxSessions: z.number().int().min(1).default(100).describe('Maximum number of cached sessions before LRU eviction'),
  queue_mode: z.enum(['collect', 'steer', 'interrupt']).default('collect'),
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
  }).optional(),
  sdk: SdkAgentConfigSchema,
});

// ─── Exported types ────────────────────────────────────────────────

export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
export type AgentYml = z.infer<typeof AgentYmlSchema>;
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
