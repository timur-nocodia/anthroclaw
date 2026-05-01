# Channel Binding UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current flat `routes:` editor in the agent Config tab with a wizard-driven binding configuration UI that operators can mouse-drive without knowing field names or peer-ID formats. Add a `route-test` API endpoint for offline binding verification.

**Architecture:** New "Where this agent listens" section in Config tab uses BindingWizardDialog (5 steps) for add/edit, BindingCard for display, and a route-test endpoint for verification. All writes go through the existing `AgentConfigWriter` from PR #7. Existing flat-row Routes editor is hidden behind an "Advanced" expandable for power users.

**Tech Stack:** Next.js 15 App Router, shadcn/ui, Tailwind 4, lucide-react, OC tokens, vitest.

**Spec:** [`docs/superpowers/specs/2026-05-01-binding-ux-design.md`](../specs/2026-05-01-binding-ux-design.md). Read it before any task.

**Depends on:** PR #6 (`AgentConfigWriter`, `routes:` schema) and PR #7 (audit log + `PATCH /api/agents/[id]/config`). Both already merged in v0.6.0.

---

## Conventions

- ESM `.js` import suffixes
- Strict TypeScript, no `any`
- Default to no comments unless WHY is non-obvious
- Vitest 3 syntax
- shadcn/ui components for primitives, OC tokens (`var(--oc-bg0)` etc.) for custom styling per `ui/CLAUDE.md`
- lucide-react for icons
- All new API routes wrapped in `withAuth()` from `lib/route-handler.ts`

---

## Stage 1 — Backend route-test endpoint + section reorganization

Goal: shippable layer 1 — backend infra for binding test plus visible section restructure even before the wizard ships.

### Task 1: `POST /api/agents/[agentId]/route-test` endpoint

**Files:**
- Create: `ui/app/api/agents/[agentId]/route-test/route.ts`
- Create test: `ui/__tests__/api/route-test.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { POST } from '@/app/api/agents/[agentId]/route-test/route';

describe('POST /api/agents/[id]/route-test', () => {
  it('returns 401 without auth', async () => {
    const res = await POST(new Request('http://x/api/agents/op/route-test', { method: 'POST', body: '{}' }), { params: { agentId: 'op' } });
    expect(res.status).toBe(401);
  });

  it('returns matched: true when route + access pass', async () => {
    // mock gateway with operator_agent route on group + topic 3
    const res = await POST(authReq({
      channel: 'telegram', account_id: 'content_sm', chat_type: 'group',
      peer_id: '-1003729315809', thread_id: '3', sender_id: '48705953',
      text: '@clowwy_bot покажи show_config', mentioned_bot: true,
    }), { params: { agentId: 'operator_agent' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      matched: true,
      agent_id: 'operator_agent',
      session_key: expect.stringContaining('thread:3'),
      blockers: [],
    });
  });

  it('returns matched: false with reason when topic mismatches', async () => {
    const res = await POST(authReq({ ...validPayload, thread_id: '99' }), { params: { agentId: 'operator_agent' } });
    expect(await res.json()).toMatchObject({
      matched: false,
      blockers: expect.arrayContaining([{ stage: 'route', reason: expect.stringMatching(/topic/i) }]),
    });
  });

  it('returns blocker when mention_only and not mentioned', async () => { ... });
  it('returns blocker when sender not in allowlist', async () => { ... });
});
```

