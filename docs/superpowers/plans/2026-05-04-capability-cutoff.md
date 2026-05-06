# Capability Cutoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut off all access from anthroclaw agents to Claude account-bound MCP servers, OAuth credentials, and integrations. Each agent ships with an explicit allowlist; everything else is invisible. Side benefits: fix cron→DM session amnesia and customer-facing hallucination.

**Architecture:** Five new modules in `src/sdk/cutoff.ts`, `src/agent/sandbox/`, `src/agent/credentials/`, `src/agent/tools/escalate.ts` + modifications in `src/sdk/options.ts`, `src/cron/scheduler.ts`, `agents/leads_agent/`. `buildSdkOptions` becomes the single chokepoint applying cutoff defaults at the bottom of every option-build pipeline.

**Tech Stack:** TypeScript (Node ≥22), Zod, vitest, `@anthropic-ai/claude-agent-sdk`, `node:crypto` (HKDF + AES-256-GCM).

**Spec:** [`docs/superpowers/specs/2026-05-04-capability-cutoff-design.md`](../specs/2026-05-04-capability-cutoff-design.md). Read it before any task — every subsystem, threat model, edge case, and migration step is defined there.

---

## Conventions

- ESM `.js` import suffixes throughout (TS source uses `.js` extension that resolves to `.ts`)
- Tests live under `<dir>/__tests__/<name>.test.ts`
- Vitest 4 — `npx vitest run <path>` for single test runs
- Conventional commits — `feat(cutoff): ...`, `fix(...)`, `chore(...)`
- Working directory: `/Users/tyess/dev/anthroclaw-capability-cutoff` (worktree on branch `feat/capability-cutoff`)
- Master key for tests: `ANTHROCLAW_MASTER_KEY=<64-hex>` set per test, never global

## File map (target)

```
src/sdk/
├── options.ts                                    # MODIFIED — call applyCutoffOptions last
├── cutoff.ts                                     # NEW — applyCutoffOptions, scrubAgentEnv, gate composition
└── __tests__/
    └── cutoff.test.ts                            # NEW

src/agent/sandbox/
├── agent-workspace.ts                            # NEW — agentWorkspaceDir, siblingAgentDirs
└── __tests__/
    └── agent-workspace.test.ts                   # NEW

src/agent/credentials/
├── index.ts                                      # NEW — CredentialStore interface, types
├── encrypted-fs-store.ts                         # NEW — EncryptedFilesystemCredentialStore
├── audit.ts                                      # NEW — CredentialAuditLog
├── master-key.ts                                 # NEW — boot-time env validation + key load
└── __tests__/
    ├── encrypted-fs-store.test.ts                # NEW
    ├── audit.test.ts                             # NEW
    └── master-key.test.ts                        # NEW

src/cron/
├── scheduler.ts                                  # MODIFIED — persist sessionId for DM-cron
└── __tests__/
    └── cron-session-continuity.test.ts           # NEW

src/agent/tools/
└── escalate.ts                                   # NEW — universal escalate tool

agents/leads_agent/
├── CLAUDE.md                                     # MODIFIED — anti-hallucination addendum
└── agent.yml                                     # MODIFIED — add escalate to mcp_tools

src/__tests__/
└── capability-cutoff-e2e.test.ts                 # NEW — end-to-end fixture

.env.example                                      # MODIFIED — add ANTHROCLAW_MASTER_KEY
CHANGELOG.md                                      # MODIFIED — v0.8.0 section
VERSION                                           # MODIFIED — 0.7.1 → 0.8.0
package.json                                      # MODIFIED — version bump
ui/package.json                                   # MODIFIED — version bump
data/dynamic-cron.json                            # MODIFIED on prod ONLY — disable morning-standup; not committed
```

## Phase ordering

Phases are ordered by dependency. Subagent dispatcher should not parallelize across phases (each builds on prior). Within a phase, multiple tasks may run in parallel where noted.

```
Phase 1 — Cutoff core      (Subsystem 1)             ← load-bearing, blocks everything
Phase 2 — Sandbox          (Subsystem 2)             ← parallel with Phase 3
Phase 3 — Credentials      (Subsystems 3 + 4)        ← parallel with Phase 2
Phase 4 — Cron continuity  (Subsystem 5)             ← parallel with Phases 2, 3
Phase 5 — Safety guardrails (Subsystem 6)            ← parallel with Phases 2, 3, 4
Phase 6 — E2E test         (Subsystem 7)             ← after Phases 1-5
Phase 7 — Release prep                                ← after Phase 6
```

---

## Phase 0 — Worktree readiness

### Task 0: Confirm worktree state

**Files:** none

- [ ] **Step 1: Verify branch and pnpm state**

```bash
cd /Users/tyess/dev/anthroclaw-capability-cutoff
git branch --show-current  # expect: feat/capability-cutoff
test -f node_modules/.modules.yaml && echo "deps OK"
```

- [ ] **Step 2: Build plugins (worktree starts without compiled dist)**

```bash
pnpm build 2>&1 | tail -5
```

Expected: tsc + plugin builds pass.

- [ ] **Step 3: Run baseline test suite — must be green before any code change**

```bash
pnpm test 2>&1 | tail -10
```

Expected: `Test Files NN passed` with zero fails. If anything fails, escalate — do NOT start until baseline is clean.

---

## Phase 1 — SDK options cutoff (load-bearing)

### Task 1: Implement `cutoff.ts` core helpers

**Files:**
- Create: `src/sdk/cutoff.ts`
- Test: `src/sdk/__tests__/cutoff.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/sdk/__tests__/cutoff.test.ts
import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_BUILTIN_TOOL_WHITELIST,
  ENV_VAR_DENYLIST,
  ENV_VAR_DENYLIST_PREFIXES,
  scrubAgentEnv,
  composeToolGates,
} from '../cutoff.js';

describe('AGENT_BUILTIN_TOOL_WHITELIST', () => {
  it('contains exactly the safe built-ins', () => {
    expect(AGENT_BUILTIN_TOOL_WHITELIST).toEqual(
      ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite'],
    );
  });
});

describe('scrubAgentEnv', () => {
  it('removes exact-match denylist vars', () => {
    const out = scrubAgentEnv({
      GOOGLE_CALENDAR_ID: 'leak',
      ANTHROCLAW_MASTER_KEY: 'secret',
      TZ: 'UTC',
    });
    expect(out.GOOGLE_CALENDAR_ID).toBeUndefined();
    expect(out.ANTHROCLAW_MASTER_KEY).toBeUndefined();
    expect(out.TZ).toBe('UTC');
  });

  it('removes prefix-matched vars', () => {
    const out = scrubAgentEnv({
      ANTHROPIC_API_KEY: 'k',
      OPENAI_API_KEY: 'k',
      AWS_ACCESS_KEY_ID: 'k',
      GITHUB_TOKEN: 'k',
      PATH: '/usr/bin',
    });
    expect(out.ANTHROPIC_API_KEY).toBeUndefined();
    expect(out.OPENAI_API_KEY).toBeUndefined();
    expect(out.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(out.GITHUB_TOKEN).toBeUndefined();
    expect(out.PATH).toBe('/usr/bin');
  });

  it('preserves benign env', () => {
    const out = scrubAgentEnv({
      NODE_ENV: 'production',
      LANG: 'en_US.UTF-8',
      USER: 'node',
    });
    expect(out).toEqual({ NODE_ENV: 'production', LANG: 'en_US.UTF-8', USER: 'node' });
  });
});

describe('composeToolGates', () => {
  const allow = async () => ({ behavior: 'allow' as const });
  const deny = async () => ({ behavior: 'deny' as const, message: 'no', decisionReason: { type: 'other', reason: 'test' } });

  it('runs upstream first; if upstream denies, returns its decision', async () => {
    const gate = composeToolGates(deny, allow);
    const r = await gate('Read', {}, { agentId: 'a', sessionId: 's' } as any);
    expect(r.behavior).toBe('deny');
  });

  it('runs cutoff after upstream allow; cutoff has final say', async () => {
    const gate = composeToolGates(allow, deny);
    const r = await gate('Read', {}, { agentId: 'a', sessionId: 's' } as any);
    expect(r.behavior).toBe('deny');
  });

  it('handles undefined upstream — runs only cutoff', async () => {
    const gate = composeToolGates(undefined, deny);
    expect((await gate('x', {}, {} as any)).behavior).toBe('deny');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/sdk/__tests__/cutoff.test.ts
```

