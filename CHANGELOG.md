# Changelog

All notable changes to AnthroClaw are documented here.

## [Unreleased]

### BREAKING

- `safety_profile` is now required in `agents/<id>/agent.yml`. Existing configs without this field fail to load. Run `pnpm migrate:safety-profile --apply` to add it. See `docs/safety-profiles.md`.
- The hardcoded `claude_code` SDK preset and `settingSources: ['project']` are no longer applied by default. Profile-driven; see `docs/safety-profiles.md`.
- `DEFAULT_ALLOWED_TOOLS` no longer auto-includes `Bash`, `Write`, `Edit`, `MultiEdit`, `WebFetch` for every agent. Per-profile gating replaces it.

### Added

- **`chat_like_openclaw` safety profile** — friendly conversational mode for
  personal/single-user bots. Pure-string system prompt with embedded
  personality baseline (no `claude_code` preset). All tools auto-allowed,
  no approval flow, wildcard allowlist permitted, no sandbox.
- **`personality` field** in `agent.yml` — overrides the profile's default
  personality baseline. Editable in dashboard via Personality textarea
  (visible only on chat profile).
- `GET /api/security/profiles/chat_like_openclaw/baseline` — returns the
  default baseline string (read-only, used by UI placeholder).
- `src/security/profiles/` — `public`, `trusted`, `private` profile definitions
- `src/security/approval-broker.ts` — in-memory approval queue for interactive permission flow
- `pnpm migrate:safety-profile` — utility to add `safety_profile` to existing agents
- Telegram inline-button approval for destructive tool calls in `trusted`/`private` profiles
- Per-tool `META` exports across all MCP tools

### Changed

- **Default `safety_profile` for new agents is now `chat_like_openclaw`**
  (UI scaffold and `createAgent` API). Existing agents are unaffected.
- `agents/example` (Klavdia) migrated to `chat_like_openclaw`. CLAUDE.md
  rewritten to remove "be concise"-style instructions; soul.md rewritten
  for warm conversational tone.
- `inferProfile()` migration helper now suggests `chat_like_openclaw` for
  configs with `permission_mode: bypass`, wildcard allowlists, or empty
  configs.
- Validator no longer errors on `permission_mode: bypass` with
  `safety_profile: chat_like_openclaw` (in addition to existing `private`
  exception).

### Fixed

- Klavdia (and any other agent under `claude_code` preset) was instructed by SDK to use `/tmp/claude-resume-.../memory/` and harness primitives `RemoteTrigger`/`CronCreate`. This is replaced for `public` profile (custom prompt) and gated for others.

## [0.4.1] - 2026-04-28

Polish pass on the Sessions surface shipped in 0.4.0: shape-matched
loading skeletons, faster detail-page open, plus a small reliability
fix and a favicon. Also includes a config-mutation fix for Docker
deployments and a UX fix for the WhatsApp pair flow.

### Added

- **Skeleton loaders for Sessions UI.** The list page now renders 8
  shape-matched row skeletons while the first fetch is in flight (was
  blank); the detail page renders 4 skeleton bubbles in place of the
  thin "Loading transcript..." line, and the title shows a skeleton
  bar instead of the long raw `sessionId` string before metadata
  arrives. No layout shift when data lands (caf709e).
- **Favicon.** Real favicon shipped under `ui/app/favicon.ico` —
  Next.js auto-detects and serves at `/favicon.ico` (2529214).

### Performance

