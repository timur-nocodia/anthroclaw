# System-prompt resolution — Implementation Plan

> **For agentic workers:** Use sub-driven workflow per task — implementer (TDD), controller verification, spec reviewer, quality reviewer, fix-pass, re-review.

**Goal:** All `safety_profile`s deliver the agent's authored CLAUDE.md to the SDK system prompt; `@-imports` are resolved recursively with cycle detection. Closes pre-existing pre-v0.8 bug (root cause of Amina hallucinations).

**Spec:** [`docs/superpowers/specs/2026-05-05-system-prompt-resolution-design.md`](../specs/2026-05-05-system-prompt-resolution-design.md). Read before any task.

**Tech stack:** TypeScript (Node ≥22), vitest, `node:fs`, `node:path`, `@anthropic-ai/claude-agent-sdk`.

**Branch / worktree:** `/Users/tyess/dev/anthroclaw-v0.9-system-prompt` on branch `feat/v0.9-system-prompt-fix`, base `main` at commit `aa7d9a0`.

---

## Conventions

- ESM `.js` import suffixes throughout
- Tests under `<dir>/__tests__/<name>.test.ts`
- Vitest 4 — `npx vitest run <path>` for single tests
- Conventional commits — `feat(prompt): ...`, `fix(prompt): ...`, `test(prompt): ...`
- Each task = TDD: failing test first, then impl, then green
- Each task ends with controller diff verification + spec/quality review

## File map (target)

```
src/sdk/
├── system-prompt.ts                            # NEW — resolveImports, loadResolvedAgentClaudeMd, composeSystemPrompt
├── options.ts                                  # MODIFIED — call composeSystemPrompt; remove inlined resolveChatSystemPrompt
└── __tests__/
    ├── system-prompt-resolver.test.ts          # NEW — @-import resolver tests
    ├── system-prompt-composer.test.ts          # NEW — profile-aware composition tests
    └── options.test.ts                         # MODIFIED — assertions for all 4 profiles
```

## Pre-flight

- [ ] **0.1** Confirm worktree pristine: `git status` clean on `feat/v0.9-system-prompt-fix`.
- [ ] **0.2** Confirm baseline tests green: `pnpm test` reports 1771/1771 passing.
- [ ] **0.3** Resolve open question #1 from spec: `trusted` profile uses `preset` mode → both `trusted` and `private` use `append`. Update spec test #22 accordingly. **DECISION: yes, both preset profiles use `append`.**

## Task 1 — Resolver core (`resolveImports`)

Pure function, no profile awareness, no SDK dependency. The lowest-level brick.

- [ ] **1.1** Create `src/sdk/system-prompt.ts` with stub:
  ```ts
  export function resolveImports(
    content: string,
    fromFile: string,
    opts: { workspaceRoot: string; maxDepth?: number },
  ): string { return content; }
  ```
- [ ] **1.2** Write failing tests in `src/sdk/__tests__/system-prompt-resolver.test.ts`:
  - 1 — content without `@-imports` returns input unchanged
  - 2 — single `@./X.md` import inlined
  - 3 — recursive A → B → C all inlined depth-first
  - 4 — cycle A → B → A: first A inlined, second dropped silently
  - 5 — diamond A → {B, C}, B → D, C → D: D inlined once (de-dupe)
  - 6 — depth > 5 terminates, deepest line dropped
  - 7 — missing `@./nonexistent.md` line preserved
  - 8 — path escape `@../../etc/passwd` line preserved
  - 9 — absolute `@/etc/passwd` line preserved
  - 10 — URL-like `@http://...` line preserved
  - 11 — symlink-escape (workspace/link → /tmp/outside) line preserved
  - 12 — file > 1 MB line preserved
  - 13 — whitespace variations (`  @./X.md  `, CRLF) → resolved
  - 14 — non-import lines mentioning `@` (`Use @username`, `# @./X.md`) preserved verbatim
  - 15 — empty imported file → `@<path>` replaced with empty string
  - Each test creates an isolated tmp workspace via `mkdtempSync` + `path.join(os.tmpdir(), 'system-prompt-test-')`. Cleanup in `afterEach`.
