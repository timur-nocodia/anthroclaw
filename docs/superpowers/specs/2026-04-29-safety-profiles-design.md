# Safety Profiles Design — secure-by-default agent configuration

**Date:** 2026-04-29
**Status:** Draft (ожидает ревью пользователя)
**Author:** Claude + Timur (brainstorming session)
**Scope:** Введение системы `safety_profile` для агентов anthroclaw — закрытие текущих security holes (`leads_agent` с `manage_cron`+`access_control` в публичном WA), фикс багов системного промпта (auto-memory `/tmp/claude-resume`, deferred tools `RemoteTrigger`/`CronCreate`/`mcp__claude_ai_*`), и установка адекватных дефолтов "из коробки".

---

## 1. Контекст и цели

### 1.1 Проблема

anthroclaw — публичный репозиторий, рассчитанный на то что юзеры разворачивают своих агентов сами. Текущая модель безопасности страдает четырьмя проблемами:

1. *Unsafe defaults в built-in tools.* `src/sdk/permissions.ts:22-39` — `DEFAULT_ALLOWED_TOOLS` включает `Bash`, `Write`, `Edit`, `MultiEdit`, `WebFetch`. Агент по умолчанию получает доступ к коду и сети без явного opt-in от автора конфига.

2. *SDK preset leakage.* `src/sdk/options.ts:48-52` — все агенты идут через `systemPrompt: { type: 'preset', preset: 'claude_code', excludeDynamicSections: true }` + `settingSources: ['project']`. Это приносит в системный промпт *auto-memory секцию* (учит агента что память живёт в `/tmp/claude-resume-.../memory/`) и *deferred tools* (`RemoteTrigger`, `CronCreate`, `mcp__claude_ai_*`, `mcp__claude-in-chrome__*`). Агент использует harness-tools вместо custom MCP-tools нашего гейтвея.

3. *Ноль изоляции по уровню доверия.* Один и тот же tool surface применяется к single-user приватным агентам (Klavdia) и публичным WA-ботам (`leads_agent` с `pairing.mode: open`). Хостайл-юзер в публичном WA может попросить бота создать cron от имени бота через `manage_cron` или поменять собственные права через `access_control`.

4. *Нет канала approval.* Даже если канал-уровневые ограничения захочется ввести (TG inline-buttons), сейчас `canUseTool` синхронный и `onElicitation` всегда возвращает `cancel`. Инфраструктура есть, но не задействована.

### 1.2 Триггер

29.04.2026 в диалоге с агентом Klavdia (`agents/example`) обнаружено: вместо `manage_cron` агент 18 раз вызвал `RemoteTrigger`, 2 раза `CronCreate`, ни разу `manage_cron`. Память пуста (`memory_write` не вызывался ни разу за две сессии). Внутреннее `thinking` агента: *"The memory system is described in the system instructions as being at /tmp/claude-resume-e0b88289-.../memory/"* — то есть SDK preset активно дезориентирует агента.

### 1.3 Решение

Ввести понятие *Safety Profile* — обязательное поле `safety_profile` в `agent.yml` с тремя значениями: `public`, `trusted`, `private`. Профиль контролирует:

- system prompt mode (custom string vs preset claude_code)
- `settingSources` (нужно ли грузить `.claude/` settings)
- whitelist категорий built-in тулов
- whitelist custom MCP-тулов (через метаданные на каждом туле)
- permission flow (auto / interactive с TG-кнопками / strict-deny)
- sandbox defaults
- форму допустимого `allowlist`

Профиль базовый + `safety_overrides:` блок для точечных подкручиваний. Каждый override логируется WARN.

### 1.4 Жёсткое ограничение — нативность Agent SDK

Все правки идут через стандартные опции `Options` объекта (`disallowedTools`, `permissionMode`, `canUseTool`, `systemPrompt`, `settingSources`, `sandbox`). Никакого обхода `query()`, никаких прямых вызовов Messages API. Нарушение этого ограничения может расцениться Anthropic как abuse подписки и привести к её блокировке.

### 1.5 Не-цели (out of scope)