Expected: module-not-found error for `../cutoff.js`.

- [ ] **Step 3: Implement `cutoff.ts`**

```ts
// src/sdk/cutoff.ts
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';

export const AGENT_BUILTIN_TOOL_WHITELIST = [
  'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'TodoWrite',
] as const;

export const ENV_VAR_DENYLIST = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CALENDAR_ID',
  'GMAIL_OAUTH_TOKEN',
  'NOTION_API_KEY',
  'LINEAR_API_KEY',
  'CLAUDE_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROCLAW_MASTER_KEY',
] as const;

export const ENV_VAR_DENYLIST_PREFIXES = [
  'ANTHROPIC_', 'CLAUDE_', 'GOOGLE_', 'NOTION_', 'LINEAR_', 'GMAIL_',
  'OPENAI_', 'AWS_', 'GCP_', 'AZURE_', 'VAULT_', 'GITHUB_TOKEN',
] as const;

export function scrubAgentEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  const denySet = new Set<string>(ENV_VAR_DENYLIST);
  for (const [k, v] of Object.entries(env)) {
    if (denySet.has(k)) continue;
    if (ENV_VAR_DENYLIST_PREFIXES.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  return out;
}

export function composeToolGates(
  upstream: CanUseTool | undefined,
  cutoff: CanUseTool,
): CanUseTool {
  return async (toolName, input, ctx) => {
    if (upstream) {
      const upRes = await upstream(toolName, input, ctx);
      if (upRes.behavior !== 'allow') return upRes;
    }
    return cutoff(toolName, input, ctx);
  };
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/sdk/__tests__/cutoff.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/sdk/cutoff.ts src/sdk/__tests__/cutoff.test.ts
git commit -m "feat(cutoff): scrubAgentEnv + composeToolGates + tool whitelist"
```

### Task 2: Implement `applyCutoffOptions` and wire into `buildSdkOptions`

**Files:**
- Modify: `src/sdk/cutoff.ts` (add `applyCutoffOptions`, `agentToolGate`, `buildAllowedToolNames`)
- Modify: `src/sdk/options.ts` (call `applyCutoffOptions` last)
- Test: `src/sdk/__tests__/cutoff.test.ts` (new describe block)

- [ ] **Step 1: Read current `buildSdkOptions`**

```bash
sed -n '1,80p' src/sdk/options.ts
```

Note where final `Options` object is returned (the `return { ... }` line). `applyCutoffOptions(opts, agent)` will wrap that return.

- [ ] **Step 2: Write failing tests**

Append to `src/sdk/__tests__/cutoff.test.ts`:

```ts
import { applyCutoffOptions, agentToolGate, buildAllowedToolNames } from '../cutoff.js';
import type { Agent } from '../../agent/agent.js';

function stubAgent(overrides: Partial<Agent['config']> = {}): Agent {
  return {
    id: 'test-agent',
    config: {
      model: 'claude-sonnet-4-6',
      mcp_tools: ['memory_search', 'send_message'],
      external_mcp_servers: undefined,
      ...overrides,
    },
  } as any;
}

describe('applyCutoffOptions', () => {
  it('forces enabledMcpjsonServers to []', () => {
    const out = applyCutoffOptions({ enabledMcpjsonServers: ['leak'] } as any, stubAgent());
    expect(out.enabledMcpjsonServers).toEqual([]);
  });

  it('forces settingSources to []', () => {
    const out = applyCutoffOptions({ settingSources: ['user', 'project'] } as any, stubAgent());
    expect(out.settingSources).toEqual([]);
  });

  it('sets tools to AGENT_BUILTIN_TOOL_WHITELIST regardless of input', () => {
    const out = applyCutoffOptions({ tools: ['WebFetch'] } as any, stubAgent());
    expect(out.tools).toEqual([...AGENT_BUILTIN_TOOL_WHITELIST]);
  });

  it('sets mcpServers to agent.config.external_mcp_servers ?? {}', () => {
    const out1 = applyCutoffOptions({} as any, stubAgent());
    expect(out1.mcpServers).toEqual({});

    const out2 = applyCutoffOptions(
      {} as any,
      stubAgent({ external_mcp_servers: { foo: { url: 'x' } } as any }),
    );
    expect(out2.mcpServers).toEqual({ foo: { url: 'x' } });
  });

  it('sets additionalDirectories to []', () => {
    const out = applyCutoffOptions({ additionalDirectories: ['/etc'] } as any, stubAgent());
    expect(out.additionalDirectories).toEqual([]);
  });

  it('strips denylisted env vars', () => {
    const out = applyCutoffOptions({ env: { GOOGLE_CALENDAR_ID: 'leak', TZ: 'UTC' } } as any, stubAgent());
    expect(out.env?.GOOGLE_CALENDAR_ID).toBeUndefined();
    expect(out.env?.TZ).toBe('UTC');
  });

  it('is idempotent — applying twice yields the same result', () => {
    const a = stubAgent();
    const opts = applyCutoffOptions({} as any, a);
    expect(applyCutoffOptions(opts, a)).toEqual(opts);
  });
});

describe('agentToolGate', () => {
  it('allows tools in built-in whitelist', async () => {
    const gate = agentToolGate(stubAgent());
    expect((await gate('Read', {}, {} as any)).behavior).toBe('allow');
  });

  it('allows tools in agent.config.mcp_tools', async () => {
    const gate = agentToolGate(stubAgent({ mcp_tools: ['memory_search'] } as any));
    expect((await gate('memory_search', {}, {} as any)).behavior).toBe('allow');
  });

  it('denies tools not declared anywhere', async () => {
    const gate = agentToolGate(stubAgent());
    const r = await gate('mcp__claude_ai_Google_Calendar__list_events', {}, {} as any);
    expect(r.behavior).toBe('deny');
    expect(r.message).toContain('not declared');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

- [ ] **Step 4: Implement `applyCutoffOptions`, `agentToolGate`, `buildAllowedToolNames` in `cutoff.ts`**

```ts
// Append to src/sdk/cutoff.ts
import type { Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../agent/agent.js';
import { logger } from '../logger.js';
import { agentWorkspaceDir } from '../agent/sandbox/agent-workspace.js';

export function buildAllowedToolNames(agent: Agent): string[] {
  const names: string[] = [...AGENT_BUILTIN_TOOL_WHITELIST];
  for (const t of agent.config.mcp_tools ?? []) names.push(t);
  for (const [name] of Object.entries(agent.config.external_mcp_servers ?? {})) {
    // Tools from external MCP servers come prefixed `mcp__<server>__<tool>`.
    // We allow ANY tool that starts with this prefix — the gateway has no
    // a-priori knowledge of which tools the external server exposes.
    names.push(`mcp__${name}__*`);
  }
  return names;
}

export function agentToolGate(agent: Agent): CanUseTool {
  const allowed = buildAllowedToolNames(agent);
  const exactNames = new Set(allowed.filter((n) => !n.endsWith('*')));
  const prefixGlobs = allowed
    .filter((n) => n.endsWith('*'))
    .map((n) => n.slice(0, -1));

  return async (toolName, _input, ctx) => {
    if (exactNames.has(toolName)) return { behavior: 'allow' };
    if (prefixGlobs.some((p) => toolName.startsWith(p))) return { behavior: 'allow' };
    logger.warn(
      { agentId: agent.id, toolName, sessionId: (ctx as any)?.sessionId },
      'capability-cutoff: tool blocked at runtime',
    );
    return {
      behavior: 'deny',
      message: `Tool "${toolName}" is not declared in this agent's capabilities. Use only the tools listed in your system prompt.`,
      decisionReason: { type: 'other', reason: 'capability_cutoff' },
    };
  };
}

export function applyCutoffOptions(base: SdkOptions, agent: Agent): SdkOptions {
  const cutoffGate = agentToolGate(agent);
  return {
    ...base,
    enabledMcpjsonServers: [],
    settingSources: [],
    tools: [...AGENT_BUILTIN_TOOL_WHITELIST],
    mcpServers: agent.config.external_mcp_servers ?? {},
    additionalDirectories: [],
    cwd: agentWorkspaceDir(agent),
    env: scrubAgentEnv(base.env ?? process.env),
    canUseTool: composeToolGates(base.canUseTool, cutoffGate),
  };
}
```

NOTE: This task imports `agentWorkspaceDir` from Phase 2 module. If Phase 2 is run in parallel by another subagent, coordinate: either (a) Phase 2 finishes first, or (b) implementer creates a stub `agentWorkspaceDir` returning `path.resolve('agents', agent.id)` here and full impl lands in Phase 2. Recommendation: serialize Phase 1 → Phase 2 to avoid stub.

- [ ] **Step 5: Wire into `src/sdk/options.ts`**

Locate the `return { ... }` at the end of `buildSdkOptions`. Replace with:

```ts
import { applyCutoffOptions } from './cutoff.js';

// ... (existing code)

const opts: SdkOptions = {
  // ... existing computed fields
};
return applyCutoffOptions(opts, args.agent);
```

(Exact replacement depends on the current shape of `buildSdkOptions`. Inspect with `sed -n '1,150p' src/sdk/options.ts` first.)

- [ ] **Step 6: Run all SDK tests**

```bash
npx vitest run src/sdk/
```

- [ ] **Step 7: Commit**

```bash
git add src/sdk/cutoff.ts src/sdk/options.ts src/sdk/__tests__/cutoff.test.ts
git commit -m "feat(cutoff): applyCutoffOptions wires SDK option hardening into buildSdkOptions"
```

---

## Phase 2 — Filesystem sandbox

### Task 3: `agentWorkspaceDir` and `siblingAgentDirs`

**Files:**
- Create: `src/agent/sandbox/agent-workspace.ts`
- Test: `src/agent/sandbox/__tests__/agent-workspace.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/agent/sandbox/__tests__/agent-workspace.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentWorkspaceDir, siblingAgentDirs } from '../agent-workspace.js';