- [ ] **1.3** Implement `resolveImports`:
  - Regex `^[ \t]*@(\S+)[ \t]*$`
  - For each line: if not import, push to output as-is; if import, resolve through path-policy, recurse if valid
  - Path policy helper `validateImportPath(path, fromFile, workspaceRoot)` returns `{ ok: true, abs } | { ok: false, reason: 'absolute'|'url'|'escape' }`
  - Use `fs.realpathSync.native` after `fs.existsSync` to detect symlink escapes
  - Cap individual file size at 1 MB via `fs.statSync(path).size`
  - Track `visited: Set<string>` (realpath'd absolute) — pass through recursion
  - Default `maxDepth = 5`
  - Logger calls per spec ("Logging" section): warn for escape/absolute/url/oversize/depth, info for missing/cycle, debug for successful resolution
- [ ] **1.4** Run tests: `npx vitest run src/sdk/__tests__/system-prompt-resolver.test.ts` — all green.
- [ ] **1.5** Controller (parent agent) diff verification: `git diff` reviewed before commit. Spec reviewer + quality reviewer dispatched.
- [ ] **1.6** Commit: `feat(prompt): @-import resolver with cycle detection and path-policy`

## Task 2 — `loadResolvedAgentClaudeMd` helper

Thin wrapper that reads the agent's CLAUDE.md and runs the resolver.

- [ ] **2.1** Add to `src/sdk/system-prompt.ts`:
  ```ts
  export function loadResolvedAgentClaudeMd(opts: {
    workspaceRoot: string;
    maxDepth?: number;
  }): string;
  ```
- [ ] **2.2** Failing tests in same `system-prompt-resolver.test.ts`:
  - 16 — workspace without CLAUDE.md → returns empty string
  - 17 — CLAUDE.md plain text → returns trimmed
  - 18 — CLAUDE.md with `@-imports` → resolved content returned (integration with task 1)
  - 19 — CLAUDE.md unreadable (permission denied) → returns empty string, logs warn
- [ ] **2.3** Implement helper:
  - Build path = `join(workspaceRoot, 'CLAUDE.md')`
  - If not exists → return `''`
  - Try-catch readFileSync → on error log warn and return `''`
  - Pass to `resolveImports(content, claudeMdPath, { workspaceRoot, maxDepth })`
  - Trim trailing whitespace before return
- [ ] **2.4** Tests green.
- [ ] **2.5** Controller diff verification + reviewers.
- [ ] **2.6** Commit: `feat(prompt): loadResolvedAgentClaudeMd reads agent CLAUDE.md with import resolution`

## Task 3 — `composeSystemPrompt` profile-aware composer

This is the function that replaces today's `resolveChatSystemPrompt` and the inline `if (profile.name === 'chat_like_openclaw') ... else ...` block in `options.ts`.

- [ ] **3.1** Add to `src/sdk/system-prompt.ts`:
  ```ts
  export function composeSystemPrompt(
    agent: Agent,
    profile: SafetyProfile,
  ): Options['systemPrompt'];
  ```
- [ ] **3.2** Failing tests in `src/sdk/__tests__/system-prompt-composer.test.ts`:
  - 17 — `chat_like_openclaw` + agent with CLAUDE.md → personality (CHAT_PERSONALITY_BASELINE) + separator + CLAUDE.md
  - 18 — `chat_like_openclaw` + no CLAUDE.md → personality only
  - 19 — `chat_like_openclaw` + agent.config.personality set → custom personality + separator + CLAUDE.md
  - 20 — `public` + CLAUDE.md → public.text + separator + CLAUDE.md
  - 21 — `public` + no CLAUDE.md → public.text only
  - 22 — `trusted` + CLAUDE.md → `{ type: 'preset', preset: 'claude_code', excludeDynamicSections: true, append: CLAUDE.md }`
  - 23 — `trusted` + no CLAUDE.md → `{ type: 'preset', preset: 'claude_code', excludeDynamicSections: true }` (no `append`)
  - 24 — `private` + CLAUDE.md → `{ type: 'preset', preset: 'claude_code', excludeDynamicSections: false, append: CLAUDE.md }`
  - 25 — `private` + no CLAUDE.md → `{ type: 'preset', preset: 'claude_code', excludeDynamicSections: false }`
  - 26 — `chat_like_openclaw` + CLAUDE.md with `@./X.md` import → resolved content present in result (integration)
  - 27 — `public` + CLAUDE.md with `@./X.md` import → resolved content present (integration)
- [ ] **3.3** Implement composer per spec "Composer" section. Mock `Agent` and `SafetyProfile` shapes minimally — use existing `publicProfile`, `trustedProfile`, `privateProfile`, `chatLikeOpenclawProfile` for realism.
- [ ] **3.4** Tests green.
- [ ] **3.5** Controller diff verification + reviewers.
- [ ] **3.6** Commit: `feat(prompt): composeSystemPrompt — profile-aware system prompt with agent CLAUDE.md`

## Task 4 — Wire `composeSystemPrompt` into `options.ts`

Replace the inlined logic; delete the now-redundant `resolveChatSystemPrompt`.

- [ ] **4.1** Failing tests in `src/sdk/__tests__/options.test.ts` (modify or extend if exists, otherwise create):
  - 28 — `buildSdkOptions(agent)` for `chat_like_openclaw` agent with CLAUDE.md → `options.systemPrompt` is string containing personality + CLAUDE.md
  - 29 — `buildSdkOptions(agent)` for `public` agent with CLAUDE.md → `options.systemPrompt` is string containing public.text + CLAUDE.md
  - 30 — `buildSdkOptions(agent)` for `trusted` agent with CLAUDE.md → `options.systemPrompt` is `{ type: 'preset', preset: 'claude_code', excludeDynamicSections: true, append: <CLAUDE.md> }`
  - 31 — `buildSdkOptions(agent)` for `private` agent with CLAUDE.md → `options.systemPrompt` is `{ type: 'preset', ..., excludeDynamicSections: false, append: <CLAUDE.md> }`
  - 32 — Backward compat: `chat_like_openclaw` agent with plain text CLAUDE.md (no imports) on byte level → identical to v0.8.0 output (snapshot or string equality)
- [ ] **4.2** Refactor `src/sdk/options.ts`:
  - Remove `resolveChatSystemPrompt` function (lines 47-65)
  - Replace lines 91-102 with single call: `const systemPrompt = composeSystemPrompt(agent, profile);`
  - Remove now-unused imports (`readFileSync`, `existsSync`, `join`, `CHAT_PERSONALITY_BASELINE`)
- [ ] **4.3** Run full SDK test suite: `npx vitest run src/sdk/`. All tests green including pre-existing.
- [ ] **4.4** Run full project test suite: `pnpm test`. 1771 + new tests all green.
- [ ] **4.5** Controller diff verification + reviewers.
- [ ] **4.6** Commit: `refactor(sdk): composeSystemPrompt replaces inline profile/CLAUDE.md branching`

## Task 5 — End-to-end smoke fixture

A test fixture that creates real-shaped agents on disk (workspace dir, `agent.yml`, `CLAUDE.md` with `@-imports`, side files) and asserts the SDK options contain expected resolved content for each profile.

- [ ] **5.1** Failing test in `src/sdk/__tests__/system-prompt-e2e.test.ts`:
  - Setup: tmp dir with subdirs `agent_chat`, `agent_public`, `agent_trusted`, `agent_private`. Each has CLAUDE.md = `@./SOUL.md\n@./IDENTITY.md`, plus SOUL.md and IDENTITY.md with stub content.
  - For each agent, instantiate `Agent` (or a minimal mock that satisfies `composeSystemPrompt`), call `buildSdkOptions`, verify `systemPrompt` includes both SOUL.md and IDENTITY.md content. For preset profiles, the content is in `append`.
- [ ] **5.2** Implement test using existing test scaffolding patterns (look at `src/sdk/__tests__/cutoff.test.ts` for fixture style).
- [ ] **5.3** Tests green.
- [ ] **5.4** Controller + reviewers.
- [ ] **5.5** Commit: `test(prompt): e2e fixture covers all 4 profiles with real @-imports`

## Task 6 — CHANGELOG + spec docs

- [ ] **6.1** Add unreleased section in `CHANGELOG.md`:
  ```
  ## [Unreleased]
  ### Fixed
  - **System prompt resolution**: `@-imports` (e.g. `@./SOUL.md`) in agent CLAUDE.md are now resolved recursively before being passed to the SDK. Previously these were sent as literal text and ignored by the model. Cycle detection, max depth = 5, path-policy rejects absolute / URL / workspace-escape paths.
  - **Non-chat safety profiles read agent CLAUDE.md**: `safety_profile: public | trusted | private` agents now include their authored CLAUDE.md in the system prompt. Previously only `chat_like_openclaw` did.
  ### Behaviour change
  - Agents under `public/trusted/private` profiles will start receiving their own CLAUDE.md content. Operators must verify that any CLAUDE.md does not contain credentials or developer-only notes that shouldn't reach customer-facing dialogues.
  ```
- [ ] **6.2** Update `agents/agent_template/CLAUDE.md` (or whichever template exists) with a comment noting `@-imports` are now supported across all profiles.
- [ ] **6.3** Commit: `docs(prompt): CHANGELOG + template note for system prompt resolution`

## Task 7 — Manual verification (local)

- [ ] **7.1** `pnpm test` — full suite green, ≥ 1771 + new tests.
- [ ] **7.2** `pnpm build` — TypeScript compile clean.
- [ ] **7.3** Spin up a local agent under each profile with a CLAUDE.md containing `@./X.md`. Run `pnpm dev` briefly, send a message, assert in logs that the system prompt body matches expectations (or use `LOG_LEVEL=debug` to see resolver output).
- [ ] **7.4** Commit nothing (verification only). Note results in PR description.

## Task 8 — PR

- [ ] **8.1** Push branch, open PR titled `v0.9 — system prompt resolution (#72 + #73)`.
- [ ] **8.2** PR body: link spec + plan, summarise behaviour change for non-chat profiles, list which prod hotfixes will be reverted in a follow-up.
- [ ] **8.3** Tag review per workflow note in handoff doc.

## Task 9 — Post-merge prod follow-up (separate session)

After this PR merges and is deployed, a follow-up commit reverts the prod hotfixes:

- [ ] **9.1** `agents/leads_agent/agent.yml` — `safety_profile: public` (was `chat_like_openclaw` hotfix).
- [ ] **9.2** `agents/leads_agent/CLAUDE.md` — restore `@-imports` form from `CLAUDE.md.bak-imports-only-1777911469`.
- [ ] **9.3** `agents/timur_agent/CLAUDE.md` — restore `@-imports` from `.bak-imports-1777911551`.
- [ ] **9.4** `agents/content_sm_building/CLAUDE.md` — restore `@-imports` from `.bak-imports-1777911551`.
- [ ] **9.5** Deploy + verify each agent still receives the right body (resolver does the work now).
- [ ] **9.6** Update `project_pre_v080_profile_systemprompt_bug.md` memory: mark `RESOLVED in v0.9.0`.

---

## Definition of done

- All tests in plan green; full suite ≥ 1771 + new tests, no regressions.
- All 4 profiles include agent CLAUDE.md content (or `append` equivalent).
- `@-imports` resolved with cycle detection, max depth, path-policy.
- CHANGELOG entry shipped.
- PR opened and reviewed.
- Plan task 9 (prod hotfix revert) tracked separately, executed post-deploy.
