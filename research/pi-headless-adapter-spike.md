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

## Next proof points

Before Pi can be considered beyond headless smoke tests, the spike still needs:

- a local opt-in CLI/config path that loads `@earendil-works/pi-coding-agent` and calls `runHeadlessReview({ runtime: 'pi' })`;
- a model resolver wired through Pi `ModelRegistry`;
- session continuation mapping from AnthroClaw session keys to Pi sessions;
- tool policy experiments for read/bash/edit/write;
- model-visible denial feedback for blocked tools;
- normalized event mapping for Gateway streaming UI.