let dir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sandbox-test-'));
  mkdirSync(join(dir, 'agentA'));
  mkdirSync(join(dir, 'agentB'));
  mkdirSync(join(dir, 'agentC'));
  prevEnv = process.env.OC_AGENTS_DIR;
  process.env.OC_AGENTS_DIR = dir;
});
afterEach(() => {
  process.env.OC_AGENTS_DIR = prevEnv;
  rmSync(dir, { recursive: true, force: true });
});

describe('agentWorkspaceDir', () => {
  it('returns absolute path under OC_AGENTS_DIR', () => {
    const path = agentWorkspaceDir({ id: 'agentA' } as any);
    expect(path).toBe(join(dir, 'agentA'));
  });

  it('resolves relative agentId safely (no traversal)', () => {
    expect(() => agentWorkspaceDir({ id: '../etc' } as any)).toThrow(/invalid/i);
    expect(() => agentWorkspaceDir({ id: 'foo/bar' } as any)).toThrow(/invalid/i);
  });
});

describe('siblingAgentDirs', () => {
  it('returns absolute paths of all agents EXCEPT current', () => {
    const siblings = siblingAgentDirs('agentA');
    expect(siblings.sort()).toEqual([join(dir, 'agentB'), join(dir, 'agentC')].sort());
  });

  it('returns [] when current is the only agent', () => {
    rmSync(join(dir, 'agentB'), { recursive: true });
    rmSync(join(dir, 'agentC'), { recursive: true });
    expect(siblingAgentDirs('agentA')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `agent-workspace.ts`**

```ts
// src/agent/sandbox/agent-workspace.ts
import { resolve } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { Agent } from '../agent.js';

const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

function agentsRoot(): string {
  return process.env.OC_AGENTS_DIR ?? resolve(process.cwd(), 'agents');
}

export function agentWorkspaceDir(agent: { id: string }): string {
  if (!AGENT_ID_RE.test(agent.id) || agent.id.length > 64) {
    throw new Error(`agent-workspace: invalid agentId: ${agent.id}`);
  }
  return resolve(agentsRoot(), agent.id);
}

export function siblingAgentDirs(currentAgentId: string): string[] {
  const root = agentsRoot();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name !== currentAgentId && AGENT_ID_RE.test(name))
    .map((name) => resolve(root, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
}
```

- [ ] **Step 4: Run tests to confirm pass**

- [ ] **Step 5: Commit**

```bash
git add src/agent/sandbox/
git commit -m "feat(sandbox): agentWorkspaceDir + siblingAgentDirs"
```

### Task 4: Bash sibling-dir denylist (defence-in-depth)

**Files:**
- Modify: `src/sdk/cutoff.ts` — wrap `Bash` invocations
- Test: `src/sdk/__tests__/cutoff.test.ts` (new describe)

This task hardens `Bash` against shell-level path escape. Implementation: wrap every Bash call by prepending a small shell preamble that early-`exit`s if the resolved cwd is outside the agent workspace.

The simplest, lowest-risk approach is via `canUseTool` middleware that intercepts `Bash` invocations and rewrites the command:

- [ ] **Step 1: Write failing test**

```ts
// In src/sdk/__tests__/cutoff.test.ts add:
describe('Bash sibling-dir denylist', () => {
  it('rewrites Bash command to prepend agent-workspace cwd guard', async () => {
    const gate = agentToolGate(stubAgent());
    // The gate currently only allows/denies; for Bash hardening we use a
    // command-rewrite middleware exported as `wrapBashCommand`.
    const { wrapBashCommand } = await import('../cutoff.js');
    const wrapped = wrapBashCommand('echo hi', { id: 'agentA' } as any);
    expect(wrapped).toContain('cd "');                    // prepends cd into workspace
    expect(wrapped).toContain('echo hi');                 // preserves user command
    expect(wrapped).toMatch(/PROMPT|cwd guard/i);         // preamble marker
  });

  it('rejects Bash command containing absolute path to sibling agent', () => {
    const { detectBashPathEscape } = require('../cutoff.js');
    expect(detectBashPathEscape('cat /app/agents/agentB/credentials/google.enc', 'agentA'))
      .toBe(true);
    expect(detectBashPathEscape('echo hello world', 'agentA')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `wrapBashCommand` and `detectBashPathEscape` in `cutoff.ts`**

```ts
// Append to src/sdk/cutoff.ts
import { agentWorkspaceDir, siblingAgentDirs } from '../agent/sandbox/agent-workspace.js';

export function wrapBashCommand(userCommand: string, agent: Agent): string {
  const ws = agentWorkspaceDir(agent);
  return `# capability-cutoff: cwd guard
cd "${ws}" || { echo "agent-cwd-guard: cannot enter workspace"; exit 1; }
${userCommand}`;
}

export function detectBashPathEscape(command: string, currentAgentId: string): boolean {
  const siblings = siblingAgentDirs(currentAgentId);
  return siblings.some((path) => command.includes(path));
}
```

Then extend `agentToolGate` to use these:

```ts
// In agentToolGate, before the allow/deny return:
if (toolName === 'Bash' && _input?.command) {
  const cmd = String(_input.command);
  if (detectBashPathEscape(cmd, agent.id)) {
    logger.warn({ agentId: agent.id, cmd }, 'cutoff: Bash sibling-dir reference blocked');
    return {
      behavior: 'deny',
      message: 'Bash command references another agent\'s directory.',
      decisionReason: { type: 'other', reason: 'capability_cutoff_bash_escape' },
    };
  }
  // Rewrite command to prepend cwd guard. SDK CanUseTool allows input mutation
  // via the `updatedInput` field on allow.
  return { behavior: 'allow', updatedInput: { ..._input, command: wrapBashCommand(cmd, agent) } };
}
```

NOTE: confirm `updatedInput` is supported by the SDK `CanUseToolReturn` type. If not, alternative is to use a hook that rewrites the input before SDK execution. Check `sdk.d.ts` for `CanUseToolReturn` shape.

- [ ] **Step 4: Run tests to confirm pass**

- [ ] **Step 5: Commit**

```bash
git add src/sdk/cutoff.ts src/sdk/__tests__/cutoff.test.ts
git commit -m "feat(cutoff): Bash sibling-dir denylist + cwd-guard wrapper"
```

---

## Phase 3 — Credentials store + audit log

### Task 5: Master key validation at boot

**Files:**
- Create: `src/agent/credentials/master-key.ts`
- Test: `src/agent/credentials/__tests__/master-key.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/agent/credentials/__tests__/master-key.test.ts
import { describe, expect, it } from 'vitest';
import { loadMasterKey, MASTER_KEY_ENV } from '../master-key.js';

describe('loadMasterKey', () => {
  it('throws when env var is missing', () => {
    delete process.env[MASTER_KEY_ENV];
    expect(() => loadMasterKey()).toThrow(/required/i);
  });

  it('throws when env var is too short', () => {
    process.env[MASTER_KEY_ENV] = 'short';
    expect(() => loadMasterKey()).toThrow(/length/i);
  });

  it('throws when env var is not hex', () => {
    process.env[MASTER_KEY_ENV] = 'g'.repeat(64);
    expect(() => loadMasterKey()).toThrow(/hex/i);
  });

  it('returns 32-byte buffer for valid hex', () => {
    process.env[MASTER_KEY_ENV] = '0123456789abcdef'.repeat(4); // 64 hex chars = 32 bytes
    const buf = loadMasterKey();
    expect(buf.length).toBe(32);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `master-key.ts`**

```ts
// src/agent/credentials/master-key.ts
export const MASTER_KEY_ENV = 'ANTHROCLAW_MASTER_KEY';

export function loadMasterKey(): Buffer {
  const raw = process.env[MASTER_KEY_ENV];
  if (!raw) {
    throw new Error(
      `${MASTER_KEY_ENV} env var is required. ` +
      `Generate with: openssl rand -hex 32`,
    );
  }
  if (raw.length < 64) {
    throw new Error(
      `${MASTER_KEY_ENV} too short — expected 64 hex chars (32 bytes), got ${raw.length}`,
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(`${MASTER_KEY_ENV} must be hex-encoded`);
  }
  return Buffer.from(raw, 'hex');
}
```

- [ ] **Step 4: Run tests to confirm**

- [ ] **Step 5: Commit**

```bash
git add src/agent/credentials/master-key.ts src/agent/credentials/__tests__/master-key.test.ts
git commit -m "feat(credentials): master key boot validation"
```

### Task 6: `CredentialAuditLog`

**Files:**
- Create: `src/agent/credentials/audit.ts`
- Test: `src/agent/credentials/__tests__/audit.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/agent/credentials/__tests__/audit.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CredentialAuditLog } from '../audit.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'audit-test-'));
  process.env.OC_DATA_DIR = dir;
});
afterEach(() => {
  delete process.env.OC_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('CredentialAuditLog', () => {
  it('appends a JSONL line per record', async () => {
    const log = new CredentialAuditLog();
    await log.record({ ts: 1000, agentId: 'a', service: 'google_calendar', action: 'get', reason: 'mcp' });
    await log.record({ ts: 2000, agentId: 'a', service: 'google_calendar', action: 'set' });
    const content = readFileSync(join(dir, 'credential-access.jsonl'), 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).action).toBe('get');
    expect(JSON.parse(lines[1]).action).toBe('set');
  });

  it('handles concurrent records without corruption', async () => {
    const log = new CredentialAuditLog();
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        log.record({ ts: i, agentId: 'a', service: 's', action: 'get', reason: String(i) }),
      ),
    );
    const lines = readFileSync(join(dir, 'credential-access.jsonl'), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(50);
    for (const line of lines) {
      // every line is valid JSON — no interleaving
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `audit.ts`**

```ts
// src/agent/credentials/audit.ts
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface CredentialAuditEvent {
  ts: number;
  agentId: string;
  service: string;
  action: 'get' | 'set' | 'delete';
  reason?: string;
  sessionId?: string;
}

export class CredentialAuditLog {
  private readonly path: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(path?: string) {
    this.path =
      path ?? resolve(process.env.OC_DATA_DIR ?? 'data', 'credential-access.jsonl');
  }

  async record(ev: CredentialAuditEvent): Promise<void> {
    const line = JSON.stringify(ev) + '\n';
    // Serialize writes via chain to guarantee whole-line atomicity.
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, line, { mode: 0o640 });
    });
    return this.writeChain;
  }
}
```

- [ ] **Step 4: Run tests to confirm**

- [ ] **Step 5: Commit**

```bash
git add src/agent/credentials/audit.ts src/agent/credentials/__tests__/audit.test.ts
git commit -m "feat(credentials): append-only audit log JSONL"
```

### Task 7: `CredentialStore` interface

**Files:**
- Create: `src/agent/credentials/index.ts`
- (No tests — pure type definitions)

- [ ] **Step 1: Implement `index.ts`**

```ts
// src/agent/credentials/index.ts
export interface OAuthCredential {
  service: string;
  account: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
  metadata?: Record<string, string>;
}

export interface CredentialRef {
  agentId: string;
  service: string;
}

export type CredentialMetadata = Omit<OAuthCredential, 'accessToken' | 'refreshToken'>;

export interface CredentialStore {
  get(ref: CredentialRef, accessReason: string): Promise<OAuthCredential>;
  set(ref: CredentialRef, credential: OAuthCredential): Promise<void>;
  list(agentId: string): Promise<CredentialMetadata[]>;
  delete(ref: CredentialRef): Promise<void>;
}

export { CredentialAuditLog, type CredentialAuditEvent } from './audit.js';
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/credentials/index.ts
git commit -m "feat(credentials): CredentialStore interface + types"
```

### Task 8: `EncryptedFilesystemCredentialStore`

**Files:**
- Create: `src/agent/credentials/encrypted-fs-store.ts`
- Test: `src/agent/credentials/__tests__/encrypted-fs-store.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/agent/credentials/__tests__/encrypted-fs-store.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EncryptedFilesystemCredentialStore } from '../encrypted-fs-store.js';
import { CredentialAuditLog } from '../audit.js';

let dir: string;
const KEY = 'a'.repeat(64); // 32 bytes hex

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'creds-test-'));
  process.env.OC_AGENTS_DIR = dir;
  process.env.OC_DATA_DIR = dir;
  process.env.ANTHROCLAW_MASTER_KEY = KEY;
  mkdirSync(join(dir, 'agentA'));
  mkdirSync(join(dir, 'agentB'));
});
afterEach(() => {
  delete process.env.OC_AGENTS_DIR;
  delete process.env.OC_DATA_DIR;
  delete process.env.ANTHROCLAW_MASTER_KEY;
  rmSync(dir, { recursive: true, force: true });
});

describe('EncryptedFilesystemCredentialStore', () => {
  const cred = {
    service: 'google_calendar',
    account: 'timur@nocodia.dev',
    accessToken: 'ya29.abc',
    refreshToken: '1//refresh',
    expiresAt: Date.now() + 3600_000,
    scopes: ['calendar.readonly'],
  };

  it('round-trips set/get', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agentA', service: 'google_calendar' }, cred);
    const out = await store.get({ agentId: 'agentA', service: 'google_calendar' }, 'test');
    expect(out).toEqual(cred);
  });

  it('writes encrypted bytes — plaintext token does NOT appear on disk', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agentA', service: 'google_calendar' }, cred);
    const path = join(dir, 'agentA', 'credentials', 'google_calendar.enc');
    const blob = readFileSync(path);
    expect(blob.includes(Buffer.from('ya29.abc'))).toBe(false);
    expect(blob.includes(Buffer.from('1//refresh'))).toBe(false);
  });

  it('decryption fails when blob is copied to a different agent', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agentA', service: 'google_calendar' }, cred);
    // Copy ciphertext to agentB
    const blob = readFileSync(join(dir, 'agentA', 'credentials', 'google_calendar.enc'));
    mkdirSync(join(dir, 'agentB', 'credentials'), { recursive: true });
    writeFileSync(join(dir, 'agentB', 'credentials', 'google_calendar.enc'), blob);

    await expect(
      store.get({ agentId: 'agentB', service: 'google_calendar' }, 'test'),
    ).rejects.toThrow();
  });

  it('decryption fails on tampered ciphertext (AES-GCM auth)', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agentA', service: 'google_calendar' }, cred);
    const path = join(dir, 'agentA', 'credentials', 'google_calendar.enc');
    const blob = Buffer.from(readFileSync(path));
    blob[blob.length - 1] ^= 0xff; // flip a bit
    writeFileSync(path, blob);
    await expect(
      store.get({ agentId: 'agentA', service: 'google_calendar' }, 'test'),
    ).rejects.toThrow();
  });

  it('list returns metadata without secrets', async () => {
    const store = new EncryptedFilesystemCredentialStore(new CredentialAuditLog());
    await store.set({ agentId: 'agentA', service: 'google_calendar' }, cred);
    const meta = await store.list('agentA');
    expect(meta.length).toBe(1);
    expect(meta[0]).not.toHaveProperty('accessToken');
    expect(meta[0]).not.toHaveProperty('refreshToken');
    expect(meta[0].service).toBe('google_calendar');
    expect(meta[0].account).toBe('timur@nocodia.dev');
  });

  it('delete removes the file and writes audit', async () => {
    const log = new CredentialAuditLog();
    const store = new EncryptedFilesystemCredentialStore(log);
    await store.set({ agentId: 'agentA', service: 'google_calendar' }, cred);
    await store.delete({ agentId: 'agentA', service: 'google_calendar' });
    await expect(
      store.get({ agentId: 'agentA', service: 'google_calendar' }, 'test'),
    ).rejects.toThrow();
  });

  it('get writes audit-log entry with reason', async () => {
    const log = new CredentialAuditLog();
    const store = new EncryptedFilesystemCredentialStore(log);
    await store.set({ agentId: 'agentA', service: 'google_calendar' }, cred);
    await store.get({ agentId: 'agentA', service: 'google_calendar' }, 'mcp_call:list_events');
    const auditPath = join(dir, 'credential-access.jsonl');
    const content = readFileSync(auditPath, 'utf-8');
    const lines = content.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.find((l) => l.action === 'get')?.reason).toBe('mcp_call:list_events');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `encrypted-fs-store.ts`**

Per spec Subsystem 3 — copy the implementation block in the spec verbatim, adapting imports as needed:

```ts
// src/agent/credentials/encrypted-fs-store.ts
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { agentWorkspaceDir } from '../sandbox/agent-workspace.js';
import { loadMasterKey } from './master-key.js';
import type { CredentialStore, CredentialRef, OAuthCredential, CredentialMetadata } from './index.js';
import { CredentialAuditLog } from './audit.js';

function deriveKey(masterKey: Buffer, agentId: string, service: string): Buffer {
  const salt = Buffer.from(`${agentId}/${service}`, 'utf-8');
  const info = Buffer.from('credential-key', 'utf-8');
  return Buffer.from(hkdfSync('sha256', masterKey, salt, info, 32));
}

export class EncryptedFilesystemCredentialStore implements CredentialStore {
  private readonly masterKey: Buffer;
  constructor(private readonly auditLog: CredentialAuditLog) {
    this.masterKey = loadMasterKey();
  }

  async set(ref: CredentialRef, credential: OAuthCredential): Promise<void> {
    const key = deriveKey(this.masterKey, ref.agentId, ref.service);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(credential), 'utf-8');
    const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const blob = Buffer.concat([Buffer.from([1]), iv, tag, ct]);

    const path = this.pathFor(ref);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, blob, { mode: 0o600 });
    await this.auditLog.record({ ts: Date.now(), agentId: ref.agentId, service: ref.service, action: 'set' });
  }

  async get(ref: CredentialRef, accessReason: string): Promise<OAuthCredential> {
    const path = this.pathFor(ref);
    const blob = await readFile(path);
    if (blob[0] !== 1) throw new Error(`unsupported credential file version: ${blob[0]}`);
    const iv = blob.subarray(1, 13);
    const tag = blob.subarray(13, 29);
    const ct = blob.subarray(29);
    const key = deriveKey(this.masterKey, ref.agentId, ref.service);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    const credential = JSON.parse(plaintext.toString('utf-8')) as OAuthCredential;
    await this.auditLog.record({ ts: Date.now(), agentId: ref.agentId, service: ref.service, action: 'get', reason: accessReason });
    return credential;
  }

  async list(agentId: string): Promise<CredentialMetadata[]> {
    const dir = resolve(agentWorkspaceDir({ id: agentId } as any), 'credentials');
    let entries: string[];
    try { entries = await readdir(dir); } catch { return []; }
    const out: CredentialMetadata[] = [];
    for (const name of entries) {
      if (!name.endsWith('.enc')) continue;
      const service = name.slice(0, -4);
      try {
        const cred = await this.get({ agentId, service }, 'list_metadata');
        const { accessToken: _a, refreshToken: _r, ...meta } = cred;
        out.push(meta);
      } catch { /* skip unreadable */ }
    }
    return out;
  }

  async delete(ref: CredentialRef): Promise<void> {
    await unlink(this.pathFor(ref)).catch(() => undefined);
    await this.auditLog.record({ ts: Date.now(), agentId: ref.agentId, service: ref.service, action: 'delete' });
  }

  private pathFor(ref: CredentialRef): string {
    return resolve(agentWorkspaceDir({ id: ref.agentId } as any), 'credentials', `${ref.service}.enc`);
  }
}
```

- [ ] **Step 4: Run tests to confirm**

- [ ] **Step 5: Commit**

```bash
git add src/agent/credentials/encrypted-fs-store.ts src/agent/credentials/__tests__/encrypted-fs-store.test.ts
git commit -m "feat(credentials): EncryptedFilesystemCredentialStore (AES-256-GCM + HKDF)"
```

---

## Phase 4 — Cron-DM session continuity

### Task 9: Persist sessionId for DM-cron dispatches

**Files:**
- Modify: `src/gateway.ts` (queryAgent's session-id-capture logic) OR `src/cron/scheduler.ts` (depending on where the capture lives)
- Test: `src/__tests__/cron-session-continuity.test.ts`

- [ ] **Step 1: Locate the session-id capture site**

```bash
grep -n "session_id\|setSessionId\|observedSessionId" src/gateway.ts | head -20
grep -n "cron\|InboundMessage.*cron" src/gateway.ts | head -20
```

- [ ] **Step 2: Write failing integration test**

Model fixture after `src/__tests__/routing.test.ts:1-80`. Mock SDK to capture session_id:

```ts
// src/__tests__/cron-session-continuity.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  startup: vi.fn().mockResolvedValue(undefined),
}));
import { query } from '@anthropic-ai/claude-agent-sdk';
import { Gateway } from '../gateway.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cron-cont-'));
  process.env.OC_AGENTS_DIR = join(dir, 'agents');
  process.env.OC_DATA_DIR = join(dir, 'data');
  process.env.ANTHROCLAW_MASTER_KEY = 'a'.repeat(64);
  mkdirSync(join(dir, 'agents', 'agent_t'), { recursive: true });
  writeFileSync(
    join(dir, 'agents', 'agent_t', 'agent.yml'),
    `model: claude-sonnet-4-6\nroutes:\n- channel: telegram\n  account: default\n  scope: dm\nallowlist:\n  telegram:\n  - "100"\nmcp_tools: [send_message]\n`,
  );
  writeFileSync(join(dir, 'agents', 'agent_t', 'CLAUDE.md'), '# A1\n');
});
afterEach(() => {
  delete process.env.OC_AGENTS_DIR;
  delete process.env.OC_DATA_DIR;
  delete process.env.ANTHROCLAW_MASTER_KEY;
  rmSync(dir, { recursive: true, force: true });
});

function mockStreamWithSessionId(sessionId: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init', session_id: sessionId };
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
      yield { type: 'result', usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };
    },
  };
}

describe('cron-DM session continuity', () => {
  it('persists sessionId for cron dispatch with deliverTo, so user resume hits same session', async () => {
    const calls: any[] = [];
    (query as any).mockImplementation((args: any) => {
      calls.push(args);
      // Each call gets a unique session id; the fix is that the second
      // call (user dispatch) RESUMES the first session id, not creates a new one.
      return mockStreamWithSessionId('sdk-session-from-cron');
    });

    // Build gateway with one agent (agent_t)
    const gateway = await buildTestGateway(dir);

    // Simulate cron firing
    await gateway.dispatch({
      channel: 'telegram', accountId: 'default', chatType: 'dm',
      peerId: '100', senderId: 'cron', text: 'cron: write briefing',
      raw: { cron: true, deliverTo: { channel: 'telegram', account_id: 'default', peer_id: '100' } },
    } as any);

    // Now user replies — should resume same session
    await gateway.dispatch({
      channel: 'telegram', accountId: 'default', chatType: 'dm',
      peerId: '100', senderId: '100', text: 'thanks',
    } as any);

    expect(calls.length).toBe(2);
    expect(calls[1].options.resume).toBe('sdk-session-from-cron');
  });

  it('does NOT persist sessionId when cron has no deliverTo (background isolation)', async () => {
    (query as any).mockImplementation(() => mockStreamWithSessionId('bg-session'));
    const gateway = await buildTestGateway(dir);

    await gateway.dispatch({
      channel: 'telegram', accountId: 'default', chatType: 'dm',
      peerId: '100', senderId: 'cron', text: 'background task',
      raw: { cron: true /* no deliverTo */ },
    } as any);

    // User-driven dispatch right after — should NOT resume bg-session
    let captured: any;
    (query as any).mockImplementationOnce((args: any) => {
      captured = args;
      return mockStreamWithSessionId('user-session');
    });
    await gateway.dispatch({
      channel: 'telegram', accountId: 'default', chatType: 'dm',
      peerId: '100', senderId: '100', text: 'hi',
    } as any);

    expect(captured.options.resume).not.toBe('bg-session');
  });
});

async function buildTestGateway(dir: string): Promise<Gateway> {
  // construction sketched after src/__tests__/routing.test.ts:25-65
  // ...
  throw new Error('TODO: implement test gateway builder');
}
```

(Implementer fills in `buildTestGateway` by copying from `routing.test.ts`.)

- [ ] **Step 3: Run tests to verify they fail**

- [ ] **Step 4: Modify `gateway.ts` to persist sessionId for DM-cron**

In the SDK event-loop where `init` is captured:

```ts
// Inside queryAgent (gateway.ts), in the event-loop:
if (event.type === 'system' && event.subtype === 'init') {
  const sdkSessionId = (event as any).session_id;
  if (sdkSessionId) {
    observedSessionId = sdkSessionId;
    // Persist for non-background flows — background-cron stays isolated.
    const isBackgroundCron = source === 'cron' && !msg.raw?.deliverTo;
    if (!isBackgroundCron) {
      agent.setSessionId(sessionKey, sdkSessionId);
    }
  }
}
```

Locate the *exact* current code via `grep -n "observedSessionId\s*=" src/gateway.ts` — the change is one new conditional block immediately after the existing `observedSessionId = ...` assignment. Preserve all existing behaviour (LCM mirror, on_session_reset emission for legacy compact path, etc.).

- [ ] **Step 5: Run tests to confirm pass**

- [ ] **Step 6: Run all tests**

```bash
pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add src/gateway.ts src/__tests__/cron-session-continuity.test.ts
git commit -m "fix(cron): persist SDK sessionId for DM-cron dispatches so user resume hits same session"
```

---

## Phase 5 — Customer-facing safety guardrails

### Task 10: `escalate` MCP tool

**Files:**
- Create: `src/agent/tools/escalate.ts`
- Test: `src/agent/tools/__tests__/escalate.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/agent/tools/__tests__/escalate.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { escalateTool, registerEscalateTool } from '../escalate.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'esc-'));
  process.env.OC_DATA_DIR = dir;
});
afterEach(() => {
  delete process.env.OC_DATA_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('escalate tool', () => {
  it('writes a JSONL line to data/escalations/<agentId>.jsonl', async () => {
    const tool = registerEscalateTool();
    const result = await tool.handler(
      { summary: 'client asked for full lead export', urgency: 'urgent', suggested_action: 'reply manually' },
      { agentId: 'leads_agent', sessionId: 's1' } as any,
    );
    expect(result.content[0]).toMatchObject({ type: 'text' });
    const path = join(dir, 'escalations', 'leads_agent.jsonl');
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);
    const ev = JSON.parse(lines[0]);
    expect(ev.agentId).toBe('leads_agent');
    expect(ev.summary).toBe('client asked for full lead export');
    expect(ev.urgency).toBe('urgent');
  });

  it('defaults urgency to routine', async () => {
    const tool = registerEscalateTool();
    await tool.handler(
      { summary: 'simple question' },
      { agentId: 'a', sessionId: 's' } as any,
    );
    const lines = readFileSync(join(dir, 'escalations', 'a.jsonl'), 'utf-8').trim().split('\n');
    expect(JSON.parse(lines[0]).urgency).toBe('routine');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `escalate.ts`**

```ts
// src/agent/tools/escalate.ts
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const escalateInputSchema = z.object({
  summary: z.string().describe('One-sentence description of what the client asked'),
  urgency: z.enum(['routine', 'urgent']).default('routine'),
  suggested_action: z
    .string()
    .optional()
    .describe('What the operator should do; optional'),
});

export function registerEscalateTool() {
  return tool(
    'escalate',
    'Route a question to the human operator. Use when the client asks for ' +
      'something you cannot fulfill and the matter genuinely needs human attention. ' +
      'Do NOT use for trivial refusals — use plain refusal instead.',
    escalateInputSchema as any,
    async (input, ctx) => {
      const event = {
        ts: Date.now(),
        agentId: (ctx as any).agentId,
        sessionId: (ctx as any).sessionId,
        summary: input.summary,
        urgency: input.urgency,
        suggested_action: input.suggested_action,
      };
      const path = resolve(
        process.env.OC_DATA_DIR ?? 'data',
        'escalations',
        `${(ctx as any).agentId}.jsonl`,
      );
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify(event) + '\n');
      return {
        content: [
          {
            type: 'text',
            text: 'Escalation logged. The operator will respond.',
          },
        ],
      };
    },
  );
}

export const escalateTool = registerEscalateTool();
```

- [ ] **Step 4: Wire `escalate` into the gateway's tool registry**

The gateway has a place where built-in MCP tools are registered (memory_search, memory_write, etc.). Locate it via:

```bash
grep -n "memory_search\|registerMcpTool\|createSdkMcpServer" src/agent/tools/ src/gateway.ts | head -10
```

Add `escalate` to that registry the same way other built-in tools are registered. The tool resolves at runtime via the same `createSdkMcpServer` pattern existing tools use.

- [ ] **Step 5: Run tests + full suite**

- [ ] **Step 6: Commit**

```bash
git add src/agent/tools/escalate.ts src/agent/tools/__tests__/escalate.test.ts
# plus whatever file holds the tool registry
git commit -m "feat(safety): escalate MCP tool — log structured escalations to JSONL"
```

### Task 11: Anti-hallucination addendum to `leads_agent`

**Files:**
- Modify: `agents/leads_agent/CLAUDE.md`
- Modify: `agents/leads_agent/agent.yml`

- [ ] **Step 1: Add the addendum to `agents/leads_agent/CLAUDE.md`**

Insert near the top of the system prompt (after any persona block, before behavioural instructions):

```markdown
## Talking to clients

You are speaking with external customers. They do not know how the system
behind you is built — and they should not. Never volunteer or invent details
about internal anthroclaw architecture, plugins, configs, MCP tools, operator
consoles, escalation systems, or who built you. Mentioning these confuses
clients and undermines trust.

When you cannot do what a client asks:
- Do NOT invent a technical reason ("operator console is disabled", "the
  config is broken", "I'm waiting for my supervisor to fix something").
- DO say plainly: "Я не могу сделать это прямо сейчас. Передам Тимуру —
  он свяжется с тобой." or equivalent.
- If the inability is permanent (you genuinely lack the capability), use
  the `escalate` tool to route the question to a human operator. Do not
  improvise a workaround that involves describing the system to the client.

Refusal must always be **plain**, not technical.
```

- [ ] **Step 2: Add `escalate` to `agents/leads_agent/agent.yml` mcp_tools**

```yaml
mcp_tools:
- memory_search
- memory_wiki
- list_skills
- escalate          # ← NEW
```

- [ ] **Step 3: Verify config still parses**

```bash
cd /Users/tyess/dev/anthroclaw-capability-cutoff
node -e "
import('./src/agent/agent.js').then((m) => {
  const cfg = require('yaml').parse(require('fs').readFileSync('agents/leads_agent/agent.yml', 'utf-8'));
  console.log(JSON.stringify(cfg.mcp_tools));
});
"
```

(Or run the existing schema unit test that validates all agents parse.)

- [ ] **Step 4: Commit**

```bash
git add agents/leads_agent/CLAUDE.md agents/leads_agent/agent.yml
git commit -m "feat(leads_agent): anti-hallucination guardrail + escalate tool"
```

---

## Phase 6 — End-to-end smoke test

### Task 12: E2E capability-cutoff fixture

**Files:**
- Create: `src/__tests__/capability-cutoff-e2e.test.ts`

- [ ] **Step 1: Write failing test (the test IS the task here — TDD-as-acceptance)**

```ts
// src/__tests__/capability-cutoff-e2e.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  startup: vi.fn().mockResolvedValue(undefined),
  tool: (name: string, desc: string, schema: any, handler: any) => ({ name, desc, schema, handler }),
}));
import { query } from '@anthropic-ai/claude-agent-sdk';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cutoff-e2e-'));
  process.env.OC_AGENTS_DIR = join(dir, 'agents');
  process.env.OC_DATA_DIR = join(dir, 'data');
  process.env.ANTHROCLAW_MASTER_KEY = 'b'.repeat(64);
  process.env.GOOGLE_CALENDAR_ID = 'should_not_leak@example.com';
  mkdirSync(join(dir, 'agents', 'a1'), { recursive: true });
  writeFileSync(
    join(dir, 'agents', 'a1', 'agent.yml'),
    `model: claude-sonnet-4-6\nroutes:\n- channel: telegram\n  account: default\n  scope: dm\nallowlist:\n  telegram:\n  - "100"\nmcp_tools: [send_message]\n`,
  );
  writeFileSync(join(dir, 'agents', 'a1', 'CLAUDE.md'), '# a1\n');
});
afterEach(() => {
  delete process.env.OC_AGENTS_DIR;
  delete process.env.OC_DATA_DIR;
  delete process.env.ANTHROCLAW_MASTER_KEY;
  delete process.env.GOOGLE_CALENDAR_ID;
  rmSync(dir, { recursive: true, force: true });
});