- *Peer-isolated memory* для public-агентов. Сейчас `memory_write` в public профиле просто запрещён. Изоляция per-peer — отдельная фича.
- *WhatsApp interactive approval.* Baileys буттоны нестабильны (Meta их урезала); в trusted на WA destructive тулы просто блокируются с reason. Полноценный WA approval flow — out of scope.
- *Persistent approval queue.* Pending approvals живут в памяти. Если гейтвей упал во время approval — тулколл умирает, агент попробует снова в новой сессии.
- *UI для управления профилями.* Сейчас только yaml + CLI миграция.
- *Per-route профили.* Per-agent — финальное решение. Если агент должен работать в двух режимах — два разных файла в `agents/`.

---

## 2. Решения, принятые в brainstorming-сессии

| # | Вопрос | Решение | Обоснование |
|---|---|---|---|
| 1 | Гранулярность | Per-agent | Простота аудита; "один агент = один уровень доверия"; per-route добавляет корнер-кейсы без явной выгоды |
| 2 | Жёсткость профиля | База + `safety_overrides` с WARN-логом | Гибкость для экспертных юзеров без потери guarantee; YAGNI на этапе v1 |
| 3 | System prompt control | Профиль управляет `systemPromptMode` + `settingSources` | Только так можно убрать auto-memory секцию из preset; precondition для починки Klavdia-бага |
| 4 | Backward compatibility | Hard-fail при отсутствии `safety_profile` + миграционная утилита | Phasing breaking changes через legacy-слой = тех-долг; один больной коммит лучше |
| 5 | `memory_write` в public | Запрещён | Защита от memory poisoning хостайл-юзерами; peer-isolated memory — отдельная фича |
| 6 | Trusted на WA | Деградирует в strict-deny для destructive тулов | Baileys кнопки нестабильны; нет approval-канала → нет destructive |
| 7 | Private allowlist | Ровно 1 peer на канал, иначе fail to start | Защита от случайной выдачи `bypassPermissions` группе |
| 8 | Tool meta storage | `META` экспорт из каждого `src/agent/tools/*.ts` + `BUILTIN_META` для встроенных | Single source of truth; профили референсятся, не дублируют |

---

## 3. Архитектура

### 3.1 Новые файлы

```
src/security/profiles/
  index.ts                 # резолв профиля по имени, validateSafetyProfile()
  public.ts                # описание профиля public
  trusted.ts
  private.ts
  types.ts                 # SafetyProfile interface
  __tests__/profiles.test.ts
src/security/
  builtin-tool-meta.ts     # META для Bash, Write, Edit, etc.
  approval-broker.ts       # in-memory pending approvals
  __tests__/approval-broker.test.ts
scripts/
  migrate-safety-profile.ts
  __tests__/migrate-safety-profile.test.ts
docs/
  safety-profiles.md       # юзер-гид
```

### 3.2 Файлы которые меняются

```
src/config/schema.ts                 # +safety_profile, +safety_overrides
src/sdk/options.ts                   # профиль-aware buildSdkOptions
src/sdk/permissions.ts               # interactive canUseTool flow
src/agent/tools/*.ts                 # +META export на каждом туле
src/channels/telegram.ts             # +promptForApproval helper
src/channels/whatsapp.ts             # supportsButtons: false constant
src/channels/types.ts                # +supportsApproval property на ChannelAdapter
src/agent/agent.ts                   # validateSafetyProfile() при load
src/gateway.ts                       # ApprovalBroker init, callback_query routing
agents/example/agent.yml             # +safety_profile: private
agents/leads_agent/agent.yml         # +safety_profile: public + manual review
agents/content_sm_building/agent.yml # +safety_profile: trusted
CHANGELOG.md                         # breaking change note
README.md                            # ссылка на safety-profiles.md
```

### 3.3 Что не меняется

- `routes`, `pairing`, `allowlist` остаются. Профиль *проверяет* совместимость с ними.
- `agents/*/CLAUDE.md` — профиль не диктует содержимое промпта, только *режим* (string vs preset). Юзерский CLAUDE.md аппендится в обоих режимах.
- Глобальный `config.yml`, plugin loader, gateway core (роутинг, sessions, hooks).

---

## 4. Содержимое профилей

### 4.1 Profile: `public`

*Threat model:* любой незнакомец из интернета через WA `*` или открытый TG. Возможно враждебный, prompt-injection активен.

