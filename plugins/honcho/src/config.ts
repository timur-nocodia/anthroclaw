import { z } from 'zod';

export const HonchoModeSchema = z.enum(['off', 'observe', 'context', 'tools', 'hybrid']);

export const HonchoConfigSchema = z.object({
  enabled: z.boolean().default(false),
  mode: HonchoModeSchema.default('observe'),
  connection: z.object({
    workspace_id: z.string().min(1).default('anthroclaw-local'),
    environment: z.enum(['production', 'local']).default('production'),
    base_url: z.string().url().default('https://api.honcho.dev'),
    api_key_env: z.string().min(1).default('HONCHO_API_KEY'),
    timeout_ms: z.number().int().positive().default(15_000),
    max_retries: z.number().int().min(0).max(3).default(2),
  }).default({
    workspace_id: 'anthroclaw-local',
    environment: 'production',
    base_url: 'https://api.honcho.dev',
    api_key_env: 'HONCHO_API_KEY',
    timeout_ms: 15_000,
    max_retries: 2,
  }),
  peers: z.object({
    agent_peer_prefix: z.string().default('agent'),
    user_peer_prefix: z.string().default('user'),
    group_peer_prefix: z.string().default('group'),
    hash_ids: z.boolean().default(true),
  }).default({
    agent_peer_prefix: 'agent',
    user_peer_prefix: 'user',
    group_peer_prefix: 'group',
    hash_ids: true,
  }),
  observe: z.object({
    include_user_messages: z.boolean().default(true),
    include_assistant_messages: z.boolean().default(true),
    include_media_text: z.boolean().default(true),
    max_message_chars: z.number().int().min(500).max(50_000).default(12_000),
    queue_on_failure: z.boolean().default(true),
  }).default({
    include_user_messages: true,
    include_assistant_messages: true,
    include_media_text: true,
    max_message_chars: 12_000,
    queue_on_failure: true,
  }),
  context: z.object({
    enabled: z.boolean().default(true),
    token_budget: z.number().int().min(256).max(12_000).default(1800),
    include_peer_card: z.boolean().default(true),
    include_session_context: z.boolean().default(true),
    include_agent_view: z.boolean().default(false),
    max_chars: z.number().int().min(500).max(40_000).default(8000),
  }).default({
    enabled: true,
    token_budget: 1800,
    include_peer_card: true,
    include_session_context: true,
    include_agent_view: false,
    max_chars: 8000,
  }),
  tools: z.object({
    context: z.boolean().default(true),
    ask: z.boolean().default(true),
    search_messages: z.boolean().default(true),
    search_conclusions: z.boolean().default(true),
    session: z.boolean().default(true),
    status: z.boolean().default(true),
  }).default({
    context: true,
    ask: true,
    search_messages: true,
    search_conclusions: true,
    session: true,
    status: true,
  }),
  privacy: z.object({
    include_display_names: z.boolean().default(false),
    strip_prompt_context_blocks: z.boolean().default(true),
    strip_tool_progress: z.boolean().default(true),
    redact_secrets: z.boolean().default(true),
  }).default({
    include_display_names: false,
    strip_prompt_context_blocks: true,
    strip_tool_progress: true,
    redact_secrets: true,
  }),
});

export type HonchoConfig = z.infer<typeof HonchoConfigSchema>;

export function resolveConfig(globalDefaults?: unknown, perAgent?: unknown): HonchoConfig {
  const merged = deepMerge(
    isRecord(globalDefaults) ? globalDefaults : {},
    isRecord(perAgent) ? perAgent : {},
  );
  return HonchoConfigSchema.parse(merged);
}

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (isRecord(existing) && isRecord(value)) {
      out[key] = deepMerge(existing, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export default HonchoConfigSchema;
