# Agent SDK Upgrade Current Status

Status checked: 2026-04-24
Last updated: 2026-04-24 after commits `8e4c2a5` and `39c4772`

This file supersedes the older high-level planning docs for implementation status:
- `docs/agent-sdk-hermes-openclaw-roadmap.md`
- `docs/agent-sdk-hermes-openclaw-backlog.md`
- `docs/agent-sdk-strict-native-policy.md`

The current source of truth for the completed upgrade wave is:
- `docs/superpowers/plans/2026-04-22-agent-sdk-gap-analysis-plan.md`
- this current-status file for post-plan cleanup, persistent metrics, and Fleet UI exposure

## Verification

Commands run:

```sh
npx vitest run test/sdk test/agent/tools test/session/session-search.test.ts test/references/parser.test.ts test/security/ssrf.test.ts test/security/injection-scanner.test.ts
npm test
npm run build
npx vitest run test/session/session-search.test.ts test/agent/tools/session-search.test.ts test/references/parser.test.ts
npm run build
npx vitest run test/metrics-collector.test.ts test/metrics/store.test.ts
npm run build
npm test
npm run ui:build
cd ui && pnpm test --run
```

Results:
- targeted SDK/tool/session/security tests: 24 files passed, 213 tests passed
- full test suite before focused-summary changes: 69 files passed, 769 tests passed
- post-summary targeted session/reference tests: 3 files passed, 45 tests passed
- post-summary full test suite: 69 files passed, 776 tests passed
- post-summary TypeScript build: passed
- persistent metrics targeted tests: 2 files passed, 18 tests passed
- latest backend full test suite: 70 files passed, 777 tests passed
- latest backend TypeScript build: passed
- latest UI production build: passed
- latest UI test suite: 14 files passed, 162 tests passed

## Implemented

### Strict native SDK runtime

Implemented.

Evidence:
- centralized SDK option builder: `src/sdk/options.ts`
- user-facing query paths use `buildSdkOptions()` through `Gateway.buildUserQueryOptions()`
- `query()` / `WarmQuery` remain the runtime path
- `settingSources: ['project']` is explicit
- SDK-native `fallbackModel`, `promptSuggestions`, `agentProgressSummaries`, `includePartialMessages`, `includeHookEvents`, `enableFileCheckpointing`, `sessionStore`, and sandbox options are wired

Important nuance:
- `trustedBypass` still exists, but only as a narrow internal escape hatch for trusted summarization flows, not as the user-facing default.

### Permissions and hooks

Implemented.

Evidence:
- `src/sdk/permissions.ts`
- `src/sdk/hooks.ts`
- `buildAllowedTools()`
- `createCanUseTool()`
- `buildPermissionHooks()`
- SDK `PreToolUse` hook blocks dangerous Bash patterns and protected file paths
- local webhook/script hooks remain as integration notifications, while SDK hooks carry execution lifecycle events

### Session service and SDK SessionStore

Implemented.

Evidence:
- `src/sdk/session-store.ts`
- `src/sdk/sessions.ts`
- `Gateway` initializes `SdkSessionService` with `FileSessionStore`
- session list, inspect, fork, delete, title metadata, and transcript reads are backed by SDK session APIs/store

Remaining nuance:
- `Agent` still keeps lightweight session maps for channel/session routing. This is routing glue, not the long-term transcript source of truth.

### WarmQuery

Implemented.

Evidence:
- `src/sdk/warm-pool.ts`
- `Gateway.prewarmAgent()`
- `Gateway.startQuery()` consumes a warm handle for fresh sessions and falls back to regular `query()`

### SDK events and Web UI flow

Implemented.

Evidence:
- `src/sdk/events.ts`
- partial text extraction
- prompt suggestions
- task progress
- hook lifecycle events

### SDK file checkpoint rewind

Implemented.

Evidence:
- `src/sdk/checkpoints.ts`
- Gateway checkpoint registry
- native `Query.rewindFiles()` is used rather than custom filesystem rollback

### Skills: native `.claude/skills`

Implemented enough for the current wave.

Evidence:
- `src/skills/workspace.ts`
- `src/agent/tools/list-skills.ts`
- `src/agent/tools/manage-skills.ts`
- `list_skills` prefers `.claude/skills` and supports legacy `skills/` only for compatibility
- `manage_skills` manages SDK-native `.claude/skills/*/SKILL.md`

Remaining nuance:
- `skills-index.md` still exists as a compatibility artifact, but runtime no longer depends on refreshing it before every query.

### Session search

Implemented.

Evidence:
- `src/session/transcript-index.ts`
- `src/session/session-search.ts`
- `src/agent/tools/session-search.ts`
- `Agent.load()` wires `session_search` through `SessionSearchService`
- subagent portable MCP path also supports `session_search`

Current behavior:
- indexes SDK session transcripts into SQLite FTS
- returns compact snippets grouped by session
- optionally adds focused per-session summaries for matched sessions

Hermes comparison:
- the original gap was FTS-only snippets versus FTS plus session-focused LLM recap
- this is now closed with `searchWithSummaries()`
- the summary path uses the Claude Agent SDK `query()` runtime, disables tools, uses `permissionMode: 'dontAsk'`, and treats transcript text as untrusted historical data
- callers can set `summarize: false` to keep the cheaper snippet-only behavior

