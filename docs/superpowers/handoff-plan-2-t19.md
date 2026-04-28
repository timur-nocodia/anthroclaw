# Plan 2 — Handoff (для /compact, после T19)

**Дата:** 2026-04-28
**Сессия:** прервана для compact на границе T19 → T20
**Предыдущий handoff:** `docs/superpowers/handoff-plan-2.md` (после T2)

## Project state

**Repo:** `/Users/tyess/dev/openclaw-agents-sdk-clone` (anthroclaw — gateway на `@anthropic-ai/claude-agent-sdk`).

**Жёсткое ограничение проекта:** все LLM-вызовы строго через `query()` SDK. Никаких `@anthropic-ai/sdk` (raw) или `messages.create()` — иначе риск бана подписки. В plugin'ах единственный канал — `ctx.runSubagent()`.

**Имя проекта** — `anthroclaw` (см. package.json в корне). Не путать с OpenClaw.

## Plan 2 текущий прогресс — 19/28 done ✅

**Worktree:** `/Users/tyess/dev/openclaw-agents-sdk-clone/.worktrees/lcm-core` на ветке `feat/lcm-core`.

**Завершённые tasks (с тестовыми коммитами):**

| # | Task | Tests | Last commit | Notes |
|---|------|-------|-------------|-------|
| T1 | scaffolding | — | `8fa0e0b` | manifest + package + types-shim |
| T2 | SQLite schema + bootstrap | 15 | `0d88dbe` | versioned migrations + FTS5 triggers |
| T3 | tokens.ts | 7 | `6413283` | tiktoken + char-fallback |
| T4 | store.ts MessageStore | 41 | `ef9f97b` | immutable append-only + FTS5 + LIKE-fallback |
| T5 | dag.ts SummaryDAG | 30 | `e8c7515` | recursive CTE + lossless drill-down + helpers extract |
| T6 | lifecycle.ts | 18 | `1b536a6` | frontier + debt + atomic recordReset |
| T7 | search-query.ts | 31 | `3009259` | parseFtsQuery + computeDirectnessScore + escapeLike new shape |
| T8 | escalation.ts | 26 | `0c5c42f` | L1→L2→L3 + sanitizeThinkingBlocks |
| T9 | engine.ts LCMEngine | 22 | `b34b555` | compress (leaf+condensation) + assemble |
| T10 | hooks/mirror.ts | 12 | `7e4c367` | on_after_query handler |
| T11 | tools/grep.ts | 15 | `63d6ad3` | lcm_grep MCP tool |
| T12 | tools/{describe,status}.ts | 18 | `82d7f19` | + `store.totalTokensInSession` helper |
| T13 | config.ts | 35 | `907f978` | LCMConfigSchema + resolveConfig |
| T14 | tools/expand.ts | 13 | `acba716` | lcm_expand MCP tool |
| T15 | tools/expand-query.ts | 15 | `344592e` | lcm_expand_query (RAG via runSubagent) |
| T16 | tools/doctor.ts | 15 | `25c5d0c` | health check + double-gated cleanup |
| T17 | extraction.ts | 19 | `5a9f386` | pre-compaction extraction (opt-in) |
| T18 | externalize.ts | 17 | `251e48f` | large-output → JSON (opt-in) |
| T19 | register() entry | 10 | `c8b0106` | wires everything |

**Stats:** Plugin tests **360/360 passing**, gateway baseline **975/975** (zero regressions across 19 tasks). Все ревью прошли (full chain: implementer + spec + quality + fix iterations при необходимости).

## Pending: T20-T28 (9 tasks)

**Высокий риск / меняют core:**
- **T20** anthroclaw `src/session/compressor.ts` (+ `src/gateway.ts` likely) — ContextEngine.compress delegation
- **T21** anthroclaw `src/gateway.ts` — wire ContextEngine.assemble call
- **T23** @lossless drill-down test (**CRITICAL invariant** — gates Plan 2 acceptance)
- **T24** Plan 1 amendment — agentId в MCP tool ctx (рефакторинг plugin framework)
- **T25** @e2e gateway + LCM integration test

**Меньший риск:**
- **T22** `plugins/lcm/skills/lcm-usage.md`
- **T26** contract test (no `@anthropic-ai/sdk` в `plugins/lcm/`)
- **T27** sanity smoke (Gateway boot with LCM enabled)
- **T28** `docs/guide.md` (Plugin Framework + LCM sections)

## Ключевые файлы для подсматривания

