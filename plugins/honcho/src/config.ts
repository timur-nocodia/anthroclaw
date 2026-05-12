import { z } from 'zod';

export const HonchoModeSchema = z.enum(['off', 'observe', 'context', 'tools', 'hybrid']);
export const HonchoLlmProviderSchema = z.enum(['openai', 'anthropic']);

function help(...lines: string[]): string {
  return lines.join('\n');
}

export const HonchoConfigSchema = z.object({
  enabled: z.boolean().default(false)
    .describe(help(
      'Turns Honcho on for this agent.',
      'Recommended: enable it only for agents you want to test first, then roll out to more agents later.',
      'Default: false. Example: true for a smoke-test agent, false for agents that should not send memory to Honcho.',
    )),
  mode: HonchoModeSchema.default('observe')
    .describe(help(
      'Controls how much Honcho participates in each agent turn.',
      'Recommended first step: observe. It only records messages, so it is the safest production smoke-test mode.',
      'Mode guide: off = do nothing; observe = save messages only; context = save messages and inject Honcho memory into the prompt; tools = save messages and expose honcho_* tools to the agent; hybrid = context + tools.',
      'Default: observe. Example: observe for first rollout, context after ingestion is verified, hybrid for trusted agents that should actively query Honcho.',
    )),
  llm: z.object({
    provider: HonchoLlmProviderSchema.default('openai')
      .describe(help(
        'The LLM provider Honcho should use for its own background intelligence work.',
        'This is not the main AnthroClaw agent model. It is only for Honcho tasks such as summaries, representation updates, dialectic chat, and dreams.',
        'Recommended: openai for the default path; anthropic if you want Honcho to use an Anthropic API key stored in Secret Vault.',
        'Default: openai. Example: openai.',
      )),
    model: z.string().min(1).default('gpt-5.4-mini')
      .describe(help(
        'The model Honcho should use for its own summaries and reasoning.',
        'Choose cheaper/faster models while testing. Move to larger models only if summaries or representations are too weak.',
        'Recommended default: gpt-5.4-mini for OpenAI, claude-haiku-4-5 for Anthropic.',
        'Example values: gpt-5.4-mini, gpt-5.5, claude-haiku-4-5, claude-sonnet-4-6.',
        'Default: gpt-5.4-mini.',
      )),
    api_key_secret_ref: z.string().optional()
      .describe(help(
        'A Secret Vault reference to the provider API key that Honcho should use.',
        'Do not paste the real API key into this text field. Paste it into the password field below and click Store; the UI will save the encrypted key and fill this field with a vault:// reference.',
        'Recommended: leave empty until you need Honcho LLM features, then store one key per provider.',
        'Example: vault://global/honcho/openai_api_key or vault://global/honcho/anthropic_api_key.',
      )),
  }).default({
    provider: 'openai',
    model: 'gpt-5.4-mini',
  }).describe(help(
    'Configures the LLM that self-hosted Honcho uses internally.',
    'You usually only need this when Honcho performs summaries, representations, dialectic chat, or dreams.',
    'This does not change the AnthroClaw agent model shown at the top of the agent page.',
  )),
  connection: z.object({
    workspace_id: z.string().min(1).default('anthroclaw-local')
      .describe(help(
        'The Honcho workspace where this agent stores and reads memory.',
        'Use one stable workspace per environment. Do not change it casually, because changing it makes the agent look in a different Honcho memory space.',
        'Recommended: anthroclaw-prod for production, anthroclaw-smoke for testing, anthroclaw-local for local dev.',
        'Default: anthroclaw-local. Example: anthroclaw-prod.',
      )),
    environment: z.enum(['production', 'local']).default('local')
      .describe(help(
        'Tells the Honcho SDK whether the API endpoint is managed/authenticated or local/self-hosted.',
        'Use local for the self-hosted Honcho Docker stack on the same server/network. Use production only for managed Honcho API endpoints that require HONCHO_API_KEY.',
        'Recommended for your Hostinger self-host setup: local.',
        'Default: local. Example: local.',
      )),
    base_url: z.string().url().default('http://honcho-api-1:8000')
      .describe(help(
        'The HTTP URL AnthroClaw uses to call the Honcho API.',
        'In Docker, do not use localhost unless Honcho runs inside the same container. Use the Honcho API container/service name on the shared Docker network.',
        'Recommended for the self-hosted compose network: http://honcho-api-1:8000.',
        'Managed Honcho example: https://api.honcho.dev.',
        'Default: http://honcho-api-1:8000.',
      )),
    api_key_env: z.string().min(1).default('HONCHO_API_KEY')
      .describe(help(
        'The environment variable name that contains the managed Honcho API key.',
        'Only used when Environment is production. It is normally ignored for self-hosted/local Honcho.',
        'Recommended: keep HONCHO_API_KEY unless your deployment already uses another env var name.',
        'Default: HONCHO_API_KEY. Example: HONCHO_API_KEY.',
      )),
    timeout_ms: z.number().int().positive().default(15_000)
      .describe(help(
        'Maximum time one Honcho HTTP call can wait before AnthroClaw gives up.',
        'Lower values protect chat latency. Higher values tolerate a slow Honcho server but can make agent replies feel stuck.',
        'Recommended: 15000 for production, 5000-10000 for aggressive testing.',
        'Default: 15000. Example: 15000 means 15 seconds.',
      )),
    max_retries: z.number().int().min(0).max(3).default(2)
      .describe(help(
        'How many times the Honcho SDK retries temporary failures.',
        'Recommended: 2. Use 0 only when debugging exact failures; use 3 only if the network is unstable.',
        'Default: 2. Example: 2.',
      )),
  }).default({
    workspace_id: 'anthroclaw-local',
    environment: 'local',
    base_url: 'http://honcho-api-1:8000',
    api_key_env: 'HONCHO_API_KEY',
    timeout_ms: 15_000,
    max_retries: 2,
  }).describe(help(
    'Connection settings for the Honcho API.',
    'For the Hostinger self-host setup, the important values are Environment = local and Base URL = http://honcho-api-1:8000.',
  )),
  peers: z.object({
    agent_peer_prefix: z.string().default('agent')
      .describe(help(
        'Prefix used when AnthroClaw creates Honcho peer IDs for agents.',
        'Recommended: keep agent. Changing it creates a different identity namespace in Honcho.',
        'Default: agent. Example stored peer shape: agent:timur_agent.',
      )),
    user_peer_prefix: z.string().default('user')
      .describe(help(
        'Prefix used when AnthroClaw creates Honcho peer IDs for human users.',
        'Recommended: keep user. With Hash IDs enabled, the real Telegram/WhatsApp ID is not stored directly.',
        'Default: user. Example stored peer shape: user:<hashed-id>.',
      )),
    group_peer_prefix: z.string().default('group')
      .describe(help(
        'Prefix used when AnthroClaw creates Honcho peer IDs for group chats.',
        'In groups, Honcho can see a group peer plus user peers, so group memory can stay separate from direct-message memory.',
        'Recommended: keep group.',
        'Default: group. Example stored peer shape: group:<hashed-group-id>.',
      )),
    hash_ids: z.boolean().default(true)
      .describe(help(
        'Stores Telegram IDs, WhatsApp JIDs, and group IDs as stable hashes before sending them to Honcho.',
        'Recommended: true for production privacy. Turn off only in a local throwaway test if you need to debug raw peer IDs.',
        'Default: true. Example: 123456789 becomes a stable hash instead of the raw ID.',
      )),
  }).default({
    agent_peer_prefix: 'agent',
    user_peer_prefix: 'user',
    group_peer_prefix: 'group',
    hash_ids: true,
  }).describe(help(
    'Controls how AnthroClaw maps chats and participants into Honcho peers.',
    'Most installations should keep these defaults. Change prefixes only if you are deliberately migrating namespaces.',
  )),
  observe: z.object({
    include_user_messages: z.boolean().default(true)
      .describe(help(
        'Saves incoming user messages to Honcho.',
        'Recommended: true, otherwise Honcho will not learn what users asked.',
        'Default: true.',
      )),
    include_assistant_messages: z.boolean().default(true)
      .describe(help(
        'Saves assistant replies to Honcho after each turn.',
        'Recommended: true, because Honcho needs both sides of the conversation to build useful context.',
        'Default: true.',
      )),
    include_media_text: z.boolean().default(true)
      .describe(help(
        'Allows extracted media text to be saved, such as audio transcripts or PDF text.',
        'Recommended: true if your agents work with voice notes, PDFs, or attachments. Turn off if media may contain highly sensitive data you do not want in Honcho.',
        'Default: true.',
      )),
    max_message_chars: z.number().int().min(500).max(50_000).default(12_000)
      .describe(help(
        'Maximum characters from one message sent to Honcho before truncation.',
        'Recommended: 12000. Lower values reduce storage and privacy exposure; higher values preserve long documents better.',
        'Default: 12000. Example: 12000 keeps roughly several pages of text.',
      )),
    queue_on_failure: z.boolean().default(true)
      .describe(help(
        'Writes failed Honcho ingestion attempts to a local JSONL queue when Honcho is down.',
        'Recommended: true, so outages do not silently lose memory writes. Current implementation stores failures for operator replay; it does not run an automatic background replay worker yet.',
        'Default: true.',
      )),
  }).default({
    include_user_messages: true,
    include_assistant_messages: true,
    include_media_text: true,
    max_message_chars: 12_000,
    queue_on_failure: true,
  }).describe(help(
    'Controls what conversation data AnthroClaw sends to Honcho.',
    'For a first rollout, keep all defaults and run Mode = observe.',
  )),
  context: z.object({
    enabled: z.boolean().default(true)
      .describe(help(
        'Allows AnthroClaw to automatically add Honcho context to the agent prompt.',
        'Only affects context and hybrid modes. In observe or tools mode, this does not inject anything automatically.',
        'Recommended: true when using context or hybrid.',
        'Default: true.',
      )),
    token_budget: z.number().int().min(256).max(12_000).default(1800)
      .describe(help(
        'Approximate token budget requested from Honcho for automatic context.',
        'Recommended: 1800 for normal chat. Increase to 3000-5000 only for agents that need deep long-term context.',
        'Default: 1800. Example: 1800.',
      )),
    include_peer_card: z.boolean().default(true)
      .describe(help(
        'Includes Honcho peer representations, such as what Honcho believes about a user or group.',
        'Recommended: true. This is often the most useful part of Honcho context.',
        'Default: true.',
      )),
    include_session_context: z.boolean().default(true)
      .describe(help(
        'Includes Honcho context connected to the current session or recent conversation.',
        'Recommended: true for continuity across active chats.',
        'Default: true.',
      )),
    include_agent_view: z.boolean().default(false)
      .describe(help(
        'Includes Honcho context about the agent peer itself.',
        'Recommended: false. Turn on only when intentionally testing agent self-representation or cross-agent behavior.',
        'Default: false.',
      )),
    max_chars: z.number().int().min(500).max(40_000).default(8000)
      .describe(help(
        'Hard character cap for the Honcho text inserted into the prompt.',
        'Recommended: 8000. Lower values are safer for prompt size; higher values can help complex memory-heavy agents.',
        'Default: 8000. Example: 8000.',
      )),
  }).default({
    enabled: true,
    token_budget: 1800,
    include_peer_card: true,
    include_session_context: true,
    include_agent_view: false,
    max_chars: 8000,
  }).describe(help(
    'Controls automatic Honcho memory injection into the agent prompt.',
    'These settings matter when Mode is context or hybrid. They do not make Honcho respond by itself.',
  )),
  tools: z.object({
    context: z.boolean().default(true)
      .describe(help(
        'Exposes honcho_context, a tool the agent can call to fetch current Honcho context.',
        'Recommended: true in tools or hybrid mode.',
        'Default: true.',
      )),
    ask: z.boolean().default(true)
      .describe(help(
        'Exposes honcho_ask, a natural-language question tool over Honcho memory.',
        'Recommended: true for trusted agents that should actively ask memory questions.',
        'Default: true.',
      )),
    search_messages: z.boolean().default(true)
      .describe(help(
        'Exposes honcho_search_messages, which searches raw stored messages.',
        'Recommended: true for debugging and retrieval-heavy agents. Turn off if agents should not inspect raw message history.',
        'Default: true.',
      )),
    search_conclusions: z.boolean().default(true)
      .describe(help(
        'Exposes honcho_search_conclusions, which searches Honcho summaries, conclusions, and representations.',
        'Recommended: true. This is usually safer and cleaner than raw message search.',
        'Default: true.',
      )),
    session: z.boolean().default(true)
      .describe(help(
        'Exposes honcho_session, which inspects current session context and summaries.',
        'Recommended: true for debugging and context-aware agents.',
        'Default: true.',
      )),
    status: z.boolean().default(true)
      .describe(help(
        'Exposes honcho_status, which reports Honcho plugin status and selected config.',
        'Recommended: true while rolling out. You may turn it off later if agents should not introspect plugin state.',
        'Default: true.',
      )),
  }).default({
    context: true,
    ask: true,
    search_messages: true,
    search_conclusions: true,
    session: true,
    status: true,
  }).describe(help(
    'Controls which honcho_* tools are available to the agent.',
    'These settings matter when Mode is tools or hybrid. In observe/context-only rollout, they can stay enabled but will not matter unless tools are exposed.',
  )),
  privacy: z.object({
    include_display_names: z.boolean().default(false)
      .describe(help(
        'Allows human display names to be uploaded as Honcho metadata.',
        'Recommended: false for privacy. Turn on only if names are necessary for operator workflows.',
        'Default: false.',
      )),
    strip_prompt_context_blocks: z.boolean().default(true)
      .describe(help(
        'Removes previously injected context blocks before saving messages back to Honcho.',
        'Recommended: true. This prevents Honcho from re-ingesting its own generated context over and over.',
        'Default: true.',
      )),
    strip_tool_progress: z.boolean().default(true)
      .describe(help(
        'Removes noisy tool progress and runtime lines before saving messages.',
        'Recommended: true. This keeps Honcho memory focused on user/assistant content instead of logs.',
        'Default: true.',
      )),
    redact_secrets: z.boolean().default(true)
      .describe(help(
        'Redacts obvious API keys, tokens, and secret-looking strings before persistence.',
        'Recommended: true and do not disable in production.',
        'Default: true.',
      )),
  }).default({
    include_display_names: false,
    strip_prompt_context_blocks: true,
    strip_tool_progress: true,
    redact_secrets: true,
  }).describe(help(
    'Privacy safeguards applied before anything is sent to Honcho.',
    'Recommended production defaults: hash IDs on, display names off, redact secrets on, strip injected context on.',
  )),
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