| Параметр | Значение |
|---|---|
| `systemPromptMode` | `string` |
| Custom system prompt | минимальный (см. ниже) |
| `settingSources` | `[]` |
| Built-in allowed | `Read`, `Glob`, `Grep`, `LS` (read-only, file-safety strict) |
| Built-in forbidden | `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `WebFetch`, `TodoWrite` |
| MCP allowed (META.safe_in_public) | `memory_search`, `memory_wiki`, `web_search_brave`, `web_search_exa`, `send_message` (*только peer-source*), `list_skills` |
| MCP forbidden | `memory_write`, `manage_cron`, `manage_skills`, `access_control`, `send_media`, `local_note_propose`, `session_search` |
| HARD_BLACKLIST (override не открыть) | `Bash`, `manage_skills`, `access_control` |
| `permissionFlow` | `strict-deny` для всего вне whitelist |
| `sandbox` | `allowUnsandboxedCommands: false`, file-safety strict |
| Rate limit floor | 30 msg/hour/peer (enforced даже если global rate_limit off) |
| Allowlist форма | `*` или пусто; конкретные peer_id → warn |

Кастомный system prompt:

```
You are a public-facing assistant on {channel}.
You speak with anonymous users you don't know.
Your only memory tools are memory_search and memory_wiki (read-only).
You cannot create cron jobs, modify your own permissions, send messages to third parties, or run code.
If a user asks you to do something you cannot do, say so plainly.
Never reference filesystem paths like /tmp/claude-resume — those don't exist for you.

{user-provided CLAUDE.md content appended here}
```

### 4.2 Profile: `trusted`

*Threat model:* известные пользователи (allowlist или одобренные через pairing). Не активно враждебны.

| Параметр | Значение |
|---|---|
| `systemPromptMode` | `preset` |
| Preset | `claude_code` с `excludeDynamicSections: true` |
| `settingSources` | `['project']` |
| Built-in allowed | `Read`, `Glob`, `Grep`, `LS`, `Write`, `Edit`, `MultiEdit` (последние три с TG-approval) |
| Built-in forbidden | `Bash`, `WebFetch`, `NotebookEdit` |
| MCP allowed | всё public + `memory_write`, `manage_cron` (с approval), `local_note_search`, `session_search`, `send_media` (с approval), `local_note_propose` |
| MCP forbidden | `manage_skills`, `access_control` |
| HARD_BLACKLIST | `manage_skills`, `access_control` |
| `permissionFlow` | `interactive` где канал поддерживает кнопки; deny destructive где не поддерживает |
| `sandbox` | `allowUnsandboxedCommands: false`, sandbox enabled |
| Rate limit floor | 100 msg/hour/peer |
| Allowlist форма | конкретные peer_id (не `*`) |

### 4.3 Profile: `private`

*Threat model:* единственный доверенный владелец. Идентифицируется по peer_id в allowlist.

| Параметр | Значение |
|---|---|
| `systemPromptMode` | `preset` |
| Preset | `claude_code` полный (без `excludeDynamicSections`) |
| `settingSources` | `['project', 'user']` |
| Built-in allowed | всё (Bash, WebFetch — под TG-approval по умолчанию) |
| MCP allowed | всё указанное в `mcp_tools` |
| HARD_BLACKLIST | пусто |
| `permissionFlow` | `interactive` для destructive; `safety_overrides.permission_mode: 'bypass'` → `auto-allow всё` |
| `sandbox` | enabled by default, конфигурируемый |
| Rate limit floor | нет |
| Allowlist форма | *ровно 1 peer на канал*, иначе fail to start |

### 4.4 Сводка

| | `public` | `trusted` | `private` |
|--|--|--|--|
| systemPrompt | string (custom) | preset claude_code | preset claude_code |
| settingSources | `[]` | `['project']` | `['project','user']` |
| Built-in code-exec | ❌ | Write/Edit с approval | всё, Bash под approval |
| `manage_cron` | ❌ | ✓ с approval | ✓ |
| `memory_write` | ❌ | ✓ | ✓ |
| `access_control` | ❌ HARD_BLACKLIST | ❌ HARD_BLACKLIST | ✓ |
| WA support | full | degraded (no approval) | invalid (1 peer rule) |
| Allowlist форма | `*` или пусто | конкретные peer_id | ровно 1 peer/канал |

---

## 5. Валидация при загрузке агента

`Agent.load()` вызывает `validateSafetyProfile(config)`. Шаги в строгом порядке:

1. *Поле существует:* `safety_profile` есть в yaml. Иначе fatal.
2. *Значение валидно:* one of `public | trusted | private`. Иначе fatal.
3. *Совместимость с allowlist/pairing:*
   - `private` + allowlist не имеет ровно 1 peer на канал → fatal
   - `public` + allowlist с конкретными peer_id (не `*`) → warn
4. *Совместимость mcp_tools с профилем:*
   - Каждый тул проверяется на `profile.allowedMcpTools ∪ safety_overrides.allow_tools`
   - HARD_BLACKLIST невозможно открыть через override
5. *Валидация overrides:*
   - `safety_overrides.permission_mode: 'bypass'` разрешён только в `private`
   - `safety_overrides.allow_tools` не может содержать тулы из HARD_BLACKLIST
6. *Каждый override логируется WARN:*
   ```
   WARN agent "leads_agent" overrides safety_profile "public":
     allow_tools=[manage_cron]
   ```

### 5.1 Формат fatal ошибки

```
❌ Cannot load agent "leads_agent":
   safety_profile "public" forbids these tools listed in mcp_tools:
     - manage_cron      (allowed in: trusted, private)
     - access_control   (allowed in: private; HARD_BLACKLIST in public/trusted)

   Options:
     1. Remove these tools from mcp_tools (safest)
     2. Change safety_profile to a more permissive one
     3. Add to safety_overrides.allow_tools (logged as WARN; HARD_BLACKLIST cannot be overridden)

   See docs/safety-profiles.md