- **План:** `docs/superpowers/plans/2026-04-28-lcm-core.md` — все 28 tasks. T20+ начинаются на строке ~1922.
- **Спека:** `docs/superpowers/specs/2026-04-28-lcm-plugin-design.md`
- **Plan 1 план:** `docs/superpowers/plans/2026-04-28-plugin-framework.md`
- **Reference:** `reference-projects/hermes-lcm/` (gitignored, читать из main repo path).
- **Plugin code:** `.worktrees/lcm-core/plugins/lcm/src/` — все 19 модулей готовы.
- **Plugin tests:** `.worktrees/lcm-core/plugins/lcm/tests/` — 18 test files, 360 tests.
- **Existing plugin example:** `plugins/__example/` — для паттернов.

## User preferences (КРИТИЧНО)

- **Subagent-driven** execution с **full review chain** (implementer + spec reviewer + quality reviewer + fix iterations) **ЗА КАЖДОЙ task** (выбран Variant 1).
- **100% test coverage** обязательно.
- **Don't ask, just do** — не запрашивать подтверждения для рутинных шагов (memory `feedback_no_asking.md`).
- **Test before reporting** — тестировать самостоятельно перед сообщением о готовности (memory `feedback_test_before_reporting.md`).
- **Telegram formatting** при ответах в Telegram — bold `*text*`, italic `_text_`, code `` `code` `` (memory `telegramFormatting`).
- **Naming:** anthroclaw, не OpenClaw (memory `feedback_anthroclaw_naming.md`).

## Subagent dispatch pattern (проверенный)

Для каждой task:

1. `TaskUpdate` mark in_progress
2. **Dispatch implementer** (`subagent_type: general-purpose`, `model: sonnet` — Haiku для тривиальных) — даю **полный текст task + код примеров + tdd-шаги** в prompt-е (НЕ заставляю читать файл плана). Подсветить known design decisions.
3. **Dispatch spec reviewer** — verifies code matches spec. CRITICAL: do not trust report; read code with cite file:line.
4. **Dispatch quality reviewer** (`subagent_type: superpowers:code-reviewer`) — provides BASE_SHA + HEAD_SHA, asks task-specific quality questions. Combined spec+quality review acceptable for leaf tasks.
5. Если reviewer нашёл Important/Critical issues — dispatch fix subagent с конкретным списком правок.
6. `TaskUpdate` mark completed; move to next.

**Промпт-шаблоны:** `/Users/tyess/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/subagent-driven-development/`:
- `implementer-prompt.md`
- `spec-reviewer-prompt.md`
- `code-quality-reviewer-prompt.md`

## TaskCreate IDs (Plan 2)

- T1=24 ✅ ... T19=42 ✅
- T20=43 (next), T21=44, T22=45, T23=46 (LOSSLESS), T24=47, T25=48 (E2E)
- T26=49, T27=50, T28=51

## Recurring issues review caught (don't re-discover)

- **HookEvent typing in plugin shims** — discriminated union из `src/hooks/emitter.ts`, не `string`.
- **CompressResult.messages** (не `.assembled`).
- **AbortController в SDK Options** для timeout — без этого утечка subprocesses.
- **canUseTool: deny** должен **проверяться в тестах** runSubagent.
- **Migrations в транзакциях** через `db.transaction(migration)(db)`.
- **FTS update/delete triggers тестировать** — не только insert.
- **LIKE escape negative-case test** — обязательно asserts что `escapeLike` НЕ no-op.
- **`getMany` duplicate-id semantics** — JSDoc + test required.
- **`_searchLike` LIMIT pre-trim** должен быть детерминирован (`ORDER BY store_id DESC` перед LIMIT).
- **Recursive CTE cycle safety** — relies on `UNION` (не `UNION ALL`); JSDoc note required.
- **Tool name** в factory — `'grep'`, не `'lcm_grep'` (auto-namespacing).
- **`EngineMessage` not `SDKMessage`** — plugin decoupled от `@anthropic-ai/claude-agent-sdk`.
- **`LCMConfig` not `ResolvedLCMConfig`** — T13 vs T9 name collision; используем `LCMConfig` для T13's z.infer; T19 имеет `toEngineConfig` flatten.

## Архитектурные решения T19 (КРИТИЧНО для T20-T25)

**v0.1.0 known limitation:** В `plugins/lcm/src/index.ts` все 6 MCP tools зарегистрированы с deps от `'default'` агента (closure captures `_bootstrapState`). `getCurrentAgentId()` resolver обновляется через `setCurrentAgent()` при on_after_query / compress / assemble — но **сами `store`/`dag`/`lifecycle` объекты тулзов остаются от 'default' агента**.

**T24 должен это пофиксить:** plumb agentId через `PluginContext.registerMcpTool` или handler signature так, чтобы tools могли при invocation time переключаться на per-agent state. Это Plan 1 amendment — после T24 надо вернуться и обновить T19's tool registration в register().