describe('capability cutoff e2e', () => {
  it('agent without external_mcp_servers receives sanitized SDK options', async () => {
    let captured: any;
    (query as any).mockImplementation((args: any) => {
      captured = args;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'system', subtype: 'init', session_id: 'x' };
          yield { type: 'result', usage: {} };
        },
      };
    });

    const gw = await buildTestGateway(dir);
    await gw.dispatch({
      channel: 'telegram', accountId: 'default', chatType: 'dm',
      peerId: '100', senderId: '100', text: 'hi',
    } as any);

    expect(captured.options.enabledMcpjsonServers).toEqual([]);
    expect(captured.options.settingSources).toEqual([]);
    expect(captured.options.tools).toEqual(['Read','Write','Edit','Bash','Glob','Grep','TodoWrite']);
    expect(captured.options.mcpServers).toEqual({});
    expect(captured.options.additionalDirectories).toEqual([]);
    expect(captured.options.cwd).toContain('/agents/a1');
    expect(captured.options.env.GOOGLE_CALENDAR_ID).toBeUndefined();
    expect(captured.options.env.ANTHROCLAW_MASTER_KEY).toBeUndefined();
  });

  it('canUseTool denies a Claude.ai tool the agent did not declare', async () => {
    let captured: any;
    (query as any).mockImplementation((args: any) => {
      captured = args;
      return { async *[Symbol.asyncIterator]() { yield { type: 'result' }; } };
    });
    const gw = await buildTestGateway(dir);
    await gw.dispatch({
      channel: 'telegram', accountId: 'default', chatType: 'dm',
      peerId: '100', senderId: '100', text: 'hi',
    } as any);

    const decision = await captured.options.canUseTool(
      'mcp__claude_ai_Google_Calendar__list_events',
      {},
      { agentId: 'a1', sessionId: 's1' },
    );
    expect(decision.behavior).toBe('deny');
    expect(decision.decisionReason?.reason).toBe('capability_cutoff');
  });

  it('declared external MCP server tool is allowed', async () => {
    writeFileSync(
      join(dir, 'agents', 'a1', 'agent.yml'),
      `model: claude-sonnet-4-6\nroutes:\n- channel: telegram\n  account: default\n  scope: dm\nallowlist:\n  telegram:\n  - "100"\nmcp_tools: [send_message]\nexternal_mcp_servers:\n  google_calendar:\n    url: http://example/mcp\n`,
    );
    let captured: any;
    (query as any).mockImplementation((args: any) => { captured = args; return { async *[Symbol.asyncIterator]() { yield { type: 'result' }; } }; });
    const gw = await buildTestGateway(dir);
    await gw.dispatch({ channel: 'telegram', accountId: 'default', chatType: 'dm', peerId: '100', senderId: '100', text: 'hi' } as any);

    const decision = await captured.options.canUseTool(
      'mcp__google_calendar__list_events',
      {},
      { agentId: 'a1', sessionId: 's1' },
    );
    expect(decision.behavior).toBe('allow');
  });
});

