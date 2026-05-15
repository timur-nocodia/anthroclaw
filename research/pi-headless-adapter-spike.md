# Pi headless adapter spike

Date: 2026-05-15

## Current package identity

Pi moved to the Earendil Works organization in May 2026. For new work, use:

- GitHub: https://github.com/earendil-works/pi
- npm package: `@earendil-works/pi-coding-agent`
- SDK docs: https://pi.dev/docs/latest/sdk
- RPC docs: https://pi.dev/docs/latest/rpc

The older `@mariozechner/*` package names appear in older docs and examples, but the current package scope is `@earendil-works/*`.

## Why this PR keeps Pi optional

This spike deliberately does not add `@earendil-works/pi-coding-agent` to AnthroClaw dependencies yet.

Reasons:

- keep production install unchanged while the Claude Agent SDK migration stack is under review;
- prove the AnthroClaw-owned `HeadlessRuntime` contract before binding to Pi package types;
- allow local experiments with injected Pi factories or a dynamic optional loader;
- avoid candidate-specific package churn in the same PR as contract hardening.

## Adapter shape

`src/runtime/pi-headless.ts` implements a minimal `HeadlessRuntime`:

- creates a Pi `AgentSession` through an injected factory or optional dynamic import;
- subscribes to Pi session events;
- collects assistant `text_delta` events into a final text result;
- enforces headless `tools: []` by default;
- supports timeout by calling `session.abort()` and always unsubscribing/disposing;
- allows a caller-provided `resolveModel()` hook because Pi expects a model object, while AnthroClaw headless inputs currently carry model IDs as strings.

This is enough for a non-production headless probe. It is not yet a production runtime replacement.

## Explicit opt-in

The default headless runtime remains Claude Agent SDK. Pi is selected only when a caller explicitly asks for it:

```ts
await runHeadlessReview({
  prompt: 'Summarize this transcript.',
  runtime: 'pi',
  runtimeOptions: {
    pi: {
      // injected for tests, or omitted to use the optional dynamic loader
      createAgentSession,
    },
  },
});
```

This keeps production behavior stable while giving local spikes a real `HeadlessRuntime` path. The next production-facing step should be a config/CLI flag that builds these options intentionally, not an ambient runtime switch.

## Local config/CLI opt-in

Local smoke runs can now select Pi through `config.yml`:

```yaml
runtime:
  headless:
    provider: pi
```

The same path is available through the probe CLI:

```bash
pnpm headless:runtime -- --prompt "Summarize this transcript." --runtime pi
```

`--runtime` intentionally overrides config so an operator can force `claude-agent-sdk` while testing a Pi-enabled config. For continuation probes, the CLI can emit and accept runtime session metadata:

```bash
pnpm headless:runtime -- --prompt "Start." --runtime pi --json
pnpm headless:runtime -- --prompt "Continue." --runtime pi --session-id "<sessionId-from-json>" --json
```

The CLI is still a smoke probe: it runs the headless, tools-disabled review path only. It does not prove Gateway streaming, tools, approvals, or production session-key mapping.

## Headless session metadata

The Pi headless adapter now supports the minimum stateful contract:

- `HeadlessRunInput.sessionId` is passed into Pi session creation when present.
- `HeadlessRunResult.sessionId` is returned from Pi session metadata when exposed by the SDK/session object.
- `runHeadlessReview()` remains text-only for current callers.
- `runHeadlessReviewResult()` exposes `{ text, sessionId }` for smoke probes and future session mapping work.

## Model and tool policy bridge

The Pi headless adapter now has a narrow model/tool bridge:

- model ids in `provider/model` or `provider:model` format can resolve through a Pi `ModelRegistry`-like `{ find(provider, modelId) }` object;
- callers can still inject a custom `resolveModel()` for package-specific behavior;
- tools are denied by default with `noTools: "all"` and `tools: []`, because Pi enables built-in tools when no tool option is provided;
- `runtimeDefaults.allowedTools` is intentionally ignored by Pi unless a Pi-specific `toolPolicy` is explicitly provided;
- `HeadlessRunInput.toolPolicy` can now override the constructor policy for a single run, which lets Gateway pass per-dispatch policy instead of mutating a process-global Pi runtime;
- explicit `toolPolicy: { mode: "allow-list", tools: [...] }` maps AnthroClaw/Claude-style tool names such as `Read` and `Bash` to Pi names such as `read` and `bash`.
- explicit `toolPolicy.canUseTool` installs a Pi `tool_call` extension that returns `{ block: true, reason }` for denied calls, preserving model-visible denial feedback instead of silently disabling the harness guard;
- when Pi is loaded dynamically, the adapter creates a `DefaultResourceLoader` with an inline policy extension; when a caller provides a resource loader, the adapter wraps `getExtensions()` and appends the same policy extension.