- [ ] **Step 2: Verify failure** (endpoint doesn't exist)

- [ ] **Step 3: Implement**

The handler under `withAuth()`:
1. Parse body into `RouteTestRequest` shape
2. `const gw = await getGateway()`
3. `const route = gw.routeTable.resolve(channel, account_id, chat_type, peer_id, thread_id)`
4. If no route → return `{ matched: false, blockers: [{ stage: 'route', reason: 'no route matched ...' }] }`
5. If route doesn't belong to requested `agentId` → return matched-but-different-agent (operator can still see this is useful info)
6. Run mention check: if `route.mentionOnly && !mentioned_bot` → blocker
7. Run access-control check: pairing.mode + allowlist for sender_id
8. Build session key via `buildSessionKey(...)`
9. Return `{ matched, agent_id, session_key, blockers: [] }`

The endpoint must NOT actually dispatch the message. It's pure read-only inspection.

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(api): route-test endpoint for offline binding verification"
```

---

### Task 2: Rename "Channel behavior" → "Per-chat customization (optional)" + collapse by default

**Files:**
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` (find existing "Channel behavior" Section component, rename + add `defaultCollapsed` prop)

- [ ] **Step 1: Write failing test (component-level)**

```tsx
import { render, screen } from '@testing-library/react';

it('renders Per-chat customization section collapsed by default', () => {
  render(<AgentConfigTab agent={mockAgent} ... />);
  expect(screen.getByText(/Per-chat customization/i)).toBeInTheDocument();
  expect(screen.queryByText(/Operator context for Telegram chats/i)).not.toBeVisible();
});
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement**

The Section component already exists in the page. Either:
- Add a `defaultCollapsed` prop on Section, render with collapsed state if set
- OR refactor "Channel behavior" into its own collapsed Accordion/Disclosure

Mirror existing collapse patterns in the page.

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(ui): rename Channel behavior to Per-chat customization (collapsed)"
```

---

### Task 3: Insert empty placeholder "Where this agent listens" section above

**Files:**
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`
- Create: `ui/components/binding/WhereAgentListensSection.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it('renders Where this agent listens section above Per-chat customization', () => {
  render(<AgentConfigTab agent={mockAgent} ... />);
  const sections = screen.getAllByRole('region', { name: /(Where this agent listens|Per-chat customization)/i });
  expect(sections[0]).toHaveTextContent('Where this agent listens');
  expect(sections[1]).toHaveTextContent('Per-chat customization');
});
```

- [ ] **Step 2: Verify fails**

- [ ] **Step 3: Implement**

`WhereAgentListensSection.tsx` placeholder version: just renders `<Section title="Where this agent listens" subtitle={`${routes.length} bindings`}>` with a plain summary list of routes (read from `cfg.routes`). No "Add binding" button yet (that ships in Stage 2). For each route show:

```
📱 Telegram (account_id) — group/dm — peer_id → topic_id (mention only)
```

Just text; no card UI yet. The point of Stage 1 is to make the section visible in the new location with current data, while wizard ships next.

Also keep the existing Routes section in place (don't delete) — Stage 2 will replace it. They coexist temporarily.

- [ ] **Step 4: Verify pass**

- [ ] **Step 5: Commit**

```
git commit -m "feat(ui): scaffold Where this agent listens section"
```

---

## Stage 2 — BindingWizardDialog + BindingCard

Goal: full wizard end-to-end. After this stage, operators can mouse-drive bindings.

### Task 4: `binding-language.ts` plain-language summary helper

**Files:**
- Create: `ui/components/binding/binding-language.ts`
- Create test: `ui/__tests__/components/binding-language.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describeBinding } from '@/components/binding/binding-language';

