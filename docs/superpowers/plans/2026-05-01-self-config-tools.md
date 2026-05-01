# Self-Configuration Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 MCP tools + a unified config-write service that let an agent configure its own (or a managed agent's) `notifications` / `human_takeover` / `operator_console` blocks via natural-language conversation, with full audit trail and UI parity.

**Architecture:** New `AgentConfigWriter` core service is the single mutation point for `agent.yml`. UI save endpoints refactored to use it; new MCP tools delegate to it. Audit log JSONL records every write with `source: chat | ui`. Permission helper extracted from operator-console plugin so self-config tools can reuse the manager-side `manages` whitelist.

**Tech Stack:** TypeScript (Node ≥22), Zod, vitest, `yaml` library (already in use for `migrate-safety-profile`), Next.js 15 App Router for UI.

**Spec:** [`docs/superpowers/specs/2026-05-01-self-config-tools-design.md`](../specs/2026-05-01-self-config-tools-design.md). Read it before any task — every code surface, schema, audit format, and permission rule is defined there.

**Depends on:** PR #6 (Operator Control Plane). Must merge first; this branch will rebase onto the post-#6 main before implementation starts.

---

## Conventions

- ESM `.js` import suffixes throughout
- Tests live under `<dir>/__tests__/<name>.test.ts`
- Each task ends with one commit; Conventional Commits
- Subagent execution: fresh subagent per task (or batched by stage like PR #6)
- Project rules in `CLAUDE.md`: no `@anthropic-ai/sdk` direct imports, no Messages API, default no comments unless WHY is non-obvious

---

## Stage 1 — `AgentConfigWriter` core service + audit

Goal: a single, race-free mutation API for `agent.yml`. UI save endpoints migrated to use it. Standalone — once Stage 1 lands, both UI and tool-driven writes go through one path.

### Task 1: Scaffold types and interface

**Files:**
- Create: `src/config/writer.ts`
- Create test: `src/config/__tests__/writer.test.ts`

- [ ] **Step 1: Write failing test for shape**

```ts
import { describe, it, expect } from 'vitest';
import { createAgentConfigWriter } from '../writer.js';

describe('AgentConfigWriter — basic shape', () => {
  it('exports the factory and surface API', () => {
    const writer = createAgentConfigWriter({ agentsDir: '/tmp/non-existent' });
    expect(typeof writer.patchSection).toBe('function');
    expect(typeof writer.readSection).toBe('function');
    expect(typeof writer.readFullConfig).toBe('function');
  });
});
```

- [ ] **Step 2: Verify it fails** — `createAgentConfigWriter` not exported.

- [ ] **Step 3: Implement minimal scaffold**

```ts
export type ConfigSection = 'notifications' | 'human_takeover' | 'operator_console';

export interface ConfigWriteResult {
  agentId: string;
  section: ConfigSection;
  prevValue: unknown;
  newValue: unknown;
  writtenAt: string;
  backupPath: string;
}

export interface AgentConfigWriter {
  patchSection(
    agentId: string,
    section: ConfigSection,
    patch: (current: unknown) => unknown | null,
  ): Promise<ConfigWriteResult>;
  readSection(agentId: string, section: ConfigSection): unknown;
  readFullConfig(agentId: string): unknown;
}

export interface CreateAgentConfigWriterOptions {
  agentsDir: string;
  auditDir?: string;     // default: <agentsDir>/../data/config-audit
  backupKeep?: number;   // default: 10
  clock?: () => number;
}

export function createAgentConfigWriter(opts: CreateAgentConfigWriterOptions): AgentConfigWriter {
  return {
    patchSection: async () => { throw new Error('not implemented'); },
    readSection: () => { throw new Error('not implemented'); },
    readFullConfig: () => { throw new Error('not implemented'); },
  };
}
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git add src/config/writer.ts src/config/__tests__/writer.test.ts
git commit -m "feat(config): scaffold AgentConfigWriter interface"
```

---

### Task 2: Implement patchSection with parseDocument + atomic rename + lock

**Files:**
- Modify: `src/config/writer.ts`
- Modify: `src/config/__tests__/writer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('AgentConfigWriter — patchSection', () => {
  let agentsDir: string;
  beforeEach(() => {
    agentsDir = mkdtempSync(join(tmpdir(), 'acw-'));
    // seed an agent
    require('node:fs').mkdirSync(join(agentsDir, 'amina'), { recursive: true });
    writeFileSync(join(agentsDir, 'amina', 'agent.yml'), [
      '# Amina lead bot',
      'safety_profile: chat_like_openclaw',
      'routes:',
      '  - { channel: whatsapp }',
      '',
    ].join('\n'));
  });
  afterEach(() => rmSync(agentsDir, { recursive: true, force: true }));

  it('adds a new section with comment-preserving write', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const result = await writer.patchSection('amina', 'human_takeover', (current) => ({
      enabled: true, pause_ttl_minutes: 30,
    }));
    expect(result.prevValue).toBeUndefined();
    expect(result.newValue).toMatchObject({ enabled: true, pause_ttl_minutes: 30 });
    const after = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    expect(after).toContain('# Amina lead bot');         // comment preserved
    expect(after).toContain('safety_profile: chat_like_openclaw'); // existing field preserved
    expect(after).toContain('human_takeover:');          // new section present
    expect(after).toContain('enabled: true');
  });

  it('returns null patch removes the section', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    await writer.patchSection('amina', 'human_takeover', () => ({ enabled: true }));
    const result = await writer.patchSection('amina', 'human_takeover', () => null);
    expect(result.newValue).toBeNull();
    const after = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    expect(after).not.toContain('human_takeover');
  });

  it('serializes concurrent writes per-agent', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    const results = await Promise.all([
      writer.patchSection('amina', 'human_takeover', () => ({ enabled: true, pause_ttl_minutes: 30 })),
      writer.patchSection('amina', 'human_takeover', () => ({ enabled: true, pause_ttl_minutes: 60 })),
    ]);
    // both writes succeeded, second one wins
    const final = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
    expect(final).toContain('pause_ttl_minutes: 60');
    expect(results).toHaveLength(2);
  });

  it('throws AgentConfigNotFound if agent.yml missing', async () => {
    const writer = createAgentConfigWriter({ agentsDir });
    await expect(writer.patchSection('ghost', 'human_takeover', () => ({ enabled: true })))
      .rejects.toThrow(/ghost/);
  });
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

Use `parseDocument` from the `yaml` package (already a project dep). Per-agent lock as `Map<string, Promise<void>>` — `await locks.get(agentId)` chains the queue. Atomic rename: write to `agent.yml.tmp`, `rename` to `agent.yml`. Read previous section before patch via `doc.get(section)?.toJSON()`. Patch returns new value (or null to delete). Set the document node via `doc.set(section, newValue)` or `doc.delete(section)`. Serialize back via `doc.toString()`.

- [ ] **Step 4: Verify pass + tsc clean**

- [ ] **Step 5: Commit**

```
git commit -m "feat(config): patchSection with comment-preserving YAML mutation and per-agent lock"
```

---

### Task 3: Schema validation + backup file management

**Files:**
- Modify: `src/config/writer.ts`
- Modify: `src/config/__tests__/writer.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('rejects patch that produces invalid YAML schema', async () => {
  const writer = createAgentConfigWriter({ agentsDir });
  await expect(writer.patchSection('amina', 'human_takeover', () => ({
    enabled: true, pause_ttl_minutes: -1,    // invalid: schema requires positive
  }))).rejects.toThrow(/pause_ttl_minutes/);

  const after = readFileSync(join(agentsDir, 'amina', 'agent.yml'), 'utf-8');
  expect(after).not.toContain('-1');         // file unchanged
});

it('creates a timestamped backup before each write', async () => {
  const writer = createAgentConfigWriter({ agentsDir });
  await writer.patchSection('amina', 'human_takeover', () => ({ enabled: true, pause_ttl_minutes: 30 }));
  const files = require('node:fs').readdirSync(join(agentsDir, 'amina'));
  expect(files.some((f: string) => f.startsWith('agent.yml.bak-'))).toBe(true);
});

it('prunes backups beyond backupKeep', async () => {
  const writer = createAgentConfigWriter({ agentsDir, backupKeep: 3 });
  for (let i = 0; i < 5; i++) {
    await writer.patchSection('amina', 'human_takeover', () => ({ enabled: i % 2 === 0, pause_ttl_minutes: 30 }));
  }
  const backups = require('node:fs').readdirSync(join(agentsDir, 'amina'))
    .filter((f: string) => f.startsWith('agent.yml.bak-'));
  expect(backups).toHaveLength(3);
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

Import `AgentYmlSchema` from `src/config/schema.ts`. After patch + serialize, parse the new doc to JS via `doc.toJS()`, run `AgentYmlSchema.safeParse(...)`. If failed, throw `ConfigValidationError` with the Zod error path. Backup: copy original to `agent.yml.bak-${ISO}` BEFORE writing new. Prune: list `agent.yml.bak-*` files, sort by name (ISO timestamps are lexicographically ordered), keep last N, delete older.

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(config): schema validation and backup pruning in writer"
```

---

### Task 4: Audit log JSONL writer with rotation

**Files:**
- Create: `src/config/audit.ts`
- Modify: `src/config/writer.ts` (call audit on every write)
- Create test: `src/config/__tests__/audit.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { createConfigAuditLog } from '../audit.js';

describe('ConfigAuditLog', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'audit-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends a JSONL entry per write', async () => {
    const log = createConfigAuditLog({ auditDir: dir });
    await log.append({
      callerAgent: 'klavdia',
      callerSession: 'telegram:control:dm:48705953',
      targetAgent: 'amina',
      section: 'notifications',
      action: 'add_subscription',
      prev: null,
      new: { event: 'peer_pause_started', route: 'operator' },
      source: 'chat',
    });
    const file = require('node:fs').readFileSync(join(dir, 'amina.jsonl'), 'utf-8');
    const lines = file.trim().split('\n');
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ caller_agent: 'klavdia', target_agent: 'amina', section: 'notifications', source: 'chat' });
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rotates file at maxFileBytes', async () => {
    const log = createConfigAuditLog({ auditDir: dir, maxFileBytes: 200, maxFiles: 3 });
    for (let i = 0; i < 10; i++) {
      await log.append({ callerAgent: 'klavdia', targetAgent: 'amina', section: 'notifications', action: 'noop',
        prev: null, new: { i }, source: 'chat' });
    }
    const files = require('node:fs').readdirSync(dir).filter((f: string) => f.startsWith('amina.jsonl'));
    expect(files.length).toBeGreaterThan(1);
    expect(files.length).toBeLessThanOrEqual(3);
  });

  it('readRecent returns most recent N entries newest-first', async () => {
    const log = createConfigAuditLog({ auditDir: dir });
    for (let i = 0; i < 5; i++) {
      await log.append({ callerAgent: 'k', targetAgent: 'amina', section: 'human_takeover', action: 'noop',
        prev: null, new: { i }, source: 'chat' });
    }
    const recent = await log.readRecent('amina', { limit: 3 });
    expect(recent).toHaveLength(3);
    expect(recent[0].new).toMatchObject({ i: 4 });   // newest first
  });
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement audit log**

```ts
export interface AuditEntry {
  callerAgent: string; callerSession?: string;
  targetAgent: string;
  section: ConfigSection; action: string;
  prev: unknown; new: unknown;
  source: 'chat' | 'ui';
}

export interface ConfigAuditLog {
  append(entry: AuditEntry): Promise<void>;
  readRecent(agentId: string, opts?: { limit?: number; section?: ConfigSection }): Promise<Array<AuditEntry & { ts: string }>>;
}
```

Append: serialize to JSONL line (snake_case keys per spec), `appendFileSync` with rotation check. Rotation: when file exceeds `maxFileBytes`, rename to `{agentId}.jsonl.{N}` (N = next number), keep last `maxFiles`. Read: tail-read by reading file chunks from end (or just `readFile + split + slice` for v1 simplicity).

In `writer.ts`, after successful write, call `audit.append(...)` with the prev/new values from the patch.

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(config): audit log with rotation; writer emits entries on each write"
```

---

### Task 5: Refactor UI save endpoints to use AgentConfigWriter

**Files:**
- Modify: `ui/app/api/agents/[agentId]/config/route.ts` (or wherever the existing UI save endpoint lives — `grep -rn "agent.yml" ui/app/api`)
- Modify: `ui/lib/gateway.ts` (expose `getGateway().getAgentConfigWriter()`)
- Modify: `src/gateway.ts` (instantiate `AgentConfigWriter` at startup, expose getter)
- Modify: `ui/app/api/agents/[agentId]/handoff/route.ts` (PR #6's Handoff save endpoint, if exists)
- Test: `ui/__tests__/api/config-save-via-writer.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('PATCH /api/agents/[id]/config writes through AgentConfigWriter and creates audit entry with source: ui', async () => {
  const gw = mockGateway({ agentsDir: '/tmp/test', writerSpy: vi.fn() });
  const res = await PATCH(req('/api/agents/amina/config', { method: 'PATCH', body: JSON.stringify({
    section: 'human_takeover', value: { enabled: true, pause_ttl_minutes: 30 },
  }) }), { params: { agentId: 'amina' } });
  expect(res.status).toBe(200);
  expect(gw.writerSpy).toHaveBeenCalledWith('amina', 'human_takeover', expect.any(Function));
  const audit = await gw.auditLog.readRecent('amina', { limit: 1 });
  expect(audit[0].source).toBe('ui');
});
```

- [ ] **Step 2: Verify failure** (existing endpoint writes the file directly, doesn't go through writer)

- [ ] **Step 3: Refactor**

In `Gateway.start()`, instantiate `createAgentConfigWriter({ agentsDir: <runtime path> })` and `createConfigAuditLog(...)`. Expose `gateway.getAgentConfigWriter()` and `gateway.getConfigAuditLog()`. UI route uses these instead of writing the file directly. Pass `source: 'ui'` to the audit log.

If existing UI endpoint did broader writes (whole config, not just our 3 sections), keep that path for non-OCP fields but route OCP-section writes through `AgentConfigWriter`. Document this branch in the commit body.

- [ ] **Step 4: Verify pass + run UI suite**

- [ ] **Step 5: Commit**

```
git commit -m "feat(ui): UI save endpoints write through AgentConfigWriter (Stage 1 closes)"
```

---

## Stage 2 — 4 MCP tools + permissions

Goal: chat-driven configuration of the three OCP subsystems. After Stage 2, an operator agent can say "set up notifications to me" and the YAML actually changes.

### Task 6: Extract cross-agent permission helper

**Files:**
- Create: `src/security/cross-agent-perm.ts`
- Modify: `plugins/operator-console/src/permissions.ts` (re-export from new location for back-compat)
- Test: `src/security/__tests__/cross-agent-perm.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { canManageAgent } from '../cross-agent-perm.js';

describe('canManageAgent', () => {
  it('self always allowed when target_agent_id matches caller', () => {
    expect(canManageAgent({ callerId: 'amina', targetId: 'amina', operatorConsoleConfig: undefined })).toBe(true);
  });
  it('cross-agent requires operator_console.manages whitelist', () => {
    expect(canManageAgent({
      callerId: 'klavdia', targetId: 'amina',
      operatorConsoleConfig: { enabled: true, manages: ['amina'], capabilities: [] },
    })).toBe(true);
    expect(canManageAgent({
      callerId: 'klavdia', targetId: 'larry',
      operatorConsoleConfig: { enabled: true, manages: ['amina'], capabilities: [] },
    })).toBe(false);
  });
  it('manages: "*" allows any target', () => { ... });
  it('disabled operator_console blocks cross-agent', () => { ... });
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Extract**

Move logic from `plugins/operator-console/src/permissions.ts` to `src/security/cross-agent-perm.ts`. The plugin file becomes a thin re-export so existing operator-console imports keep working.

- [ ] **Step 4: Verify both suites pass** (backend + plugin)

- [ ] **Step 5: Commit**

```
git commit -m "refactor(security): extract canManageAgent for reuse by self-config tools"
```

---

### Task 7: Register manage tools in builtin-tool-meta

**Files:**
- Modify: `src/security/builtin-tool-meta.ts`
- Modify: `src/security/__tests__/builtin-tool-meta.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('manage_notifications is HARD_BLACKLIST in public', () => {
  expect(BUILTIN_META['manage_notifications'].hard_blacklist_in).toContain('public');
});
it('manage_human_takeover is HARD_BLACKLIST in public', () => { ... });
it('manage_operator_console is HARD_BLACKLIST in public', () => { ... });
it('show_config is allowed in all profiles (read-only)', () => {
  expect(BUILTIN_META['show_config'].hard_blacklist_in).toEqual([]);
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Add entries**

```ts
manage_notifications: {
  description: 'Configure notifications subsystem (routes, subscriptions, enabled).',
  hard_blacklist_in: ['public'],
  reasoning: 'Mutates agent config; risk of self-misconfiguration in public-facing agents.',
},
manage_human_takeover: { ... same },
manage_operator_console: { ... same },
show_config: {
  description: 'Read current config sections (notifications/human_takeover/operator_console).',
  hard_blacklist_in: [],
  reasoning: 'Read-only; safe in all profiles.',
},
```

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(security): register self-config tools in builtin-tool-meta"
```

---

### Task 8: `manage_notifications` tool

**Files:**
- Create: `src/agent/tools/manage-notifications.ts`
- Test: `src/agent/tools/__tests__/manage-notifications.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { createManageNotificationsTool } from '../manage-notifications.js';

describe('manage_notifications', () => {
  it('action=set_enabled toggles enabled flag', async () => {
    const writer = makeFakeWriter();
    const tool = createManageNotificationsTool({ writer, canManage: () => true });
    const r = await tool.handler({ action: { kind: 'set_enabled', enabled: true } }, mockCtx({ agentId: 'amina' }));
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(writer.patchCalls[0]).toMatchObject({ agentId: 'amina', section: 'notifications' });
  });

  it('action=add_route adds named route', async () => { ... });
  it('action=remove_route deletes by name', async () => { ... });
  it('action=list_routes returns existing routes', async () => { ... });
  it('action=add_subscription appends to array', async () => { ... });
  it('action=remove_subscription deletes by index', async () => { ... });
  it('action=test fires synthetic notifications.test_dispatch through named route', async () => { ... });
  it('rejects cross-agent target without manage permission', async () => {
    const tool = createManageNotificationsTool({ writer: makeFakeWriter(), canManage: () => false });
    await expect(tool.handler({
      target_agent_id: 'amina', action: { kind: 'set_enabled', enabled: true },
    }, mockCtx({ agentId: 'klavdia' }))).rejects.toThrow(/not authorized/);
  });
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

Tool factory takes `{ writer: AgentConfigWriter, canManage, notificationsEmitter? }`. Each action maps to a `writer.patchSection('notifications', patcherFn)` call. The patcher receives the current section and returns the new shape. For `list_*` actions, use `writer.readSection` (no mutation). For `test`, call `notificationsEmitter.emit('notifications.test_dispatch', { route: routeName, agentId })`.

Permission: if `target_agent_id` set and != caller, check `canManage(callerId, targetId)` and reject if false.

- [ ] **Step 4: Verify pass + tsc**

- [ ] **Step 5: Commit**

```
git commit -m "feat(tools): manage_notifications self-config tool"
```

---

### Task 9: `manage_human_takeover` tool

**Files:**
- Create: `src/agent/tools/manage-human-takeover.ts`
- Test: `src/agent/tools/__tests__/manage-human-takeover.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('patches enabled only when provided; preserves other fields', async () => {
  const writer = makeFakeWriterWithExisting('human_takeover', { enabled: false, pause_ttl_minutes: 60, channels: ['whatsapp'] });
  const tool = createManageHumanTakeoverTool({ writer, canManage: () => true });
  await tool.handler({ enabled: true }, mockCtx({ agentId: 'amina' }));
  expect(writer.lastPatchResult).toMatchObject({ enabled: true, pause_ttl_minutes: 60, channels: ['whatsapp'] });
});

it('null on a field resets it to schema default', async () => {
  const writer = makeFakeWriterWithExisting('human_takeover', { enabled: true, pause_ttl_minutes: 60 });
  const tool = createManageHumanTakeoverTool({ writer, canManage: () => true });
  await tool.handler({ pause_ttl_minutes: null as any }, mockCtx({ agentId: 'amina' }));
  expect(writer.lastPatchResult.pause_ttl_minutes).toBe(30);  // schema default
});

it('seeds defaults when enabling on missing block', async () => {
  const writer = makeFakeWriterWithExisting('human_takeover', undefined);
  const tool = createManageHumanTakeoverTool({ writer, canManage: () => true });
  await tool.handler({ enabled: true }, mockCtx({ agentId: 'amina' }));
  expect(writer.lastPatchResult).toMatchObject({ enabled: true, pause_ttl_minutes: 30 });
});

it('rejects unauthorized cross-agent target', async () => { ... });
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

Patch-style: read current section, merge with input (omit undefined fields, replace with schema-default for null fields). Single `patchSection` call. Schema defaults pulled from `HumanTakeoverSchema.parse({})`.

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(tools): manage_human_takeover patch-style self-config tool"
```

---

### Task 10: `manage_operator_console` tool

**Files:**
- Create: `src/agent/tools/manage-operator-console.ts`
- Test: `src/agent/tools/__tests__/manage-operator-console.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('rejects when both manages and manages_action are provided', async () => {
  await expect(tool.handler({
    manages: ['amina'], manages_action: { kind: 'add', agent_id: 'larry' },
  }, mockCtx({ agentId: 'klavdia' }))).rejects.toThrow(/mutually exclusive/);
});

it('manages_action=add appends to existing list', async () => {
  const writer = makeFakeWriterWithExisting('operator_console', { enabled: true, manages: ['amina'], capabilities: [] });
  await tool.handler({ manages_action: { kind: 'add', agent_id: 'larry' } }, mockCtx({ agentId: 'klavdia' }));
  expect(writer.lastPatchResult.manages).toEqual(['amina', 'larry']);
});

it('manages_action=remove drops from list; idempotent', async () => { ... });
it('manages: "*" sets super-admin', async () => { ... });
it('partial capabilities array replaces full list', async () => { ... });
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

Validate mutual exclusion of `manages` and `manages_action` at input parse time. `manages_action` reads current `manages` array, mutates, writes back. Edge case: `manages: '*'` + `manages_action: { remove }` is a no-op (super-admin can't have an item removed); document and test this.

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(tools): manage_operator_console with full and incremental updates"
```

---

### Task 11: `show_config` tool

**Files:**
- Create: `src/agent/tools/show-config.ts`
- Test: `src/agent/tools/__tests__/show-config.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('returns requested section with defaults applied', async () => {
  const writer = makeFakeWriterWithExisting('human_takeover', { enabled: true });
  const auditLog = makeFakeAudit([{ ts: '2026-05-01T12:00Z', section: 'human_takeover', source: 'chat', callerAgent: 'klavdia' }]);
  const tool = createShowConfigTool({ writer, auditLog, canManage: () => true });
  const r = await tool.handler({ sections: ['human_takeover'] }, mockCtx({ agentId: 'amina' }));
  expect(r.sections.human_takeover).toMatchObject({ enabled: true, pause_ttl_minutes: 30 });
  expect(r.last_modified).toMatchObject({ section: 'human_takeover', by: 'klavdia' });
});

it('"all" returns all three sections', async () => { ... });
it('cross-agent target requires manage permission', async () => { ... });
it('self-target works without manage permission', async () => { ... });
```

- [ ] **Step 2-5:** Implement and commit.

```
git commit -m "feat(tools): show_config read-only inspector"
```

---

### Task 12: Stage 2 integration test

**Files:**
- Test: `src/__tests__/integration/self-config-tools-e2e.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('e2e: chat → manage_notifications → file write → reload → notification fires', async () => {
  const gw = await createTestGateway({
    agents: { klavdia: { mcp_tools: ['manage_notifications'] }, amina: { } },
    realFsForAgents: true,    // use real chokidar in this test
  });

  // Klavdia (operator-console disabled — self-target only)
  await gw.simulateInbound({
    channel: 'telegram', accountId: 'control', peerId: '48705953',
    text: 'set up notifications: pause alerts to me at telegram control 48705953',
    targetAgent: 'klavdia',
  });

  // After Klavdia processes: amina/agent.yml unchanged (klavdia self-targeted)
  // klavdia/agent.yml has notifications block

  await waitForFileReload();   // chokidar fires; agent reloads

  // Now trigger an event that would fire to that route
  gw.notificationsEmitter.emit('peer_pause_started', { agentId: 'klavdia', peerKey: 'wa:b:1' });
  expect(gw.lastSentMessage).toMatchObject({ channel: 'telegram', peerId: '48705953' });
});

it('e2e: cross-agent management requires operator_console.manages', async () => { ... });

it('audit log records both chat and ui writes', async () => { ... });
```

- [ ] **Step 2-5:** Implement. Use real chokidar wait (similar to existing watcher tests in PR #6 if applicable). Commit.

```
git commit -m "test(integration): self-config tools e2e via chat → file write → reload"
```

---

## Stage 3 — UI surface

Goal: operators see "Last modified by chat (klavdia)" indicators in the Handoff tab and can browse the audit log.

### Task 13: Audit log API endpoint

**Files:**
- Create: `ui/app/api/agents/[agentId]/config-audit/route.ts`
- Test: `ui/__tests__/api/config-audit.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('GET returns audit entries newest-first; respects limit query', async () => {
  const res = await GET(req('/api/agents/amina/config-audit?limit=5&section=notifications'),
    { params: { agentId: 'amina' } });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.entries).toHaveLength(5);
});
it('returns 401 without auth', async () => { ... });
```

- [ ] **Step 2-5:** Implement using `withAuth` and the gateway's `auditLog.readRecent`. Commit.

```
git commit -m "feat(ui): config-audit API endpoint"
```

---

### Task 14: "Last modified" indicator on HumanTakeoverCard + NotificationsCard

**Files:**
- Modify: `ui/components/handoff/HumanTakeoverCard.tsx`
- Modify: `ui/components/handoff/NotificationsCard.tsx`
- Test: `ui/__tests__/components/last-modified-indicator.test.tsx`

- [ ] **Step 1: Write failing tests**

```ts
it('HumanTakeoverCard shows "Last modified 3 hours ago via chat (klavdia)" when audit has recent entry', async () => {
  render(<HumanTakeoverCard agentId="amina" />);
  await waitFor(() => screen.getByText(/Last modified/i));
  expect(screen.getByText(/via chat \(klavdia\)/i)).toBeInTheDocument();
});

it('hides indicator when no audit entries exist', async () => { ... });
```

- [ ] **Step 2-5:** Each card fetches `/api/agents/[id]/config-audit?section=<theirs>&limit=1` on mount. Uses lucide-react `Clock` icon. Format relative time via existing `ui/lib/relative-time.ts` helper or shadcn pattern (search for prior usage). Commit.

```
git commit -m "feat(ui): Last modified indicator on Handoff cards"
```

---

### Task 15: Optional ConfigAuditPanel timeline

**Files:**
- Create: `ui/components/handoff/ConfigAuditPanel.tsx`
- Modify: `ui/components/handoff/HandoffTab.tsx` (add as 5th section)
- Test: `ui/__tests__/components/ConfigAuditPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

```ts
it('renders timeline of audit entries with section filter', async () => { ... });
it('shows diff for each entry', async () => { ... });
```

- [ ] **Step 2-5:** Filterable timeline UI. Diff display uses prev/new JSON. Optional polish; ship if cheap. Commit.

```
git commit -m "feat(ui): ConfigAuditPanel timeline view (optional v1 polish)"
```

---

### Task 16: Final full-implementation review

**Files:** review all changes since branching from `main`.

- [ ] **Step 1: Dispatch final code-reviewer subagent**

Review against `docs/superpowers/specs/2026-05-01-self-config-tools-design.md`. Acceptance:
- All four tools work with self and cross-agent targets per permission matrix
- `public` safety profile blocks the three `manage_*` tools (validation rejects)
- `show_config` works in all profiles
- UI saves and chat tool writes both go through `AgentConfigWriter`
- Audit log records both with correct `source` tags
- Backups created and pruned per `backupKeep`
- Atomic rename: no partial-write window observable to chokidar
- All new code under unit + integration test coverage

- [ ] **Step 2: Run full suites**

```
pnpm test
pnpm -C ui test
npx tsc --noEmit
pnpm build
pnpm -C ui build
```

All green.

- [ ] **Step 3: Update CHANGELOG.md**

```
## [Unreleased]
### Added
- Self-configuration tools (#7): `manage_notifications`, `manage_human_takeover`,
  `manage_operator_console`, `show_config` MCP tools — operators can configure
  the OCP subsystems via natural-language conversation in any channel.
- `AgentConfigWriter` core service: comment-preserving YAML mutation, per-agent
  lock, atomic rename, audit log, schema validation, automatic backups (last 10).
- "Last modified" indicators on Handoff tab cards plus optional ConfigAuditPanel
  timeline view.

### Changed
- UI save endpoints for agent config now go through `AgentConfigWriter` —
  unified write path with chat-driven changes, single audit log.
```

- [ ] **Step 4: Mark PR ready for review**

```
gh pr ready 7
```

- [ ] **Step 5: Commit**

```
git commit -m "docs(changelog): self-configuration tools v0.7.0"
```

---

## Self-review

### Spec coverage
- All 4 tools mapped to tasks (8-11) with full input/output behaviors
- AgentConfigWriter (Tasks 1-3) covers all spec requirements: lock, parse, validate, atomic rename, backup
- Audit log (Task 4) matches spec format including source tag
- UI integration (Tasks 13-15) covers read-side indicators + optional timeline; write-side refactor in Task 5
- Permission helper extraction (Task 6) before tools (Tasks 8-11) so all tools can use it

### Placeholder scan
- Test bodies use `...` only where the pattern repeats earlier explicit examples (e.g., "rejects unauthorized" repeats across tools). Each placeholder block has a sentence describing what to assert.
- File paths exact; no "find the file" without grep hint
- Commit messages prescribed per task

### Type consistency
- `ConfigSection` type used consistently across writer, audit, tools, UI
- `AgentConfigWriter` API stable from Task 1 through Task 16
- `canManageAgent` signature consistent in Tasks 6, 8-11
- `AuditEntry` format unchanged from Task 4 through Tasks 13-14

### Stage independence
- Stage 1 (Tasks 1-5) ships meaningfully alone — UI saves through unified writer with audit log
- Stage 2 (Tasks 6-12) layers on top — adds chat-driven writes through the same writer
- Stage 3 (Tasks 13-16) layers on top of both — UI surfaces the audit log