async function buildTestGateway(dir: string) { /* ... copy from routing.test.ts pattern ... */ throw new Error('TODO'); }
```

- [ ] **Step 2: Run test to verify it fails (TODO in helper)**

- [ ] **Step 3: Implement `buildTestGateway` helper**

Copy the gateway-construction pattern from `src/__tests__/routing.test.ts:25-65` verbatim, parameterized by `dir`.

- [ ] **Step 4: Run test to confirm pass**

- [ ] **Step 5: Run full test suite**

```bash
pnpm test 2>&1 | tail -10
```

Must be all green.

- [ ] **Step 6: Commit**

```bash
git add src/__tests__/capability-cutoff-e2e.test.ts
git commit -m "test(cutoff): e2e fixture covering all 7 cutoff invariants"
```

---

## Phase 7 — Release prep

### Task 13: Update `.env.example` and CHANGELOG, bump VERSION

**Files:**
- Modify: `.env.example`
- Modify: `CHANGELOG.md`
- Modify: `VERSION`, `package.json`, `ui/package.json`

- [ ] **Step 1: Add ANTHROCLAW_MASTER_KEY to `.env.example`**

```bash
cat >> .env.example <<'EOF'

# Master key for credential-store at-rest encryption.
# Generate once with: openssl rand -hex 32
# REQUIRED — gateway will fail to start without it.
ANTHROCLAW_MASTER_KEY=
EOF
```

- [ ] **Step 2: Add `[0.8.0]` section to `CHANGELOG.md`**

```markdown
## [0.8.0] - 2026-05-XX

