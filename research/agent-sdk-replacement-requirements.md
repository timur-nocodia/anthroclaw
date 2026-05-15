# Claude Agent SDK replacement research

Date: 2026-05-15

Scope: AnthroClaw clone in the current worktree.

## Executive summary

`@anthropic-ai/claude-agent-sdk` is not just a model transport in this codebase. It is the execution kernel behind agent turns, session resume, streaming UI, tool permissions, MCP, subagents, hooks, checkpoints, and several internal headless workflows. Replacing it safely means first introducing an AnthroClaw-owned runtime adapter contract, then implementing candidates behind that contract.

The immediate reason to move is valid: Anthropic now says that starting 2026-06-15, Claude Agent SDK and `claude -p` usage no longer spends normal Claude subscription limits and instead uses a separate Agent SDK credit pool. After that credit, the value proposition moves toward metered/token economics rather than the previous subscription arbitrage.

Best candidate classes:

1. **OpenCode**: best feature parity as an open-source Claude Code-like harness. It already has sessions, server SDK, events, permissions, MCP, subagents, LSP, built-in coding tools, and provider neutrality. Main cost: it is a whole product/server, so integration likely means wrapping/forking its server instead of importing a small runtime.
2. **Pi**: best modifiable minimal harness. It has a clean embedded SDK, provider flexibility, sessions, event hooks, extensions, and a small code-agent loop. Main cost: AnthroClaw must rebuild MCP, approval semantics, subagent orchestration, and some safety boundaries.
3. **GitHub Copilot SDK**: closest proprietary SDK shape to Claude Agent SDK. It has permissions, hooks, MCP, custom agents/subagents, sessions, skills, events, steering, and queueing. Main cost: GitHub/Copilot lock-in, public-preview risk, and less control over the runtime core.
4. **OpenAI Agents JS**: strongest general official SDK foundation and good long-term adapter target. It has tools, MCP, sessions, HITL, tracing, handoffs/agents-as-tools, and sandbox agents. Main cost: it is not a Claude Code/OpenCode-style harness out of the box, so AnthroClaw would rebuild more of the code-agent UX and policy layer.

Recommendation: do not pick one replacement before building the runtime boundary. Add a `RuntimeAdapter` layer around the current Claude SDK first, then run two spikes: OpenCode server-adapter and Pi embedded-adapter. Keep Copilot SDK as a high-parity vendor-backed fallback and OpenAI Agents JS as the strategic provider-neutral SDK track.

## Current Claude SDK dependency surface

The current code uses Claude Agent SDK in these roles:

### 1. Run loop and streaming

`src/gateway.ts` imports `query`, `startup`, `Query`, and SDK event types directly. Gateway logic builds SDK options, starts a query or warm query, streams events to Web UI/channel callbacks, interrupts runs, tracks active SDK sessions, records usage, and runs post-query workflows.

Critical coupled behaviors:

- async event iteration from SDK `query()`
- partial text extraction
- tool use/tool result event extraction
- task/subagent lifecycle extraction
- `Query.interrupt()`
- resume ID persistence per AnthroClaw session key
- prompt suggestions and progress summaries
- usage and cost reporting

### 2. Options and capability declaration

`src/sdk/options.ts` builds native Claude `Options`:

- model, effort, thinking, max turns, max budget, fallback model
- `cwd` bound to the agent workspace
- system prompt composition
- local SDK MCP server and external MCP servers
- subagent definitions
- `SessionStore`
- `onElicitation`
- permissions mode, `allowedTools`, `disallowedTools`, `canUseTool`
- hook bridge
- sandbox settings
- file checkpointing

The replacement must expose a comparable run configuration, or AnthroClaw must own the missing fields in an adapter layer.

### 3. Tools and MCP

`src/agent/agent.ts` builds built-in tools with Claude SDK `tool()` wrappers and exposes them through `createSdkMcpServer()`. Per-dispatch tools are rebuilt to capture channel/session context, especially `send_message`, `send_media`, `manage_cron`, `connect_mcp`, and Buildroom tools.

AnthroClaw relies on tool context being dynamic per inbound message. A replacement cannot assume a static process-global tool list.

### 4. Permission and safety policy

`src/sdk/permissions.ts` combines several policy layers:

- default Claude Code built-ins (`Read`, `Write`, `Edit`, `Bash`, `WebFetch`, `WebSearch`, etc.)
- local MCP tools and external MCP tools
- profile hard blacklist
- safety profile allow/approval requirements
- per-agent `allowed_mcp_tools`
- channel approval flow through `ApprovalBroker`
- channel-specific constraints such as public `send_message`
- protected path checks
- dangerous Bash pattern denial
- file ownership checks for subagents

`src/sdk/cutoff.ts` adds a capability boundary that applies even in trusted bypass:

- clears SDK setting sources
- clears extra directories
- scrubs provider and channel secrets from env
- forces `cwd` to the agent workspace
- gates tools to declared capabilities
- blocks cross-agent workspace access

This is not optional. Any replacement must support a deterministic pre-tool gate, async human approval, environment scrubbing, workspace isolation, and argument rewrite/denial.

### 5. Sessions and durability

`src/sdk/session-store.ts` implements Claude SDK `SessionStore` over JSONL files. Gateway maps product session keys to SDK session IDs and resumes SDK sessions. Several subsystems use SDK sessions directly:

- chat/Web UI sessions
- cron and heartbeat runs
- session recall summarization
- title generation
- memory extraction and compaction
- headless review/plugin subagent runner

The replacement must support durable transcript, resume/fork/compact, active run status, crash recovery, and enough history introspection for session search and UI.

### 6. Hooks and observability

`src/sdk/hooks.ts` maps SDK hook events into the AnthroClaw hook emitter:

- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PermissionRequest`
- `Elicitation`
- `Notification`
- `SubagentStart`
- `SubagentStop`

Plugins and UI code observe these events. The new runtime must emit a stable AnthroClaw event schema independent of the underlying SDK.

### 7. Subagents

Current subagent support depends on Claude SDK `agents`, the `Task` tool, subagent lifecycle events, and extra AnthroClaw policy in `src/sdk/subagent-policy.ts`, `src/sdk/subagent-registry.ts`, `src/sdk/file-ownership.ts`, and `src/sdk/subagent-mcp.ts`.

The replacement must support either:

- native subagent sessions with lifecycle events, or
- AnthroClaw-owned subagent orchestration implemented as tools over the same runtime adapter.

Do not rely on opaque model-driven delegation unless AnthroClaw can enforce tool scope, write ownership, and nesting limits.

## Replacement runtime requirements

### Runtime API

The adapter should expose:

```ts
interface AgentRuntimeAdapter {
  id: string;
  capabilities(): RuntimeCapabilities;
  createSession(input: RuntimeCreateSessionInput): Promise<RuntimeSession>;
  resumeSession(input: RuntimeResumeSessionInput): Promise<RuntimeSession>;
  run(input: RuntimeRunInput): AsyncIterable<RuntimeEvent>;
  interrupt(input: RuntimeInterruptInput): Promise<void>;
  approve(input: RuntimeApprovalInput): Promise<void>;
  compact?(input: RuntimeCompactInput): Promise<RuntimeCompactResult>;
  checkpoint?(input: RuntimeCheckpointInput): Promise<RuntimeCheckpointResult>;
}
```

This layer must hide Claude/OpenCode/Pi/Copilot/OpenAI-specific IDs and event names from Gateway code.

### Runtime events

Minimum normalized event types:

- `run.started`
- `run.completed`
- `run.failed`
- `text.delta`
- `message.completed`
- `tool.call.started`
- `tool.call.delta`
- `tool.call.completed`
- `tool.call.failed`
- `approval.requested`
- `approval.resolved`
- `elicitation.requested`
- `subagent.started`
- `subagent.completed`
- `subagent.failed`
- `checkpoint.created`
- `usage.updated`
- `notification`

Every event needs `runtime`, `runId`, `sessionId`, `agentId`, `source`, monotonic timestamp, and raw-provider payload kept behind a debug flag.

### Tool system

The adapter must support:

- JSON Schema/Zod-like tool schemas
- dynamic per-dispatch tool context
- tool progress and metadata
- local tools
- local stdio MCP
- remote HTTP/SSE MCP
- per-tool allow/deny/ask policy
- tool result attachments/media where possible
- tool name normalization to avoid provider-specific prefixes leaking through the rest of AnthroClaw

### Permissions

AnthroClaw should own the authoritative permission decision, not delegate it entirely to a candidate framework.

Required:

- deterministic pre-tool check
- async approval with channel delivery and timeout
- once/always/reject semantics
- rejection feedback to model
- argument rewriting before execution where supported
- final denial reason persisted for audit
- env/cwd boundary enforcement
- file path boundary checks
- cross-agent write conflict policy
- capability cutoff independent of "trusted" permission mode

### Sessions and state

Required:

- product session key to runtime session ID mapping
- durable message log
- active run status
- resume after process restart
- fork or branch where supported
- compaction and compaction failure handling
- session title generation
- session search/read-only recall mode
- per-session model override
- usage/cost aggregation

If candidate session storage is opaque, AnthroClaw still needs an independent mirror transcript.

### Context and memory

Required:

- first-turn context assembly from channel, memory, references, media, and plugin context engines
- provenance for injected context
- plugin hook compatibility
- memory extraction after runs
- LCM/context engine continuation
- safe headless runs with all tools denied

### Subagents

Required:

- explicit subagent registry
- per-subagent role/prompt/tool policy
- explorer/worker/custom classes
- nested subagent limit
- file ownership and conflict reporting
- lifecycle stream for UI
- bounded final summaries back to parent

### Operational surface

Required:

- health/preflight for runtime and MCP servers
- active run list
- runtime version reporting
- event logs and trace IDs
- user-visible model/provider list
- auth redaction
- failure categories: model error, tool error, approval timeout, runtime busy, session missing, permission denied

## Candidate evaluation

### OpenCode

Sources reviewed:

- local clone `/tmp/anthroclaw-agent-research/opencode`, commit `1c7c033 2026-05-15`
- OpenCode README
- OpenCode SDK docs: https://opencode.ai/docs/sdk/
- OpenCode agents/permissions docs: https://opencode.ai/docs/agents/
- OpenCode server docs: https://dev.opencode.ai/docs/server/

What it provides:

- open-source Claude Code-like coding harness
- provider-agnostic model layer
- built-in tools: bash, read, write, edit, apply_patch, grep, glob, LSP, todo, webfetch, websearch, skills, question
- primary agents and subagents
- per-agent permissions with `ask`/`allow`/`deny`
- pattern permissions for bash/file/tool names
- MCP local and remote support
- headless server with OpenAPI spec
- JS/TS SDK generated from server API
- SSE event stream
- session create/list/messages/fork/abort/revert/permissions
- server/client architecture designed for multiple clients
- plugin hooks such as `permission.ask`, `tool.execute.before`, `tool.execute.after`, session compaction hooks

Local benchmark adapter status:

- Draft PR #59 adds an optional AnthroClaw `HeadlessRuntime` adapter for OpenCode.
- The adapter uses an injected OpenCode client or dynamically imports `@opencode-ai/sdk`, so OpenCode remains an experimental dependency instead of a required install.
- It maps AnthroClaw `HeadlessRunInput.sessionId` to OpenCode `session.prompt({ path: { id } })` and creates a session through `session.create()` when no id is present.
- It emits a minimal benchmark `RuntimeRunHandle` with normalized text and completion events.
- It maps interrupts to OpenCode `session.abort()` and checkpoint rewind calls to `session.revert()` when the client supports that API.
- Draft PR #60 adds OpenCode to the shared runtime acceptance contract. Current contract status is 6 pass, 0 partial, 4 fail: OpenCode passes headless text, session continuation, minimal event streaming, interrupt, timeout abort, and checkpoint rewind shape; it fails AnthroClaw permission policy, custom tools, external MCP proxying, and Gateway active-run integration.

Fit to AnthroClaw:

- Strongest feature parity among open-source candidates.
- Best replacement if AnthroClaw wants a complete open-source code-agent kernel, not just an LLM loop.
- Its client/server architecture maps well to AnthroClaw Gateway as a control plane: AnthroClaw can run an OpenCode server per workspace/tenant or embed its server runtime.

Gaps and costs:

- Not a small library. Integration as a package means accepting its server/database/config model or forking internal packages.
- Permission model is close but not identical. AnthroClaw still needs its own capability cutoff, env scrub, protected path policy, channel approvals, and public `send_message` constraints.
- Subagent behavior exists but must be constrained to AnthroClaw's explorer/worker/file-ownership semantics.
- Tool naming and MCP prefixes need translation.
- Session storage/revert semantics need mapping to current UI and `SdkSessionService`.
- Existing AnthroClaw plugin hooks do not map 1:1 to OpenCode plugin hooks.

Estimated migration cost:

- Adapter proof-of-concept: 1-2 weeks.
- Usable single-agent runtime for Web UI + one channel: 3-5 weeks.
- Full parity with cron, heartbeat, plugins, MCP onboarding, subagents, checkpoints, and operator UI: 8-14 weeks.

Verdict:

High-priority spike. It is likely the closest open-source substitute for the Claude Code/Claude Agent SDK harness, but the integration must be treated as a runtime bridge or strategic fork.

### Pi

Sources reviewed:

- local clone `/tmp/anthroclaw-agent-research/pi`, commit `a8af0b5 2026-05-15`
- Pi GitHub README: https://github.com/earendil-works/pi
- Pi site/docs: https://pi.dev/
- Pi provider docs: https://pi.dev/docs/latest/providers
- Pi quickstart: https://pi.dev/docs/latest/quickstart

What it provides:

- minimal terminal coding harness
- package-level SDK via `createAgentSession()`
- agent core with tool calling and state management
- event subscription from `AgentSession`
- extension runner with hooks around context, provider requests, turns, messages, tool calls, and tool results
- default tools: read, write, edit, bash
- sessions stored as tree/branch history
- steering and follow-up behavior
- compaction and retry behavior
- provider layer with subscription OAuth and API-key providers
- ChatGPT Plus/Pro, GitHub Copilot, and Claude Pro/Max auth support, though Pi docs now note Claude subscription harness use is billed from extra usage rather than plan limits

Local spike adapter status:

- Draft PRs #45-#58 build Pi from optional headless prompt into an opt-in Gateway runtime path with streamed `RuntimeEvent` values, AnthroClaw permission broker integration, custom local tools, external MCP proxying, active-run interrupts, and checkpoint-control alias preservation.
- Draft PR #60 adds Pi to the shared runtime acceptance contract. Current contract status is 9 pass, 1 partial, 0 fail: Pi passes every required scenario except true provider-backed checkpoint/file rewind, which remains explicit unsupported-runtime behavior.

Fit to AnthroClaw:

- Best candidate if AnthroClaw wants to own the policy/control plane and use a small hackable code-agent loop underneath.
- Embedded SDK is much easier to wrap than a whole server.
- Extension hooks are a reasonable place to insert AnthroClaw context, permission gates, telemetry, and tool transforms.
- Provider flexibility is valuable for escaping single-vendor dependency.

Gaps and costs:

- Pi intentionally skips built-in subagents and plan mode as product defaults.
- No native MCP surface in the minimal core; AnthroClaw must expose MCP through extensions/tools or build an MCP bridge.
- No built-in AnthroClaw-like approval popup model; approvals must be implemented through hooks and tool wrappers.
- Default four-tool model is too small for current AnthroClaw parity.
- Session tree differs from current SDK session mapping and UI expectations.
- Security model must be mostly AnthroClaw-owned.

Estimated migration cost:

- Adapter proof-of-concept: 4-7 days.
- Usable single-agent runtime for local tools + channel approvals: 3-4 weeks.
- MCP, plugin, cron/heartbeat, subagent parity: 8-12 weeks.

Verdict:

High-priority spike. Pi is the best modifiable core. It is less complete than OpenCode, but probably easier to bend into an AnthroClaw-native harness without inheriting another full product.

### GitHub Copilot SDK

Sources reviewed:

- local clone `/tmp/anthroclaw-agent-research/copilot-sdk`, commit `0159731 2026-05-14`
- GitHub Copilot SDK docs: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk
- MCP docs: https://docs.github.com/copilot/how-tos/copilot-sdk/use-copilot-sdk/mcp-servers
- session persistence docs: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/session-persistence
- custom agents/subagents docs: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/custom-agents

What it provides:

- programmatic SDK over GitHub Copilot CLI/runtime
- sessions with event handlers
- `send`, `sendAndWait`, abort, resume/list/delete
- required `onPermissionRequest`
- user input and elicitation hooks
- pre/post tool hooks
- custom local tools and commands
- MCP stdio/http servers
- custom agents and automatic subagent delegation
- skill directories and instruction directories
- streaming events
- infinite sessions/background compaction
- BYOK/provider options in session config

Fit to AnthroClaw:

- Closest SDK surface to what AnthroClaw currently expects.
- Permission, hooks, MCP, skills, custom agents, and sessions map directly to many current concepts.
- Could be the quickest path to a working non-Anthropic runtime if Copilot subscription economics are acceptable.

Gaps and costs:

- Public preview; APIs and availability can change.
- Depends on GitHub Copilot CLI/runtime and Copilot auth.
- Less appropriate if the goal is a self-owned, deeply modifiable harness core.
- Opaque internal run loop compared with OpenCode/Pi.
- Must validate license/terms/quota behavior for AnthroClaw use before committing.
- Custom agent delegation is runtime-selected; AnthroClaw must verify it can enforce deterministic subagent policy.

Estimated migration cost:

- Adapter proof-of-concept: 4-7 days.
- Usable single-agent runtime: 2-4 weeks.
- Full parity: 6-10 weeks, assuming preview APIs remain stable.

Verdict:

Strong fallback if GitHub dependency is acceptable. Not ideal as the strategic core because the runtime remains vendor-owned.

### OpenAI Agents JS

Sources reviewed:

- local clone `/tmp/anthroclaw-agent-research/openai-agents-js`, commit `629d35a 2026-05-14`
- OpenAI Agents JS repo: https://github.com/openai/openai-agents-js
- OpenAI Agents SDK docs: https://openai.github.io/openai-agents-js/
- OpenAI Agents SDK guide: https://developers.openai.com/api/docs/guides/agents
- HITL docs: https://openai.github.io/openai-agents-js/guides/human-in-the-loop/
- MCP docs: https://openai.github.io/openai-agents-js/guides/mcp/
- tools docs: https://openai.github.io/openai-agents-js/guides/tools/

What it provides:

- TypeScript-first official SDK
- built-in agent loop
- function tools with Zod/schema validation
- hosted tools and local built-in execution tools
- local/remote MCP integration
- human-in-the-loop interruptions and resumable `RunState`
- sessions
- tracing
- guardrails
- handoffs and agents-as-tools
- sandbox agents with workspace filesystem, shell, patching, snapshots, and state
- provider-agnostic core packages

Fit to AnthroClaw:

- Good long-term foundation for an AnthroClaw-owned runtime adapter.
- HITL and MCP are conceptually aligned with AnthroClaw approvals and external tools.
- Sandbox agents are directly relevant to code-agent workspaces.
- Strong official support and active development.

Gaps and costs:

- Not a drop-in coding harness comparable to Claude Code. It is a framework for building agents.
- AnthroClaw must implement most code-agent prompt/tool UX itself.
- Sandbox agent features are newer/beta in JS and need reliability verification.
- Subscription advantage is not the main value; expect metered API economics unless using another model provider through lower-level packages.
- Existing Claude SDK-specific events, prompt suggestions, checkpointing semantics, and subagent events need reimplementation or mapping.

Estimated migration cost:

- Adapter proof-of-concept: 1-2 weeks.
- Usable single-agent runtime: 4-6 weeks.
- Full parity: 10-16 weeks.

Verdict:

Strategic candidate, but not the fastest parity path. Best if the goal is an explicit AnthroClaw-owned agent framework with official SDK primitives underneath.

## Broader second-pass scan

These candidates were checked after the first deep pass. They should not all get the same treatment: some are plausible runtime cores, others are useful reference implementations, and some are poor fits because they are IDE products or pair-programming tools rather than embeddable harnesses.

### OpenAI Codex CLI / Codex App Server

Sources reviewed:

- Codex CLI repo: https://github.com/openai/codex
- OpenAI App Server architecture post: https://openai.com/index/unlocking-the-codex-harness/
- OpenAI Agents SDK harness update: https://openai.com/index/the-next-evolution-of-the-agents-sdk/

Why it matters:

- OpenAI explicitly describes Codex as a shared harness behind CLI, IDE, web, and desktop surfaces.
- The App Server exists because OpenAI needed to reuse the same agent loop outside the TUI.
- It is highly relevant to AnthroClaw because AnthroClaw currently needs exactly that shape: a non-UI runtime surface around a coding agent loop.

Potential fit:

- Very high if the App Server/protocol surface is stable and externally usable.
- The Codex CLI direction overlaps heavily with the requirements here: sandboxing, approvals, MCP, filesystem tools, shell execution, progress streaming, skills/AGENTS.md, and multi-surface sessions.

Main concerns:

- It is OpenAI-owned and tied to Codex/ChatGPT/OpenAI account economics.
- The public stable embedding story must be verified in code, not assumed from product posts.
- If the App Server is still semi-internal/unstable, adopting it as AnthroClaw's core creates the same strategic problem as Claude Agent SDK, just with a different vendor.

Action:

- Add to the spike list, but behind OpenCode/Pi unless the App Server exposes a clean supported protocol for third-party products.

### Goose

Sources reviewed:

- Goose repo: https://github.com/aaif-goose/goose
- Goose docs/extensions: https://block.github.io/goose/docs/getting-started/using-extensions

What it provides:

- open-source local AI agent with desktop app, CLI, and API
- Rust implementation
- provider support across Anthropic, OpenAI, Google, Ollama, OpenRouter, Azure, Bedrock, and others
- MCP extensions
- positioned as broader than code: workflows, automation, research, data analysis
- now under the Agentic AI Foundation at the Linux Foundation

Fit:

- Serious second-tier candidate. It may be closer to AnthroClaw's "general automation control plane" than pure coding agents.
- The API surface and extension model need deeper inspection.

Concerns:

- It is broad and product-shaped, like OpenCode, so integration may mean wrapping a full app/server rather than importing a small core.
- Need verify permission granularity, session resume semantics, approval model, and whether subagent-like delegation is first-class.

Action:

- Worth a code-level spike after OpenCode/Pi if AnthroClaw wants a general automation runtime rather than a code-first runtime.

### Crush

Sources reviewed:

- Crush repo: https://github.com/charmbracelet/crush

What it provides:

- terminal coding agent in Go
- multi-model/provider support
- session-based project contexts
- LSP-enhanced context
- MCP over http/stdio/sse
- permission prompts by default
- configurable allowed/disabled tools
- project initialization into `AGENTS.md`-style context

Fit:

- Good reference implementation for a local coding-agent UX.
- Potentially useful if AnthroClaw wants a Go-based harness component or a simpler alternative to OpenCode.

Concerns:

- Need verify embeddable API/server surface. README reads primarily as a CLI/TUI product.
- Permission model appears simpler than AnthroClaw's safety/capability cutoff.
- No obvious evidence yet of AnthroClaw-grade subagent/session/control-plane APIs.

Action:

- Keep as reference/possible tertiary spike, not short-list until API surface is confirmed.

### Gemini CLI

Sources reviewed:

- Gemini CLI repo: https://github.com/google-gemini/gemini-cli
- Gemini CLI sandbox docs: https://google-gemini.github.io/gemini-cli/docs/cli/sandbox.html
- Gemini CLI configuration docs: https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md

What it provides:

- open-source terminal agent
- Google Search grounding
- file operations, shell commands, web fetching
- MCP support
- sandbox mode and approval modes
- very favorable free-tier/subscription story for Gemini usage

Fit:

- Relevant as a provider/runtime option, especially for cost pressure.
- Less compelling as the main AnthroClaw harness core unless its internal API is cleanly embeddable.

Concerns:

- Gemini/model coupling is stronger than Pi/OpenCode.
- Need verify event stream, durable sessions, programmatic approval, and subagent support.
- Tool-use quality and portability must be evaluated with AnthroClaw-specific tasks.

Action:

- Good candidate for provider/runtime experimentation, not first-choice core replacement.

### Aider

Sources reviewed:

- Aider repo: https://github.com/Aider-AI/aider

What it provides:

- mature terminal pair-programming tool
- strong repo-map approach
- multi-model support
- git integration, auto commits, lint/test loops

Fit:

- Useful reference for codebase context and edit workflows.
- Poor fit as a Claude Agent SDK replacement because it is more pair-programming/edit-loop oriented than a general agent harness with MCP, channel approvals, subagents, and AnthroClaw-style runtime events.

Action:

- Study repo-map and edit/test loop ideas; do not prioritize as runtime core.

### Cline / Roo Code

Sources reviewed:

- Cline/Roo public descriptions and docs surfaced in search

What they provide:

- mature IDE-agent patterns
- Plan/Act-style UX
- MCP usage
- explicit approval gates for file writes and terminal commands
- custom modes/agents

Fit:

- Useful reference for UX and approval ergonomics.
- Poor fit as runtime core because they are primarily editor extensions, not standalone embeddable harness kernels for AnthroClaw Gateway.

Action:

- Mine for approval UX and mode design only.

### OpenHands / SWE-agent style systems

Not deeply inspected in this pass.

Likely fit:

- Useful for evaluation, sandboxing, and autonomous coding research.
- Usually too platform/evaluation-oriented to replace Claude Agent SDK inside a messaging-first AnthroClaw runtime.

Action:

- Keep in a third-pass research bucket if the project moves toward cloud/devcontainer task execution rather than local always-on assistant runtime.

## Updated short-list

After the broader scan, the short-list changes slightly:

1. **OpenCode** remains the strongest open-source parity candidate.
2. **Pi** remains the strongest modifiable embedded core.
3. **OpenAI Codex CLI/App Server** should be added as a serious spike because it may expose exactly the reusable harness surface AnthroClaw needs.
4. **Copilot SDK** remains the fastest vendor-backed SDK fallback.
5. **Goose** becomes a second-tier candidate worth deeper inspection, especially for general automation beyond code.
6. **OpenAI Agents JS** remains strategic, but overlaps with Codex/Agents SDK evolution and may be better consumed through the newer sandbox/harness primitives.

The rest are reference material, not current replacement targets.

## Candidates intentionally not prioritized

### Mastra, LangChain, LangGraph-like frameworks

They are useful general orchestration frameworks, but they do not directly replace the code-agent harness surface AnthroClaw currently gets from Claude Agent SDK: filesystem tools, terminal execution semantics, per-tool approvals, coding sessions, subagent workspaces, and CLI-like event streams.

### Pure model clients

OpenAI/Anthropic/Gemini raw API clients only solve model transport. They do not solve tool loop, sessions, approval interruption, checkpoints, subagents, context compaction, or code workspace semantics.

### Generic "agent platforms"

Hosted agent products should be treated as separate deployment products, not harness replacements, unless they expose a local/runtime SDK that can enforce AnthroClaw policy.

## Proposed migration architecture

### Phase 0: isolate Claude SDK behind a runtime contract

Add:

- `src/runtime/types.ts`
- `src/runtime/events.ts`
- `src/runtime/permissions.ts`
- `src/runtime/adapters/claude-agent-sdk.ts`

Goal: no behavioral change. Gateway still uses Claude, but imports only AnthroClaw runtime interfaces.

Acceptance:

- Web UI run works.
- Telegram/WhatsApp run works.
- tool approval works.
- MCP tool works.
- session resume works.
- subagent lifecycle still appears.
- current tests pass.

### Phase 1: move headless workflows first

Move these to `RuntimeAdapter` before user-facing runs:

- title generation
- memory extraction
- session recall summarization
- headless plugin review
- forced compaction

Reason: these have simpler event needs and are easier to compare across runtimes.

### Phase 2: single-agent adapter spike

Build two proof-of-concepts:

1. **OpenCode adapter**
   - start/connect OpenCode server
   - create session
   - send prompt
   - subscribe SSE events
   - map text/tool/permission events
   - approve/reject permissions from AnthroClaw channel
   - abort active run

2. **Pi adapter**
   - create embedded `AgentSession`
   - register AnthroClaw tool wrappers
   - subscribe to events
   - implement pre-tool approval via extension hook
   - map session tree ID to AnthroClaw session key
   - abort/steer where possible

Choose based on concrete event parity, not README claims.

### Phase 3: MCP and plugin parity

Implement:

- local MCP server bridge
- external MCP credential resolution
- MCP preflight
- plugin tool registration
- context engine injection
- hook emission compatibility

### Phase 4: subagents and ownership

Implement:

- explorer/worker/custom subagent registry
- file ownership claims
- conflict detection
- lifecycle events
- bounded summaries
- nested delegation limit

If the underlying runtime does not provide deterministic subagent control, implement subagents as explicit AnthroClaw tools that start separate runtime sessions.

### Phase 5: dual-runtime canary

Add per-agent config:

```yaml
runtime:
  provider: claude-agent-sdk | opencode | pi | copilot-sdk | openai-agents
  model: ...
  experimental: true
