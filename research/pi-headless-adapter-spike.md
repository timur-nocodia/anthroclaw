# Pi headless adapter spike

Date: 2026-05-15

## Current package identity

Pi moved to the Earendil Works organization in May 2026. For new work, use:

- GitHub: https://github.com/earendil-works/pi
- npm package: `@earendil-works/pi-coding-agent`
- SDK docs: https://pi.dev/docs/latest/sdk
- RPC docs: https://pi.dev/docs/latest/rpc

The older `@mariozechner/*` package names appear in older docs and examples, but the current package scope is `@earendil-works/*`.

## Why Pi stays optional

AnthroClaw now carries `@earendil-works/pi-coding-agent` as an `optionalDependency` pinned at `0.74.0`. The Pi runtime is still opt-in: default production traffic remains on the Claude Agent SDK path unless config or CLI flags explicitly select `runtime.headless.provider: pi`.

Reasons:

- keep production install unchanged while the Claude Agent SDK migration stack is under review;
- prove the AnthroClaw-owned `HeadlessRuntime` contract without importing Pi package types across production modules;
- allow local experiments with injected Pi factories or a dynamic optional loader;
- make real smoke gates reproducible in a normal checkout while preserving a clear runtime opt-in boundary.

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
    pi:
      auth_path: /secure/pi-auth.json
      models_path: /secure/pi-models.json
