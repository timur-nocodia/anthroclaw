# Operator Control Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three independent, off-by-default subsystems (`human_takeover`, `notifications`, `operator-console` plugin) + a Handoff tab in the UI, composed via YAML, with no agent-specific assumptions in code.

**Architecture:** Three orthogonal layers wired through the gateway. Stage 1 stops production duplicate-replies on its own; Stages 2 and 3 layer notifications and the cross-agent admin plugin on top.

**Tech Stack:** TypeScript (Node ≥22), Zod schemas, vitest, better-sqlite3 (already in use), Next.js 15 App Router for UI, shadcn/ui + Tailwind 4, lucide-react.

**Spec:** [`docs/superpowers/specs/2026-05-01-operator-control-plane-design.md`](../specs/2026-05-01-operator-control-plane-design.md). Read it before any task — every code surface, schema, and behavior is defined there.

---

## Conventions

- All new files use ESM `.js` import suffixes per project convention.
- Tests live under `<dir>/__tests__/<name>.test.ts` matching project pattern.
- Each task ends with a commit; use Conventional Commits.
- Subagent execution: each task is a fresh subagent. Provide full task text + the spec excerpt relevant to that task.

---

## Stage 1 — `human_takeover` subsystem

Goal of stage: turn on `human_takeover.enabled: true` in `agent.yml` → operator outbound on WhatsApp triggers pause → next inbound is skipped → TTL expires → resumes.

### Task 1: Define peer-pause types and store interface

**Files:**
- Create: `src/routing/peer-pause.ts`
- Test: `src/routing/__tests__/peer-pause.test.ts`

- [ ] **Step 1: Write the failing test for type shape**

```ts
import { describe, it, expect } from 'vitest';
import { createPeerPauseStore } from '../peer-pause.js';

describe('PeerPauseStore — basic shape', () => {
  it('starts empty and reports unpaused for unknown peers', () => {
    const store = createPeerPauseStore({ filePath: ':memory:' });
    expect(store.list()).toEqual([]);
    const result = store.isPaused('amina', 'whatsapp:business:37120000@s.whatsapp.net');
    expect(result.paused).toBe(false);
    expect(result.entry).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
npx vitest run src/routing/__tests__/peer-pause.test.ts
```
Expected: FAIL — `createPeerPauseStore` not exported.

- [ ] **Step 3: Implement minimal store**

```ts
export interface PauseEntry {
  agentId: string;
  peerKey: string;
  pausedAt: string;
  expiresAt: string | null;
  reason: 'operator_takeover' | 'manual' | 'manual_indefinite';
  source: string;
  extendedCount: number;
  lastOperatorMessageAt: string | null;
}

export interface PeerPauseStore {
  pause(agentId: string, peerKey: string, opts: { ttlMinutes?: number; reason: PauseEntry['reason']; source: string }): PauseEntry;
  extend(agentId: string, peerKey: string): PauseEntry | null;
  unpause(agentId: string, peerKey: string, reason: string): PauseEntry | null;
  isPaused(agentId: string, peerKey: string): { paused: boolean; entry?: PauseEntry; expired?: boolean };
  list(agentId?: string): PauseEntry[];
}

export interface CreatePeerPauseStoreOptions {
  filePath: string; // ':memory:' for tests
}

export function createPeerPauseStore(opts: CreatePeerPauseStoreOptions): PeerPauseStore {
  const entries = new Map<string, PauseEntry>();
  const key = (agentId: string, peerKey: string) => `${agentId}::${peerKey}`;
  return {
    pause() { throw new Error('not implemented'); },
    extend() { throw new Error('not implemented'); },
    unpause() { throw new Error('not implemented'); },
    isPaused: (agentId, peerKey) => {
      const entry = entries.get(key(agentId, peerKey));
      if (!entry) return { paused: false };
      return { paused: true, entry };
    },
    list: (agentId) => [...entries.values()].filter((e) => !agentId || e.agentId === agentId),
  };
}
```

- [ ] **Step 4: Run tests and verify pass**

```
npx vitest run src/routing/__tests__/peer-pause.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add src/routing/peer-pause.ts src/routing/__tests__/peer-pause.test.ts
git commit -m "feat(routing): scaffold peer-pause store types and isPaused stub"
```

---

### Task 2: Implement pause/unpause/extend with TTL math