describe('describeBinding', () => {
  it('describes telegram group + topic + mention-only', () => {
    expect(describeBinding({
      channel: 'telegram', account: 'content_sm', scope: 'group',
      peers: ['-1003729315809'], topics: ['3'], mention_only: true,
    }, { telegramAccounts: { content_sm: { username: 'clowwy_bot' } } })).toEqual({
      icon: 'telegram',
      title: 'Telegram (clowwy_bot · content_sm)',
      lines: [
        'In group: -1003729315809',
        'In topic: 3',
        'Behavior: Responds only when @-mentioned',
      ],
    });
  });

  it('describes whatsapp DM open pairing', () => { ... });
  it('describes telegram any-scope respond-to-all', () => { ... });
  it('describes route with allowlist hint', () => { ... });
});
```

- [ ] **Step 2-5:** Implement, test, commit.

```
git commit -m "feat(ui): binding-language summary helper"
```

---

### Task 5: `BindingCard` component

**Files:**
- Create: `ui/components/binding/BindingCard.tsx`
- Create test: `ui/__tests__/components/BindingCard.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it('renders binding via describeBinding output', () => { ... });
it('Edit button calls onEdit', () => { ... });
it('Remove button shows confirm dialog before calling onRemove', () => { ... });
it('Test button opens BindingTestPanel', () => { ... });
```

- [ ] **Step 2-5:** Implement using shadcn Card, AlertDialog for confirm. Use `describeBinding` for content. Commit.

```
git commit -m "feat(ui): BindingCard with Edit/Remove/Test actions"
```

---

### Task 6: Wizard scaffold + ChannelStep, AccountStep

**Files:**
- Create: `ui/components/binding/BindingWizardDialog.tsx`
- Create: `ui/components/binding/steps/ChannelStep.tsx`
- Create: `ui/components/binding/steps/AccountStep.tsx`
- Test: `ui/__tests__/components/BindingWizardDialog.test.tsx`

- [ ] **Step 1: Write failing tests for steps 1+2 navigation**

```tsx
it('Step 1 selects telegram and advances', () => { ... });
it('Step 1 auto-advances when only one channel configured', () => { ... });
it('Step 2 lists accounts from gateway config', () => { ... });
it('Step 2 auto-advances when only one account configured', () => { ... });
it('Back button preserves prior selection', () => { ... });
```

- [ ] **Step 2-5:** Implement. Use shadcn Dialog, RadioGroup. Wizard state held in parent component, passed down to step components. Commit.

```
git commit -m "feat(ui): BindingWizardDialog scaffold + Channel and Account steps"
```

---

### Task 7: WhereStep + TargetStep (DMs + Group sub-flows)

**Files:**
- Create: `ui/components/binding/steps/WhereStep.tsx`
- Create: `ui/components/binding/steps/TargetStep.tsx`
- Modify: `BindingWizardDialog.tsx`
- Test: `ui/__tests__/components/BindingWizardDialog.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it('Step 3 (Where) presents DM/Group/Both radio', () => { ... });
it('Step 4 DM sub-flow: All users vs Allowlisted', () => { ... });
it('Step 4 Group sub-flow: chat ID input + forum toggle + topic input', () => { ... });
it('forum toggle off hides topic input', () => { ... });
it('validates chat ID format hint shows', () => { ... });
```

- [ ] **Step 2-5:** Implement. Use Input with hint text + helper validation. Commit.

```
git commit -m "feat(ui): WhereStep and TargetStep with DM/Group sub-flows"
```

---

### Task 8: BehaviorStep + PreviewStep

**Files:**
- Create: `ui/components/binding/steps/BehaviorStep.tsx`
- Create: `ui/components/binding/steps/PreviewStep.tsx`
- Modify: `BindingWizardDialog.tsx`
- Test: `ui/__tests__/components/BindingWizardDialog.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it('Step 5 (Behavior) shows three radios for group scope', () => { ... });
it('Step 5 skipped for DM-only scope', () => { ... });
it('Step 6 (Preview) shows plain-language summary via describeBinding', () => { ... });
it('Step 6 shows YAML diff for new binding', () => { ... });
it('Step 6 Save button writes via PATCH endpoint and shows success', () => { ... });
```

- [ ] **Step 2-5:** Implement. PATCH `/api/agents/[id]/config` with `{ section: 'routes', value: [...newRoutes] }`. Show toast on success. On failure, render the validation error inline.

```
git commit -m "feat(ui): BehaviorStep and PreviewStep with PATCH save"
```

---

### Task 9: Wire wizard into WhereAgentListensSection

**Files:**
- Modify: `ui/components/binding/WhereAgentListensSection.tsx`
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
it('Add binding button opens wizard', () => { ... });
it('Edit on existing binding opens wizard pre-populated', () => { ... });
it('Remove deletes binding and refreshes section', () => { ... });
it('renders BindingCard list when routes exist', () => { ... });
it('renders empty-state hint when no routes', () => { ... });
```

- [ ] **Step 2-5:** Implement. Section renders cards for each route + Add button. Edit/Remove integrate with wizard and PATCH endpoint. Commit.

```
git commit -m "feat(ui): wire BindingWizard into WhereAgentListensSection"
```

---

### Task 10: Add "Advanced (raw routes table)" expandable + remove old Routes section

