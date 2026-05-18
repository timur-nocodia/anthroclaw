# UI Pi Runtime Control Plane migration checklist

Status: draft implementation scope
Owner intent: remove Agent SDK-native UX as the primary path and rebuild the UI around Runtime v1 + Pi.

## Goal

The UI must stop presenting AnthroClaw as a Claude Agent SDK control panel. The primary operator surface should expose:

- Runtime v1 harness status.
- Pi as the effective default runtime provider.
- Runtime auth/model readiness.
- Agent-level effective runtime selection.
- Side-effect gate registry and dry-run planning.
- Fleet expansion packet progress.
- Legacy Claude Agent SDK only as a quarantined compatibility/diagnostics surface.

This plan is intentionally broader than a rename. The source of truth must move from Claude-native concepts to AnthroClaw-owned runtime contracts.

## Non-goals

- Do not remove backend Claude Agent SDK compatibility code in this UI phase.
- Do not run live side effects from the UI until a separate explicit approval flow is designed and tested.
- Do not mark fleet expansion packets closed from UI dry-runs alone.
- Do not hardcode named-agent migration flows into UI components or API routes.

## Current UI Coupling Map

### Claude auth surface

- `ui/components/settings/ClaudeAuthPanel.tsx`
  - User-facing copy says "Claude subscription auth", "Connect Claude subscription", "Claude runtime".
  - Calls `/api/fleet/:serverId/claude-auth/*`.
  - Models a Claude OAuth/login lifecycle, not a generic runtime credential lifecycle.
- `ui/lib/claude-auth.ts`
  - Starts `claude auth login --claudeai`.
  - Reads Claude runtime home and `.claude/.credentials.json`.
  - Verifies with a Claude CLI query.
- `ui/app/api/claude-auth/*`
  - Local Claude auth API.
- Fleet proxy exposes matching `/api/fleet/:serverId/claude-auth/*`.

### Anthropic-only model selection

- `ui/lib/anthropic-models.ts`
  - Hardcoded Claude model list.
- `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`
  - Imports `ANTHROPIC_MODELS as MODELS`.
  - Presents model selection as if Claude is the only first-class runtime family.
- `ui/components/plugins/JsonSchemaForm.tsx`
  - Uses the same Anthropic model list for plugin config schema model fields.

### Runtime settings copy and contract shape

- `ui/app/(dashboard)/fleet/[serverId]/settings/page.tsx`
  - Imports and renders `ClaudeAuthPanel`.
  - `GatewayInfo.runtimeDefaults.headlessProvider` still allows `"claude-agent-sdk" | "pi" | "opencode"`.
  - Advanced section shows `sdkActiveInput`, "Native steer", and "SDK stream input".
- `ui/app/api/gateway/status/route.ts`
  - Returns `gw.getStatus()`.
- `src/gateway.ts#getStatus()`
  - Returns `runtimeDefaults.headlessProvider` and `sdkActiveInput`.
  - Does not expose a Pi readiness contract, side-effect gates, or expansion status.

### Runtime and gate primitives already available

- Runtime provider config:
  - `config.yml` / overlay: `runtime.headless.provider`, `runtime.headless.pi.auth_path`, `runtime.headless.pi.models_path`.
  - `src/config/schema.ts`.
- Pi headless runtime:
  - `src/runtime/pi-headless.ts`.
  - `src/runtime/headless-registry.ts`.
  - `src/sdk/headless-runtime-config.ts`.
- Side-effect gates:
  - `src/runtime/side-effect-gates/registry.ts`.
  - `runtime:pi-live-gate -- --list/--describe/--plan/--validate-args`.
- Expansion progress:
  - `src/cli/pi-expansion-status.ts`.
  - `research/pi-expansion-packets/*.md`.

## Target Information Architecture

### Primary navigation

- Add a first-class `Runtime` section under fleet server pages.
- Keep `Settings > General` for gateway-level config.
- Move Claude-native auth to `Settings > Legacy Runtime` or `Runtime > Legacy`, hidden behind "compatibility".

### Runtime page tabs

- `Overview`
  - Harness: `runtime-v1`.
  - Default provider: `pi`.
  - Provider readiness: package/auth/models.
  - Active agents by effective provider.
  - Recent auth/model/runtime errors.