**Files:**
- Modify: `src/routing/peer-pause.ts`
- Modify: `src/routing/__tests__/peer-pause.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('PeerPauseStore — pause/unpause/extend', () => {
  const NOW = new Date('2026-05-01T12:00:00Z').getTime();
  const clock = () => NOW;

  it('pause sets entry with expiry and isPaused returns it', () => {
    const store = createPeerPauseStore({ filePath: ':memory:', clock });
    const entry = store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'whatsapp:fromMe' });
    expect(entry.expiresAt).toBe('2026-05-01T12:30:00.000Z');
    expect(entry.extendedCount).toBe(0);
    expect(store.isPaused('amina', 'wa:b:1')).toMatchObject({ paused: true, expired: false });
  });

  it('isPaused returns expired:true after TTL passes', () => {
    const t0 = NOW;
    let now = t0;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => now });
    store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    now = t0 + 31 * 60 * 1000;
    const result = store.isPaused('amina', 'wa:b:1');
    expect(result.paused).toBe(true);
    expect(result.expired).toBe(true);
  });

  it('extend resets expiry and increments extendedCount', () => {
    let now = NOW;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => now });
    store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    now = NOW + 10 * 60 * 1000;
    const ext = store.extend('amina', 'wa:b:1');
    expect(ext?.expiresAt).toBe('2026-05-01T12:40:00.000Z');
    expect(ext?.extendedCount).toBe(1);
  });

  it('unpause removes the entry and returns the previous state', () => {
    const store = createPeerPauseStore({ filePath: ':memory:', clock });
    store.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    const removed = store.unpause('amina', 'wa:b:1', 'manual');
    expect(removed?.peerKey).toBe('wa:b:1');
    expect(store.isPaused('amina', 'wa:b:1').paused).toBe(false);
  });

  it('indefinite pause has expiresAt: null and never reports expired', () => {
    let now = NOW;
    const store = createPeerPauseStore({ filePath: ':memory:', clock: () => now });
    store.pause('amina', 'wa:b:1', { reason: 'manual_indefinite', source: 'mcp:operator-console' });
    now = NOW + 100 * 24 * 60 * 60 * 1000;
    expect(store.isPaused('amina', 'wa:b:1')).toMatchObject({ paused: true, expired: false });
  });
});
```