**Files:**
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it('Advanced expandable contains the original flat-row Routes editor', () => { ... });
it('Advanced is collapsed by default', () => { ... });
```

- [ ] **Step 2-5:** Wrap the existing flat-row Routes editor in an "Advanced (raw routes table)" Disclosure/Accordion. Move under WhereAgentListensSection. Old top-level Routes section removed (or just relocated). Commit.

```
git commit -m "feat(ui): hide raw routes table behind Advanced expandable"
```

---

## Stage 3 — Polish + final review

### Task 11: BindingTestPanel — uses route-test endpoint

**Files:**
- Create: `ui/components/binding/BindingTestPanel.tsx`
- Modify: `ui/components/binding/BindingCard.tsx`
- Test: `ui/__tests__/components/BindingTestPanel.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
it('Test panel shows form with sender_id, text, mention checkbox', () => { ... });
it('Run match button calls /api/agents/[id]/route-test', () => { ... });
it('renders matched: ✓ Routed to operator_agent', () => { ... });
it('renders blocker reasons when not matched', () => { ... });
```

- [ ] **Step 2-5:** Implement. Pre-populate form from binding's route data (channel, account, peer, topic). Operator just types text + flags mention. POST to route-test endpoint, render result. Commit.

```
git commit -m "feat(ui): BindingTestPanel for offline binding verification"
```

---

### Task 12: Final review + CHANGELOG + ready

**Files:**
- Modify: `CHANGELOG.md`

#### Step 1: Run full suites

```bash
npx vitest run
pnpm -C ui test
pnpm -C plugins/operator-console test
npx tsc --noEmit
pnpm build
pnpm -C ui build
```

All green.

#### Step 2: Verify acceptance scenarios from spec

1. Add binding wizard end-to-end → operator can configure operator_agent's binding entirely via wizard
2. Edit pre-populates correctly
3. Test panel shows match/blocker reasons

If any scenario fails, fix before proceeding.

#### Step 3: Update CHANGELOG.md

```md
## [Unreleased]

### Added
- **Channel binding wizard** (#8): new "Where this agent listens" section in
  agent settings replaces the flat-row Routes editor with a 5-step wizard
  (Channel → Account → Where → Target → Behavior → Preview). Plain-language
  summaries on each binding card; Edit pre-populates; Remove confirms.
- `POST /api/agents/[id]/route-test` — offline binding verification endpoint;
  reuses RouteTable.resolve + access-control checks without dispatching.
- BindingTestPanel: per-binding "Test" button that drives the route-test
  endpoint and surfaces match/blocker reasons.

### Changed
- "Channel behavior" section renamed to "Per-chat customization (optional)"
  and collapsed by default — it was being mistaken for the binding config.
- Old flat-row Routes editor moved behind an "Advanced (raw routes table)"
  expandable for power users.
```

#### Step 4: Mark PR ready

```
gh pr ready 8
```

#### Step 5: Commit

```
git commit -m "docs(changelog): channel binding wizard (PR #8)"
```

---

## Self-review

### Spec coverage
- Each spec subsystem has tasks: Wizard (Tasks 6-9), Section reorg (Tasks 2-3), Test panel (Tasks 1, 11), Backend (Task 1), Section content (Tasks 4-5).
- Migration explicit: existing routes render as cards; "Advanced" preserves old UI for power users (Task 10).
- All schema fields touched are existing — no new YAML required.

### Placeholder scan
- Test bodies use `...` only where pattern repeats (e.g., "validates X format hint" mirrors the explicit examples in earlier tasks). Each block has clear assertion intent.
- File paths exact and absolute under repo root.
- Commit messages prescribed per task.

### Type consistency
- `BindingWizardState` shape consistent across step components (Tasks 6-9)
- `RouteTestResponse` consistent between Task 1 (server) and Task 11 (client)
- Existing `AgentYml.routes` schema referenced — no new field types

### Stage independence
- Stage 1 (Tasks 1-3) ships meaningfully alone — backend infra + section reorg + section placeholder. Even before wizard ships, "Per-chat customization" is correctly named/positioned.
- Stage 2 (Tasks 4-10) layers on top — wizard end-to-end.
- Stage 3 (Tasks 11-12) is polish + sign-off.