- **Session detail open is one fetch instead of two.** Opening a
  session previously dispatched the detail fetch *and* a list of up
  to 200 sibling sessions (only to find the meta — title, labels,
  provenance, activeKeys, messageCount — for the one being opened).
  `getAgentSessionDetails()` now returns those fields directly, and
  the full session list (used solely as autocomplete source for "Add
  label") is fetched lazily on first input focus. Noticeable on
  agents with long history (dfb1aaf).

### Fixed

- **`/api/fleet/status` no longer 500s on a zero-byte
  `fleet-alerts.json` / `fleet.json`.** A half-written or
  externally-truncated JSON file made `loadFleet()` / `loadStore()`
  throw "Unexpected end of JSON input" inside the route handler,
  which surfaced as the empty "No gateways in fleet" state on the
  Fleet page even though the gateway itself was healthy. Empty file
  is now treated as default state (3ede5cb).
- **WhatsApp Disconnect and config edits no longer fail with
  `EROFS` in Docker.** The production compose file mounts
  `config.yml` read-only, but the UI's `DELETE /api/channels/whatsapp/[accountId]`
  and `PUT /api/config` handlers tried to `writeFileSync` to it. New
  runtime overlay (`data/runtime-overrides.yml`) is deep-merged with
  the base `config.yml` at gateway startup; UI mutations write to the
  overlay only, with `null` values acting as tombstones to suppress
  base entries. The base file stays read-only as the operator-edited
  source of truth (60bed6d).
- **WhatsApp pair page no longer dead-ends on `loggedOut`.** Previously
  the page showed "Logged out by WhatsApp. Clear credentials and try
  again." with a perpetually pulsing "Generating QR…" spinner and no
  affordance to clear. Now an error panel renders with a "Clear
  credentials & retry" button that wipes the auth dir via the pair
  endpoint's new `reset:true` flag and restarts the SSE stream.
  Account ID is echoed up front so the retry targets the right
  directory even when it was derived from the agent's route (60bed6d).

### Docs

- README "Control UI" section now lists the dedicated Sessions
  browser; `docs/guide.md` "Session Lifecycle" corrected to reflect
  on-disk persistence (`data/sdk-sessions/...main.jsonl` for SDK
  transcripts, `data/session-mappings/{agentId}.json` for sessionKey
  ↔ sessionId mapping) instead of the stale "in-memory only" claim
  (035ead7).


## [0.4.0] - 2026-04-27

This release ships a dedicated **Sessions** section in the UI: full read /
manage / export / bulk surface for stored agent sessions, with rendering
unified across live Test Chat and saved-history views.

### Added

- **Sessions section** (`/fleet/[serverId]/sessions/[agentId]` and
  `/[sessionId]`). List page with search + source/status filters, agent
  picker, time-ago, message count, label chips, active-session indicator;
  detail page with editable title, label editor, transcript renderer,
  metadata strip, and action bar (Open in Test Chat / Fork / Export /
  Delete with two-step confirm).
- **Sidebar entries.** `Chat` renamed to `Test Chat`; new `Sessions` entry
  with `History` icon between Test Chat and Channels.
- **Unified message rendering for stored sessions.** New
  `storedEntriesToChatMessages()` reconstructs `ChatMessage[]` (with
  `toolCalls[]` and `output` paired by `tool_use_id`) from persisted
  Anthropic content blocks, so resumed history renders identical to the
  live SSE stream — same `MessageBubble` and `ToolCallCard` components.
  Fixes the lossy `openSession()` path that previously stringified raw
  `message` JSON when text was empty, dropping all tool calls.
- **Per-session export.** `GET /api/agents/[agentId]/sessions/[sessionId]/export?format=md|jsonl`
  with `Content-Disposition`. Markdown formatter emits role-labelled
  sections, fenced JSON for tool inputs, fenced output blocks for tool
  results, with dynamic-length fences so embedded triple-backticks don't
  break the document.
- **Bulk operations.** New `POST /api/agents/[agentId]/sessions/bulk` with
  `{action: 'delete' | 'addLabels' | 'removeLabels', sessionIds, labels}`.
  List-page UI supports multi-select (checkbox per row, shift-click range,
  selection highlight), bulk-action bar with Delete (two-step confirm) and
  Tag (add/remove labels with autocomplete from agent's known labels),
  sonner toasts on result.
- **Inline label editor on detail page.** Click chip's `×` to remove,
  `+ Add label` opens an autocomplete input (datalist of existing labels).
- **`gw.getAgentSessionLabels(agentId, sessionId)`** — public gateway
  accessor used by the bulk endpoint to compute label diffs.
- **Keyboard shortcuts on the list page.** `/` focuses search,
  `j` / `k` / `↓` / `↑` move row focus (with auto-scroll and accent
  ring), `Enter` opens, `x` toggles selection of focused row,
  `a` selects all visible, `⌫` / `Delete` triggers bulk-delete confirm,
  `Esc` clears selection / closes cheatsheet / blurs input,
  `?` toggles a cheatsheet modal listing every binding. Listener is
  inert while typing in `INPUT` / `TEXTAREA` / `SELECT` / contentEditable
  and skips modifier-key combinations.

### Changed

- Test Chat's `openSession()` now delegates to the shared normalizer, so
  the rendering of resumed history is byte-identical to the live stream.
- **`display.toolProgress` now actually wired** to per-tool chat status
  surfacing (was a dead config field). When set to `all` the gateway posts
  a short `▶ <toolName>: <preview>` line per tool call (preview length
  governed by `display.toolPreviewLength`); `new` posts only the first
  occurrence of each tool name; `off` (default) stays silent. Default is
  now `off` on every platform — including Telegram, where the previous
  unwired default was `all` and would have spammed group chats once
  surfacing landed. Opt in per-agent for dev/debug surfaces.

### Fixed

- **Verbose tool-call visibility in logs.** Each `tool_use` event now
  emits a `logger.debug({ agentId, sessionKey, toolName }, 'agent: tool_use')`
  line. Without this, a long-running query (extended thinking, slow tool,
  hung subagent) was indistinguishable from a working one — the only
  signals were `Querying agent` at the start and `Memory prefetch
  completed` at the end. Run with `LOG_LEVEL=debug` to see what a stuck
  agent is actually doing.

## [0.3.0] - 2026-04-27

This release fixes the WhatsApp pair → reply path end-to-end, makes sessions
survive restart, plugs framework debug-string leaks to end users, and adds
conventional building blocks (NO_REPLY sentinel, serial queue mode, Python
runtime, opt-in task notifications).

### Added

- **Persistent session mappings.** `sessionKey ↔ sessionId` is now written to
  `data/session-mappings/{agentId}.json` on every change and reloaded on
  startup. Gateway restarts (deploys, container recreate, OOM) no longer make
  the bot "forget" ongoing chats — the next inbound message resumes the same
  SDK session with the full transcript intact (4069332).
- **`NO_REPLY` sentinel.** Conventional pattern for conversational agents:
  emit `NO_REPLY` when the model judges the turn doesn't warrant a reply
  (blocked sender, ack-only follow-up, operator handoff). Gateway recognizes
  the marker — both as the whole response and as a trailing line tacked onto
  a real reply — and suppresses delivery (b4dd853).
- **Serial queue mode.** New `queue_mode: serial` runs each buffered message
  as its own turn in arrival order, instead of folding them into one merged
  follow-up like `collect` does (b483d4e).
- **`display.taskNotifications` flag.** Forwarding SDK task lifecycle
  notifications (`Task completed: …`) to the user channel is now opt-in via
  agent.yml. Off by default — these are framework-internal progress events
  that look like debug output in a real chat (fb6f71b).
- **Python + curl + common Python deps in runtime image.** `python3`,
  `python3-pip`, `curl`, plus `google-auth`, `google-api-python-client`, and
  `requests`. Agents shipping Python helper scripts (Calendar booking,
  Sheets logging, Gmail follow-ups) no longer need to bundle their own venv
  (d08c0a0).

### Fixed

- **WhatsApp `@lid` outbound now actually delivers.** Baileys 7.0.0-rc.9
  throws `Cannot read properties of undefined (reading 'undefined')` inside
  `generateWAMessageFromContent` for bare `@lid` JIDs whose participant
  device list is partially resolved. Resolve LID → phone-number JID via
  `signalRepository.lidMapping.getPNForLID`, then strip the device suffix
  with `jidNormalizedUser`. Falls back to the original LID if no mapping
  exists yet (da140bc).
- **WhatsApp quoted-reply no longer crashes the send.** The synthetic
  `{quoted: {key: {…}}}` we built for replies omitted the `message` body,
  which made Baileys call `getContentType(undefined)` and throw the same
  `'undefined'` error. Drop the quoted option entirely — bots don't really
  benefit from quote-replies anyway (da140bc).
- **Empty agent responses no longer leak `Agent X processed your message
  but produced no text response`** to end users. When the model emits no
  text this turn (only tool calls, hits iteration budget, or chooses
  silence), the gateway returns empty and skips delivery instead of
  inventing a synthetic placeholder (fb6f71b).
- **WhatsApp `auth_dir` resolves against workspace root, not cwd.** The
  Next.js host runs from `/app/ui`, which made relative `auth_dir`
  resolve to `/app/ui/data/whatsapp/...` (empty) instead of the mounted
  `/app/data/whatsapp/...`. Pair-then-restart silently broke the
  WhatsApp connection on every deploy (a9c2934).
- **WhatsApp pair UI now actually works end-to-end.** Unified Baileys
  `browser` tuple between pair-whatsapp and the gateway socket (different
  tuples = different "linked devices" to WhatsApp); pair UI accepts both
  legacy SSE field names; resolves accountId from the selected agent's
  whatsapp route (e034720). Bind button opens the pair flow scoped to the
  selected account (0d9f047). Trash button on the channels page wired to
  the DELETE endpoint (413b342).
- **WhatsApp typing-presence failures stop blocking actual sends.**
  Baileys throws on `sendPresenceUpdate('composing', '@lid')` for some
  device-list states. Wrapped in `.catch` so the typing indicator can fail
  without aborting the message that follows (87e535a).
- **Queue `collect` mode buffers and drains follow-up messages instead of
  silently dropping them.** During an active turn, additional messages are
  now folded into a merged follow-up turn — as documented (ebc6fc3).
- **Drain-dispatch failures no longer crash the worker.** Errors when
  delivering a buffered turn (e.g. Baileys `@lid` throw) are caught,
  logged, and continue draining (ba60616).
- **Steer-aborted runs don't leak a stub reply.** When a follow-up message
  cancels an in-flight query, the original turn now exits silently so the
  follow-up's reply is the only thing the user sees (79c331e).
- **`pairing.mode = "off"` warns once.** Counter-intuitive default that
  silently denies everyone unless allowlisted now emits a one-time warn
  log per (agentId, channel) explaining the footgun (87e535a).
- **Group access defaults open + multi-line channel rule editor fixed.**
  Dropping a bot into a group with `@`-mention no longer requires
  per-group config; UI editor for channel rules accepts multi-line input
  again (88bc614).

### Docs

- Queue modes guide and UI picker now explain all four modes
  (`always`, `interrupt`, `collect`, `serial`) and when to pick each
  (ab3404b).

### Verified

- Full test suite: 92 files passed, 899 tests passed.
- Root TypeScript check and UI TypeScript check passed.
- End-to-end WhatsApp pair → message → reply confirmed in production.


## [0.2.1] - 2026-04-26

### Changed
- docs: document new bot commands, in-thread typing, eye reaction, .claude bind-mount (995576b)
- feat(telegram): bot UX upgrades — eye reaction, in-thread typing, /compact, /model (f74331d)
- merge: bring in v0.2.0 from origin/main (1c497e8)
- fix: chat header layout and gateway uptime drift (aba7b61)
- feat: add Docker deployment for Linux servers (8f8b12a)


## [0.2.0] - 2026-04-25

### Added

- Operator diagnostics bundle with redacted metadata export, run scoping, debug-rail download links, and run sidecars for interrupts, integration audit, and memory influence.
- Memory quality workflow: provenance, review queue/API/UI, review notes, memory doctor, influence tracing, post-run memory candidates, and review-gated local note proposals.
- Runtime reliability surfaces for activity timeouts, SDK task notifications, active run/debug visibility, durable interrupt records, direct webhook delivery, and webhook delivery logs.
- Agentic control UX for session mailbox filters, labels, rename, summary rows, reconnect-safe active run controls, subagent policy controls, subagent tool summaries, and file ownership visibility.
- Integration capability matrix, MCP preflight/status/audit UI, integration audit filters/run links, copyable permission snippets, Google/Gmail external MCP presets, and local notes MCP quick enable.
- Speech-to-text provider interface with automatic provider selection for AssemblyAI, OpenAI, and ElevenLabs.

### Changed

- Kept harness additions outside Claude Agent SDK transcript internals: no transcript surgery, synthetic SDK tool results, custom provider router, or SDK history rewriting.
- Made native in-flight steer behavior explicit: production active-run steering remains disabled and the supported fallback is interrupt-and-restart.
- Improved sandbox-aware test coverage so `fs.watch` and local HTTP webhook specs skip only when the current environment cannot provide those system capabilities.

### Verified

- Full test suite: 92 files passed, 876 tests passed, 8 environment-dependent tests skipped in the current sandbox.
- Root TypeScript check, UI TypeScript check, and production build passed.

## [0.1.0] - 2026-04-24

### Added

- Initial public AnthroClaw release.
- Claude Agent SDK-native gateway runtime.
- Telegram and WhatsApp channels.
- Agent workspaces with prompts, skills, MCP tools, memory, sessions, and cron jobs.
- Next.js Web UI for agents, chat, channels, logs, settings, and fleet control.
- Fleet deployment, telemetry, command execution, and public guide documentation.
