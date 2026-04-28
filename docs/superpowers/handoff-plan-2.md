# Plan 2 — Handoff (для /compact)

**Дата:** 2026-04-28
**Сессия:** прервана для compact на границе Task 2 → Task 3

## Project state

**Repo:** `/Users/tyess/dev/openclaw-agents-sdk-clone` (anthroclaw — gateway на `@anthropic-ai/claude-agent-sdk`).

**Жёсткое ограничение проекта:** все LLM-вызовы строго через `query()` SDK. Никаких `@anthropic-ai/sdk` (raw) или `messages.create()` — иначе риск бана подписки. В плагинах единственный канал — `ctx.runSubagent()`.

**Имя проекта** — `anthroclaw` (см. package.json). Не путать с OpenClaw — OpenClaw это вдохновитель/предшественник, директория названа исторически.

## Plan статус

- **Plan 1** (plugin framework) — ✅ DONE, merged to main, тег `plugin-framework-v0.1.0`. 975/975 tests baseline.
- **Plan 2** (LCM core port) — **в процессе**, ветка `feat/lcm-core`. T1+T2 завершены.
- **Plan 3** (UI integration) — позже, после Plan 2.

## Plan 2 текущий прогресс

**Worktree:** `/Users/tyess/dev/openclaw-agents-sdk-clone/.worktrees/lcm-core` на ветке `feat/lcm-core`.

**Завершённые tasks:**

- ✅ **T1** scaffolding — `plugins/lcm/` package + manifest + types-shim. Stub `register()`. Commit `d96e3b7` + fix `8fa0e0b` (HookEvent → discriminated union).
- ✅ **T2** SQLite schema + bootstrap — schema.sql, bootstrap.ts, 15 тестов. Commit `e43f66b` + fix `0d88dbe` (migration tx wrapping + FTS update/delete tests).

**В очереди (26 tasks):**

T3 tokens.ts → T4 store.ts → T5 dag.ts → T6 lifecycle.ts → T7 search-query.ts → T8 escalation.ts → T9 engine.ts → T10 hooks/mirror.ts → T11-T16 (6 тулзов) → T13 config.ts → T17-T18 optional features → T19 register() → T20-T21 anthroclaw integration → T22 skill md → T23 @lossless test (CRITICAL) → T24 Plan 1 amendment (agentId in tool ctx) → T25 @e2e → T26 contract → T27 sanity smoke → T28 docs/guide.md.

## Ключевые файлы для подсматривания

- **План:** `docs/superpowers/plans/2026-04-28-lcm-core.md` — все 28 tasks с tdd-шагами и кодом.
- **Спека:** `docs/superpowers/specs/2026-04-28-lcm-plugin-design.md` — архитектурное обоснование.
- **Plan 1 план:** `docs/superpowers/plans/2026-04-28-plugin-framework.md` — для контекста о plugin framework API.
- **Reference:** `reference-projects/hermes-lcm/` (in main repo, gitignored, не в worktree) — Python источник для порта. Subagent читает напрямую из main repo path: `/Users/tyess/dev/openclaw-agents-sdk-clone/reference-projects/hermes-lcm/`.
- **Существующий пример плагина:** `plugins/__example/` (workspace package, использует tools-shim pattern).

## User preferences (важные)

- **Subagent-driven** execution с **full review chain** (implementer + spec reviewer + quality reviewer + fix iterations) **за каждой task**.
- **100% test coverage** обязательно.
- **Don't ask, just do** — не запрашивать подтверждения для рутинных шагов (см. memory `feedback_no_asking.md`).
- **Test before reporting** — тестировать самостоятельно перед сообщением о готовности.

## Subagent dispatch pattern

Для каждой task:
1. Mark task in_progress (TaskUpdate)
2. Dispatch implementer (Sonnet by default, Haiku для тривиальных copy-paste) — даю полный текст task + код + tdd-шаги в prompt-е
3. Dispatch spec reviewer — verifies code matches spec (CRITICAL: do not trust report, read code)
4. Dispatch quality reviewer (`subagent_type: superpowers:code-reviewer`) — provides BASE_SHA + HEAD_SHA, asks task-specific quality questions
5. Если reviewer нашёл issues — dispatch fix subagent с конкретным списком правок
6. Mark task completed; move to next