### Added
- **Capability cutoff** — every agent's SDK invocation runs with `enabledMcpjsonServers: []`, `settingSources: []`, hardened `tools` whitelist, scrubbed env, agent-scoped `cwd`, and runtime `canUseTool` gate. Built-in Claude.ai MCP servers (Google Calendar, Notion, Linear, Gmail, Vercel, Cloudflare, etc.) are no longer reachable from agents. External integrations must be declared via `external_mcp_servers` in `agent.yml`.
- **Encrypted credential store** — `EncryptedFilesystemCredentialStore` at `agents/<id>/credentials/<service>.enc`, AES-256-GCM with HKDF-derived per-`(agentId, service)` keys. Master key via `ANTHROCLAW_MASTER_KEY`.
- **Credential audit log** — append-only JSONL at `data/credential-access.jsonl`.
- **Cron→DM session continuity** — cron dispatches with `deliverTo` now persist their SDK sessionId, so the next user message resumes the same conversation. Background-only cron (no `deliverTo`) stays isolated as before.
- **`escalate` MCP tool** — universal tool for routing client questions to human operator. Writes structured events to `data/escalations/<agentId>.jsonl`.
- **Anti-hallucination guardrail** — `leads_agent` (Amina) system prompt explicitly forbids inventing technical excuses involving internal architecture.
- **Filesystem isolation** — every agent's SDK process is constrained to `agents/<id>/` via `cwd`. Bash hardened with sibling-dir denylist + cwd guard wrapper.