- `Models/Auth`
  - Pi auth path and models path.
  - Model inventory and selected defaults.
  - Verify button for Pi runtime readiness.
  - No Claude OAuth as the primary call to action.
- `Gates`
  - Side-effect gate registry table.
  - Gate id, title, capability group, action, risk, approval mode, dry-run support.
  - `--plan` and `--validate-args` equivalent output.
  - Dry-run only execution can be added later; live execution remains disabled until explicit approval UX exists.
- `Expansion`
  - Fleet expansion progress, e.g. `66/70`.
  - Open evidence by kind.
  - Per-packet table: agent id, risk, ring, checked/open items, next action.
  - Policy state: normal/attention, allowed external-open kinds, violations.
- `Legacy`
  - Claude Agent SDK credential status and restart hooks.
  - Clear copy: compatibility/fallback only, not the primary runtime.

## Backend API Contract Checklist

### Phase 1 - Runtime status API

- [x] Add local API `GET /api/runtime/status`.
- [x] Add fleet proxy support through existing `/api/fleet/:serverId/...` path.
- [x] Return a provider-neutral shape:
  - [x] `harness.id = "runtime-v1"`.
  - [x] `defaultProvider`.
  - [x] `legacyProviders`.
  - [x] `pi.packageAvailable`.
  - [x] `pi.authPath`.
  - [x] `pi.authConfigured`.
  - [x] `pi.modelsPath`.
  - [x] `pi.modelsConfigured`.
  - [x] `pi.lastError`.
  - [x] `agents.total`.
  - [x] `agents.byEffectiveProvider`.
  - [x] `gateway.uptime`, `gateway.activeSessions`.
  - [x] `legacy.claudeAgentSdk.present`.
  - [x] `legacy.claudeAgentSdk.primary = false`.
- [x] Tests:
  - [x] Returns Pi default when config default is Pi.
  - [x] Reports missing Pi auth/models paths without throwing.
  - [x] Does not expose tokens or raw credential material.

### Phase 2 - Runtime gates API

- [x] Add `GET /api/runtime/gates`.
- [x] Source data from `SIDE_EFFECT_GATE_REGISTRY`, not a UI-side copy.
- [x] Return all registry metadata needed by the dashboard:
  - [x] id/title/summary/capabilityGroup.
  - [x] risk/action.
  - [x] focusedCommand.
  - [x] required/optional flags.
  - [x] approval mode and safety mode.
  - [x] example args.
- [x] Add `POST /api/runtime/gates/plan`.
- [x] Add `POST /api/runtime/gates/validate`.
- [x] Prefer shared library functions over shelling out to CLI.
- [x] Tests:
  - [x] Registry endpoint includes `controlled-live-turn`.
  - [x] No named-agent defaults in examples.
  - [x] Unknown gate returns a structured validation error.

### Phase 3 - Runtime expansion API

- [x] Add `GET /api/runtime/expansion-status`.
- [x] Use the same parser/classifier as `runtime:pi-expansion-status`.
- [x] Support query params:
  - [x] `openOnly`.
  - [x] `failOnOpen`.
  - [x] `allowExternalOpen`.
  - [x] repeated `agentsDir`.
  - [x] `packetsDir`.
- [x] Default to repo-local tracked agents and `research/pi-expansion-packets`.
- [x] Tests:
  - [x] Returns progress percent.
  - [x] Classifies open evidence kinds.
  - [x] Does not mutate packet files.
  - [x] Does not run any live side effect.

### Phase 4 - Runtime model registry API

- [ ] Replace `ui/lib/anthropic-models.ts` with `ui/lib/runtime-models.ts`.
- [ ] Add `GET /api/runtime/models`.
- [ ] Support model groups:
  - [ ] Pi configured models.
  - [ ] OpenCode models when provider is enabled.
  - [ ] Legacy Claude model list as compatibility only.
- [ ] Tests:
  - [ ] Agent config model selector can render non-Claude model ids.
  - [ ] Unknown current model remains selectable as a custom/current value.

## UI Component Checklist

### Phase 5 - Replace ClaudeAuthPanel primary usage