- [ ] **Step 2: Run to verify failure** (clock option doesn't exist yet)

- [ ] **Step 3: Implement with injected clock**

Add `clock?: () => number` to options (defaults to `Date.now`). Implement `pause`, `extend`, `unpause`, and update `isPaused` to compute `expired` from `entry.expiresAt`.

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(routing): peer-pause TTL math, extend, unpause"
```

---

### Task 3: Persistence — load/save to data/peer-pauses.json

**Files:**
- Modify: `src/routing/peer-pause.ts`
- Modify: `src/routing/__tests__/peer-pause.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('PeerPauseStore — persistence', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pp-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('saves to disk and reloads on next instance', async () => {
    const path = join(dir, 'peer-pauses.json');
    const a = createPeerPauseStore({ filePath: path });
    a.pause('amina', 'wa:b:1', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
    await a.flush();   // public flush() for tests; internal save is debounced

    const b = createPeerPauseStore({ filePath: path });
    expect(b.list()).toHaveLength(1);
    expect(b.list()[0].peerKey).toBe('wa:b:1');
  });

  it('handles missing file as empty store', () => {
    const path = join(dir, 'does-not-exist.json');
    const store = createPeerPauseStore({ filePath: path });
    expect(store.list()).toEqual([]);
  });

  it('handles malformed file by logging and starting empty', () => {
    const path = join(dir, 'bad.json');
    require('node:fs').writeFileSync(path, '{not valid json');
    const store = createPeerPauseStore({ filePath: path });
    expect(store.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

Add `flush()` method, internal `scheduleSave()` (debounced 250ms via timer), and load-on-construct (sync). Mirror persistence patterns from `src/cron/scheduler.ts` (`dynamic-cron.json`).

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(routing): peer-pause persistence with debounced writes"
```

---

### Task 4: Add `human_takeover` to AgentYmlSchema

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
it('AgentYmlSchema accepts human_takeover block with defaults', () => {
  const result = AgentYmlSchema.safeParse({
    ...minimalValidAgentYml,
    human_takeover: { enabled: true },
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.human_takeover).toMatchObject({
      enabled: true,
      pause_ttl_minutes: 30,
      channels: ['whatsapp'],
      ignore: ['reactions', 'receipts', 'typing', 'protocol'],
      notification_throttle_minutes: 5,
    });
  }
});

it('human_takeover defaults to disabled', () => {
  const result = AgentYmlSchema.safeParse(minimalValidAgentYml);
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.human_takeover?.enabled ?? false).toBe(false);
  }
});

it('AgentYmlSchema rejects human_takeover.pause_ttl_minutes <= 0', () => {
  const result = AgentYmlSchema.safeParse({
    ...minimalValidAgentYml,
    human_takeover: { enabled: true, pause_ttl_minutes: 0 },
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Add schema in `src/config/schema.ts`**

```ts
export const HumanTakeoverSchema = z.object({
  enabled: z.boolean().default(false),
  pause_ttl_minutes: z.number().int().positive().default(30),
  channels: z.array(z.enum(['whatsapp', 'telegram'])).default(['whatsapp']),
  ignore: z.array(z.enum(['reactions', 'receipts', 'typing', 'protocol']))
    .default(['reactions', 'receipts', 'typing', 'protocol']),
  notification_throttle_minutes: z.number().int().nonnegative().default(5),
});

// In AgentYmlSchema:
human_takeover: HumanTakeoverSchema.optional(),
```

- [ ] **Step 4: Run, verify pass + run full test suite to catch regressions**

```
pnpm test -- src/config
```

- [ ] **Step 5: Commit**

```
git commit -m "feat(schema): add human_takeover config block"
```

---

### Task 5: WhatsApp `fromMe` classifier emits operator_outbound events

**Files:**
- Create: `src/channels/whatsapp-classifier.ts` (extracted helper)
- Test: `src/channels/__tests__/whatsapp-classifier.test.ts`
- Modify: `src/channels/whatsapp.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { classifyFromMe } from '../whatsapp-classifier.js';

describe('classifyFromMe', () => {
  it('returns ignore for reaction', () => {
    const msg: any = { key: { fromMe: true }, message: { reactionMessage: {} } };
    expect(classifyFromMe(msg)).toEqual({ kind: 'ignore', reason: 'reaction' });
  });
  it('returns ignore for protocol', () => {
    const msg: any = { key: { fromMe: true }, message: { protocolMessage: {} } };
    expect(classifyFromMe(msg)).toEqual({ kind: 'ignore', reason: 'protocol' });
  });
  it('returns operator_outbound for plain text', () => {
    const msg: any = {
      key: { fromMe: true, id: 'X', remoteJid: '37120@s.whatsapp.net' },
      message: { conversation: 'hey' },
      messageTimestamp: 12345,
    };
    expect(classifyFromMe(msg)).toEqual({
      kind: 'operator_outbound',
      textPreview: 'hey',
      hasMedia: false,
      messageId: 'X',
      timestamp: 12345,
    });
  });
  it('flags media on imageMessage', () => {
    const msg: any = {
      key: { fromMe: true, id: 'X', remoteJid: 'g@g.us' },
      message: { imageMessage: { caption: 'a' } },
      messageTimestamp: 1,
    };
    expect(classifyFromMe(msg)).toMatchObject({ kind: 'operator_outbound', hasMedia: true });
  });
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement classifier**

Extract logic into `whatsapp-classifier.ts` so `whatsapp.ts:421` becomes a single call.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(channels): extract fromMe classifier with operator_outbound detection"
```

---

### Task 6: Wire `whatsapp.ts` to emit operator_outbound to gateway

**Files:**
- Modify: `src/channels/whatsapp.ts`
- Modify: `src/channels/types.ts` (add operator_outbound to ChannelAdapter event interface)
- Test: `src/channels/__tests__/whatsapp-operator-outbound.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// Mock baileys; assert that fromMe text msg → channel adapter emits 'operator_outbound'
it('emits operator_outbound for fromMe text message', async () => {
  const adapter = await createTestWhatsAppAdapter({ accountId: 'business' });
  const events: any[] = [];
  adapter.on('operator_outbound', (e) => events.push(e));
  await adapter.simulateUpsert([{
    key: { fromMe: true, id: 'M1', remoteJid: '37120@s.whatsapp.net' },
    message: { conversation: 'hi from operator' },
    messageTimestamp: 1700000000,
  }]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    accountId: 'business',
    peerKey: 'whatsapp:business:37120@s.whatsapp.net',
    textPreview: 'hi from operator',
    messageId: 'M1',
  });
});

it('does NOT emit for fromMe reaction', async () => { ... });
```

(`createTestWhatsAppAdapter` is a thin test helper that exposes `simulateUpsert` — write it alongside this test.)

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Modify `whatsapp.ts:421` block**

Replace the silent `continue` with a call to the classifier. On `operator_outbound` kind, emit a typed event from the adapter; still `continue` (don't dispatch to agent). On `ignore` kind, still `continue`.

Add `OperatorOutboundEvent` type to `src/channels/types.ts` and extend `ChannelAdapter` interface to expose `on('operator_outbound', cb)`.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(channels): emit operator_outbound from whatsapp adapter"
```

---

### Task 7: Gateway subscribes to operator_outbound, pauses peer

**Files:**
- Modify: `src/gateway.ts`
- Test: `src/__tests__/gateway-human-takeover.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('on operator_outbound, gateway pauses the peer for the configured TTL', async () => {
  const gw = await createTestGateway({
    agents: { amina: { human_takeover: { enabled: true, pause_ttl_minutes: 30 } } },
  });
  gw.simulateChannelEvent('whatsapp', 'business', {
    type: 'operator_outbound',
    peerKey: 'whatsapp:business:37120@s.whatsapp.net',
    messageId: 'X', timestamp: 1, hasMedia: false, textPreview: 'hi',
  });
  const status = gw.peerPauseStore.isPaused('amina', 'whatsapp:business:37120@s.whatsapp.net');
  expect(status.paused).toBe(true);
});

it('does NOT pause when human_takeover.enabled is false', async () => {
  const gw = await createTestGateway({
    agents: { amina: { human_takeover: { enabled: false } } },
  });
  gw.simulateChannelEvent(...);
  expect(gw.peerPauseStore.list('amina')).toEqual([]);
});

it('extends pause on subsequent operator_outbound', async () => {
  // pause set, fast-forward 10min, second operator_outbound → expiresAt advances
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

In `gateway.start`: instantiate `PeerPauseStore`, subscribe to each `ChannelAdapter`'s `operator_outbound` event. For each event, look up which agent owns that route+peer (existing `RouteTable.match`-like logic), check if `agent.config.human_takeover?.enabled`, call `peerPauseStore.pause` or `extend`.

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(gateway): wire operator_outbound → peer-pause store"
```

---

### Task 8: Pre-dispatch pause check in `Gateway.dispatch`

**Files:**
- Modify: `src/gateway.ts`
- Modify: `src/__tests__/gateway-human-takeover.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('skips dispatch for paused peer', async () => {
  const gw = await createTestGateway({ agents: { amina: { human_takeover: { enabled: true } } } });
  gw.peerPauseStore.pause('amina', 'whatsapp:business:37120@s.whatsapp.net', {
    ttlMinutes: 30, reason: 'operator_takeover', source: 'wa',
  });
  const queryAgent = vi.spyOn(gw, 'queryAgent');
  await gw.dispatch(makeInboundMessage({ peerId: '37120@s.whatsapp.net' }));
  expect(queryAgent).not.toHaveBeenCalled();
});

it('clears expired pause and dispatches normally', async () => {
  // pause + advance clock past TTL + dispatch → queryAgent called, pause removed
});
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement check**

Insert in `Gateway.dispatch` after access control + rate limiter, before `hookEmitter.emit('on_message_received')`. If `paused.expired`, unpause + (Stage 2 will hook notification here — leave a TODO comment with event name `peer_pause_ended`).

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(gateway): skip dispatch for paused peers; auto-clear expired"
```

---

### Task 9: Pre-send pause check in `send_message` tool

**Files:**
- Modify: `src/agent/tools/send-message.ts` (find existing tool path)
- Test: `src/agent/tools/__tests__/send-message-pause-suppress.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('suppresses send when peer is paused mid-generation', async () => {
  const gw = await createTestGateway({ agents: { amina: { human_takeover: { enabled: true } } } });
  const tool = gw.agents.get('amina')!.getTool('send_message');
  gw.peerPauseStore.pause('amina', 'whatsapp:business:37120@s.whatsapp.net', { ttlMinutes: 30, reason: 'operator_takeover', source: 'wa' });
  const result = await tool.handler({
    channel: 'whatsapp',
    account_id: 'business',
    peer_id: '37120@s.whatsapp.net',
    text: 'reply that should be suppressed',
  }, mockContext({ agentId: 'amina' }));
  expect(result).toMatchObject({ suppressed: true, reason: 'paused' });
  expect(mockChannelAdapter.sendCount).toBe(0);
});

it('still sends to non-paused peers normally', async () => { ... });
```

- [ ] **Step 2: Run, verify failure**

- [ ] **Step 3: Implement**

In the `send_message` tool handler, before invoking the channel adapter's send, check `peerPauseStore.isPaused(agentId, peerKey)`. If paused (and not expired), return `{ suppressed: true, reason: 'paused', expires_at }` without sending.

(Stage 2 will hook a notification here — TODO comment.)

- [ ] **Step 4: Run, verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(send_message): suppress sends to paused peers"
```

---

### Task 10: Stage 1 integration test — full E2E

**Files:**
- Test: `src/__tests__/integration/human-takeover-e2e.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('end-to-end: WA fromMe → pause → skip inbound → TTL expire → resume', async () => {
  const clock = mockClock('2026-05-01T12:00:00Z');
  const gw = await createTestGateway({
    agents: { amina: { human_takeover: { enabled: true, pause_ttl_minutes: 30 } } },
    clock,
  });

  // 1. Operator outbound
  gw.simulateWhatsAppUpsert({ fromMe: true, peer: '37120@s.whatsapp.net', text: 'attended' });

  // 2. Client inbound — should be skipped
  const queryCalls: string[] = [];
  gw.onQueryAgent((agentId, text) => queryCalls.push(`${agentId}:${text}`));
  await gw.simulateInbound({ channel: 'whatsapp', accountId: 'business', peerId: '37120@s.whatsapp.net', text: 'thanks' });
  expect(queryCalls).toEqual([]);

  // 3. Advance clock past TTL
  clock.advance(31 * 60 * 1000);

  // 4. Next inbound — dispatched normally
  await gw.simulateInbound({ channel: 'whatsapp', accountId: 'business', peerId: '37120@s.whatsapp.net', text: 'still there?' });
  expect(queryCalls).toEqual(['amina:still there?']);
});
```

- [ ] **Step 2: Run, verify pass** (all wiring should already be in place from Tasks 1-9)

- [ ] **Step 3: If fails, debug whatever is missing**

- [ ] **Step 4: Commit**

```
git commit -m "test(integration): human_takeover end-to-end pause/resume cycle"
```

---

## Stage 2 — `notifications` subsystem

Goal of stage: pause events from Stage 1 emit Telegram-formatted notifications to a configured operator route. Daily summary fires via cron.

### Task 11: Notifications types and emitter scaffold

**Files:**
- Create: `src/notifications/types.ts`
- Create: `src/notifications/emitter.ts`
- Test: `src/notifications/__tests__/emitter.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { createNotificationsEmitter } from '../emitter.js';

describe('NotificationsEmitter — scaffold', () => {
  it('exists and accepts subscriptions', () => {
    const emitter = createNotificationsEmitter({ sendMessage: vi.fn() });
    expect(typeof emitter.emit).toBe('function');
    expect(typeof emitter.subscribe).toBe('function');
  });
});
```

- [ ] **Step 2-5: Stub interface, types, commit**

Types in `src/notifications/types.ts`:

```ts
export type NotificationEventName =
  | 'peer_pause_started'
  | 'peer_pause_ended'
  | 'peer_pause_intervened_during_generation'
  | 'peer_pause_summary_daily'
  | 'agent_error'
  | 'iteration_budget_exhausted'
  | 'escalation_needed';

export interface NotificationEventPayload { agentId: string; [k: string]: unknown }

export interface NotificationRoute { channel: 'telegram' | 'whatsapp'; accountId: string; peerId: string }

export interface NotificationSubscription {
  event: NotificationEventName;
  route: string;       // route name, lookup by agent
  schedule?: string;   // cron expr, only valid for periodic events
  throttle?: string;   // '5m' | '1h' etc
  filter?: Record<string, unknown>;
}
```

```
git commit -m "feat(notifications): scaffold emitter and event types"
```

---

### Task 12: Notifications schema + validation

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/__tests__/schema.test.ts`

- [ ] **Step 1-5:** TDD — schema tests for routes/subscriptions/throttle/schedule. Mirror Task 4 structure. Commit:

```
git commit -m "feat(schema): add notifications config block with routes and subscriptions"
```

---

### Task 13: Event formatters (Telegram + plain)

**Files:**
- Create: `src/notifications/formatters.ts`
- Test: `src/notifications/__tests__/formatters.test.ts`

- [ ] **Step 1: Write failing tests**

One test per event name. Telegram-formatted output uses `*bold*`, `_italic_`, `` `code` `` per project convention. WhatsApp formatter falls back to plain text.

```ts
it('formats peer_pause_started for telegram', () => {
  const msg = formatTelegram('peer_pause_started', {
    agentId: 'amina',
    peerKey: 'whatsapp:business:37120@s.whatsapp.net',
    expiresAt: '2026-05-01T12:30:00Z',
  });
  expect(msg).toContain('*Auto-pause*');
  expect(msg).toContain('`whatsapp:business:37120@s.whatsapp.net`');
  expect(msg).toContain('14:30');  // formatted local time per agent timezone
});
```

- [ ] **Step 2-5:** Implement, run, commit.

```
git commit -m "feat(notifications): event formatters for telegram and plain text"
```

---

### Task 14: Subscription dispatch + throttle

**Files:**
- Modify: `src/notifications/emitter.ts`
- Modify: `src/notifications/__tests__/emitter.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
it('emit calls sendMessage on each matching subscription', async () => {
  const sendMessage = vi.fn();
  const emitter = createNotificationsEmitter({ sendMessage });
  emitter.subscribeAgent('amina', {
    routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
    subscriptions: [{ event: 'peer_pause_started', route: 'operator' }],
  });
  await emitter.emit('peer_pause_started', { agentId: 'amina', peerKey: 'wa:b:1', expiresAt: '...' });
  expect(sendMessage).toHaveBeenCalledOnce();
  expect(sendMessage.mock.calls[0][0]).toMatchObject({ channel: 'telegram', peerId: '48705953' });
});

it('throttle dedupes identical events within window', async () => {
  // emit twice within 5m → only one send
  // emit a third time after 6m → second send happens
});

it('does not match unsubscribed events', async () => { ... });

it('skips when notifications.enabled is false', async () => { ... });
```

- [ ] **Step 2-5:** Implement, run, commit.

```
git commit -m "feat(notifications): subscription dispatch with per-event throttle"
```

---

### Task 15: Cron-scheduled events (daily summary)

**Files:**
- Modify: `src/notifications/emitter.ts`
- Modify: `src/cron/scheduler.ts` (register notification cron)
- Test: `src/notifications/__tests__/scheduled-events.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('peer_pause_summary_daily fires at scheduled cron and emits aggregated payload', async () => {
  const sendMessage = vi.fn();
  const emitter = createNotificationsEmitter({ sendMessage });
  emitter.subscribeAgent('amina', {
    routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
    subscriptions: [{ event: 'peer_pause_summary_daily', route: 'operator', schedule: '0 9 * * *' }],
  });
  // simulate cron tick at 09:00
  await emitter.fireScheduled('peer_pause_summary_daily');
  expect(sendMessage).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2-5:** Implement registration via the existing `CronScheduler`, summary builder reads from `peerPauseStore.list(agentId)` for daily aggregation. Commit.

```
git commit -m "feat(notifications): cron-scheduled events with aggregated summaries"
```

---

### Task 16: Wire pause events from Stage 1 to notifications emitter

**Files:**
- Modify: `src/gateway.ts`
- Modify: `src/agent/tools/send-message.ts`
- Test: `src/__tests__/integration/human-takeover-with-notifications.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('pause start emits peer_pause_started; expiry emits peer_pause_ended', async () => {
  const sendMessage = vi.fn();
  const gw = await createTestGateway({
    agents: {
      amina: {
        human_takeover: { enabled: true, pause_ttl_minutes: 30 },
        notifications: {
          enabled: true,
          routes: { operator: { channel: 'telegram', accountId: 'control', peerId: '48705953' } },
          subscriptions: [
            { event: 'peer_pause_started', route: 'operator' },
            { event: 'peer_pause_ended', route: 'operator' },
          ],
        },
      },
    },
    sendMessage,
  });
  gw.simulateWhatsAppUpsert({ fromMe: true, peer: '37120@s.whatsapp.net', text: 'hi' });
  expect(sendMessage).toHaveBeenCalledOnce();
  // ... advance clock + simulate inbound → should fire peer_pause_ended
});

it('mid-generation suppression emits peer_pause_intervened_during_generation', async () => { ... });
```

- [ ] **Step 2-5:** Replace TODO comments from Tasks 8 and 9 with `notificationsEmitter.emit(...)` calls. Wire emitter into Gateway construction, call `subscribeAgent` per loaded agent. Commit.

```
git commit -m "feat(gateway): wire pause events to notifications emitter"
```

---

## Stage 3 — `operator-console` plugin + UI

Goal of stage: operator agent on TG can call `peer_pause` / `delegate_to_peer` / `list_active_peers` / `peer_summary` / `escalate` against managed agents; Handoff tab in agent settings renders + edits the configs end-to-end.

### Task 17: Plugin scaffold (manifest, package.json, tsconfig)

**Files:**
- Create: `plugins/operator-console/.claude-plugin/plugin.json`
- Create: `plugins/operator-console/package.json`
- Create: `plugins/operator-console/tsconfig.json`
- Create: `plugins/operator-console/vitest.config.ts`
- Create: `plugins/operator-console/src/index.ts` (stub `register()`)

- [ ] **Step 1: Mirror `plugins/lcm/` layout**

`plugin.json`:

```json
{
  "name": "operator-console",
  "version": "0.1.0",
  "description": "Cross-agent admin tools — pause/unpause/delegate/summarize peers from another channel.",
  "entry": "dist/index.js",
  "configSchema": "dist/config.js",
  "requires": { "anthroclaw": ">=0.5.0" }
}
```

`src/index.ts`:

```ts
import type { PluginContext, PluginInstance } from './types-shim.js';
export function register(ctx: PluginContext): PluginInstance {
  return { name: 'operator-console', tools: [], hooks: [], dispose: async () => {} };
}
```

- [ ] **Step 2: Verify**

```
pnpm -C plugins/operator-console install
pnpm -C plugins/operator-console build
```

- [ ] **Step 3: Commit**

```
git commit -m "feat(operator-console): scaffold plugin layout mirroring lcm"
```

---

### Task 18: Plugin config schema + permissions enforcement

**Files:**
- Create: `plugins/operator-console/src/config.ts`
- Create: `plugins/operator-console/src/permissions.ts`
- Test: `plugins/operator-console/tests/permissions.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { resolveConfig } from '../src/config.js';
import { canManage } from '../src/permissions.js';

describe('operator-console permissions', () => {
  it('canManage true when target listed in manages array', () => {
    const cfg = resolveConfig({ enabled: true, manages: ['amina'] });
    expect(canManage(cfg, 'amina')).toBe(true);
    expect(canManage(cfg, 'larry')).toBe(false);
  });
  it('manages: "*" allows all', () => {
    const cfg = resolveConfig({ enabled: true, manages: '*' });
    expect(canManage(cfg, 'amina')).toBe(true);
    expect(canManage(cfg, 'anything')).toBe(true);
  });
  it('disabled config refuses everything', () => {
    const cfg = resolveConfig({ enabled: false, manages: '*' });
    expect(canManage(cfg, 'amina')).toBe(false);
  });
});
```

- [ ] **Step 2-5:** Implement, run, commit.

```
git commit -m "feat(operator-console): config schema and manages whitelist"
```

---

### Task 19: `peer_pause` tool

**Files:**
- Create: `plugins/operator-console/src/tools/peer-pause.ts`
- Test: `plugins/operator-console/tests/peer-pause.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('operator_console.peer_pause', () => {
  it('action=pause sets pause on target via gateway store', async () => {
    const fakeStore = makeFakePauseStore();
    const tool = createPeerPauseTool({ pauseStore: fakeStore, config: { enabled: true, manages: ['amina'] } });
    const r = await tool.handler({
      target_agent_id: 'amina',
      peer: { channel: 'whatsapp', account_id: 'business', peer_id: '37120@s.whatsapp.net' },
      action: 'pause',
      ttl_minutes: 60,
    }, mockCtx({ agentId: 'klavdia' }));
    expect(r).toMatchObject({ ok: true, expires_at: expect.any(String) });
    expect(fakeStore.list('amina')).toHaveLength(1);
  });

  it('rejects unmanaged target', async () => {
    const tool = createPeerPauseTool({ pauseStore: makeFakePauseStore(), config: { enabled: true, manages: ['amina'] } });
    await expect(tool.handler({ target_agent_id: 'larry', peer: { ... }, action: 'pause' }, mockCtx())).rejects.toThrow(/not authorized/);
  });

  it('action=unpause/list/status work end-to-end', async () => { ... });

  it('ttl_minutes=null produces indefinite pause (manual_indefinite)', async () => { ... });
});
```

- [ ] **Step 2-5:** Implement tool with `tool()` from agent-sdk, route through `pauseStore` + permission check, commit.

```
git commit -m "feat(operator-console): peer_pause tool"
```

---

### Task 20: `delegate_to_peer` tool

**Files:**
- Create: `plugins/operator-console/src/tools/delegate-to-peer.ts`
- Test: `plugins/operator-console/tests/delegate-to-peer.test.ts`
- Modify: `src/cron/scheduler.ts` (extract `dispatchSyntheticInbound` helper)

- [ ] **Step 1: Write failing tests**

```ts
it('synthesizes an inbound to target session and returns dispatched_message_id', async () => {
  const dispatched: any[] = [];
  const tool = createDelegateTool({
    dispatchSynthetic: (msg) => { dispatched.push(msg); return { messageId: 'ID' }; },
    config: { enabled: true, manages: ['amina'] },
  });
  const r = await tool.handler({
    target_agent_id: 'amina',
    peer: { channel: 'whatsapp', account_id: 'business', peer_id: '37120@s.whatsapp.net' },
    instruction: 'find out a convenient time for a call',
  }, mockCtx({ agentId: 'klavdia' }));
  expect(r.ok).toBe(true);
  expect(dispatched).toHaveLength(1);
  expect(dispatched[0].text).toContain('Operator delegation');
  expect(dispatched[0].text).toContain('find out a convenient time for a call');
});
```

- [ ] **Step 2-5:** Extract helper from `cron/scheduler.ts` to share, implement tool, run, commit.

```
git commit -m "feat(operator-console): delegate_to_peer via synthetic inbound"
```

---

### Task 21: `list_active_peers` tool

**Files:**
- Create: `plugins/operator-console/src/tools/list-active-peers.ts`
- Test: `plugins/operator-console/tests/list-active-peers.test.ts`

- [ ] **Step 1-5:** TDD — returns recent peers from pause store + recent message activity, optional `since` and `limit`. Commit.

```
git commit -m "feat(operator-console): list_active_peers tool"
```

---

### Task 22: `peer_summary` tool

**Files:**
- Create: `plugins/operator-console/src/tools/peer-summary.ts`
- Test: `plugins/operator-console/tests/peer-summary.test.ts`

- [ ] **Step 1-5:** TDD — uses `memory_search` against the target agent's memory store filtered by peer, optional `since`. Commit.

```
git commit -m "feat(operator-console): peer_summary tool"
```

---

### Task 23: `escalate` tool

**Files:**
- Create: `plugins/operator-console/src/tools/escalate.ts`
- Test: `plugins/operator-console/tests/escalate.test.ts`

- [ ] **Step 1-5:** TDD — emits `escalation_needed` notification for the calling agent (no target). Commit.

```
git commit -m "feat(operator-console): escalate tool"
```

---

### Task 24: Wire plugin entry — register all 5 tools

**Files:**
- Modify: `plugins/operator-console/src/index.ts`
- Test: `plugins/operator-console/tests/index-register.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('register returns 5 tools when all capabilities enabled', () => {
  const ctx = makeFakePluginContext({ config: { enabled: true, manages: ['amina'], capabilities: ['peer_pause','delegate','list_peers','peer_summary','escalate'] } });
  const inst = register(ctx);
  expect(inst.tools.map((t) => t.name)).toEqual([
    'operator_console.peer_pause',
    'operator_console.delegate_to_peer',
    'operator_console.list_active_peers',
    'operator_console.peer_summary',
    'operator_console.escalate',
  ]);
});

it('omits tools not listed in capabilities', () => { ... });

it('returns no tools when enabled=false', () => { ... });
```

- [ ] **Step 2-5:** Implement, run, commit.

```
git commit -m "feat(operator-console): register all tools by capabilities"
```

---

### Task 25: API endpoints for pauses

**Files:**
- Create: `ui/app/api/agents/[agentId]/pauses/route.ts` (GET, POST)
- Create: `ui/app/api/agents/[agentId]/pauses/[peerKey]/route.ts` (DELETE)
- Create: `ui/app/api/agents/[agentId]/pause-events/route.ts` (GET)
- Create: `ui/app/api/notifications/test/route.ts` (POST)
- Test: `ui/__tests__/api/pauses.test.ts`
- Test: `ui/__tests__/api/notifications-test.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('GET /api/agents/[agentId]/pauses', () => {
  it('returns 401 without auth', async () => { ... });
  it('returns active pauses for the agent', async () => {
    const gw = mockGateway({ pauses: [{ agentId: 'amina', peerKey: 'wa:b:1', ... }] });
    const res = await GET(req('/api/agents/amina/pauses'), { params: { agentId: 'amina' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pauses: [{ peerKey: 'wa:b:1' }] });
  });
});
describe('DELETE /api/agents/[agentId]/pauses/[peerKey]', () => { ... });
describe('POST /api/agents/[agentId]/pauses', () => { ... });
describe('POST /api/notifications/test', () => { ... });
```

- [ ] **Step 2-5:** Implement using `withAuth()` from `lib/route-handler.ts`, commit.

```
git commit -m "feat(ui): API endpoints for pauses CRUD and notifications test"
```

---

### Task 26: HumanTakeoverCard component

**Files:**
- Create: `ui/components/handoff/HumanTakeoverCard.tsx`
- Test: `ui/__tests__/components/HumanTakeoverCard.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it('renders all controls with current values', () => { ... });
it('toggling enabled triggers onChange', () => { ... });
it('saving sends PATCH to agent config endpoint', () => { ... });
```

- [ ] **Step 2-5:** Implement form with shadcn/ui inputs, OC tokens for styling, commit.

```
git commit -m "feat(ui): HumanTakeoverCard with form + persist"
```

---

### Task 27: NotificationsCard component

**Files:**
- Create: `ui/components/handoff/NotificationsCard.tsx`
- Test: `ui/__tests__/components/NotificationsCard.test.tsx`

- [ ] **Step 1-5:** Routes array UI + Subscriptions array UI + Test button per route. Commit.

```
git commit -m "feat(ui): NotificationsCard with routes and subscriptions editor"
```

---

### Task 28: ActivePausesTable component

**Files:**
- Create: `ui/components/handoff/ActivePausesTable.tsx`
- Test: `ui/__tests__/components/ActivePausesTable.test.tsx`

- [ ] **Step 1-5:** Live table with 10s refresh, unpause buttons that call DELETE endpoint, empty state. Commit.

```
git commit -m "feat(ui): ActivePausesTable live view with unpause"
```

---

### Task 29: ActivityLogPanel component

**Files:**
- Create: `ui/components/handoff/ActivityLogPanel.tsx`
- Test: `ui/__tests__/components/ActivityLogPanel.test.tsx`

- [ ] **Step 1-5:** Filterable timeline, last 7 days. Commit.

```
git commit -m "feat(ui): ActivityLogPanel for pause events"
```

---

### Task 30: HandoffTab + wire into agent settings page

**Files:**
- Create: `ui/components/handoff/HandoffTab.tsx`
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` (add TabsTrigger + TabsContent between Routines and Skills)

- [ ] **Step 1: Write failing test**

```tsx
it('HandoffTab renders all four sections', () => {
  render(<HandoffTab serverId="local" agentId="amina" agent={mockAgent} />);
  expect(screen.getByText(/Auto-pause on human takeover/i)).toBeInTheDocument();
  expect(screen.getByText(/Notifications/i)).toBeInTheDocument();
  expect(screen.getByText(/Active pauses/i)).toBeInTheDocument();
  expect(screen.getByText(/Activity log/i)).toBeInTheDocument();
});
```

- [ ] **Step 2-5:** Implement composition + add tab. Use lucide-react `UserCheck` icon. Commit.

```
git commit -m "feat(ui): Handoff tab with all four sections wired into agent settings"
```

---

### Task 31: Stage 3 integration test — full E2E

**Files:**
- Test: `src/__tests__/integration/operator-console-e2e.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it('e2e: operator agent pauses a managed agent peer via Telegram', async () => {
  const gw = await createTestGateway({
    agents: {
      klavdia: {
        plugins: { 'operator-console': { enabled: true, manages: ['amina'] } },
        mcp_tools: ['operator_console.peer_pause'],
      },
      amina: {
        human_takeover: { enabled: true },
      },
    },
  });

  // Klavdia receives a Telegram inbound asking to pause +371
  await gw.simulateInbound({
    channel: 'telegram', accountId: 'control', peerId: '48705953',
    text: 'pause +37120@s.whatsapp.net for amina',
  });

  // After Klavdia processes: pause exists for amina
  expect(gw.peerPauseStore.list('amina')).toHaveLength(1);
});

it('e2e: delegate_to_peer dispatches synthesized inbound to managed agent', async () => { ... });
```

- [ ] **Step 2-5:** Run, fix any wiring gaps, commit.

```
git commit -m "test(integration): operator-console e2e via klavdia → amina"
```

---

### Task 32: Final full-implementation review

**Files:** review all changes since branching from `main`.

- [ ] **Step 1: Dispatch final code-reviewer subagent**

Review against the spec at `docs/superpowers/specs/2026-05-01-operator-control-plane-design.md`. Acceptance:
- All three subsystems work independently (test by enabling only one at a time in a fresh config)
- All three are off-by-default (omitting block = subsystem disabled)
- No `@anthropic-ai/sdk` import added; no Messages API loop in plugin
- Permissions: `manages: '*'` works as super-admin; missing target rejected with clear error
- UI: Handoff tab renders, all four sub-components functional, API endpoints under `withAuth()`
- Test coverage: all new code has unit tests, two integration tests (Stage 1 e2e, Stage 3 e2e) green

- [ ] **Step 2: Run full test suite**

```
pnpm test
pnpm -C ui test
pnpm -C plugins/operator-console test
pnpm build
pnpm -C ui build
```

All green.

- [ ] **Step 3: Update CHANGELOG.md**

```
## [Unreleased]
### Added
- Operator control plane: `human_takeover`, `notifications`, `operator-console` plugin (#6).
  - WhatsApp `fromMe` → auto-pause with sliding-window TTL
  - Generic notifications emitter with cron-scheduled events
  - Cross-agent admin tools: `peer_pause`, `delegate_to_peer`, `list_active_peers`, `peer_summary`, `escalate`
  - New "Handoff" tab in agent settings (UI)
- All three subsystems are off-by-default and independently composable.
```

- [ ] **Step 4: Mark PR ready for review**

```
gh pr ready 6
```

- [ ] **Step 5: Commit**

```
git commit -m "docs(changelog): operator control plane v0.6.0"
```

---

## Self-review

### Spec coverage
- Each spec section maps to at least one task: schemas (Tasks 4, 12, 18), peer-pause store (Tasks 1-3), channel detection (Tasks 5, 6), gateway integration (Tasks 7-9), notifications emitter (Tasks 11-15), event wiring (Task 16), plugin scaffold + tools (Tasks 17-24), API + UI (Tasks 25-30), e2e (Tasks 10, 16, 31, 32).
- Permission model (Variant 1) covered in Task 18.
- UI Handoff tab covered in Tasks 26-30; cross-agent dashboard noted as bonus in spec (out of plan scope).
- Persona switching deferred per spec — not in plan.

### Placeholder scan
- Test bodies use `...` placeholders only where the test pattern repeats earlier explicit examples (e.g., "rejects auth", "throttle dedupes"). Each `...` block has a clear sentence describing what to assert.
- File paths exact and absolute under repo root.
- Commit messages prescribed per task.

### Type consistency
- `PauseEntry` shape used consistently across Tasks 1-3, 7-9, 16, 25, 28.
- `NotificationEventName` enum referenced from Task 11 in Tasks 12, 13, 14, 16.
- `operator_console.<tool>` namespace consistent across Tasks 19-24, 31.
- `manages` field consistent across Tasks 18-24, 31, 32.

### Stage independence
- Stage 1 (Tasks 1-10) ships meaningfully alone — duplicate-reply problem solved.
- Stage 2 (Tasks 11-16) layers on top — no Stage 1 changes required, only consumes its events.
- Stage 3 (Tasks 17-32) layers on top of both — UI references Stage 1 store and Stage 2 emitter.