### Changed
- `buildSdkOptions` now applies cutoff defaults at the bottom of every option-build pipeline.
- Default agent built-in tool whitelist: `Read, Write, Edit, Bash, Glob, Grep, TodoWrite`.

### Required action for operators
- Generate a master key for credential store: `openssl rand -hex 32`. Set as `ANTHROCLAW_MASTER_KEY` in production env. Gateway will refuse to start without it.
- If your agents previously relied on inherited Claude.ai MCP servers (Google Calendar, Notion, Linear, etc.), those tools will stop working until v0.9.0 ships agent-driven OAuth. Disable any cron jobs that reference them.

### Deprecated
None.

### Removed
- Implicit access to Claude account-bound MCP servers from agent runtime. (This was a security hazard, not a feature.)
```

- [ ] **Step 3: Bump version to 0.8.0**

```bash
echo "0.8.0" > VERSION
node -e "const p=require('./package.json'); p.version='0.8.0'; require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2)+'\n');"
node -e "const p=require('./ui/package.json'); p.version='0.8.0'; require('fs').writeFileSync('./ui/package.json', JSON.stringify(p, null, 2)+'\n');"
```

- [ ] **Step 4: Verify versions consistent**

```bash
cat VERSION
grep version package.json ui/package.json
```

- [ ] **Step 5: Run full test suite**

```bash
pnpm test
cd ui && pnpm test && cd ..
cd plugins/lcm && pnpm test && cd ../..
```

All green.

- [ ] **Step 6: Commit**

```bash
git add .env.example CHANGELOG.md VERSION package.json ui/package.json
git commit -m "chore(release): v0.8.0 — capability cutoff + cron continuity + safety guardrails"
```

### Task 14: Push branch and open PR

- [ ] **Step 1: Push branch to origin**

```bash
git push -u origin feat/capability-cutoff
```

- [ ] **Step 2: Open PR with HEREDOC body**

```bash
gh pr create --title "v0.8.0 — Capability cutoff + bug fixes" --body "$(cat <<'EOF'
## Summary