This proves the shape of the boundary and the Pi hook needed for blocked-tool feedback. Gateway now uses the same hook for built-in Pi tool approval, but MCP/custom AnthroClaw tool execution is still open.

## Gateway event mapping proof

Pi emits `AgentSession.subscribe()` events from `@earendil-works/pi-agent-core`:

- `agent_start` / `agent_end`;
- `message_update` with `assistantMessageEvent` values such as `text_delta`;
- `message_end` with finalized assistant messages and Pi usage fields (`input`, `output`, `cacheRead`, `cacheWrite`, `cost.total`);
- `tool_execution_start` / `tool_execution_update` / `tool_execution_end`.

`src/runtime/pi-events.ts` now maps those Pi-specific shapes into AnthroClaw `RuntimeEvent` values:

- `run.started` / `run.completed` / `run.failed`;
- `text.delta`;
- `message.completed`;
- `usage.updated`;
- `tool.call.started` / `tool.call.delta` / `tool.call.completed` / `tool.call.failed`;
- `raw` for unsupported Pi session events.

This is still a proof module, not a default Gateway runtime switch. Gateway now consumes `RuntimeEvent` for the existing Claude path's partial text, usage, and tool lifecycle handling, while Claude-only task/hook/prompt suggestion events remain on their existing raw extractors.

## Gateway headless bridge

Gateway can now run web and channel queries through Pi only when global config explicitly selects it:

```yaml
runtime:
  headless:
    provider: pi
```

This bridge reuses the existing `HeadlessRuntime` resolver and preserves the default Claude path. It proves:

- Gateway does not require Claude SDK readiness when Pi is explicitly selected;
- prompts, model, cwd, and prior runtime session ids are passed into the Pi headless adapter;
- returned Pi `sessionId` values are mapped back into AnthroClaw session keys;
- channel and Web UI dispatch can return Pi text and record run/session metrics.

It is intentionally not yet the production Pi agent loop. The first bridge did not provide Gateway streaming, interrupts, checkpoint rewind, task/hook/prompt-suggestion events, tool progress bubbles, or production permission-broker execution for Pi tools.

## Gateway RuntimeRunHandle bridge

Pi now has a `RuntimeRunHandle` implementation over `AgentSession.subscribe()`:

- session events are normalized through `normalizePiRuntimeEvents()`;
- the handle exposes async iteration, `interrupt()`, `close()`, timeout abort, and cleanup;
- `message_end` assistant text is emitted as a `text.delta` fallback when Pi does not stream text deltas;
- Gateway's explicit Pi path consumes the handle when available and falls back to the older headless `run()` path for tests/older injected runtimes;
- Web UI receives Pi partial text, tool lifecycle callbacks, usage totals, and session ids from normalized events;
- channel dispatch aggregates Pi text deltas, records usage/tool metrics, and maps returned session ids to AnthroClaw session keys.

This proves the Gateway-facing stream shape. The current bridge still does not execute MCP/custom AnthroClaw tools, but built-in Pi tool calls can now be guarded by AnthroClaw's per-run policy bridge.

## Gateway permission-broker bridge

The explicit Gateway Pi path now builds a per-run `HeadlessToolPolicy` from AnthroClaw's existing permission stack:

- `buildAllowedTools(agent, false)` provides the allowed tool names for the Pi allow-list;
- Pi tool names such as `write`, `edit`, `bash`, and `read` are mapped back to AnthroClaw names such as `Write`, `Edit`, `Bash`, and `Read` before policy evaluation;
- `createCanUseTool()` remains the authoritative decision point for safety profile checks, public `send_message` peer binding, and interactive approval;
- channel dispatch passes the current channel plus `{ peerId, senderId, accountId, threadId }`, so `ApprovalBroker.resolveBySender()` preserves the same sender-authenticated approval semantics as the Claude SDK path;
- web dispatch passes a non-interactive `web-user` context, so approval-required tools fail closed unless a future Web UI approval channel is added;
- dangerous Bash and protected read/write path checks now live in `createCanUseTool()` as well as the Claude SDK pre-tool hook, so Pi does not lose that hard-deny layer.

This is production-relevant for Pi's built-in read/write/edit/bash-style tools, but it is not full production parity yet. Pi still needs an AnthroClaw tool execution bridge for local MCP tools, plugin tools, external MCP tools, and dynamic per-dispatch tool context such as `send_message`, `send_media`, `manage_cron`, and `connect_mcp`.

## Next proof points

Before Pi can be considered beyond headless smoke tests, the spike still needs:

- production session continuation mapping from AnthroClaw session keys to Pi sessions;
- MCP/custom AnthroClaw tool execution on Pi, including dynamic per-dispatch tool context;
- system prompt wiring in Pi session options;
- production-grade interrupt/checkpoint behavior for Pi-backed active sessions.