### Subagent safety and portable MCP

Implemented for the current wave.

Evidence:
- `src/sdk/subagent-mcp.ts`
- `src/sdk/subagent-registry.ts`
- `Gateway.buildSubagents()`
- subagents receive explicit built-in tools plus portable stdio MCP tools
- shared in-process MCP server instances are no longer passed directly into subagents

### Title generation

Implemented.

Evidence:
- `src/session/title-generator.ts`
- `Gateway.maybeGenerateSessionTitle()`
- title generation uses a tool-disabled Claude Agent SDK query and stores metadata via `SdkSessionService`

### Prompt caching direction

Implemented by deletion/reframe.

Current state:
- old custom `src/session/prompt-cache.ts` is gone
- runtime uses SDK-native system prompt behavior through `systemPrompt` and `excludeDynamicSections`

### Persistent runtime metrics

Implemented.

Evidence:
- `src/metrics/store.ts`
- `src/metrics/collector.ts`
- `Gateway.start()` attaches `data/metrics.sqlite`
- `Gateway` records counters, query durations, token windows, usage events, tool lifecycle events, session lifecycle events, and subagent lifecycle events
- `/api/metrics` snapshot exposes `insights_30d` and `events_30d`

Current behavior:
- metrics survive restarts
- 24-hour message/token windows are backed by persistent events when the store is attached
- 30-day insights include sessions, messages, token totals, top models, and top tools
- lifecycle counts cover session, tool, and subagent event classes

### Fleet UI metrics and dead settings cleanup

Implemented.

Evidence:
- `ui/app/(dashboard)/fleet/[serverId]/page.tsx`
- `ui/app/(dashboard)/fleet/[serverId]/settings/page.tsx`
- `ui/components/sidebar.tsx`

Current behavior:
- Fleet server dashboard displays live persisted metrics instead of synthetic numbers
- server settings storage page shows read-only runtime facts from `/api/metrics`
- advanced settings no longer expose UI-only experimental toggles or fake storage controls
- strict-native runtime contract is visible as read-only configuration context
- fake `admin@acme.internal` UI text has been removed from the sidebar/settings surface

### Backend config cleanup

Implemented.

Evidence:
- `src/config/schema.ts`
- `test/config/schema.test.ts`

Current behavior:
- legacy `credentials.anthropic` is ignored by `GlobalConfigSchema`
- legacy agent `skills` blocks are ignored by `AgentYmlSchema`
- legacy agent `fallbacks` blocks are ignored by `AgentYmlSchema`
- native Agent SDK options remain under the `sdk` block
- OpenAI remains valid for `defaults.embedding_provider` only, not as an agent runtime backend

### Reference hardening

### `@url` SSRF guard

Implemented.

Evidence:
- `src/security/ssrf.ts` exists and is tested
- `src/references/parser.ts` calls `validateUrl()` before fetching `@url`
- `@url` accepts only `http:` and `https:` protocols

### Prompt injection scanning for injected references

Implemented.

Evidence:
- `src/security/injection-scanner.ts` exists and is tested
- `src/references/parser.ts` annotates suspicious file, folder, and URL reference content before formatting it into `<context-references>`
- reference formatting also enforces a bounded context budget

### Workspace-root restrictions for file/folder references

Implemented.

Evidence:
- `src/references/parser.ts` rejects file and folder references outside the workspace root

## Partially implemented or intentionally deferred

### Full subagent steering UX

Deferred.

Current implementation:
- registry/list/inspect/control boundary exists
- interrupt semantics are intentionally scoped to parent-query behavior

Status:
- documented out of scope for first pass

### Full daemon/service envelope and remote-control worker path

Deferred.

Evidence:
- `docs/superpowers/spikes/2026-04-23-assistant-worker-remote-control-spike.md`

Decision:
- keep Gateway-first runtime as the production path
- do not adopt `runAssistantWorker()` for current Web UI / fleet / channel execution

## Conclusion

Most of the strict-native Agent SDK upgrade has already been implemented.

The old `docs/agent-sdk-hermes-openclaw-backlog.md` should be treated as historical planning, not current status. The code is ahead of that document.

The original high-priority gap-analysis scope is now closed in code:
- strict-native Claude Agent SDK runtime
- native permission and hook surface
- SDK SessionStore-backed sessions
- WarmQuery
- native `.claude/skills`
- transcript indexing and `session_search`
- SDK-native focused session summaries
- reference SSRF and prompt-injection hardening
- subagent portable MCP hardening
- checkpoint rewind
- title generation
- prompt-cache deletion/reframe toward SDK-native behavior
- persistent runtime metrics
- Fleet UI metrics exposure
- legacy/dead UI settings cleanup
- backend legacy config blocks ignored in strict-native mode

Remaining work is deferred product/runtime scope rather than unfinished gap-analysis scope:
- decide later whether full subagent steering UX is worth adding
- decide later whether assistant-worker remote control is worth adopting for any non-primary runtime
- decide later whether stricter reference policies or richer observability dashboards are worth adding
