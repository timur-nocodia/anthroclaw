# AnthroClaw Honcho Plugin

Optional Honcho memory integration for AnthroClaw agents. The plugin can observe chat turns, inject bounded Honcho context, and expose `honcho_*` MCP tools without replacing the existing Agent SDK runtime or local memory tools.

## Enable Globally

Global config only provides defaults. A plugin is loaded only for agents that opt in with `plugins.honcho.enabled: true`.

```yaml
# config.yml
plugins:
  honcho:
    defaults:
      enabled: true
      mode: observe
      connection:
        workspace_id: anthroclaw-prod
        environment: local
        base_url: http://honcho-api-1:8000
        api_key_env: HONCHO_API_KEY
```

These defaults target the self-hosted Docker setup. Managed Honcho requires `environment: production`, `base_url: https://api.honcho.dev`, and the named API key environment variable:

```bash
export HONCHO_API_KEY=hch-v3-...
```

For local/self-hosted Honcho:

```yaml
plugins:
  honcho:
    defaults:
      enabled: true
      mode: hybrid
      connection:
        workspace_id: anthroclaw-local
        environment: local
        base_url: http://honcho-api-1:8000
```

`environment: local` does not require an API key. `environment: production` requires `api_key_env` to resolve.
When AnthroClaw runs in Docker and Honcho runs in another Compose project,
use the Honcho API service/container URL instead of `localhost`, for example
`base_url: http://honcho-api-1:8000`, and connect the AnthroClaw container to
the Honcho Docker network.

## Enable Per Agent

```yaml
# agents/amina/agent.yml
plugins:
  honcho:
    enabled: true
    mode: context
```

Per-agent config deep-merges over global defaults:

```yaml
plugins:
  honcho:
    enabled: true
    mode: tools
    tools:
      ask: true
      context: true
      search_messages: true
      search_conclusions: true
      session: true
      status: true
    context:
      token_budget: 1800
      max_chars: 8000
```

## Operator Config Guide

Use this block as a readable template. The comments are written as questions
because that is how operators usually decide whether a setting should change.