```

Гейтвей в этом случае *не стартует вообще*. Не "загружает остальных агентов и пропускает этот" — fatal на весь процесс.

---

## 6. Поток canUseTool

```
Tool requested by SDK
   ↓
Lookup tool category in profile registry:
   ├─ in profile.alwaysAllow → allow
   ├─ in profile.alwaysDeny → deny with reason
   ├─ in profile.requiresApproval:
   │    ├─ channel.supportsApproval (TG):
   │    │    → ApprovalBroker.request(toolName, args, peerId)
   │    │    → channel.promptForApproval()  (inline_keyboard)
   │    │    → await callback_query (timeout 60s)
   │    │    → resolve allow/deny based on click
   │    └─ channel.supportsApproval === false (WA):
   │         → deny with reason "Tool requires approval; channel doesn't support it"
   └─ tool from safety_overrides.allow_tools → allow (WARN log on first use per session)
```

`safety_overrides.permission_mode: 'bypass'` (только private) — short circuit: всегда `allow`. Лог WARN на старте сессии.

### 6.1 TG approval UX

```
🔧 Tool: manage_cron
Action: create
Schedule: "0 9 * * 1-5"
Prompt preview: "Утренняя планёрка..."

[✅ Allow]   [❌ Deny]   [🔍 Show full]
```

`[🔍 Show full]` — JSON всех аргументов. Допустим если peer === владелец (для группы — только админу).

Timeout 60s. Если timeout — deny с reason `"User did not respond"`.

### 6.2 ApprovalBroker

```ts
// src/security/approval-broker.ts
export class ApprovalBroker {
  private pending = new Map<string, {
    resolve: (v: PermissionResult) => void;
    timeout: NodeJS.Timeout;
  }>();

