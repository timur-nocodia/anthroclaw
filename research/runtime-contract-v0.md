# Runtime contract v0

Date: 2026-05-15

## Purpose

This document turns the Agent SDK replacement work into a concrete acceptance contract. A candidate runtime is not production-capable because it can answer a prompt. It must also fit AnthroClaw's control plane: sessions, events, interrupts, checkpoint semantics, permissions, custom tools, external MCP proxying, and Gateway active-run control.

The source of truth for the machine-readable version is `src/runtime/contract.ts`. The tests in `src/runtime/__tests__/runtime-acceptance.test.ts` are the reusable adapter exam.

## Status semantics

- `pass`: implemented and covered by focused tests or by the existing production baseline.
- `partial`: a safe explicit behavior exists, but it does not yet provide full production parity.
- `fail`: no usable adapter behavior exists yet.
- `not-applicable`: the scenario does not apply to that candidate. This should be rare; most gaps should be `partial` or `fail`.

## Required scenarios

| Scenario | Category | Production requirement |
| --- | --- | --- |
| `headless_text_response` | headless | Non-interactive prompt returns non-empty assistant text and session metadata when available. |
| `session_continuation` | headless | `HeadlessRunInput.sessionId` continues an existing provider conversation. |
| `runtime_event_stream` | streaming | Candidate output normalizes into AnthroClaw `RuntimeEvent` values. |
| `interrupt_active_run` | control | `RuntimeRunHandle.interrupt()` reaches the provider abort primitive. |
| `timeout_abort` | control | Hung headless runs reject and abort provider work. |
| `checkpoint_rewind` | control | Runtime either rewinds through a provider primitive or returns explicit unsupported-runtime behavior. |
| `tool_policy_denial` | tools | AnthroClaw policy remains authoritative and denial is model-visible. |
| `custom_tool_execution` | tools | AnthroClaw-owned local tools can be exposed through the candidate harness. |
| `external_mcp_proxy` | tools | Configured external MCP tools are proxied through AnthroClaw-owned tool wrappers. |
| `gateway_active_run_control` | gateway | Gateway can register, interrupt, alias, and checkpoint-control the candidate runtime. |

## Candidate matrix

| Candidate | Pass | Partial | Fail | Contract score | Production blockers |
| --- | ---: | ---: | ---: | ---: | --- |
| Claude Agent SDK | 10 | 0 | 0 | 100% | none |
| Pi | 10 | 0 | 0 | 100% | none in the current contract |
| OpenCode | 6 | 0 | 4 | 60% | permission policy, custom tools, external MCP proxying, Gateway active-run path |

## Current read

Pi is still the stronger near-term migration track. It behaves like a composable harness: prompt, session continuation, runtime events, interrupt, timeout abort, checkpoint rewind, tool policy, custom tools, external MCP proxying, and opt-in Gateway active-run control are already represented behind AnthroClaw-owned boundaries. Checkpoint rewind is implemented as an AnthroClaw-owned workspace snapshot fallback for explicit-cwd Gateway runs, not as a Pi session-tree primitive.

OpenCode is useful as a benchmark and may be cleaner for checkpoint rewind because `session.revert` maps directly to `RuntimeRunHandle.rewindFiles()`. However, the current adapter is headless-only and does not yet carry AnthroClaw's permission, tool, external MCP, or Gateway control plane. It should not displace Pi unless those four gaps close with less complexity than adding Pi-native rewind.

## Gates

- Every new adapter must pass the shared acceptance harness before Gateway integration.
- Candidate-specific events must normalize to `RuntimeEvent` before Gateway sees them.
- Provider tool calls must be mediated by AnthroClaw policy before any production channel can use the candidate.
- Checkpoint rewind can be `partial` only if the unsupported behavior is explicit and control aliases remain intact.
- Production migration remains blocked until the chosen candidate has zero required `partial` or `fail` scenarios.

## Next implementation choices

1. Run `pnpm smoke:pi-workspace -- --json` and `pnpm smoke:pi-gateway -- --json` in an environment with the optional Pi runtime and auth configured.
2. Treat a real `smoke:pi-gateway` pass as the Pi-first decision checkpoint for channel dispatch, approval routing, and workspace mutation.
3. Build an OpenCode Gateway benchmark only if we want hard evidence that its server boundary can carry AnthroClaw permissions and tools cleanly.
4. Keep Claude as the production baseline until the selected candidate is green across the contract and has enough end-to-end smoke evidence.