```yaml
plugins:
  honcho:
    # Question: should this agent use Honcho at all?
    # false = the plugin stays inactive for this agent.
    # true = the selected mode below starts applying.
    enabled: true

    # Question: how much should Honcho participate in the turn?
    # observe = only write turns to Honcho after the agent answers.
    # context = write turns and inject Honcho context before the next query.
    # tools = write turns and expose honcho_* tools, but no automatic context.
    # hybrid = context + tools.
    mode: context

    llm:
      # Question: which provider should self-hosted Honcho use for its own
      # extraction, summaries, dialectic chat, and dreams?
      # openai = use LLM_OPENAI_API_KEY on the Honcho server.
      # anthropic = use LLM_ANTHROPIC_API_KEY on the Honcho server.
      provider: openai

      # Question: which model should self-hosted Honcho use by default?
      # The UI dropdown is ordered from cheaper/faster to stronger/more
      # expensive. Start with gpt-5.4-mini or claude-haiku-4-5 unless quality
      # is visibly insufficient.
      model: gpt-5.4-mini

      # Question: where is the provider API key stored?
      # Paste the real key into the UI's password field and click Store.
      # agent.yml keeps only this vault:// reference, never the key itself.
      api_key_secret_ref: vault://global/honcho/openai_api_key

    connection:
      # Question: which Honcho memory namespace are we writing to?
      # Use one workspace per deployment/environment, for example:
      # anthroclaw-prod, anthroclaw-staging, anthroclaw-smoke.
      workspace_id: anthroclaw-prod

      # Question: is this an authenticated/managed Honcho endpoint or a local
      # self-host endpoint?
      # production = API key is required from api_key_env.
      # local = API key is not required by AnthroClaw.
      environment: local

      # Question: where can the AnthroClaw process reach Honcho API?
      # If both processes run on the same host without Docker, localhost works.
      # If AnthroClaw is inside Docker and Honcho is in another Compose project,
      # localhost points to the AnthroClaw container itself, so use the Honcho
      # service/container URL, e.g. http://honcho-api-1:8000.
      base_url: http://honcho-api-1:8000

      # Question: which environment variable contains the Honcho API key?
      # Needed only when environment is production.
      api_key_env: HONCHO_API_KEY

      # Question: how long can one Honcho HTTP call block the turn?
      # Keep this bounded so memory problems do not stall Telegram/WhatsApp.
      timeout_ms: 15000

      # Question: how many times should the SDK retry transient failures?
      # 0 = fail fast; 2 is a reasonable default for flaky network.
      max_retries: 2

    peers:
      # Question: what prefix marks AnthroClaw agents inside Honcho?
      # Final peer id looks like agent_<agentId>.
      agent_peer_prefix: agent

      # Question: what prefix marks human users inside Honcho?
      # Final peer id looks like user_<channel>_<account>_<hash>.
      user_peer_prefix: user

      # Question: what prefix marks group chats inside Honcho?
      # Used only for shared group sessions.
      group_peer_prefix: group

      # Question: should Telegram IDs, WhatsApp JIDs, and group IDs be hidden?
      # true = store stable hashes, safer default.
      # false = store sanitized raw IDs; use only for private/debug installs.
      hash_ids: true

    observe:
      # Question: should user messages be saved to Honcho?
      include_user_messages: true

      # Question: should assistant replies be saved to Honcho?
      include_assistant_messages: true

      # Question: should extracted media text be allowed into saved messages?
      # Applies to text AnthroClaw already extracted, such as transcripts/PDF text.
      include_media_text: true

      # Question: what is the max size of one saved message?
      # Larger messages are truncated before upload.
      max_message_chars: 12000

      # Question: if Honcho is down, should failed writes be saved locally?
      # true = write JSONL rows and retry on a later successful observe.
      queue_on_failure: true

    context:
      # Question: should Honcho be allowed to auto-inject context?
      # This only matters in mode: context or mode: hybrid.
      enabled: true

      # Question: how much Honcho context can be requested from Honcho?
      # This is a token request budget for the Honcho context call, not the
      # whole Claude prompt budget.
      token_budget: 1800

      # Question: should Honcho's compact peer card/representation be included?
      # Useful for stable user preferences and relationship context.
      include_peer_card: true

      # Question: should recent/session-specific Honcho context be included?
      # Useful for remembering what happened in this chat/session.
      include_session_context: true

      # Question: should the agent's own perspective be included too?
      # More experimental; keep false until we need agent self-representation.
      include_agent_view: false

      # Question: what is the hard character cap for injected Honcho text?
      # Prevents Honcho context from flooding the model prompt.
      max_chars: 8000

    tools:
      # Question: can the agent manually request current Honcho context?
      context: true

      # Question: can the agent ask Honcho a natural-language memory question?
      ask: true

      # Question: can the agent search stored Honcho messages?
      search_messages: true

      # Question: can the agent search Honcho conclusions/representations?
      search_conclusions: true

      # Question: can the agent inspect current session context/summaries?
      session: true

      # Question: can the agent inspect Honcho config/status?
      status: true

    privacy:
      # Question: should display names be uploaded as metadata?
      # false avoids sending names to Honcho unless explicitly needed.
      include_display_names: false

      # Question: should injected context blocks be stripped before saving?
      # true prevents Honcho from memorizing its own prompt context.
      strip_prompt_context_blocks: true

      # Question: should tool progress/noise be stripped before saving?
      # true keeps memory focused on user/assistant substance.
      strip_tool_progress: true

      # Question: should obvious secrets be redacted before saving?
      redact_secrets: true
```

### Self-host Docker Networking

If AnthroClaw and Honcho run in different Docker Compose projects, the
AnthroClaw container must be on the Honcho network to reach
`http://honcho-api-1:8000`.

Temporary fix after each app recreate:

```bash
docker network connect honcho_default anthroclaw-app-1
```

Production fix in the AnthroClaw Compose file:

```yaml
services:
  app:
    networks:
      - default
      - honcho

networks:
  honcho:
    external: true
    name: honcho_default
```

After this is in Compose, recreating `app` will keep the Honcho network
attachment automatically.

### Self-host LLM Provider Selection

AnthroClaw and Honcho use different model runtimes:

- AnthroClaw agent replies still go through the Claude Agent SDK.
- Self-hosted Honcho uses its own server-side LLM settings for memory
  extraction, summaries, peer representations, and `honcho_ask` reasoning.

Do not point Honcho at Claude Code, Claude Desktop, or subscription-based
auth files. Use explicit API keys only:

```env
LLM_ANTHROPIC_API_KEY=...
# or
LLM_OPENAI_API_KEY=...
```

These variables belong in the Honcho server `.env`, not in `agent.yml`.
In the AnthroClaw UI, paste the API key into the Honcho plugin `llm.api_key_secret_ref`
field and click **Store**; the saved plugin config stores only the resulting
`vault://global/honcho/<provider>_api_key` reference.

#### Recommended Anthropic Preset

Use this when you want Honcho's LLM work billed through Anthropic API keys.
This keeps normal Honcho memory work cheap and reserves stronger models for
explicit high-reasoning calls.

```env
LLM_ANTHROPIC_API_KEY=...

DERIVER_MODEL_CONFIG__TRANSPORT=anthropic
DERIVER_MODEL_CONFIG__MODEL=claude-haiku-4-5

SUMMARY_MODEL_CONFIG__TRANSPORT=anthropic
SUMMARY_MODEL_CONFIG__MODEL=claude-haiku-4-5

DIALECTIC_LEVELS__minimal__MODEL_CONFIG__TRANSPORT=anthropic
DIALECTIC_LEVELS__minimal__MODEL_CONFIG__MODEL=claude-haiku-4-5
DIALECTIC_LEVELS__low__MODEL_CONFIG__TRANSPORT=anthropic
DIALECTIC_LEVELS__low__MODEL_CONFIG__MODEL=claude-haiku-4-5
DIALECTIC_LEVELS__medium__MODEL_CONFIG__TRANSPORT=anthropic
DIALECTIC_LEVELS__medium__MODEL_CONFIG__MODEL=claude-sonnet-4-6
DIALECTIC_LEVELS__high__MODEL_CONFIG__TRANSPORT=anthropic
DIALECTIC_LEVELS__high__MODEL_CONFIG__MODEL=claude-sonnet-4-6
DIALECTIC_LEVELS__max__MODEL_CONFIG__TRANSPORT=anthropic
DIALECTIC_LEVELS__max__MODEL_CONFIG__MODEL=claude-opus-4-7

DREAM_DEDUCTION_MODEL_CONFIG__TRANSPORT=anthropic
DREAM_DEDUCTION_MODEL_CONFIG__MODEL=claude-haiku-4-5
DREAM_INDUCTION_MODEL_CONFIG__TRANSPORT=anthropic
DREAM_INDUCTION_MODEL_CONFIG__MODEL=claude-haiku-4-5
```

Anthropic model order, cheapest/fastest to strongest:

| Tier | Model alias | Use for |
| --- | --- | --- |
| Cheap / fast | `claude-haiku-4-5` | Default Honcho extraction, summaries, low-cost dialectic |
| Balanced | `claude-sonnet-4-6` | Higher-quality summaries and medium/high dialectic |
| Expensive / strongest | `claude-opus-4-7` | Rare max-quality reasoning only |

#### Recommended OpenAI Preset

Use this when OpenAI is acceptable for Honcho's auxiliary memory work.

```env
LLM_OPENAI_API_KEY=...

DERIVER_MODEL_CONFIG__TRANSPORT=openai
DERIVER_MODEL_CONFIG__MODEL=gpt-5.4-mini

SUMMARY_MODEL_CONFIG__TRANSPORT=openai
SUMMARY_MODEL_CONFIG__MODEL=gpt-5.4-mini

DIALECTIC_LEVELS__minimal__MODEL_CONFIG__TRANSPORT=openai
DIALECTIC_LEVELS__minimal__MODEL_CONFIG__MODEL=gpt-5.4-nano
DIALECTIC_LEVELS__low__MODEL_CONFIG__TRANSPORT=openai
DIALECTIC_LEVELS__low__MODEL_CONFIG__MODEL=gpt-5.4-mini
DIALECTIC_LEVELS__medium__MODEL_CONFIG__TRANSPORT=openai
DIALECTIC_LEVELS__medium__MODEL_CONFIG__MODEL=gpt-5.4-mini
DIALECTIC_LEVELS__high__MODEL_CONFIG__TRANSPORT=openai
DIALECTIC_LEVELS__high__MODEL_CONFIG__MODEL=gpt-5.4
DIALECTIC_LEVELS__max__MODEL_CONFIG__TRANSPORT=openai
DIALECTIC_LEVELS__max__MODEL_CONFIG__MODEL=gpt-5.5
```

