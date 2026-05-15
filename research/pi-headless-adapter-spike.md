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
- explicit `toolPolicy: { mode: "allow-list", tools: [...] }` maps AnthroClaw/Claude-style tool names such as `Read` and `Bash` to Pi names such as `read` and `bash`.
- explicit `toolPolicy.canUseTool` installs a Pi `tool_call` extension that returns `{ block: true, reason }` for denied calls, preserving model-visible denial feedback instead of silently disabling the harness guard;
- when Pi is loaded dynamically, the adapter creates a `DefaultResourceLoader` with an inline policy extension; when a caller provides a resource loader, the adapter wraps `getExtensions()` and appends the same policy extension.

This proves the shape of the boundary and the Pi hook needed for blocked-tool feedback. It still does not run Pi tools through AnthroClaw's production permission broker.

## Next proof points

Before Pi can be considered beyond headless smoke tests, the spike still needs:

- production session continuation mapping from AnthroClaw session keys to Pi sessions;
- production permission-broker mapping for read/bash/edit/write approvals;
- normalized event mapping for Gateway streaming UI.