  request(id: string, timeoutMs: number): Promise<PermissionResult> { ... }
  resolve(id: string, decision: 'allow' | 'deny'): void { ... }
}
```

`gateway.handleCallbackQuery()` парсит `callback_data` `"approve:<broker-id>"` / `"deny:<broker-id>"` и вызывает `approvalBroker.resolve()`. In-memory only — не persistent.

---

## 7. Tool META registry

Каждый MCP-тул в `src/agent/tools/*.ts` экспортирует `META`:

```ts
// src/agent/tools/manage-cron.ts
export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false,
  safe_in_trusted: true,
  safe_in_private: true,
  destructive: true,
  reads_only: false,
  hard_blacklist_in: ['public'],
};
```

Built-in тулы — в одном файле:

```ts
// src/security/builtin-tool-meta.ts
export const BUILTIN_META: Record<string, ToolMeta> = {
  Read:        { reads_only: true,  safe_in_public: true,  ... },
  Write:       { destructive: true, safe_in_public: false, ... },
  Bash:        { destructive: true, safe_in_public: false, hard_blacklist_in: ['public'], ... },
  // ...
};
```

Профили *референсятся на META, не дублируют список тулов* — single source of truth.

---

## 8. Schema

### 8.1 Agent yml (`src/config/schema.ts`)

```ts
const SafetyOverridesSchema = z.object({
  allow_tools: z.array(z.string()).optional(),
  deny_tools: z.array(z.string()).optional(),
  permission_mode: z.enum(['default', 'bypass']).optional(),
  sandbox: SandboxSchema.optional(),
}).strict();

const AgentYmlSchema = z.object({
  // ... existing fields
  safety_profile: z.enum(['public', 'trusted', 'private']),  // REQUIRED
  safety_overrides: SafetyOverridesSchema.optional(),
});
```

`safety_profile` — *required* в Zod. Парсинг yaml без этого поля → Zod error → fatal.

### 8.2 SafetyProfile interface

```ts
// src/security/profiles/types.ts
export interface SafetyProfile {
  name: 'public' | 'trusted' | 'private';
  systemPrompt:
    | { mode: 'string'; text: string }
    | { mode: 'preset'; preset: 'claude_code'; excludeDynamicSections: boolean };
  settingSources: Array<'project' | 'user'>;

  builtinTools: {
    allowed: Set<string>;
    forbidden: Set<string>;
    requiresApproval: Set<string>;
  };

  mcpToolPolicy: {
    allowedByMeta: (meta: ToolMeta) => boolean;
    requiresApproval: (meta: ToolMeta) => boolean;
  };

  hardBlacklist: Set<string>;  // tools that cannot be opened via overrides

  permissionFlow: 'auto-allow' | 'auto-deny' | 'interactive' | 'strict-deny';
  sandboxDefaults: SandboxSettings;
  rateLimitFloor: { windowMs: number; max: number } | null;

  validateAllowlist(allowlist: AllowlistConfig): ValidationResult;
}
```

---

## 9. Migration utility

### 9.1 `pnpm migrate:safety-profile`

Скрипт `scripts/migrate-safety-profile.ts`. Чтение агентов из `agents/` (или путь через флаг). Не трогает данные, только yaml-конфиги.

*Inference rules* (по приоритету):
1. `allowlist` имеет ровно 1 peer на канал → `private`
2. `pairing.mode === 'open'` или `allowlist: ["*"]` → `public`
3. `pairing.mode in ('approve', 'code')` с конкретными peer_id → `trusted`
4. `pairing.mode === 'off'` без allowlist → fail with explicit message ("agent denies everyone — pick safety_profile manually")
5. Всё остальное → `trusted` с warning

Затем проверяет совместимость `mcp_tools` с inferred профилем. Несовместимые → добавляет `safety_overrides.allow_tools` с комментарием для review:

```yaml
safety_profile: public
safety_overrides:
  # WARN: manage_cron is normally forbidden in 'public'.
  # Originally present in mcp_tools — kept for backwards compat.
  # Review before deploying.
  allow_tools:
    - manage_cron
```

Тулы из HARD_BLACKLIST для inferred профиля *не* применяются — юзер должен решить вручную.

### 9.2 Output (dry-run)

```
$ pnpm migrate:safety-profile

Scanning agents/...

[example] inferred: private
  + safety_profile: private
  ✓ all tools compatible

[leads_agent] inferred: public
  + safety_profile: public
  ⚠ tool conflicts: manage_cron, access_control
    Adding safety_overrides.allow_tools (review needed!)

  ❗ access_control is in HARD_BLACKLIST for public — cannot be auto-migrated.
    Manually decide: remove it, or change safety_profile to private.

[content_sm_building] inferred: trusted
  + safety_profile: trusted
  ✓ all tools compatible

Summary:
  3 agents scanned
  2 ready to apply (--apply)
  1 needs manual review (leads_agent)

No changes written. Re-run with --apply to commit.
```

С `--apply`:
- Yaml-aware writer (npm `yaml` package, *НЕ* `js-yaml` `dump` — он убивает комментарии)
- Бэкап оригинала в `agents/<id>/agent.yml.bak-<timestamp>`
- Diff в stdout
- Не коммитит в git — пусть юзер сам

---

## 10. Testing strategy

### 10.1 Unit: profiles

`src/security/profiles/__tests__/profiles.test.ts`:
- Snapshot структуры каждого профиля (catches случайные правки)
- `validateSafetyProfile()`:
  - Валидный конфиг → ok
  - Без `safety_profile` → throws
  - `private` + 0 peers → throws
  - `private` + 2 peers на одном канале → throws
  - `public` + `manage_cron` без override → throws
  - `public` + `manage_cron` с override → warn-log + ok
  - `public` + `access_control` (HARD_BLACKLIST) с override → throws
  - `bypass` permission mode в `trusted` → throws

### 10.2 Unit: ApprovalBroker

`src/security/__tests__/approval-broker.test.ts`:
- Request → resolve allow → returns allow
- Request → resolve deny → returns deny
- Request → timeout → returns deny with reason
- Concurrent requests → independent resolution
- Resolve unknown id → no-op (no crash)

### 10.3 Integration: agent loading

`src/__tests__/profile-integration.test.ts`:
- Loading agent с public + `mcp_tools: [manage_cron]` → gateway не стартует, точное сообщение в stderr
- Loading валидного профиля → стартует, все системы инициализированы корректно
- `canUseTool` для public + Bash → deny
- `canUseTool` для trusted + Write → запрос approval (mock TG channel) → allow или deny

### 10.4 Integration: channels

`src/__tests__/profile-channels.test.ts`:
- Trusted на TG-канале + destructive tool → отправляет inline_keyboard
- Trusted на WA-канале + destructive tool → deny с reason
- Private + bypass override → allow без approval, WARN log

### 10.5 Migration script

`scripts/__tests__/migrate-safety-profile.test.ts`:
- Inference на каждом из reference yaml-файлов
- HARD_BLACKLIST detection → не auto-applies
- `--apply` сохраняет комментарии и форматирование
- Бэкап создан с правильным timestamp

### 10.6 E2E smoke

`src/__tests__/e2e-safety.test.ts`:
- Запуск гейтвея с тремя реальными агентами в `agents/` после миграции — все стартуют

### 10.7 Что специально НЕ тестируем

- Реальное TG/WA соединение — мокаем channel adapter
- Реальный SDK `query()` вызов — мокаем

---

## 11. Rollout

1. Implement в feature branch `feat/safety-profiles`
2. Migration script + тесты
3. Применить миграцию к `agents/example`, `agents/leads_agent`, `agents/content_sm_building`. Manual review для `leads_agent` (HARD_BLACKLIST на `access_control`).
4. CHANGELOG.md: breaking change note с инструкцией миграции
5. README.md: ссылка на `docs/safety-profiles.md`
6. PR с тщательным код-ревью (особенно tool META — это security-critical taxonomy)
7. Merge → deploy на прод (ubuntu@46.247.41.191) → проверить что Klavdia больше не вызывает RemoteTrigger/CronCreate, использует `manage_cron`/`memory_write`

---

## 12. Решения по edge-кейсам

- *Профиль = потолок, `mcp_tools` = реально включённое.* Если профиль разрешает тул, юзер должен явно перечислить его в `mcp_tools` чтобы он стал доступен. Профиль *никогда не активирует тул автоматически* — он только определяет какие тулы вообще *могут* быть в `mcp_tools`. Это сохраняет explicit-is-better-than-implicit и не сюрпризит юзеров новыми тулами после обновления профиля.
- *Группы в Telegram* — для approval-кнопок уважаем только peer'а отправителя того сообщения, на которое сейчас работает агент. Не "владельца", не "любого в allowlist". Это самая узкая интерпретация: тот кто инициировал turn — тот и аппрувит свои тулколлы.
- *Plugin tools* (через plugin framework, см. LCM spec) — плагин *обязан* декларировать `META` на каждом своём MCP-туле. Без `META` плагин не грузится с явной ошибкой. Это предотвращает добавление security-bypass через плагины.

---

## 13. Future work

- *Peer-isolated memory* для `memory_write` в public профиле
- *WA Business API* интеграция для interactive approval (требует Meta-approval шаблонов)
- *UI для управления профилями* в Next.js админке (`ui/`)
- *Профили на уровне route* если появится реальный use-case (сейчас не нужен)
- *Tool sandboxing per-call* — ограничение filesystem/network на уровне отдельного вызова, не только на уровень всего сэндбокса