- [ ] Create `RuntimeAuthPanel`.
- [ ] Render Pi readiness and config paths.
- [ ] Remove "Claude subscription auth" from primary settings.
- [ ] Keep `ClaudeAuthPanel` only under `Legacy`.
- [ ] Rename component tests or add new tests:
  - [ ] Runtime panel calls `/api/fleet/:serverId/runtime/status`.
  - [ ] It renders Pi status and not Claude subscription copy.
  - [ ] Legacy panel still works when explicitly opened.

### Phase 6 - Runtime page

- [ ] Add `ui/app/(dashboard)/fleet/[serverId]/runtime/page.tsx`.
- [ ] Add sidebar link.
- [ ] Overview tab:
  - [ ] status chips for harness/provider/readiness.
  - [ ] agent provider distribution.
  - [ ] recent runtime errors if available.
- [ ] Gates tab:
  - [ ] gate registry table.
  - [ ] risk/approval badges.
  - [ ] plan drawer or detail panel.
- [ ] Expansion tab:
  - [ ] progress card.
  - [ ] open evidence table.
  - [ ] policy state.
  - [ ] packet links/paths.
- [ ] Legacy tab:
  - [ ] Claude auth compatibility panel.

### Phase 7 - Agent page runtime parity

- [ ] Show effective runtime provider on the agent header.
- [ ] Show global default vs per-agent override.
- [ ] Show model source.
- [ ] Show side-effect capability groups inferred from config:
  - [ ] messaging.
  - [ ] media.
  - [ ] cron/scheduled work.
  - [ ] notifications.
  - [ ] admin/config.
  - [ ] MCP onboarding/external MCP.
  - [ ] memory/session/search.
  - [ ] learning.
  - [ ] Buildroom.
- [ ] Replace Anthropic-only model dropdown with runtime model selector.

### Phase 8 - Settings Advanced cleanup

- [ ] Replace "Active input" SDK section with "Runtime execution controls".
- [ ] Move `sdkActiveInput` to legacy diagnostics.
- [ ] Show:
  - [ ] active run registry.
  - [ ] interrupt support.
  - [ ] checkpoint/rewind support.
  - [ ] tool policy gate.
  - [ ] side-effect gate harness.
  - [ ] fallback/rollback policy.

### Phase 9 - Fleet overview

- [ ] Add runtime health column/card.
- [ ] Show default provider and expansion progress per server.
- [ ] Link unhealthy runtime state to `Runtime` page.
- [ ] Keep fleet deploy/server health independent from provider branding.

## Legacy Quarantine Checklist

- [ ] Keep backend `claude-agent-sdk` code only behind runtime adapter/fallback boundaries.
- [ ] Rename UI tests so new primary tests do not assert Claude wording.
- [ ] Keep old `/api/claude-auth/*` temporarily.
- [ ] Add copy stating that Claude Agent SDK is a legacy compatibility provider.
- [ ] Add a later removal phase for:
  - [ ] `ui/lib/claude-auth.ts`.
  - [ ] `ui/lib/claude-auth-instance.ts`.
  - [ ] `ui/app/api/claude-auth/*`.
  - [ ] `@anthropic-ai/claude-agent-sdk` UI externals in `ui/next.config.ts`.

## Safety and Approval Requirements

- [ ] UI must not run live gates until a separate explicit approval design lands.
- [ ] Any future live action modal must show:
  - [ ] exact gate id.
  - [ ] exact agent id.
  - [ ] exact channel/account/peer/thread target.
  - [ ] expected effect count.
  - [ ] dry-run result.
  - [ ] post-action monitor command.
- [ ] Dry-run/plan/validate endpoints must be clearly labeled as no-live-side-effect.
- [ ] Secret values must stay masked in config and runtime status responses.

## Completion Definition

The UI migration is complete when:

- [ ] The primary settings/runtime UI has no Claude subscription or Agent SDK-native wording.
- [ ] Pi readiness is visible without reading CLI output.
- [ ] Runtime gates are visible from registry data in UI.
- [ ] Expansion packet progress is visible from UI.
- [ ] Agent pages show effective runtime and non-Claude model choices.
- [ ] Claude Agent SDK appears only under legacy compatibility diagnostics.
- [ ] API/component tests cover the new runtime status/gates/expansion contracts.
- [ ] Existing `pnpm build` and `pnpm test` pass.