**Промпт-шаблоны:** в `/Users/tyess/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/subagent-driven-development/`:
- `implementer-prompt.md`
- `spec-reviewer-prompt.md`
- `code-quality-reviewer-prompt.md`

## TaskCreate IDs (Plan 2)

- T1=24 ✅, T2=25 ✅
- T3=26 (next), T4=27, T5=28, T6=29, T7=30, T8=31, T9=32, T10=33
- T11=34, T12=35, T13=36, T14=37, T15=38, T16=39, T17=40, T18=41
- T19=42, T20=43, T21=44, T22=45, T23=46 (LOSSLESS), T24=47, T25=48 (E2E)
- T26=49, T27=50, T28=51

## Recurring issues review caught (don't re-discover)

- **HookEvent typing in plugin shims** — должен быть discriminated union из `src/hooks/emitter.ts` (15 events), не `string`. Уже зафиксировано в Task 1 fix.
- **CompressResult.messages** (не `.assembled`) — Plan 1 review caught, applied across spec/plan/code.
- **AbortController в SDK Options** для timeout — без этого утечка subprocesses (важно для Tasks с runSubagent).
- **canUseTool: deny** должен **проверяться в тестах** runSubagent, а не только присутствовать.
- **Plugin hooks orphan после hot-reload** — фикс в Plan 1 (Task 8 review). Поведение PluginContext.registerHook сейчас правильное.
- **Migrations должны быть в транзакциях** — `runMigrations` уже wraps `db.transaction(migration)(db)` после T2 fix.
- **FTS update/delete triggers нужно тестировать** не только insert — добавлено в T2 fix.

## Build artifacts checks per task

После каждой task где меняется сам plugin:

```bash
cd /Users/tyess/dev/openclaw-agents-sdk-clone/.worktrees/lcm-core
pnpm --filter @anthroclaw/plugin-lcm build 2>&1 | tail -5
cd plugins/lcm && pnpm test 2>&1 | tail -5    # plugin-internal tests
cd /Users/tyess/dev/openclaw-agents-sdk-clone/.worktrees/lcm-core
pnpm test 2>&1 | tail -5                       # gateway baseline (zero regressions expected)
```

Baseline gateway tests count: **975** (на ветке `feat/lcm-core` от main). Plugin-internal tests на T2: **15**. На T3 будет +7 для tokens (~22 total в plugin).

## Next step

**Task 3 — tokens.ts (tiktoken с char-fallback)** — mechanical, single file ~60 LOC + tests. Должен быть быстрым.

Полный prompt для T3 implementer-а есть в плане (`docs/superpowers/plans/2026-04-28-lcm-core.md` секция "Task 3"). Можно копировать целиком в `Agent` tool prompt. Рекомендую модель `sonnet` (короткие mechanical таски в Haiku тоже идут, но runSubagent-related код лучше через Sonnet).

## Тёмп-checkpoint от пользователя (важно)

Пользователь спросил про темп после 2 tasks. Я дал три варианта:
1. Full chain каждой task (как сейчас) — ~6-8 часов
2. Гибрид (full chain только integration: T9, T19, T20-21, T23, T25) — ~3x быстрее
3. Отложить и продолжить позже

Пользователь выбрал **handoff/compact** (этот документ) — то есть продолжить в следующей сессии, очевидно ожидая что fresh-context можно будет управлять более эффективно. **На вопрос про вариант 1/2/3 явного ответа не было** — спросить пользователя в начале новой сессии.

## Подсказка для fresh-me

Прочитай:
1. Этот файл (handoff-plan-2.md)
2. `docs/superpowers/plans/2026-04-28-lcm-core.md` Task 3 (для prompt-а implementer-а)
3. `git log --oneline feat/lcm-core | head -10` (последние коммиты)
4. `git status -sb` (ожидается clean)

Затем: спросить пользователя, продолжить ли с вариантом 1 (full review каждой task) или перейти на гибрид. После — диспатчить T3 implementer.