OpenAI model order, cheapest/fastest to strongest:

| Tier | Model | Use for |
| --- | --- | --- |
| Cheapest / fastest | `gpt-5.4-nano` | Minimal dialectic or very cheap background tasks |
| Cheap default | `gpt-5.4-mini` | Default Honcho extraction, summaries, dialectic |
| Balanced / stronger | `gpt-5.4` | Higher-quality summaries and high dialectic |
| Expensive / strongest | `gpt-5.5` | Rare max-quality reasoning only |

#### Embeddings Are Separate

Honcho also needs embeddings for semantic retrieval. Anthropic does not provide
an embeddings API, so an Anthropic LLM preset does not automatically remove all
non-Anthropic usage. If you leave Honcho defaults in place, embeddings use
OpenAI's cheap embedding model:

```env
EMBEDDING_MODEL_CONFIG__TRANSPORT=openai
EMBEDDING_MODEL_CONFIG__MODEL=text-embedding-3-small
```

To avoid OpenAI entirely, configure Honcho embeddings against a compatible
self-hosted or third-party embedding endpoint supported by Honcho before
enabling semantic retrieval in production.

## Modes

- `off`: no Honcho work.
- `observe`: persist sanitized user and assistant turns only.
- `context`: observe turns and inject bounded Honcho session context before `query()`.
- `tools`: observe turns and expose `honcho_*` tools, with no automatic prompt injection.
- `hybrid`: observe, automatic context injection, and tools.

Recommended rollout: start with `observe`, smoke test ingestion, then move one private test agent to `context` or `hybrid`.

## Tools

Tool names are plugin-namespaced by AnthroClaw:

- `honcho_status`: config/status snapshot.
- `honcho_context`: bounded Honcho context for the current session.
- `honcho_session`: current session context and summaries.
- `honcho_search_messages`: semantic search over current session messages.
- `honcho_search_conclusions`: session-scoped conclusion search from the agent peer.
- `honcho_ask`: session-scoped Honcho Q&A from the agent peer.

Current implementation is intentionally session-scoped except `status`. Cross-session participant recall can be added after live smoke testing confirms identity mapping and group attribution.

## Groups

Honcho follows AnthroClaw's existing session isolation:

- `group_sessions: shared`: one Honcho session for the group/thread; the group peer, sender peer, and agent peer are attached.
- `group_sessions: per_user`: one Honcho session per group participant; no group peer is attached by default.

Peer IDs and session IDs are SDK-safe and privacy-preserving by default:

- `agent_<agentId>`
- `user_<channel>_<account>_<hash>`
- `group_<channel>_<account>_<hash>`
- `session_<hash>`

Raw Telegram/WhatsApp IDs are hashed unless `peers.hash_ids: false`; even then, IDs are sanitized to Honcho's allowed `[A-Za-z0-9_-]` format.

## Privacy Defaults

Defaults are conservative:

- display names are not uploaded;
- raw channel IDs are hashed;
- prompt context blocks are stripped before persistence;
- tool progress lines are stripped;
- common secret patterns are redacted;
- raw adapter payloads are not uploaded.

## Offline Queue

When writes fail and `observe.queue_on_failure: true`, rows are written to:

```text
data/honcho/offline-queue/{agentId}.jsonl
```

On the next successful observe for that agent, the plugin retries queued rows opportunistically and keeps only failed rows in the queue.

## Smoke Test

Managed:

```bash
export HONCHO_API_KEY=hch-v3-...
pnpm build
pnpm dev
```

Local/self-hosted:

```bash
curl http://localhost:8000/health
pnpm build
pnpm dev
```

Checklist:

1. Enable `observe` for a private test agent.
2. Send a normal DM turn and confirm no gateway errors.
3. Inspect Honcho for the workspace/session/messages.
4. Switch the agent to `context`; send a second turn and confirm the answer can use prior context.
5. Switch to `tools` or `hybrid`; ask the agent to call `honcho_status` and `honcho_session`.
6. Test a group with `group_sessions: shared`.
7. Test a group with `group_sessions: per_user`.

Useful Honcho CLI checks:

```bash
honcho workspace inspect --json
honcho workspace queue-status --json
honcho session context <session_id> --json
honcho session summaries <session_id> --json
honcho message list <session_id> --last 20 --json
```