```

`auth_path` and `models_path` are optional. They point at Pi-owned storage files and do not move credential material into AnthroClaw config; the default remains Pi's own storage location when these fields are omitted.

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

For the checkpoint/rewind path there is a stronger opt-in smoke probe:

```bash
pnpm smoke:pi-workspace -- --json --allow-skip
```

It creates a temporary workspace, asks Pi to edit `anthroclaw-pi-smoke.txt`, verifies `RuntimeRunHandle.rewindFiles()` dry-run, restores the file, and reports a structured `passed` / `failed` / `skipped` result. `--allow-skip` is intended for environments where the optional Pi package or auth is not installed yet; without it, missing Pi setup is a failure.

For the Gateway path there is an opt-in channel dispatch smoke probe:

```bash
pnpm smoke:pi-gateway -- --json --allow-skip
```

It starts a temporary Gateway with `runtime.headless.provider: pi`, creates a trusted Telegram-routed smoke agent, injects a real channel-shaped inbound message, auto-resolves the Write/Edit approval through `Gateway.handleApprovalCallback()`, verifies that `ApprovalBroker` observed at least one request, and checks that the agent workspace file was changed. In environments without the optional Pi package, `--allow-skip` returns a structured `skipped` result; in a Pi-configured environment this is the first smoke gate that exercises channel dispatch, Pi `RuntimeRunHandle`, AnthroClaw tool policy, approval routing, session mapping, and final channel delivery together.

For a decision-ready local run, use the aggregate smoke gate:

```bash
pnpm smoke:pi-all -- --json --allow-skip
```

It runs the auth/model preflight first, then the workspace probe, then the Gateway probe. `--model`, `--auth-path`, `--models-path`, and `--allow-skip` are forwarded to the auth preflight; `--model`, `--auth-path`, `--models-path`, `--timeout-ms`, `--keep-workspace`, and `--allow-skip` are forwarded to the runtime probes. The result is a single JSON envelope with top-level `status` and per-probe results. In a Pi-authenticated environment, run it without `--allow-skip`; any missing optional package/auth issue or runtime failure is then a hard failure.

The auth preflight can also be run directly:

```bash
pnpm smoke:pi-auth -- --model anthropic/claude-sonnet-4-6 --json
```

It checks that the optional Pi SDK package imports, the requested model exists in Pi's model registry, the provider has credentials configured through Pi auth storage or environment variables, and the requested model appears in Pi's available-model set. It does not print credential values.

The Pi runtime now uses Pi's default `AuthStorage` and `ModelRegistry` when a model id is present and no explicit registry was injected. AnthroClaw's legacy Claude model ids are normalized for this path, so `claude-sonnet-4-6` resolves as `anthropic/claude-sonnet-4-6`. Other bare model names still need explicit `provider/model` form. For isolated staging/CI runs, pass `--auth-path /secure/pi-auth.json --models-path /secure/pi-models.json` to `smoke:pi-auth`, `smoke:pi-workspace`, `smoke:pi-gateway`, or `smoke:pi-all`; the same values flow into Pi's default `AuthStorage.create()` and `ModelRegistry.create()`.

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

## Gateway custom-tool bridge

Pi's SDK exposes `customTools` through `defineTool()`, and its docs require custom tool names to be present in `tools` when an allow-list is supplied. The explicit Pi Gateway path now uses that shape for AnthroClaw-owned tools:

- `HeadlessRunInput.customTools` carries runtime-neutral tool definitions with `name`, `description`, `inputSchema`, and `handler`.
- The Pi adapter converts each custom tool to a Pi `defineTool({ name, label, description, parameters, execute })` definition when the optional SDK export is available, with a raw-definition fallback for injected tests/spikes.
- Gateway builds the same per-dispatch tool set for Claude and Pi, including channel-bound `send_message`, `send_media`, `manage_cron`, `connect_mcp`, plugin session binding, and Buildroom handoff/session-summary binding.
- Gateway filters Pi custom tools through the existing allowed-tool list and adds their local names to the Pi allow-list because Pi does not use Claude's `mcp__server__tool` naming convention for `customTools`.
- Policy checks map Pi custom tool calls back to AnthroClaw MCP-style names before calling `createCanUseTool()`, so safety profiles, `allowed_mcp_tools`, public-tool peer guards, and approval routing stay owned by AnthroClaw.
- The Pi adapter also rechecks policy inside a custom tool's `execute()` as a fail-closed fallback if a Pi `tool_call` extension event was not observed before execution. Tool-call decisions are cached by call id/shape so a normal Pi pre-execution event and `execute()` do not prompt the same approval twice.

This is the first production-shaped proof that Pi can host AnthroClaw tools without importing Mastra/LangChain-style orchestration.

## External MCP proxy bridge

The explicit Pi Gateway path now exposes configured `external_mcp_servers` through AnthroClaw-owned custom tools instead of handing Pi a separate MCP config:

- Gateway materializes `credential_ref` entries through the same `resolveExternalMcpHeaders()` helper used by the Claude SDK path.
- AnthroClaw lists each configured external MCP server's tools through `@modelcontextprotocol/sdk` and exposes only names present in that server's `allowed_tools`.
- Each exposed tool keeps the Claude-compatible name shape `mcp__<server>__<tool>`, so existing `buildAllowedTools()` and `createCanUseTool()` checks continue to govern visibility and execution.
- Tool execution creates a short-lived MCP client, calls the upstream tool, and converts MCP content/structured output into `HeadlessCustomToolResult` for Pi's `customTools` path.
- Stdio, Streamable HTTP, and legacy SSE transports are supported at the bridge layer. HTTP/SSE credential headers are resolved by AnthroClaw before the bridge is built.

This keeps MCP credentials, allowed-tool filtering, audit semantics, and reauth lifecycle on the AnthroClaw side. Pi receives ordinary custom tools and does not become the owner of external integrations.

## System prompt bridge

Pi does not take a direct `systemPrompt` option in the SDK examples. It uses `DefaultResourceLoader({ systemPromptOverride })`. The adapter now uses that mechanism when `HeadlessRunInput.systemPrompt` is present and no preconfigured resource loader blocks the override.

## Session control and checkpoint boundary

The explicit Pi Gateway path now participates in AnthroClaw's active-run control plane when the Pi adapter returns a `RuntimeRunHandle`:

- Channel dispatch registers Pi handles with `QueueManager`, so active Pi runs appear in `listActiveAgentRuns()` with run id, session key, and delivery target metadata.
- `interruptAgentRun()` and queue conflict modes can interrupt the Pi handle through the same `SdkControlRegistry` used by the Claude path.
- Pi runtime session ids are aliased back to AnthroClaw session keys as events arrive and after the run completes, so follow-up turns pass the prior Pi `sessionId` into the next run.
- When `sdk.enableFileCheckpointing` is enabled, Pi runs register a checkpoint-control handle and alias the final Pi session id. Pi handles now expose `rewindFiles()` through an AnthroClaw-owned workspace snapshot captured before the prompt mutates files. This is not a Pi session-tree primitive; it is a bounded explicit-cwd file restore fallback owned by AnthroClaw.

This gives production-shaped continuation and interrupt behavior without pretending that Pi's tree/session model is the same as Claude SDK file checkpoints. A future Pi-specific rewind bridge should be built against Pi's session tree or a vetted workspace-history extension.

## Next proof points

Before Pi can be considered beyond headless smoke tests, the spike still needs:

- caching/reuse strategy for external MCP discovery and long-lived MCP sessions if needed for performance;
- `pnpm smoke:pi-auth -- --model anthropic/claude-sonnet-4-6 --json` to pass in a Pi-authenticated environment;
- `pnpm smoke:pi-all -- --json` to pass after auth preflight, not only through the injected-runtime unit harness.