**`toEngineConfig(c: LCMConfig): EngineConfig`** — в config.ts. Маппинг (для справки T20+):
- `leafChunkTokens` = `floor(triggers.compress_threshold_tokens / 16)` (default ~2500)
- `freshTailLength` ← `triggers.fresh_tail_count`
- `assemblyCapTokens` ← `triggers.assembly_cap_tokens`
- `l3TruncateChars` = `escalation.l3_truncate_tokens * 4` (token→char rough conversion)
- `l2BudgetRatio` ← `escalation.l2_budget_ratio`
- `condensationFanin` ← `dag.condensation_fanin`
- `dynamicLeafChunk` ← `summarizer.dynamic_leaf_chunk.enabled`
- `cacheFriendlyCondensation` ← `dag.cache_friendly_condensation.enabled`

## T20+ critical context

### T20: src/session/compressor.ts delegation

**Findpoint:** Real compression site is in `src/gateway.ts` (NOT `src/session/compressor.ts` which is a threshold helper). Search for `summaryPrompt`, places where session messages are sliced/replaced, or where `auto_compress` flag is honored.

**Pattern (from plan):**
```typescript
async function maybeCompressSession(agent, sessionKey, messages, currentTokens) {
  const lcm = this.pluginRegistry.getContextEngine(agent.id);
  if (lcm?.compress) {
    try {
      const result = await lcm.compress({ agentId, sessionKey, messages, currentTokens });
      if (result) return result.messages;
    } catch (err) { logger.warn(...); }
  }
  return legacyCompress(...);
}
```

**Tests:** With LCM disabled → legacy runs. With LCM returning result → bypass legacy. With LCM returning null → legacy. With LCM throwing → legacy (silent fallback).

### T21: src/gateway.ts assemble call

Find spot in gateway where prompt is assembled before `query()` invocation (search `query({` from `@anthropic-ai/claude-agent-sdk`). Insert `engineFacade.assemble()` call to transform messages before query.

### T23 (CRITICAL): @lossless drill-down test

End-to-end test that:
1. Inserts 200 messages
2. Runs compress (potentially multi-pass)
3. Finds all D{n} nodes at the highest depth
4. Calls `dag.collectLeafMessageIds` on each
5. Takes union of all results
6. Asserts union ⊇ all original NON-system NON-fresh-tail message store_ids

This is **THE gate** for Plan 2 acceptance. T9 tests verify this in unit form (test #18 in engine.test.ts); T23 makes it explicit / e2e.

### T25: @e2e gateway + LCM

Real gateway boot (or test harness) with LCM plugin enabled. Send conversation, trigger compression threshold, verify compressed messages flow through.

## Build/test verification commands

```bash
# From worktree root:
cd /Users/tyess/dev/openclaw-agents-sdk-clone/.worktrees/lcm-core

# Plugin build
pnpm --filter @anthroclaw/plugin-lcm build

# Plugin tests (current: 360 passing)
cd plugins/lcm && npx vitest run 2>&1 | tail -5

# Gateway tests (current: 975/975)
cd ../.. && pnpm -w test 2>&1 | tail -5
# (the -w flag is workspace-wide; without it pnpm test in worktree root targets the plugin)
```

## Tempo decision (re-confirmed Variant 1)

User explicitly выбрал **Variant 1 — Full review chain каждой task** в начале текущей сессии. T20-T28 продолжают в том же режиме unless user меняет решение в новой сессии.

## Quick recovery в новой сессии (для fresh-me)

1. Прочитать этот файл (`docs/superpowers/handoff-plan-2-t19.md`)
2. Прочитать первый handoff `docs/superpowers/handoff-plan-2.md` для базового контекста
3. `git log --oneline feat/lcm-core | head -25` (последние коммиты)
4. `cd .worktrees/lcm-core && git status -sb` (ожидается clean, на feat/lcm-core)
5. Прочитать Task 20 в плане: `docs/superpowers/plans/2026-04-28-lcm-core.md` (строка ~1922 и далее)
6. Подтвердить с пользователем продолжение Variant 1
7. Dispatch T20 implementer

## Финальное слово

19/28 — больше двух третей done. Плагин полностью самодостаточен (`plugins/lcm/`), все 6 tools работают, engine оркестрирует. Осталось: интеграция с gateway (T20+T21), CRITICAL lossless test (T23), Plan 1 amendment для proper per-agent tool resolution (T24), e2e (T25), и docs/contract (T22, T26-T28).

Качество высокое: 360 тестов, full review chain поймал ~6 реальных bug categories (HookEvent typing, FTS update tests, AbortController, canUseTool deny, migration tx, LIKE escape negative-case, hybrid determinism, getMany duplicates).

Лети, fresh-me. T23 — это main event. Don't break the lossless invariant.
