import { z } from 'zod';

export const HonchoModeSchema = z.enum(['off', 'observe', 'context', 'tools', 'hybrid']);
export const HonchoLlmProviderSchema = z.enum(['openai', 'anthropic']);

export const HonchoConfigSchema = z.object({
  enabled: z.boolean().default(false)
    .describe('Should this agent use Honcho at all? Disable this to keep the plugin inactive for this agent.'),
  mode: HonchoModeSchema.default('observe')
    .describe('How much should Honcho participate in each turn? observe stores turns, context injects memory, tools exposes honcho_* tools, hybrid does both.'),
  llm: z.object({
    provider: HonchoLlmProviderSchema.default('openai')
      .describe('Which provider should self-hosted Honcho use for derivation, summaries, dialectic chat, and dreams?'),
    model: z.string().min(1).default('gpt-5.4-mini')
      .describe('Which model should self-hosted Honcho use for its LLM work? The UI filters model choices by provider.'),
    api_key_secret_ref: z.string().optional()
      .describe('Where is the provider API key stored in Secret Vault? The real key is encrypted and never written to agent.yml.'),
  }).default({
    provider: 'openai',
    model: 'gpt-5.4-mini',
  }).describe('Which LLM provider, model, and Vault key should be used by self-hosted Honcho?'),
  connection: z.object({
    workspace_id: z.string().min(1).default('anthroclaw-local')
      .describe('Which Honcho workspace should receive this agent memory? Use separate workspaces for prod, staging, and smoke tests.'),
    environment: z.enum(['production', 'local']).default('production')
      .describe('Is this a managed authenticated Honcho endpoint or a local self-hosted endpoint? production requires api_key_env.'),
    base_url: z.string().url().default('https://api.honcho.dev')
      .describe('Where can AnthroClaw reach the Honcho API? In Docker, use the Honcho API service URL, not localhost.'),
    api_key_env: z.string().min(1).default('HONCHO_API_KEY')
      .describe('Which environment variable contains the managed Honcho API key? Only required for production environment.'),
    timeout_ms: z.number().int().positive().default(15_000)
      .describe('How long can one Honcho HTTP call block an agent turn before timing out?'),
    max_retries: z.number().int().min(0).max(3).default(2)
      .describe('How many times should the Honcho SDK retry transient request failures?'),
  }).default({
    workspace_id: 'anthroclaw-local',
    environment: 'production',
    base_url: 'https://api.honcho.dev',
    api_key_env: 'HONCHO_API_KEY',
    timeout_ms: 15_000,
    max_retries: 2,
  }).describe('How should AnthroClaw connect to the Honcho API?'),
  peers: z.object({
    agent_peer_prefix: z.string().default('agent')
      .describe('What prefix should identify AnthroClaw agents inside Honcho?'),
    user_peer_prefix: z.string().default('user')
      .describe('What prefix should identify human users inside Honcho?'),
    group_peer_prefix: z.string().default('group')
      .describe('What prefix should identify group chats inside Honcho?'),
    hash_ids: z.boolean().default(true)
      .describe('Should Telegram IDs, WhatsApp JIDs, and group IDs be stored as stable hashes for privacy?'),
  }).default({
    agent_peer_prefix: 'agent',
    user_peer_prefix: 'user',
    group_peer_prefix: 'group',
    hash_ids: true,
  }).describe('How should users, groups, and agents be represented as Honcho peers?'),
  observe: z.object({
    include_user_messages: z.boolean().default(true)
      .describe('Should incoming user messages be saved to Honcho?'),
    include_assistant_messages: z.boolean().default(true)
      .describe('Should assistant replies be saved to Honcho after each turn?'),
    include_media_text: z.boolean().default(true)
      .describe('Should extracted media text, such as transcripts and PDF text, be allowed into saved Honcho messages?'),
    max_message_chars: z.number().int().min(500).max(50_000).default(12_000)
      .describe('What is the maximum size of one message uploaded to Honcho before truncation?'),
    queue_on_failure: z.boolean().default(true)
      .describe('If Honcho is unavailable, should failed writes be stored locally for later replay?'),
  }).default({
    include_user_messages: true,
    include_assistant_messages: true,
    include_media_text: true,
    max_message_chars: 12_000,
    queue_on_failure: true,
  }).describe('What turn data should AnthroClaw persist into Honcho?'),
  context: z.object({
    enabled: z.boolean().default(true)
      .describe('Should Honcho be allowed to auto-inject context in context or hybrid mode?'),
    token_budget: z.number().int().min(256).max(12_000).default(1800)
      .describe('How much context should AnthroClaw request from Honcho for automatic injection?'),
    include_peer_card: z.boolean().default(true)
      .describe('Should Honcho peer representations be included in injected context?'),
    include_session_context: z.boolean().default(true)
      .describe('Should recent or session-specific Honcho context be included in the prompt?'),
    include_agent_view: z.boolean().default(false)
      .describe('Should the agent peer perspective be included in context? Keep off unless you are testing agent self-representation.'),
    max_chars: z.number().int().min(500).max(40_000).default(8000)
      .describe('What is the hard character cap for injected Honcho text?'),
  }).default({
    enabled: true,
    token_budget: 1800,
    include_peer_card: true,
    include_session_context: true,
    include_agent_view: false,
    max_chars: 8000,
  }).describe('How should Honcho memory be injected into the agent prompt?'),
  tools: z.object({
    context: z.boolean().default(true)
      .describe('Can the agent call honcho_context to request current Honcho context manually?'),
    ask: z.boolean().default(true)
      .describe('Can the agent call honcho_ask to ask Honcho a natural-language memory question?'),
    search_messages: z.boolean().default(true)
      .describe('Can the agent call honcho_search_messages to search stored Honcho messages?'),
    search_conclusions: z.boolean().default(true)
      .describe('Can the agent call honcho_search_conclusions to search Honcho conclusions and representations?'),
    session: z.boolean().default(true)
      .describe('Can the agent call honcho_session to inspect current session context and summaries?'),
    status: z.boolean().default(true)
      .describe('Can the agent call honcho_status to inspect Honcho plugin status and config?'),
  }).default({
    context: true,
    ask: true,
    search_messages: true,
    search_conclusions: true,
    session: true,
    status: true,
  }).describe('Which honcho_* tools should be exposed to the agent?'),
  privacy: z.object({
    include_display_names: z.boolean().default(false)
      .describe('Should display names be uploaded as Honcho metadata? Leave off unless names are needed.'),
    strip_prompt_context_blocks: z.boolean().default(true)
      .describe('Should injected context blocks be stripped before saving messages back to Honcho?'),
    strip_tool_progress: z.boolean().default(true)
      .describe('Should tool progress and noisy runtime lines be stripped before persistence?'),
    redact_secrets: z.boolean().default(true)
      .describe('Should obvious API keys and token-like strings be redacted before Honcho persistence?'),
  }).default({
    include_display_names: false,
    strip_prompt_context_blocks: true,
    strip_tool_progress: true,
    redact_secrets: true,
  }).describe('Which privacy safeguards should apply before data reaches Honcho?'),
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