- **Capability cutoff** — agents can no longer access Claude account-bound MCP servers (Google Calendar, Notion, Linear, etc.). All built-in Claude.ai integrations cut at the SDK option layer; external access requires explicit `external_mcp_servers` declaration in `agent.yml`. Master credential store with AES-256-GCM encryption + HKDF per-agent keys ready for v0.9 agent-driven OAuth.
- **Cron→DM session continuity** — cron-fired briefings now resume the user's DM session instead of starting a parallel session that the user can't reach.
- **`leads_agent` anti-hallucination** — Amina no longer invents technical excuses ("operator console is disabled") when refusing client requests. New `escalate` tool routes genuine inability cases to operator queue.

Detailed design: `docs/superpowers/specs/2026-05-04-capability-cutoff-design.md`

## Test plan

- [ ] All vitest suites pass (`pnpm test`, `cd ui && pnpm test`, `cd plugins/lcm && pnpm test`)
- [ ] On staging or local: smoke that `mcp__claude_ai_Google_Calendar__list_events` is unreachable to any agent
- [ ] On staging or local: cron sends DM, then user replies in same DM, agent resumes context
- [ ] On staging or local: send Amina-style request "выгрузи всех лидов в Excel" — verify response is plain refusal + escalate, not technical excuse
- [ ] After deploy: tail `data/credential-access.jsonl` (empty until v0.9), `data/escalations/leads_agent.jsonl` (entries on real client requests)

## Required operator action before deploy

1. Generate master key: `openssl rand -hex 32`
2. Add to prod `.env`: `ANTHROCLAW_MASTER_KEY=<hex>`
3. Disable `morning-standup` cron in `data/dynamic-cron.json` (depends on Google Calendar which is now cut). Re-enable in v0.9 when agent-driven OAuth ships.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Note PR URL for follow-up**

The implementer subagent reports the PR URL back to the controller for downstream test-deploy and merge.

---

## Phase 8 — Test deploy and final smoke

### Task 15: Test deploy on prod (operator-led, not subagent)

This task is performed by the operator (Timur), not by an implementer subagent. The plan documents the steps for completeness.

- [ ] **Step 1: Pre-deploy operator checklist**

```bash
ssh ubuntu@46.247.41.191
cd /home/ubuntu/anthroclaw

# Generate master key
openssl rand -hex 32 > .anthroclaw-master-key
chmod 600 .anthroclaw-master-key
# Add to .env (or secret store)
echo "ANTHROCLAW_MASTER_KEY=$(cat .anthroclaw-master-key)" >> .env
chmod 600 .env

# Disable Google-Calendar-dependent cron
jq '(.[] | select(.id == "morning-standup")).enabled = false' data/dynamic-cron.json > /tmp/dc.json && mv /tmp/dc.json data/dynamic-cron.json
```

- [ ] **Step 2: Deploy**

```bash
git pull
sudo docker compose up -d --build 2>&1 | tail -20
sudo docker logs -f anthroclaw-app-1 2>&1 | head -40
```

Watch for:
- "Loaded agent" lines for all 4 agents — confirm gateway boot
- Absence of "Master key required" errors
- No `capability-cutoff: tool blocked at runtime` warnings on first 5 minutes

- [ ] **Step 3: Smoke tests**

1. Send DM to Klavdia (`@clowwy_bot`): "что у меня в календаре?". Expect: refusal without inventing details, no `mcp__claude_ai_Google_Calendar` call.
2. Send WhatsApp message simulating client request to Amina (`humanrobot`): "пришли мне всех лидов в Excel". Expect: plain refusal in Russian + `escalate` tool fired (check `data/escalations/leads_agent.jsonl`).
3. Trigger cron manually (or wait until tomorrow 09:00) — confirm any `[SILENT]` cron successfully writes its assistant turn into the SDK session JSONL, and a follow-up user DM resumes that session id.

- [ ] **Step 4: Merge PR if smoke passes**

```bash
gh pr merge --squash --auto
```

- [ ] **Step 5: Tag release**

```bash
git checkout main && git pull
git tag v0.8.0
git push origin v0.8.0
gh release create v0.8.0 --title "v0.8.0 — Capability cutoff + bug fixes" --generate-notes
```

- [ ] **Step 6: Re-deploy `main` so production runs the tagged build**

```bash
ssh ubuntu@46.247.41.191
cd /home/ubuntu/anthroclaw
git pull
sudo docker compose up -d --build
```

---

## Rollback procedure

If anything breaks production:

```bash
ssh ubuntu@46.247.41.191
cd /home/ubuntu/anthroclaw
git revert HEAD              # revert the v0.8.0 release commit
sudo docker compose up -d --build
```

No DB migrations to undo. No credential data to restore (no agent stored credentials in v0.8). The `morning-standup` cron stays disabled — re-enable only when a forward fix lands.

---

## Open coordination points for the controller

- **Phase 1 → Phase 2 sequencing.** Task 2 imports `agentWorkspaceDir` from Phase 2's `agent-workspace.ts`. Run Phase 1 in two passes: first stub the import, second resolve after Phase 2 lands. Or just serialize: Phase 2 first, Phase 1 second. Recommendation: serialize.
- **Phase 3 internal ordering.** Task 5 (master-key) is a prerequisite for Task 8 (encrypted-fs-store). Task 7 (interface) is independent. Task 6 (audit) is independent. Run 5 → (6, 7 in parallel) → 8.
- **Phase 4 + 5 + 6 are independent**, may run in parallel.
- **Phase 7 strictly serial** after all above.

## Final shape

```
Tasks:
  0. Worktree readiness                      (controller)
  1. cutoff core (scrubEnv, composeGates)    (Phase 1)
  2. applyCutoffOptions wiring               (Phase 1)
  3. agent-workspace                         (Phase 2)
  4. Bash sibling-dir denylist               (Phase 2)
  5. master-key                              (Phase 3)
  6. CredentialAuditLog                      (Phase 3)
  7. CredentialStore interface               (Phase 3)
  8. EncryptedFilesystemCredentialStore      (Phase 3)
  9. cron-DM continuity fix                  (Phase 4)
  10. escalate tool                          (Phase 5)
  11. leads_agent guardrail                  (Phase 5)
  12. e2e fixture                            (Phase 6)
  13. CHANGELOG + version bump               (Phase 7)
  14. PR                                     (Phase 7)
  15. Operator deploy + smoke                (Phase 8 — operator-led)
```

15 tasks, 14 commits (Task 0 has no commit, Task 15 is operator-led).