```

Run canaries on non-critical agents first. Keep Claude adapter until acceptance tests pass and user sessions can be migrated or explicitly reset.

## Acceptance test suite

Minimum tests before a runtime can replace Claude SDK:

1. Basic chat answer streams partial text.
2. Tool call emits started/completed events.
3. `read` can read inside workspace.
4. Protected read path is denied.
5. Write outside workspace is denied.
6. Dangerous Bash command is denied.
7. Bash safe command can be approved once.
8. "Always allow" persists only within intended scope.
9. Public `send_message` can only send to originating peer.
10. External MCP tool appears only after preflight/auth success.
11. MCP tool denial does not leak raw secrets.
12. Session resumes with correct context.
13. Session title generation works with tools denied.
14. Memory extraction works with tools constrained to memory write only.
15. Cron synthetic turn returns no unsolicited reply when contract says silent.
16. Heartbeat ack handling still works.
17. Queue `collect`, `steer`, and `interrupt` modes work.
18. Subagent explorer cannot write files.
19. Subagent worker cannot overwrite another worker's claimed file.
20. Usage/cost metrics are recorded.
21. Runtime crash leaves a recoverable session state.
22. Env scrub prevents provider/channel secrets from entering tool process.

## Decision matrix

| Candidate | Harness parity | Modifiability | Vendor risk | Integration speed | Strategic value |
| --- | --- | --- | --- | --- | --- |
| OpenCode | Very high | Medium-high via fork/server | Low-medium | Medium | High |
| Pi | Medium | Very high | Low | Medium-fast | High |
| Copilot SDK | Very high | Low-medium | High | Fast | Medium |
| OpenAI Agents JS | Medium | High | Medium | Slow-medium | High |

## Recommended next decision

The Phase 0 boundary and both Pi/OpenCode spikes now have enough code-level evidence to stop treating this as a README comparison.

Use this tie-breaker:

- choose **Pi** if the AnthroClaw team wants maximum control and accepts closing the remaining checkpoint/file rewind gap;
- choose **OpenCode** only if its Gateway benchmark can close AnthroClaw permission policy, custom tools, external MCP proxying, and active-run integration with less complexity than Pi rewind;
- choose **Copilot SDK** only if GitHub subscription/runtime dependency is acceptable as a product bet;
- choose **OpenAI Agents JS** if the strategic priority is a clean AnthroClaw-owned SDK architecture over fastest migration.

My current preference: **continue Pi-first**. Pi is the cleaner long-term core and now has better AnthroClaw-owned control-plane parity in this codebase. OpenCode remains the stronger parity benchmark and should be kept honest through the shared runtime acceptance harness.

## Source notes

Primary/current sources used:

- Anthropic Help Center on Agent SDK plan credits: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
- OpenCode SDK docs: https://opencode.ai/docs/sdk/
- OpenCode agents/permissions docs: https://opencode.ai/docs/agents/
- OpenCode server docs: https://dev.opencode.ai/docs/server/
- OpenCode GitHub repo: https://github.com/opencode-ai/opencode
- Pi GitHub repo: https://github.com/earendil-works/pi
- Pi provider docs: https://pi.dev/docs/latest/providers
- Pi quickstart: https://pi.dev/docs/latest/quickstart
- GitHub Copilot SDK docs: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk
- GitHub Copilot SDK MCP docs: https://docs.github.com/copilot/how-tos/copilot-sdk/use-copilot-sdk/mcp-servers
- GitHub Copilot SDK custom agents docs: https://docs.github.com/en/copilot/how-tos/copilot-sdk/use-copilot-sdk/custom-agents
- OpenAI Agents JS repo: https://github.com/openai/openai-agents-js
- OpenAI Agents JS docs: https://openai.github.io/openai-agents-js/
- OpenAI Agents SDK guide: https://developers.openai.com/api/docs/guides/agents
- OpenAI Agents HITL docs: https://openai.github.io/openai-agents-js/guides/human-in-the-loop/
- OpenAI Agents MCP docs: https://openai.github.io/openai-agents-js/guides/mcp/
