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
        environment: production
        base_url: https://api.honcho.dev
        api_key_env: HONCHO_API_KEY
```

Managed Honcho requires the named API key environment variable:

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
        base_url: http://localhost:8000
```

`environment: local` does not require an API key. `environment: production` requires `api_key_env` to resolve.

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
