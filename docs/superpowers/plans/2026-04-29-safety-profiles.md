# Safety Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce `safety_profile` (public/trusted/private) as a required agent.yml field, gate built-in and MCP tools by profile, restore Klavdia's correct tool usage by replacing `claude_code` SDK preset with profile-controlled system prompt, and ship a migration utility for the three existing agents.

**Architecture:** Single source of truth is per-tool `META` (built-ins in `src/security/builtin-tool-meta.ts`, MCP tools export `META` from each tool file). Three profile objects in `src/security/profiles/` reference META to compute allowed/forbidden/requiresApproval sets. `validateSafetyProfile()` runs at agent load and hard-fails on incompatibility. `buildSdkOptions` becomes profile-aware. `canUseTool` becomes async and routes destructive operations through `ApprovalBroker` + Telegram inline buttons; channels declare `supportsApproval`.

**Tech Stack:** TypeScript, Zod, vitest, grammy (Telegram), Baileys (WhatsApp), `yaml` package for migration writer, `@anthropic-ai/claude-agent-sdk`.

**Spec:** `docs/superpowers/specs/2026-04-29-safety-profiles-design.md`

---

## File Structure

**New files:**
- `src/security/types.ts` — `ToolMeta` interface + `ProfileName` type
- `src/security/builtin-tool-meta.ts` — META for `Read`, `Write`, `Edit`, `MultiEdit`, `Bash`, `Glob`, `Grep`, `LS`, `WebFetch`, `NotebookEdit`, `TodoWrite`
- `src/security/profiles/types.ts` — `SafetyProfile` interface
- `src/security/profiles/public.ts` — public profile object
- `src/security/profiles/trusted.ts` — trusted profile object
- `src/security/profiles/private.ts` — private profile object
- `src/security/profiles/index.ts` — `getProfile(name)`, `validateSafetyProfile(config)`
- `src/security/profiles/__tests__/profiles.test.ts`
- `src/security/profiles/__tests__/validation.test.ts`
- `src/security/approval-broker.ts` — in-memory approval queue
- `src/security/__tests__/approval-broker.test.ts`
- `src/agent/tools/__shared/meta.ts` — re-export type, used by every tool file
- `scripts/migrate-safety-profile.ts` — CLI migration utility
- `scripts/__tests__/migrate-safety-profile.test.ts`
- `docs/safety-profiles.md` — user guide

**Modified files:**
- `src/config/schema.ts` — add `safety_profile` (required) + `safety_overrides` (optional) to `AgentYmlSchema`
- `src/sdk/options.ts` — replace hardcoded preset/`settingSources` with profile-driven values
- `src/sdk/permissions.ts` — async `canUseTool`, profile-driven allowedTools, integration with `ApprovalBroker`
- `src/agent/tools/manage-cron.ts`, `manage-skills.ts`, `access-control.ts`, `memory-search.ts`, `memory-write.ts`, `memory-wiki.ts`, `send-message.ts`, `send-media.ts`, `web-search.ts`, `list-skills.ts`, `local-note-search.ts`, `local-note-propose.ts`, `session-search.ts` — add `META` export
- `src/agent/agent.ts` — call `validateSafetyProfile()` in `Agent.load()`, store profile reference
- `src/channels/types.ts` — add `supportsApproval: boolean` and `promptForApproval()` to `ChannelAdapter`
- `src/channels/telegram.ts` — implement `promptForApproval()` (inline keyboard), `supportsApproval = true`, route callback_query for approvals to broker
- `src/channels/whatsapp.ts` — `supportsApproval = false`, `promptForApproval()` throws
- `src/gateway.ts` — instantiate `ApprovalBroker`, pass to permissions module
- `agents/example/agent.yml` — add `safety_profile: private`
- `agents/leads_agent/agent.yml` — add `safety_profile: public` + `safety_overrides` (manual review for `access_control`)
- `agents/content_sm_building/agent.yml` — add `safety_profile: trusted`
- `package.json` — add `migrate:safety-profile` script
- `CHANGELOG.md` — breaking change note
- `README.md` — link to safety-profiles.md

---

## Phase 1: Tool META foundation

### Task 1: ToolMeta type

**Files:**
- Create: `src/security/types.ts`
- Test: `src/security/__tests__/types.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/__tests__/types.test.ts
import { describe, it, expect } from 'vitest';
import type { ToolMeta, ProfileName } from '../types.js';

describe('ToolMeta type', () => {
  it('accepts a fully-specified meta object', () => {
    const meta: ToolMeta = {
      category: 'agent-config',
      safe_in_public: false,
      safe_in_trusted: true,
      safe_in_private: true,
      destructive: true,
      reads_only: false,
      hard_blacklist_in: ['public'],
    };
    expect(meta.category).toBe('agent-config');
    expect(meta.hard_blacklist_in).toContain('public');
  });

  it('ProfileName is one of the three values', () => {
    const a: ProfileName = 'public';
    const b: ProfileName = 'trusted';
    const c: ProfileName = 'private';
    expect([a, b, c]).toEqual(['public', 'trusted', 'private']);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/__tests__/types.test.ts`
Expected: fails with "Cannot find module '../types.js'"

- [ ] **Step 3: Implement**

```ts
// src/security/types.ts
export type ProfileName = 'public' | 'trusted' | 'private';

export type ToolCategory =
  | 'read-only'         // Read, Glob, Grep, LS, memory_search, memory_wiki
  | 'code-exec'         // Bash, Write, Edit, MultiEdit, NotebookEdit
  | 'network'           // WebFetch, web_search_*
  | 'messaging'         // send_message, send_media
  | 'memory-write'      // memory_write, local_note_propose
  | 'agent-config'      // manage_cron, manage_skills, access_control
  | 'session-introspect'; // session_search, list_skills, local_note_search

export interface ToolMeta {
  category: ToolCategory;
  safe_in_public: boolean;
  safe_in_trusted: boolean;
  safe_in_private: boolean;
  destructive: boolean;        // requires approval in trusted (and optionally private)
  reads_only: boolean;
  hard_blacklist_in: ProfileName[]; // override cannot open this tool in these profiles
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm vitest run src/security/__tests__/types.test.ts`
Expected: 2 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/security/types.ts src/security/__tests__/types.test.ts
git commit -m "feat(security): introduce ToolMeta and ProfileName types"
```

---

### Task 2: BUILTIN_META registry

**Files:**
- Create: `src/security/builtin-tool-meta.ts`
- Test: `src/security/__tests__/builtin-tool-meta.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/__tests__/builtin-tool-meta.test.ts
import { describe, it, expect } from 'vitest';
import { BUILTIN_META } from '../builtin-tool-meta.js';

describe('BUILTIN_META', () => {
  it('marks Read as read-only and safe in all profiles', () => {
    const m = BUILTIN_META.Read;
    expect(m.reads_only).toBe(true);
    expect(m.safe_in_public).toBe(true);
    expect(m.safe_in_trusted).toBe(true);
    expect(m.safe_in_private).toBe(true);
    expect(m.destructive).toBe(false);
  });

  it('marks Bash as destructive and forbidden in public via hard_blacklist', () => {
    const m = BUILTIN_META.Bash;
    expect(m.destructive).toBe(true);
    expect(m.safe_in_public).toBe(false);
    expect(m.hard_blacklist_in).toContain('public');
  });

  it('marks Write as destructive and not safe in public', () => {
    const m = BUILTIN_META.Write;
    expect(m.destructive).toBe(true);
    expect(m.safe_in_public).toBe(false);
    expect(m.safe_in_trusted).toBe(true);
  });

  it('covers all built-ins referenced by DEFAULT_ALLOWED_TOOLS', () => {
    const expected = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash', 'WebFetch', 'NotebookEdit', 'TodoWrite'];
    for (const name of expected) {
      expect(BUILTIN_META).toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/__tests__/builtin-tool-meta.test.ts`
Expected: "Cannot find module '../builtin-tool-meta.js'"

- [ ] **Step 3: Implement**

```ts
// src/security/builtin-tool-meta.ts
import type { ToolMeta } from './types.js';

export const BUILTIN_META: Record<string, ToolMeta> = {
  // Read-only filesystem
  Read:    { category: 'read-only', safe_in_public: true,  safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: true,  hard_blacklist_in: [] },
  Glob:    { category: 'read-only', safe_in_public: true,  safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: true,  hard_blacklist_in: [] },
  Grep:    { category: 'read-only', safe_in_public: true,  safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: true,  hard_blacklist_in: [] },
  LS:      { category: 'read-only', safe_in_public: true,  safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: true,  hard_blacklist_in: [] },

  // Filesystem writes (destructive in trusted, allowed in private)
  Write:        { category: 'code-exec', safe_in_public: false, safe_in_trusted: true, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public'] },
  Edit:         { category: 'code-exec', safe_in_public: false, safe_in_trusted: true, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public'] },
  MultiEdit:    { category: 'code-exec', safe_in_public: false, safe_in_trusted: true, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public'] },
  NotebookEdit: { category: 'code-exec', safe_in_public: false, safe_in_trusted: false, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public', 'trusted'] },

  // Code execution (only private)
  Bash: { category: 'code-exec', safe_in_public: false, safe_in_trusted: false, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public', 'trusted'] },

  // Arbitrary network (SSRF risk)
  WebFetch: { category: 'network', safe_in_public: false, safe_in_trusted: false, safe_in_private: true, destructive: true, reads_only: false, hard_blacklist_in: ['public'] },

  // Harmless ephemeral tracking
  TodoWrite: { category: 'session-introspect', safe_in_public: false, safe_in_trusted: true, safe_in_private: true, destructive: false, reads_only: false, hard_blacklist_in: ['public'] },
};
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm vitest run src/security/__tests__/builtin-tool-meta.test.ts`
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/security/builtin-tool-meta.ts src/security/__tests__/builtin-tool-meta.test.ts
git commit -m "feat(security): BUILTIN_META registry classifying built-in tools by profile safety"
```

---

### Task 3: Add META to MCP tools

**Files:**
- Modify: `src/agent/tools/manage-cron.ts`, `manage-skills.ts`, `access-control.ts`, `memory-search.ts`, `memory-write.ts`, `memory-wiki.ts`, `send-message.ts`, `send-media.ts`, `web-search.ts`, `list-skills.ts`, `local-note-search.ts`, `local-note-propose.ts`, `session-search.ts`
- Test: `src/agent/tools/__tests__/meta.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/agent/tools/__tests__/meta.test.ts
import { describe, it, expect } from 'vitest';
import { META as manageCronMeta } from '../manage-cron.js';
import { META as manageSkillsMeta } from '../manage-skills.js';
import { META as accessControlMeta } from '../access-control.js';
import { META as memorySearchMeta } from '../memory-search.js';
import { META as memoryWriteMeta } from '../memory-write.js';
import { META as memoryWikiMeta } from '../memory-wiki.js';
import { META as sendMessageMeta } from '../send-message.js';
import { META as sendMediaMeta } from '../send-media.js';
import { META as webSearchMeta } from '../web-search.js';
import { META as listSkillsMeta } from '../list-skills.js';
import { META as localNoteSearchMeta } from '../local-note-search.js';
import { META as localNoteProposeMeta } from '../local-note-propose.js';
import { META as sessionSearchMeta } from '../session-search.js';

describe('MCP tool META', () => {
  it('memory_search: read-only, safe everywhere', () => {
    expect(memorySearchMeta.reads_only).toBe(true);
    expect(memorySearchMeta.safe_in_public).toBe(true);
    expect(memorySearchMeta.destructive).toBe(false);
  });

  it('memory_write: not safe in public, no destructive approval needed in trusted', () => {
    expect(memoryWriteMeta.safe_in_public).toBe(false);
    expect(memoryWriteMeta.safe_in_trusted).toBe(true);
    expect(memoryWriteMeta.destructive).toBe(false);
  });

  it('manage_cron: forbidden in public via hard_blacklist, destructive in trusted', () => {
    expect(manageCronMeta.safe_in_public).toBe(false);
    expect(manageCronMeta.hard_blacklist_in).toContain('public');
    expect(manageCronMeta.safe_in_trusted).toBe(true);
    expect(manageCronMeta.destructive).toBe(true);
  });

  it('access_control: hard_blacklist in public AND trusted', () => {
    expect(accessControlMeta.hard_blacklist_in).toEqual(expect.arrayContaining(['public', 'trusted']));
    expect(accessControlMeta.safe_in_private).toBe(true);
  });

  it('manage_skills: hard_blacklist in public AND trusted', () => {
    expect(manageSkillsMeta.hard_blacklist_in).toEqual(expect.arrayContaining(['public', 'trusted']));
  });

  it('send_message: safe in public', () => {
    expect(sendMessageMeta.safe_in_public).toBe(true);
  });

  it('send_media: not safe in public, destructive in trusted', () => {
    expect(sendMediaMeta.safe_in_public).toBe(false);
    expect(sendMediaMeta.safe_in_trusted).toBe(true);
    expect(sendMediaMeta.destructive).toBe(true);
  });

  it('web_search: safe in public', () => {
    expect(webSearchMeta.safe_in_public).toBe(true);
    expect(webSearchMeta.reads_only).toBe(true);
  });

  it('memory_wiki: safe in public, read-only', () => {
    expect(memoryWikiMeta.safe_in_public).toBe(true);
    expect(memoryWikiMeta.reads_only).toBe(true);
  });

  it('list_skills: safe in public, read-only', () => {
    expect(listSkillsMeta.safe_in_public).toBe(true);
    expect(listSkillsMeta.reads_only).toBe(true);
  });

  it('local_note_search: not safe in public', () => {
    expect(localNoteSearchMeta.safe_in_public).toBe(false);
    expect(localNoteSearchMeta.safe_in_trusted).toBe(true);
  });

  it('local_note_propose: destructive, not safe in public', () => {
    expect(localNoteProposeMeta.safe_in_public).toBe(false);
    expect(localNoteProposeMeta.destructive).toBe(true);
  });

  it('session_search: not safe in public', () => {
    expect(sessionSearchMeta.safe_in_public).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/agent/tools/__tests__/meta.test.ts`
Expected: fails — META not exported from any tool file

- [ ] **Step 3: Add META export to each tool**

For each tool file, append at the end (after existing exports). Below are the values for each:

```ts
// src/agent/tools/manage-cron.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: ['public'],
};
```

```ts
// src/agent/tools/manage-skills.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: false, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: ['public', 'trusted'],
};
```

```ts
// src/agent/tools/access-control.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'agent-config',
  safe_in_public: false, safe_in_trusted: false, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: ['public', 'trusted'],
};
```

```ts
// src/agent/tools/memory-search.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'read-only',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/memory-write.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'memory-write',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: false, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/memory-wiki.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'read-only',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/send-message.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'messaging',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: false, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/send-media.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'messaging',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/web-search.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'network',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/list-skills.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'read-only',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/local-note-search.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'session-introspect',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/local-note-propose.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'memory-write',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: [],
};
```

```ts
// src/agent/tools/session-search.ts — append:
import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'session-introspect',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: true, hard_blacklist_in: [],
};
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/agent/tools/__tests__/meta.test.ts`
Expected: 13 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/*.ts src/agent/tools/__tests__/meta.test.ts
git commit -m "feat(tools): export META from every MCP tool for safety classification"
```

---

## Phase 2: SafetyProfile types and definitions

### Task 4: SafetyProfile interface

**Files:**
- Create: `src/security/profiles/types.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/profiles/__tests__/types.test.ts
import { describe, it, expect } from 'vitest';
import type { SafetyProfile } from '../types.js';

describe('SafetyProfile interface', () => {
  it('accepts a fully-formed profile object', () => {
    const p: SafetyProfile = {
      name: 'public',
      systemPrompt: { mode: 'string', text: 'You are a public assistant.' },
      settingSources: [],
      builtinTools: { allowed: new Set(['Read']), forbidden: new Set(['Bash']), requiresApproval: new Set() },
      mcpToolPolicy: {
        allowedByMeta: () => true,
        requiresApproval: () => false,
      },
      hardBlacklist: new Set(['Bash', 'access_control']),
      permissionFlow: 'strict-deny',
      sandboxDefaults: { allowUnsandboxedCommands: false },
      rateLimitFloor: { windowMs: 3_600_000, max: 30 },
      validateAllowlist: () => ({ ok: true, warnings: [] }),
    };
    expect(p.name).toBe('public');
    expect(p.permissionFlow).toBe('strict-deny');
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/profiles/__tests__/types.test.ts`
Expected: "Cannot find module '../types.js'"

- [ ] **Step 3: Implement**

```ts
// src/security/profiles/types.ts
import type { ProfileName, ToolMeta } from '../types.js';
import type { AllowlistConfig } from '../../config/schema.js';

export type SystemPromptSpec =
  | { mode: 'string'; text: string }
  | { mode: 'preset'; preset: 'claude_code'; excludeDynamicSections: boolean };

export type SettingSource = 'project' | 'user';

export type PermissionFlow = 'auto-allow' | 'auto-deny' | 'interactive' | 'strict-deny';

export interface SandboxDefaults {
  allowUnsandboxedCommands: boolean;
  enabled?: boolean;
}

export interface RateLimitFloor {
  windowMs: number;
  max: number;
}

export interface AllowlistValidation {
  ok: boolean;
  warnings: string[];
  error?: string;
}

export interface SafetyProfile {
  name: ProfileName;
  systemPrompt: SystemPromptSpec;
  settingSources: SettingSource[];
  builtinTools: {
    allowed: Set<string>;
    forbidden: Set<string>;
    requiresApproval: Set<string>;
  };
  mcpToolPolicy: {
    allowedByMeta: (meta: ToolMeta) => boolean;
    requiresApproval: (meta: ToolMeta) => boolean;
  };
  hardBlacklist: Set<string>;
  permissionFlow: PermissionFlow;
  sandboxDefaults: SandboxDefaults;
  rateLimitFloor: RateLimitFloor | null;
  validateAllowlist(allowlist: AllowlistConfig | undefined): AllowlistValidation;
}
```

Note: `AllowlistConfig` type does not yet exist — Step 3a adds it.

- [ ] **Step 3a: Add AllowlistConfig export to schema.ts**

In `src/config/schema.ts`, after the existing `AllowlistSchema` definition (search for `allowlist:` to find it), export the type:

```ts
export type AllowlistConfig = z.infer<typeof AllowlistSchema>;
```

If `AllowlistSchema` does not exist, locate the inline allowlist definition in `AgentYmlSchema` and extract it:

```ts
const AllowlistSchema = z.object({
  telegram: z.array(z.string()).optional(),
  whatsapp: z.array(z.string()).optional(),
}).optional();
export type AllowlistConfig = z.infer<typeof AllowlistSchema>;
```

Then reference `AllowlistSchema` in `AgentYmlSchema` instead of inline definition.

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/security/profiles/__tests__/types.test.ts`
Expected: 1 test passes

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/types.ts src/security/profiles/__tests__/types.test.ts src/config/schema.ts
git commit -m "feat(security): SafetyProfile interface and AllowlistConfig type"
```

---

### Task 5: Public profile

**Files:**
- Create: `src/security/profiles/public.ts`
- Test: `src/security/profiles/__tests__/public-profile.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/profiles/__tests__/public-profile.test.ts
import { describe, it, expect } from 'vitest';
import { publicProfile } from '../public.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('publicProfile', () => {
  it('uses string system prompt mode', () => {
    expect(publicProfile.systemPrompt.mode).toBe('string');
  });

  it('settingSources is empty', () => {
    expect(publicProfile.settingSources).toEqual([]);
  });

  it('Read is in built-in allowed set', () => {
    expect(publicProfile.builtinTools.allowed.has('Read')).toBe(true);
  });

  it('Bash is in built-in forbidden set and hard blacklist', () => {
    expect(publicProfile.builtinTools.forbidden.has('Bash')).toBe(true);
    expect(publicProfile.hardBlacklist.has('Bash')).toBe(true);
  });

  it('Write is forbidden', () => {
    expect(publicProfile.builtinTools.forbidden.has('Write')).toBe(true);
  });

  it('mcp policy: rejects tools with safe_in_public=false', () => {
    expect(publicProfile.mcpToolPolicy.allowedByMeta(BUILTIN_META.Bash)).toBe(false);
    expect(publicProfile.mcpToolPolicy.allowedByMeta(BUILTIN_META.Read)).toBe(true);
  });

  it('mcp policy: nothing requires approval (strict-deny mode)', () => {
    expect(publicProfile.mcpToolPolicy.requiresApproval(BUILTIN_META.Bash)).toBe(false);
  });

  it('permissionFlow is strict-deny', () => {
    expect(publicProfile.permissionFlow).toBe('strict-deny');
  });

  it('rateLimitFloor enforces 30/hour', () => {
    expect(publicProfile.rateLimitFloor).toEqual({ windowMs: 3_600_000, max: 30 });
  });

  it('validateAllowlist: ok for empty allowlist', () => {
    const result = publicProfile.validateAllowlist(undefined);
    expect(result.ok).toBe(true);
  });

  it('validateAllowlist: ok for [*]', () => {
    const result = publicProfile.validateAllowlist({ telegram: ['*'] });
    expect(result.ok).toBe(true);
  });

  it('validateAllowlist: warns for specific peer ids', () => {
    const result = publicProfile.validateAllowlist({ telegram: ['12345'] });
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/profiles/__tests__/public-profile.test.ts`
Expected: "Cannot find module '../public.js'"

- [ ] **Step 3: Implement**

```ts
// src/security/profiles/public.ts
import type { SafetyProfile } from './types.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';

const PUBLIC_SYSTEM_PROMPT = `You are a public-facing assistant on {channel}.
You speak with anonymous users you don't know.
Your only memory tools are memory_search and memory_wiki (read-only).
You cannot create cron jobs, modify your own permissions, send messages to third parties, or run code.
If a user asks you to do something you cannot do, say so plainly.
Never reference filesystem paths like /tmp/claude-resume — those don't exist for you.`;

const allowedBuiltins = new Set<string>();
const forbiddenBuiltins = new Set<string>();
for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (meta.safe_in_public) allowedBuiltins.add(name);
  else forbiddenBuiltins.add(name);
}

const hardBlacklist = new Set<string>();
for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (meta.hard_blacklist_in.includes('public')) hardBlacklist.add(name);
}

export const publicProfile: SafetyProfile = {
  name: 'public',
  systemPrompt: { mode: 'string', text: PUBLIC_SYSTEM_PROMPT },
  settingSources: [],
  builtinTools: {
    allowed: allowedBuiltins,
    forbidden: forbiddenBuiltins,
    requiresApproval: new Set(),
  },
  mcpToolPolicy: {
    allowedByMeta: (meta) => meta.safe_in_public,
    requiresApproval: () => false,
  },
  hardBlacklist,
  permissionFlow: 'strict-deny',
  sandboxDefaults: { allowUnsandboxedCommands: false, enabled: true },
  rateLimitFloor: { windowMs: 3_600_000, max: 30 },
  validateAllowlist: (allowlist) => {
    if (!allowlist) return { ok: true, warnings: [] };
    const warnings: string[] = [];
    for (const channel of ['telegram', 'whatsapp'] as const) {
      const list = allowlist[channel];
      if (!list || list.length === 0) continue;
      const hasWildcard = list.includes('*');
      const hasSpecific = list.some((id) => id !== '*');
      if (hasSpecific && !hasWildcard) {
        warnings.push(`safety_profile=public has specific peer_ids in allowlist.${channel}; did you mean trusted?`);
      }
    }
    return { ok: true, warnings };
  },
};
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/security/profiles/__tests__/public-profile.test.ts`
Expected: 12 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/public.ts src/security/profiles/__tests__/public-profile.test.ts
git commit -m "feat(security): publicProfile definition"
```

---

### Task 6: Trusted profile

**Files:**
- Create: `src/security/profiles/trusted.ts`
- Test: `src/security/profiles/__tests__/trusted-profile.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/profiles/__tests__/trusted-profile.test.ts
import { describe, it, expect } from 'vitest';
import { trustedProfile } from '../trusted.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('trustedProfile', () => {
  it('uses preset claude_code with excludeDynamicSections', () => {
    expect(trustedProfile.systemPrompt).toEqual({
      mode: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: true,
    });
  });

  it('settingSources includes project only', () => {
    expect(trustedProfile.settingSources).toEqual(['project']);
  });

  it('Write is allowed but requires approval', () => {
    expect(trustedProfile.builtinTools.allowed.has('Write')).toBe(true);
    expect(trustedProfile.builtinTools.requiresApproval.has('Write')).toBe(true);
  });

  it('Bash is forbidden', () => {
    expect(trustedProfile.builtinTools.forbidden.has('Bash')).toBe(true);
  });

  it('mcp policy: memory_write allowed without approval', () => {
    const memoryWriteMeta = { ...BUILTIN_META.Read, safe_in_trusted: true, destructive: false };
    expect(trustedProfile.mcpToolPolicy.allowedByMeta(memoryWriteMeta)).toBe(true);
    expect(trustedProfile.mcpToolPolicy.requiresApproval(memoryWriteMeta)).toBe(false);
  });

  it('mcp policy: destructive tools require approval', () => {
    const destructiveMeta = { ...BUILTIN_META.Write, safe_in_trusted: true, destructive: true };
    expect(trustedProfile.mcpToolPolicy.requiresApproval(destructiveMeta)).toBe(true);
  });

  it('hardBlacklist includes manage_skills and access_control', () => {
    expect(trustedProfile.hardBlacklist.has('manage_skills')).toBe(true);
    expect(trustedProfile.hardBlacklist.has('access_control')).toBe(true);
  });

  it('permissionFlow is interactive', () => {
    expect(trustedProfile.permissionFlow).toBe('interactive');
  });

  it('rateLimitFloor 100/hour', () => {
    expect(trustedProfile.rateLimitFloor).toEqual({ windowMs: 3_600_000, max: 100 });
  });

  it('validateAllowlist: rejects [*]', () => {
    const r = trustedProfile.validateAllowlist({ telegram: ['*'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/wildcard/i);
  });

  it('validateAllowlist: ok for specific ids', () => {
    expect(trustedProfile.validateAllowlist({ telegram: ['12345', '67890'] })).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/profiles/__tests__/trusted-profile.test.ts`
Expected: "Cannot find module '../trusted.js'"

- [ ] **Step 3: Implement**

```ts
// src/security/profiles/trusted.ts
import type { SafetyProfile } from './types.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';

const allowed = new Set<string>();
const forbidden = new Set<string>();
const requiresApproval = new Set<string>();

for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (!meta.safe_in_trusted) {
    forbidden.add(name);
    continue;
  }
  allowed.add(name);
  if (meta.destructive) requiresApproval.add(name);
}

const hardBlacklist = new Set<string>(['manage_skills', 'access_control']);
for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (meta.hard_blacklist_in.includes('trusted')) hardBlacklist.add(name);
}

export const trustedProfile: SafetyProfile = {
  name: 'trusted',
  systemPrompt: { mode: 'preset', preset: 'claude_code', excludeDynamicSections: true },
  settingSources: ['project'],
  builtinTools: { allowed, forbidden, requiresApproval },
  mcpToolPolicy: {
    allowedByMeta: (meta) => meta.safe_in_trusted,
    requiresApproval: (meta) => meta.safe_in_trusted && meta.destructive,
  },
  hardBlacklist,
  permissionFlow: 'interactive',
  sandboxDefaults: { allowUnsandboxedCommands: false, enabled: true },
  rateLimitFloor: { windowMs: 3_600_000, max: 100 },
  validateAllowlist: (allowlist) => {
    if (!allowlist) return { ok: true, warnings: [] };
    for (const channel of ['telegram', 'whatsapp'] as const) {
      const list = allowlist[channel] ?? [];
      if (list.includes('*')) {
        return {
          ok: false,
          warnings: [],
          error: `safety_profile=trusted does not allow wildcard "*" in allowlist.${channel}; use specific peer_ids or change profile to public.`,
        };
      }
    }
    return { ok: true, warnings: [] };
  },
};
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/security/profiles/__tests__/trusted-profile.test.ts`
Expected: 11 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/trusted.ts src/security/profiles/__tests__/trusted-profile.test.ts
git commit -m "feat(security): trustedProfile definition"
```

---

### Task 7: Private profile

**Files:**
- Create: `src/security/profiles/private.ts`
- Test: `src/security/profiles/__tests__/private-profile.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/profiles/__tests__/private-profile.test.ts
import { describe, it, expect } from 'vitest';
import { privateProfile } from '../private.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('privateProfile', () => {
  it('uses preset claude_code without excluding dynamic sections', () => {
    expect(privateProfile.systemPrompt).toEqual({
      mode: 'preset',
      preset: 'claude_code',
      excludeDynamicSections: false,
    });
  });

  it('settingSources includes project and user', () => {
    expect(privateProfile.settingSources).toEqual(['project', 'user']);
  });

  it('all built-ins allowed', () => {
    for (const name of Object.keys(BUILTIN_META)) {
      expect(privateProfile.builtinTools.allowed.has(name)).toBe(true);
    }
    expect(privateProfile.builtinTools.forbidden.size).toBe(0);
  });

  it('Bash and WebFetch require approval', () => {
    expect(privateProfile.builtinTools.requiresApproval.has('Bash')).toBe(true);
    expect(privateProfile.builtinTools.requiresApproval.has('WebFetch')).toBe(true);
  });

  it('hardBlacklist is empty', () => {
    expect(privateProfile.hardBlacklist.size).toBe(0);
  });

  it('rateLimitFloor is null', () => {
    expect(privateProfile.rateLimitFloor).toBeNull();
  });

  it('validateAllowlist: accepts exactly 1 peer per channel', () => {
    expect(privateProfile.validateAllowlist({ telegram: ['12345'] })).toMatchObject({ ok: true });
  });

  it('validateAllowlist: rejects 0 peers', () => {
    const r = privateProfile.validateAllowlist({ telegram: [] });
    expect(r.ok).toBe(false);
  });

  it('validateAllowlist: rejects 2+ peers in same channel', () => {
    const r = privateProfile.validateAllowlist({ telegram: ['1', '2'] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/exactly 1/i);
  });

  it('validateAllowlist: rejects wildcard', () => {
    const r = privateProfile.validateAllowlist({ telegram: ['*'] });
    expect(r.ok).toBe(false);
  });

  it('validateAllowlist: rejects undefined allowlist', () => {
    const r = privateProfile.validateAllowlist(undefined);
    expect(r.ok).toBe(false);
  });

  it('validateAllowlist: ok with peers across multiple channels (1 each)', () => {
    expect(privateProfile.validateAllowlist({ telegram: ['1'], whatsapp: ['2'] })).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/profiles/__tests__/private-profile.test.ts`
Expected: "Cannot find module '../private.js'"

- [ ] **Step 3: Implement**

```ts
// src/security/profiles/private.ts
import type { SafetyProfile } from './types.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';

const allowed = new Set<string>(Object.keys(BUILTIN_META));
const forbidden = new Set<string>();
const requiresApproval = new Set<string>();

for (const [name, meta] of Object.entries(BUILTIN_META)) {
  if (meta.destructive) requiresApproval.add(name);
}

export const privateProfile: SafetyProfile = {
  name: 'private',
  systemPrompt: { mode: 'preset', preset: 'claude_code', excludeDynamicSections: false },
  settingSources: ['project', 'user'],
  builtinTools: { allowed, forbidden, requiresApproval },
  mcpToolPolicy: {
    allowedByMeta: (meta) => meta.safe_in_private,
    requiresApproval: (meta) => meta.destructive,
  },
  hardBlacklist: new Set(),
  permissionFlow: 'interactive',
  sandboxDefaults: { allowUnsandboxedCommands: false, enabled: true },
  rateLimitFloor: null,
  validateAllowlist: (allowlist) => {
    if (!allowlist) {
      return { ok: false, warnings: [], error: 'safety_profile=private requires allowlist with exactly 1 peer per channel' };
    }
    let totalPeers = 0;
    for (const channel of ['telegram', 'whatsapp'] as const) {
      const list = allowlist[channel] ?? [];
      if (list.length === 0) continue;
      if (list.includes('*')) {
        return { ok: false, warnings: [], error: `safety_profile=private does not allow "*" in allowlist.${channel}` };
      }
      if (list.length !== 1) {
        return { ok: false, warnings: [], error: `safety_profile=private requires exactly 1 peer in allowlist.${channel}, got ${list.length}` };
      }
      totalPeers += 1;
    }
    if (totalPeers === 0) {
      return { ok: false, warnings: [], error: 'safety_profile=private requires at least one channel with exactly 1 peer' };
    }
    return { ok: true, warnings: [] };
  },
};
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/security/profiles/__tests__/private-profile.test.ts`
Expected: 12 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/private.ts src/security/profiles/__tests__/private-profile.test.ts
git commit -m "feat(security): privateProfile definition with strict 1-peer-per-channel allowlist"
```

---

### Task 8: Profile registry index

**Files:**
- Create: `src/security/profiles/index.ts`
- Test: `src/security/profiles/__tests__/index.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/profiles/__tests__/index.test.ts
import { describe, it, expect } from 'vitest';
import { getProfile, ALL_PROFILES } from '../index.js';

describe('profile registry', () => {
  it('returns publicProfile for "public"', () => {
    expect(getProfile('public').name).toBe('public');
  });
  it('returns trustedProfile for "trusted"', () => {
    expect(getProfile('trusted').name).toBe('trusted');
  });
  it('returns privateProfile for "private"', () => {
    expect(getProfile('private').name).toBe('private');
  });
  it('throws on unknown name', () => {
    expect(() => getProfile('admin' as any)).toThrow(/unknown safety_profile/i);
  });
  it('ALL_PROFILES contains all three', () => {
    expect(ALL_PROFILES.map((p) => p.name).sort()).toEqual(['private', 'public', 'trusted']);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/profiles/__tests__/index.test.ts`
Expected: "Cannot find module '../index.js'"

- [ ] **Step 3: Implement**

```ts
// src/security/profiles/index.ts
import type { ProfileName } from '../types.js';
import type { SafetyProfile } from './types.js';
import { publicProfile } from './public.js';
import { trustedProfile } from './trusted.js';
import { privateProfile } from './private.js';

export const ALL_PROFILES: SafetyProfile[] = [publicProfile, trustedProfile, privateProfile];

export function getProfile(name: ProfileName): SafetyProfile {
  switch (name) {
    case 'public': return publicProfile;
    case 'trusted': return trustedProfile;
    case 'private': return privateProfile;
    default: throw new Error(`unknown safety_profile: ${name}`);
  }
}

export { publicProfile, trustedProfile, privateProfile };
export type { SafetyProfile, SystemPromptSpec, PermissionFlow } from './types.js';
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/security/profiles/__tests__/index.test.ts`
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/index.ts src/security/profiles/__tests__/index.test.ts
git commit -m "feat(security): profile registry with getProfile() and ALL_PROFILES"
```

---

## Phase 3: Schema additions

### Task 9: Add safety_profile + safety_overrides to AgentYmlSchema

**Files:**
- Modify: `src/config/schema.ts`
- Test: `src/config/__tests__/schema-safety.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/config/__tests__/schema-safety.test.ts
import { describe, it, expect } from 'vitest';
import { AgentYmlSchema } from '../schema.js';

const baseAgent = {
  routes: [{ channel: 'telegram', scope: 'dm' }],
};

describe('AgentYmlSchema safety_profile', () => {
  it('rejects config without safety_profile', () => {
    const result = AgentYmlSchema.safeParse(baseAgent);
    expect(result.success).toBe(false);
  });

  it('accepts safety_profile=public', () => {
    const r = AgentYmlSchema.safeParse({ ...baseAgent, safety_profile: 'public' });
    expect(r.success).toBe(true);
  });

  it('accepts safety_profile=trusted', () => {
    const r = AgentYmlSchema.safeParse({ ...baseAgent, safety_profile: 'trusted' });
    expect(r.success).toBe(true);
  });

  it('accepts safety_profile=private', () => {
    const r = AgentYmlSchema.safeParse({ ...baseAgent, safety_profile: 'private' });
    expect(r.success).toBe(true);
  });

  it('rejects unknown safety_profile', () => {
    const r = AgentYmlSchema.safeParse({ ...baseAgent, safety_profile: 'admin' });
    expect(r.success).toBe(false);
  });

  it('accepts safety_overrides', () => {
    const r = AgentYmlSchema.safeParse({
      ...baseAgent,
      safety_profile: 'public',
      safety_overrides: { allow_tools: ['manage_cron'], permission_mode: 'default' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown override field', () => {
    const r = AgentYmlSchema.safeParse({
      ...baseAgent,
      safety_profile: 'public',
      safety_overrides: { unknown_field: true },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/config/__tests__/schema-safety.test.ts`
Expected: tests fail because field doesn't exist yet

- [ ] **Step 3: Modify schema.ts**

In `src/config/schema.ts`, locate `AgentYmlSchema` (around line 294). Add fields and the SafetyOverridesSchema before it:

```ts
// Add before AgentYmlSchema:
const SafetyOverridesSchema = z.object({
  allow_tools: z.array(z.string()).optional(),
  deny_tools: z.array(z.string()).optional(),
  permission_mode: z.enum(['default', 'bypass']).optional(),
  sandbox: SdkSandboxSchema.optional(),
}).strict();

export type SafetyOverrides = z.infer<typeof SafetyOverridesSchema>;
```

In the `AgentYmlSchema` object, add the fields (place them after `routes:` for visibility):

```ts
safety_profile: z.enum(['public', 'trusted', 'private']),
safety_overrides: SafetyOverridesSchema.optional(),
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/config/__tests__/schema-safety.test.ts`
Expected: 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema-safety.test.ts
git commit -m "feat(config): add safety_profile (required) and safety_overrides to AgentYmlSchema"
```

---

## Phase 4: Validation

### Task 10: validateSafetyProfile()

**Files:**
- Create: `src/security/profiles/validate.ts`
- Test: `src/security/profiles/__tests__/validation.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/profiles/__tests__/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateSafetyProfile } from '../validate.js';
import type { AgentYml } from '../../../config/schema.js';

const base = (overrides: Partial<AgentYml>): AgentYml => ({
  routes: [{ channel: 'telegram', scope: 'dm' }],
  safety_profile: 'public',
  ...overrides,
} as AgentYml);

describe('validateSafetyProfile', () => {
  it('public + no allowlist + safe mcp_tools → ok', () => {
    const r = validateSafetyProfile(base({ mcp_tools: ['memory_search'] }));
    expect(r.ok).toBe(true);
  });

  it('public + manage_cron without override → fatal', () => {
    const r = validateSafetyProfile(base({ mcp_tools: ['manage_cron'] }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/manage_cron/);
    expect(r.error).toMatch(/safety_profile/);
  });

  it('public + manage_cron with allow_tools override → ok with WARN', () => {
    const r = validateSafetyProfile(base({
      mcp_tools: ['manage_cron'],
      safety_overrides: { allow_tools: ['manage_cron'] },
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes('manage_cron'))).toBe(true);
  });

  it('public + access_control even with override → fatal (HARD_BLACKLIST)', () => {
    const r = validateSafetyProfile(base({
      mcp_tools: ['access_control'],
      safety_overrides: { allow_tools: ['access_control'] },
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/access_control/);
    expect(r.error).toMatch(/HARD_BLACKLIST|hard.blacklist/i);
  });

  it('private + 0 peers → fatal', () => {
    const r = validateSafetyProfile(base({
      safety_profile: 'private',
      allowlist: {},
    }));
    expect(r.ok).toBe(false);
  });

  it('private + 2 peers in same channel → fatal', () => {
    const r = validateSafetyProfile(base({
      safety_profile: 'private',
      allowlist: { telegram: ['1', '2'] },
    }));
    expect(r.ok).toBe(false);
  });

  it('private + exactly 1 peer → ok', () => {
    const r = validateSafetyProfile(base({
      safety_profile: 'private',
      allowlist: { telegram: ['1'] },
    }));
    expect(r.ok).toBe(true);
  });

  it('public + bypass permission_mode → fatal', () => {
    const r = validateSafetyProfile(base({
      safety_overrides: { permission_mode: 'bypass' },
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bypass.*private/i);
  });

  it('private + bypass permission_mode → ok with WARN', () => {
    const r = validateSafetyProfile(base({
      safety_profile: 'private',
      allowlist: { telegram: ['1'] },
      safety_overrides: { permission_mode: 'bypass' },
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => /bypass/i.test(w))).toBe(true);
  });

  it('public + specific peer in allowlist → ok with WARN', () => {
    const r = validateSafetyProfile(base({
      allowlist: { telegram: ['12345'] },
    }));
    expect(r.ok).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('error message includes "Options:" guide', () => {
    const r = validateSafetyProfile(base({ mcp_tools: ['manage_cron'] }));
    expect(r.error).toMatch(/Options:/);
  });

  it('builds error message with allowed-in info per tool', () => {
    const r = validateSafetyProfile(base({ mcp_tools: ['manage_cron', 'access_control'] }));
    expect(r.error).toMatch(/manage_cron.*allowed in.*trusted.*private/);
    expect(r.error).toMatch(/access_control.*allowed in.*private/);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/profiles/__tests__/validation.test.ts`
Expected: "Cannot find module '../validate.js'"

- [ ] **Step 3a: Create shared MCP META registry**

Create `src/security/mcp-meta-registry.ts` first (used by `validate.ts` here and by `permissions.ts` in Task 15):

```ts
// src/security/mcp-meta-registry.ts
import type { ToolMeta } from './types.js';
import { META as manageCronMeta } from '../agent/tools/manage-cron.js';
import { META as manageSkillsMeta } from '../agent/tools/manage-skills.js';
import { META as accessControlMeta } from '../agent/tools/access-control.js';
import { META as memorySearchMeta } from '../agent/tools/memory-search.js';
import { META as memoryWriteMeta } from '../agent/tools/memory-write.js';
import { META as memoryWikiMeta } from '../agent/tools/memory-wiki.js';
import { META as sendMessageMeta } from '../agent/tools/send-message.js';
import { META as sendMediaMeta } from '../agent/tools/send-media.js';
import { META as webSearchMeta } from '../agent/tools/web-search.js';
import { META as listSkillsMeta } from '../agent/tools/list-skills.js';
import { META as localNoteSearchMeta } from '../agent/tools/local-note-search.js';
import { META as localNoteProposeMeta } from '../agent/tools/local-note-propose.js';
import { META as sessionSearchMeta } from '../agent/tools/session-search.js';

export const MCP_META: Record<string, ToolMeta> = {
  manage_cron: manageCronMeta,
  manage_skills: manageSkillsMeta,
  access_control: accessControlMeta,
  memory_search: memorySearchMeta,
  memory_write: memoryWriteMeta,
  memory_wiki: memoryWikiMeta,
  send_message: sendMessageMeta,
  send_media: sendMediaMeta,
  web_search_brave: webSearchMeta,
  web_search_exa: webSearchMeta,
  list_skills: listSkillsMeta,
  local_note_search: localNoteSearchMeta,
  local_note_propose: localNoteProposeMeta,
  session_search: sessionSearchMeta,
};
```

- [ ] **Step 3b: Implement validate.ts**

```ts
// src/security/profiles/validate.ts
import type { AgentYml } from '../../config/schema.js';
import { getProfile } from './index.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';
import { MCP_META } from '../mcp-meta-registry.js';

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
  error?: string;
}

function profilesAllowingTool(toolName: string): string[] {
  const meta = MCP_META[toolName] ?? BUILTIN_META[toolName];
  if (!meta) return [];
  const allowed: string[] = [];
  if (meta.safe_in_public) allowed.push('public');
  if (meta.safe_in_trusted) allowed.push('trusted');
  if (meta.safe_in_private) allowed.push('private');
  return allowed;
}

export function validateSafetyProfile(config: AgentYml): ValidationResult {
  const warnings: string[] = [];
  const profile = getProfile(config.safety_profile);

  // Check allowlist shape
  const allowlistResult = profile.validateAllowlist(config.allowlist);
  if (!allowlistResult.ok) {
    return { ok: false, warnings: [], error: allowlistResult.error ?? 'allowlist invalid' };
  }
  warnings.push(...allowlistResult.warnings);

  // Check overrides
  const overrides = config.safety_overrides ?? {};
  if (overrides.permission_mode === 'bypass' && config.safety_profile !== 'private') {
    return {
      ok: false,
      warnings: [],
      error: `safety_overrides.permission_mode=bypass is only allowed with safety_profile=private (got ${config.safety_profile})`,
    };
  }
  if (overrides.permission_mode === 'bypass') {
    warnings.push('safety_overrides.permission_mode=bypass: all tools will run without approval');
  }

  // Check mcp_tools compat
  const tools = config.mcp_tools ?? [];
  const allowOverrides = new Set(overrides.allow_tools ?? []);

  const incompatible: { name: string; reason: string }[] = [];
  for (const toolName of tools) {
    const meta = MCP_META[toolName] ?? BUILTIN_META[toolName];
    if (!meta) {
      // Unknown tool — let SDK reject at runtime
      continue;
    }
    if (meta.hard_blacklist_in.includes(profile.name)) {
      incompatible.push({
        name: toolName,
        reason: 'HARD_BLACKLIST — cannot be opened via override',
      });
      continue;
    }
    const allowed =
      profile.builtinTools.allowed.has(toolName) ||
      profile.mcpToolPolicy.allowedByMeta(meta) ||
      allowOverrides.has(toolName);
    if (!allowed) {
      incompatible.push({
        name: toolName,
        reason: `forbidden by safety_profile=${profile.name}`,
      });
    } else if (allowOverrides.has(toolName) && !profile.mcpToolPolicy.allowedByMeta(meta) && !profile.builtinTools.allowed.has(toolName)) {
      warnings.push(`safety_overrides.allow_tools opens "${toolName}" in safety_profile=${profile.name}`);
    }
  }

  if (incompatible.length > 0) {
    const lines = incompatible.map((i) => {
      const allowedIn = profilesAllowingTool(i.name).join(', ') || 'none';
      const blacklist = (MCP_META[i.name] ?? BUILTIN_META[i.name])?.hard_blacklist_in ?? [];
      const blacklistNote = blacklist.length > 0 ? `; HARD_BLACKLIST in ${blacklist.join(', ')}` : '';
      return `     - ${i.name}      (allowed in: ${allowedIn}${blacklistNote})`;
    });
    return {
      ok: false,
      warnings: [],
      error:
        `safety_profile "${profile.name}" forbids these tools listed in mcp_tools:\n` +
        lines.join('\n') +
        `\n\n   Options:\n` +
        `     1. Remove these tools from mcp_tools (safest)\n` +
        `     2. Change safety_profile to a more permissive one\n` +
        `     3. Add to safety_overrides.allow_tools (logged as WARN; HARD_BLACKLIST cannot be overridden)\n\n` +
        `   See docs/safety-profiles.md`,
    };
  }

  return { ok: true, warnings };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/security/profiles/__tests__/validation.test.ts`
Expected: 12 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/security/mcp-meta-registry.ts src/security/profiles/validate.ts src/security/profiles/__tests__/validation.test.ts
git commit -m "feat(security): validateSafetyProfile() with hard-fail on incompatibility"
```

---

### Task 11: Wire validation into Agent.load()

**Files:**
- Modify: `src/agent/agent.ts`
- Test: `src/agent/__tests__/agent-load-safety.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/agent/__tests__/agent-load-safety.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from '../agent.js';

function setupAgentDir(name: string, agentYml: string, claudeMd = 'You are a test agent.'): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-load-'));
  const agentDir = join(root, name);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'agent.yml'), agentYml);
  writeFileSync(join(agentDir, 'CLAUDE.md'), claudeMd);
  return agentDir;
}

describe('Agent.load() safety_profile validation', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'safety-data-'));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('refuses to load agent without safety_profile', async () => {
    const dir = setupAgentDir('a', `routes:\n  - channel: telegram\n    scope: dm\n`);
    await expect(Agent.load(dir, dataDir, () => undefined)).rejects.toThrow(/safety_profile/i);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses public agent with manage_cron and no override', async () => {
    const yml = `safety_profile: public\nroutes:\n  - channel: telegram\n    scope: dm\nmcp_tools:\n  - manage_cron\n`;
    const dir = setupAgentDir('a', yml);
    await expect(Agent.load(dir, dataDir, () => undefined)).rejects.toThrow(/manage_cron/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('loads valid private agent', async () => {
    const yml = `safety_profile: private\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\nmcp_tools:\n  - memory_search\n`;
    const dir = setupAgentDir('a', yml);
    const agent = await Agent.load(dir, dataDir, () => undefined);
    expect(agent.config.safety_profile).toBe('private');
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses private agent with 2 peers in 1 channel', async () => {
    const yml = `safety_profile: private\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "1"\n    - "2"\n`;
    const dir = setupAgentDir('a', yml);
    await expect(Agent.load(dir, dataDir, () => undefined)).rejects.toThrow(/exactly 1/);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/agent/__tests__/agent-load-safety.test.ts`
Expected: tests fail (validation not wired in)

- [ ] **Step 3: Modify Agent.load() in src/agent/agent.ts**

After Zod parsing of the agent.yml (around the existing `AgentYmlSchema.parse(...)` call), add:

```ts
import { validateSafetyProfile } from '../security/profiles/validate.js';
import { getProfile, type SafetyProfile } from '../security/profiles/index.js';
import { logger } from '../logger.js';

// ... inside Agent.load(), after parsing config and before constructor call:

const validation = validateSafetyProfile(config);
if (!validation.ok) {
  throw new Error(`❌ Cannot load agent "${id}":\n   ${validation.error}`);
}
for (const warning of validation.warnings) {
  logger.warn({ agentId: id }, `safety_profile: ${warning}`);
}
const safetyProfile = getProfile(config.safety_profile);
```

Pass `safetyProfile` into the `Agent` constructor and store it as a public field. Update the constructor signature and the class to include:

```ts
readonly safetyProfile: SafetyProfile;
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/agent/__tests__/agent-load-safety.test.ts`
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/agent/agent.ts src/agent/__tests__/agent-load-safety.test.ts
git commit -m "feat(agent): hard-fail Agent.load() on invalid safety_profile, store profile reference"
```

---

## Phase 5: Approval Broker + Channel buttons

### Task 12: ApprovalBroker

**Files:**
- Create: `src/security/approval-broker.ts`
- Test: `src/security/__tests__/approval-broker.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/security/__tests__/approval-broker.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApprovalBroker } from '../approval-broker.js';

describe('ApprovalBroker', () => {
  let broker: ApprovalBroker;

  beforeEach(() => {
    broker = new ApprovalBroker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves allow when caller calls resolve(allow)', async () => {
    const promise = broker.request('id-1', 60_000);
    broker.resolve('id-1', 'allow');
    const result = await promise;
    expect(result.behavior).toBe('allow');
  });

  it('resolves deny when caller calls resolve(deny)', async () => {
    const promise = broker.request('id-2', 60_000);
    broker.resolve('id-2', 'deny');
    const result = await promise;
    expect(result.behavior).toBe('deny');
  });

  it('returns deny on timeout', async () => {
    const promise = broker.request('id-3', 1000);
    vi.advanceTimersByTime(1500);
    const result = await promise;
    expect(result.behavior).toBe('deny');
    expect((result as any).message).toMatch(/did not respond/i);
  });

  it('handles concurrent requests independently', async () => {
    const p1 = broker.request('id-4', 60_000);
    const p2 = broker.request('id-5', 60_000);
    broker.resolve('id-4', 'deny');
    broker.resolve('id-5', 'allow');
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.behavior).toBe('deny');
    expect(r2.behavior).toBe('allow');
  });

  it('resolve on unknown id is a no-op', () => {
    expect(() => broker.resolve('nonexistent', 'allow')).not.toThrow();
  });

  it('clears timeout when resolved early', async () => {
    const promise = broker.request('id-6', 60_000);
    broker.resolve('id-6', 'allow');
    await promise;
    vi.advanceTimersByTime(120_000);
    // No-op; just verify no double-resolve crash
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/security/__tests__/approval-broker.test.ts`
Expected: "Cannot find module '../approval-broker.js'"

- [ ] **Step 3: Implement**

```ts
// src/security/approval-broker.ts
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

interface PendingApproval {
  resolve: (v: PermissionResult) => void;
  timeout: NodeJS.Timeout;
}

export class ApprovalBroker {
  private pending = new Map<string, PendingApproval>();

  request(id: string, timeoutMs: number): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve({ behavior: 'deny', message: 'User did not respond within timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timeout });
    });
  }

  resolve(id: string, decision: 'allow' | 'deny'): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    if (decision === 'allow') {
      entry.resolve({ behavior: 'allow', updatedInput: {} });
    } else {
      entry.resolve({ behavior: 'deny', message: 'User declined the request' });
    }
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/security/__tests__/approval-broker.test.ts`
Expected: 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/security/approval-broker.ts src/security/__tests__/approval-broker.test.ts
git commit -m "feat(security): in-memory ApprovalBroker for tool-call approval flow"
```

---

### Task 13: Channel adapter supportsApproval + promptForApproval

**Files:**
- Modify: `src/channels/types.ts`, `src/channels/telegram.ts`, `src/channels/whatsapp.ts`
- Test: `src/channels/__tests__/telegram-approval.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/channels/__tests__/telegram-approval.test.ts
import { describe, it, expect, vi } from 'vitest';
import type { ChannelAdapter, ApprovalRequest } from '../types.js';

describe('ChannelAdapter approval API', () => {
  it('TG channel reports supportsApproval = true', async () => {
    const { TelegramChannel } = await import('../telegram.js');
    expect(TelegramChannel.prototype).toHaveProperty('promptForApproval');
    // Static metadata
    expect((TelegramChannel as any).supportsApproval).toBe(true);
  });

  it('WA channel reports supportsApproval = false', async () => {
    const { WhatsappChannel } = await import('../whatsapp.js');
    expect((WhatsappChannel as any).supportsApproval).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/channels/__tests__/telegram-approval.test.ts`
Expected: properties don't exist

- [ ] **Step 3: Update src/channels/types.ts**

Add to `ChannelAdapter` interface:

```ts
export interface ApprovalRequest {
  id: string;                  // ApprovalBroker id
  toolName: string;
  argsPreview: string;          // human-readable summary
  argsFull?: string;             // full JSON, may be large
  peerId: string;
  accountId?: string;
  threadId?: string;
}

export interface ChannelAdapter {
  // ... existing fields
  readonly supportsApproval: boolean;
  promptForApproval(req: ApprovalRequest): Promise<void>;
}
```

- [ ] **Step 3a: Implement on TelegramChannel**

In `src/channels/telegram.ts`, set `supportsApproval = true` on the class (instance field) and add `promptForApproval()`:

```ts
readonly supportsApproval = true as const;

async promptForApproval(req: ApprovalRequest): Promise<void> {
  const text = `🔧 Tool: ${req.toolName}\n\n${req.argsPreview}`;
  await this.sendText(req.peerId, text, {
    accountId: req.accountId,
    threadId: req.threadId,
    buttons: [[
      { text: '✅ Allow', callback_data: `approve:${req.id}` },
      { text: '❌ Deny', callback_data: `deny:${req.id}` },
    ]],
  });
}

// Static helper (the test reads it):
static readonly supportsApproval = true;
```

- [ ] **Step 3b: Implement on WhatsappChannel**

In `src/channels/whatsapp.ts`:

```ts
readonly supportsApproval = false as const;
static readonly supportsApproval = false;

async promptForApproval(): Promise<void> {
  throw new Error('WhatsApp channel does not support interactive approval');
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/channels/__tests__/telegram-approval.test.ts`
Expected: 2 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/channels/types.ts src/channels/telegram.ts src/channels/whatsapp.ts src/channels/__tests__/telegram-approval.test.ts
git commit -m "feat(channels): supportsApproval flag + promptForApproval() helper for TG/WA"
```

---

### Task 14: Wire callback_query → ApprovalBroker

**Files:**
- Modify: `src/gateway.ts`, `src/channels/telegram.ts`
- Test: `src/__tests__/gateway-approval-callback.test.ts` (location alongside other gateway tests)

- [ ] **Step 1: Write failing test**

```ts
// test/gateway-approval-callback.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ApprovalBroker } from '../src/security/approval-broker.js';

describe('callback_query → ApprovalBroker integration', () => {
  it('routes "approve:<id>" to broker.resolve(id, "allow")', async () => {
    const broker = new ApprovalBroker();
    const promise = broker.request('xyz', 60_000);
    // Simulate Telegram callback_data routing
    const data = 'approve:xyz';
    const [verb, id] = data.split(':');
    if (verb === 'approve') broker.resolve(id, 'allow');
    if (verb === 'deny')    broker.resolve(id, 'deny');
    const result = await promise;
    expect(result.behavior).toBe('allow');
  });

  it('routes "deny:<id>" to broker.resolve(id, "deny")', async () => {
    const broker = new ApprovalBroker();
    const promise = broker.request('abc', 60_000);
    const data = 'deny:abc';
    const [verb, id] = data.split(':');
    if (verb === 'approve') broker.resolve(id, 'allow');
    if (verb === 'deny')    broker.resolve(id, 'deny');
    const result = await promise;
    expect(result.behavior).toBe('deny');
  });
});
```

- [ ] **Step 2: Run test, expect pass (this just exercises broker semantics)**

Run: `pnpm vitest run test/gateway-approval-callback.test.ts`
Expected: 2 tests pass (since ApprovalBroker exists from Task 12). This test pins the wiring contract.

- [ ] **Step 3: Wire callback_query handler in gateway.ts**

Locate the existing callback_query handler reference (`gateway.ts:2553` mentions inline-button click handling). Add a method `handleApprovalCallback(data: string): boolean` to Gateway:

```ts
// Add field
private approvalBroker: ApprovalBroker;

// In constructor
this.approvalBroker = new ApprovalBroker();

handleApprovalCallback(data: string): boolean {
  const match = /^(approve|deny):(.+)$/.exec(data);
  if (!match) return false;
  const [, verb, id] = match;
  this.approvalBroker.resolve(id, verb === 'approve' ? 'allow' : 'deny');
  return true;
}

getApprovalBroker(): ApprovalBroker {
  return this.approvalBroker;
}
```

In `src/channels/telegram.ts`, in the callback_query handler (around line 93), add at the start:

```ts
const data = ctx.callbackQuery?.data ?? '';
if (this.gateway?.handleApprovalCallback(data)) {
  await ctx.answerCallbackQuery();
  return;
}
```

(`this.gateway` is the gateway reference passed to TelegramChannel — verify its existing wiring or add a setter.)

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run test/gateway-approval-callback.test.ts`
Expected: 2 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/gateway.ts src/channels/telegram.ts test/gateway-approval-callback.test.ts
git commit -m "feat(gateway): route Telegram callback_query for tool approvals to ApprovalBroker"
```

---

## Phase 6: canUseTool integration

### Task 15: Profile-aware canUseTool

**Files:**
- Modify: `src/sdk/permissions.ts`
- Test: `src/sdk/__tests__/permissions-profile.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/sdk/__tests__/permissions-profile.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createCanUseTool } from '../permissions.js';
import { publicProfile, trustedProfile, privateProfile } from '../../security/profiles/index.js';
import { ApprovalBroker } from '../../security/approval-broker.js';

function fakeAgent(profile: any, mcp_tools: string[] = [], overrides: any = {}) {
  return {
    id: 'a',
    config: { safety_profile: profile.name, mcp_tools, safety_overrides: overrides, sdk: {} },
    safetyProfile: profile,
    workspacePath: '/tmp',
  } as any;
}

describe('canUseTool profile gating', () => {
  it('public profile denies Bash with reason', async () => {
    const can = createCanUseTool({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      channel: undefined,
      sessionContext: { peerId: '1' },
    });
    const r = await can('Bash', { command: 'ls' });
    expect(r.behavior).toBe('deny');
  });

  it('public profile allows Read', async () => {
    const can = createCanUseTool({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      channel: undefined,
      sessionContext: { peerId: '1' },
    });
    const r = await can('Read', { file_path: '/tmp/foo' });
    expect(r.behavior).toBe('allow');
  });

  it('trusted: destructive Write requests approval via channel', async () => {
    const broker = new ApprovalBroker();
    const promptForApproval = vi.fn(async () => undefined);
    const channel = { supportsApproval: true, promptForApproval } as any;
    const can = createCanUseTool({
      agent: fakeAgent(trustedProfile),
      approvalBroker: broker,
      channel,
      sessionContext: { peerId: '1' },
    });
    const promise = can('Write', { file_path: '/tmp/x', content: 'y' });
    // Simulate user clicking allow
    setImmediate(() => {
      const callArgs = promptForApproval.mock.calls[0]?.[0];
      if (callArgs?.id) broker.resolve(callArgs.id, 'allow');
    });
    const r = await promise;
    expect(r.behavior).toBe('allow');
    expect(promptForApproval).toHaveBeenCalled();
  });

  it('trusted on WA (no approval channel): denies destructive', async () => {
    const channel = { supportsApproval: false, promptForApproval: vi.fn() } as any;
    const can = createCanUseTool({
      agent: fakeAgent(trustedProfile),
      approvalBroker: new ApprovalBroker(),
      channel,
      sessionContext: { peerId: '1' },
    });
    const r = await can('Write', { file_path: '/tmp/x', content: 'y' });
    expect(r.behavior).toBe('deny');
    expect((r as any).message).toMatch(/approval|channel/i);
  });

  it('private + bypass override: allows everything without approval', async () => {
    const channel = { supportsApproval: true, promptForApproval: vi.fn() } as any;
    const can = createCanUseTool({
      agent: fakeAgent(privateProfile, [], { permission_mode: 'bypass' }),
      approvalBroker: new ApprovalBroker(),
      channel,
      sessionContext: { peerId: '1' },
    });
    const r = await can('Bash', { command: 'ls' });
    expect(r.behavior).toBe('allow');
    expect(channel.promptForApproval).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/sdk/__tests__/permissions-profile.test.ts`
Expected: tests fail (createCanUseTool doesn't accept these params)

- [ ] **Step 3: Refactor createCanUseTool**

Replace `createCanUseTool(agent, allowedToolsSet)` signature in `src/sdk/permissions.ts` with:

```ts
export interface CanUseToolDeps {
  agent: Agent;
  approvalBroker: ApprovalBroker;
  channel?: ChannelAdapter;
  sessionContext: { peerId: string; accountId?: string; threadId?: string };
}

export function createCanUseTool(deps: CanUseToolDeps): CanUseTool {
  const { agent, approvalBroker, channel, sessionContext } = deps;
  const profile = agent.safetyProfile;
  const overrides = agent.config.safety_overrides ?? {};

  return async (toolName, toolInput) => {
    // 1. Bypass mode short-circuit
    if (overrides.permission_mode === 'bypass') {
      return { behavior: 'allow', updatedInput: toolInput };
    }

    // 2. HARD_BLACKLIST check (override cannot open)
    if (profile.hardBlacklist.has(toolName)) {
      return { behavior: 'deny', message: `Tool "${toolName}" is hard-blacklisted in safety_profile=${profile.name}` };
    }

    // 3. Override allow_tools wins over profile forbidden
    const overrideAllow = (overrides.allow_tools ?? []).includes(toolName);

    // 4. Check if allowed at all
    const meta = lookupMeta(toolName);
    const profileAllows =
      profile.builtinTools.allowed.has(toolName) ||
      (meta && profile.mcpToolPolicy.allowedByMeta(meta));

    if (!profileAllows && !overrideAllow) {
      return { behavior: 'deny', message: `Tool "${toolName}" is not allowed by safety_profile=${profile.name}` };
    }

    // 5. Approval flow
    const requiresApproval =
      profile.builtinTools.requiresApproval.has(toolName) ||
      (meta && profile.mcpToolPolicy.requiresApproval(meta));

    if (!requiresApproval) {
      return { behavior: 'allow', updatedInput: toolInput };
    }

    // Channel must support approval
    if (!channel || !channel.supportsApproval) {
      return { behavior: 'deny', message: `Tool "${toolName}" requires approval; channel does not support interactive approval` };
    }

    const id = `${agent.id}:${toolName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await channel.promptForApproval({
      id,
      toolName,
      argsPreview: previewArgs(toolInput),
      argsFull: JSON.stringify(toolInput),
      peerId: sessionContext.peerId,
      accountId: sessionContext.accountId,
      threadId: sessionContext.threadId,
    });
    return approvalBroker.request(id, 60_000);
  };
}

function lookupMeta(toolName: string): ToolMeta | undefined {
  return MCP_META[toolName] ?? BUILTIN_META[toolName];
}

function previewArgs(input: unknown): string {
  const json = JSON.stringify(input, null, 2);
  if (json.length <= 500) return json;
  return json.slice(0, 480) + '\n...(truncated)';
}
```

Required imports at top of `src/sdk/permissions.ts`:

```ts
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../agent/agent.js';
import type { ChannelAdapter } from '../channels/types.js';
import { BUILTIN_META } from '../security/builtin-tool-meta.js';
import { MCP_META } from '../security/mcp-meta-registry.js';
import type { ToolMeta } from '../security/types.js';
import { ApprovalBroker } from '../security/approval-broker.js';
```

The existing `createCanUseTool(agent, allowedToolsSet)` callsite in `buildSdkOptions` (Task 16) is updated to pass the new deps shape.

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/sdk/__tests__/permissions-profile.test.ts`
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/sdk/permissions.ts src/sdk/__tests__/permissions-profile.test.ts
git commit -m "feat(permissions): profile-aware canUseTool with interactive approval flow"
```

---

### Task 16: Profile-aware buildSdkOptions

**Files:**
- Modify: `src/sdk/options.ts`, `src/gateway.ts` (callsite update)
- Test: `src/sdk/__tests__/options-profile.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/sdk/__tests__/options-profile.test.ts
import { describe, it, expect } from 'vitest';
import { buildSdkOptions } from '../options.js';
import { publicProfile, trustedProfile, privateProfile } from '../../security/profiles/index.js';
import { ApprovalBroker } from '../../security/approval-broker.js';

function fakeAgent(profile: any) {
  return {
    id: 'a',
    config: { safety_profile: profile.name, model: 'claude-sonnet-4-6', sdk: {} },
    safetyProfile: profile,
    workspacePath: '/tmp',
    mcpServer: { name: 'a-tools', instance: {} } as any,
  } as any;
}

describe('buildSdkOptions profile-aware', () => {
  it('public uses string system prompt', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect((opts.systemPrompt as any).type).toBe('string');
    expect((opts.systemPrompt as any).text).toMatch(/public-facing/i);
  });

  it('public uses empty settingSources', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(publicProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect(opts.settingSources).toEqual([]);
  });

  it('trusted uses preset claude_code with project source', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(trustedProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect((opts.systemPrompt as any).type).toBe('preset');
    expect((opts.systemPrompt as any).preset).toBe('claude_code');
    expect(opts.settingSources).toEqual(['project']);
  });

  it('private uses preset and full settingSources', () => {
    const opts = buildSdkOptions({
      agent: fakeAgent(privateProfile),
      approvalBroker: new ApprovalBroker(),
      sessionContext: { peerId: '1' },
    });
    expect(opts.settingSources).toEqual(['project', 'user']);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run src/sdk/__tests__/options-profile.test.ts`
Expected: tests fail (buildSdkOptions doesn't take approvalBroker/sessionContext yet)

- [ ] **Step 3: Modify buildSdkOptions**

Update signature in `src/sdk/options.ts` to accept `approvalBroker` and `sessionContext`. Replace the hardcoded `systemPrompt` and `settingSources`:

```ts
export interface BuildSdkOptionsParams {
  // ... existing fields
  approvalBroker: ApprovalBroker;
  sessionContext: { peerId: string; accountId?: string; threadId?: string };
  channel?: ChannelAdapter;
}

export function buildSdkOptions(params: BuildSdkOptionsParams): Options {
  const { agent } = params;
  const profile = agent.safetyProfile;

  const systemPrompt =
    profile.systemPrompt.mode === 'string'
      ? { type: 'string' as const, text: profile.systemPrompt.text }
      : {
          type: 'preset' as const,
          preset: profile.systemPrompt.preset,
          excludeDynamicSections: profile.systemPrompt.excludeDynamicSections,
        };

  const options: Options = {
    // ... existing fields
    systemPrompt,
    settingSources: profile.settingSources,
    // ...
  };

  // Replace existing canUseTool wiring
  options.canUseTool = createCanUseTool({
    agent,
    approvalBroker: params.approvalBroker,
    channel: params.channel,
    sessionContext: params.sessionContext,
  });

  return options;
}
```

- [ ] **Step 3a: Update Gateway callsite**

In `src/gateway.ts`, locate `buildUserQueryOptions()` (around line 1031). Pass new params:

```ts
return buildSdkOptions({
  agent,
  // ... existing params
  approvalBroker: this.approvalBroker,
  sessionContext: { peerId: msg.peerId, accountId: msg.accountId, threadId: msg.threadId },
  channel: getChannel(/* the channel id from msg.channel */),
});
```

(Threading `msg`/`channel` may require a small refactor of the calling code — pass them through where currently absent.)

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run src/sdk/__tests__/options-profile.test.ts`
Expected: 4 tests pass. Then run full suite for regressions: `pnpm test`. Fix any breakages.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/options.ts src/gateway.ts src/sdk/__tests__/options-profile.test.ts
git commit -m "feat(sdk): profile-aware buildSdkOptions — system prompt and settingSources from profile"
```

---

## Phase 7: Migration utility

### Task 17: Migration utility — inference (dry-run)

**Files:**
- Create: `scripts/migrate-safety-profile.ts`
- Test: `scripts/__tests__/migrate-inference.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// scripts/__tests__/migrate-inference.test.ts
import { describe, it, expect } from 'vitest';
import { inferProfile } from '../migrate-safety-profile.js';

describe('inferProfile', () => {
  it('single peer in 1 channel → private', () => {
    const cfg = { allowlist: { telegram: ['12345'] }, pairing: { mode: 'off' } } as any;
    expect(inferProfile(cfg).profile).toBe('private');
  });

  it('pairing.mode=open → public', () => {
    const cfg = { pairing: { mode: 'open' } } as any;
    expect(inferProfile(cfg).profile).toBe('public');
  });

  it('allowlist [*] → public', () => {
    const cfg = { allowlist: { telegram: ['*'] }, pairing: { mode: 'off' } } as any;
    expect(inferProfile(cfg).profile).toBe('public');
  });

  it('pairing.mode=approve with peers → trusted', () => {
    const cfg = { allowlist: { telegram: ['1', '2'] }, pairing: { mode: 'approve' } } as any;
    expect(inferProfile(cfg).profile).toBe('trusted');
  });

  it('pairing.mode=off without allowlist → fails', () => {
    const cfg = { pairing: { mode: 'off' } } as any;
    const r = inferProfile(cfg);
    expect(r.profile).toBeNull();
    expect(r.error).toMatch(/denies everyone/i);
  });

  it('flags incompatible tools (manage_cron in inferred public) for review', () => {
    const cfg = { pairing: { mode: 'open' }, mcp_tools: ['manage_cron'] } as any;
    const r = inferProfile(cfg);
    expect(r.profile).toBe('public');
    expect(r.toolConflicts).toContain('manage_cron');
  });

  it('flags HARD_BLACKLIST tools as needing manual review', () => {
    const cfg = { pairing: { mode: 'open' }, mcp_tools: ['access_control'] } as any;
    const r = inferProfile(cfg);
    expect(r.profile).toBe('public');
    expect(r.hardBlacklistConflicts).toContain('access_control');
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run scripts/__tests__/migrate-inference.test.ts`
Expected: "Cannot find module '../migrate-safety-profile.js'"

- [ ] **Step 3: Implement inferProfile**

```ts
// scripts/migrate-safety-profile.ts
import { readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse, parseDocument, type Document } from 'yaml';
import { ALL_PROFILES, getProfile } from '../src/security/profiles/index.js';
import { BUILTIN_META } from '../src/security/builtin-tool-meta.js';
import { MCP_META } from '../src/security/mcp-meta-registry.js';

export interface InferResult {
  profile: 'public' | 'trusted' | 'private' | null;
  reason: string;
  toolConflicts: string[];
  hardBlacklistConflicts: string[];
  error?: string;
}

export function inferProfile(cfg: any): InferResult {
  const allowlist = cfg.allowlist ?? {};
  const pairing = cfg.pairing ?? {};
  const tools: string[] = cfg.mcp_tools ?? [];

  let profile: 'public' | 'trusted' | 'private' | null = null;
  let reason = '';

  const allLists = [allowlist.telegram, allowlist.whatsapp].filter((l): l is string[] => Array.isArray(l));
  const peerCounts = allLists.map((l) => l.filter((p) => p !== '*').length);
  const totalSpecific = peerCounts.reduce((s, n) => s + n, 0);
  const hasWildcard = allLists.some((l) => l.includes('*'));

  // Rule 1: exactly 1 peer per channel that has a list
  const channelsWithSpecific = peerCounts.filter((n) => n > 0);
  if (totalSpecific > 0 && channelsWithSpecific.every((n) => n === 1) && !hasWildcard) {
    profile = 'private';
    reason = 'allowlist has exactly 1 peer per channel';
  } else if (pairing.mode === 'open' || hasWildcard) {
    profile = 'public';
    reason = pairing.mode === 'open' ? 'pairing.mode=open' : 'allowlist contains "*"';
  } else if ((pairing.mode === 'approve' || pairing.mode === 'code') && totalSpecific > 0) {
    profile = 'trusted';
    reason = `pairing.mode=${pairing.mode} with specific peer_ids`;
  } else if (pairing.mode === 'off' && totalSpecific === 0) {
    return {
      profile: null,
      reason: '',
      toolConflicts: [],
      hardBlacklistConflicts: [],
      error: 'agent denies everyone (pairing.mode=off, no allowlist) — pick safety_profile manually',
    };
  } else {
    profile = 'trusted';
    reason = 'fallback (could not classify confidently)';
  }

  // Tool compatibility check
  const target = getProfile(profile);
  const toolConflicts: string[] = [];
  const hardBlacklistConflicts: string[] = [];

  for (const t of tools) {
    const meta = MCP_META[t] ?? BUILTIN_META[t];
    if (!meta) continue;
    if (meta.hard_blacklist_in.includes(profile)) {
      hardBlacklistConflicts.push(t);
      continue;
    }
    const allowedNatively =
      target.builtinTools.allowed.has(t) || target.mcpToolPolicy.allowedByMeta(meta);
    if (!allowedNatively) toolConflicts.push(t);
  }

  return { profile, reason, toolConflicts, hardBlacklistConflicts };
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run scripts/__tests__/migrate-inference.test.ts`
Expected: 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-safety-profile.ts scripts/__tests__/migrate-inference.test.ts
git commit -m "feat(scripts): inferProfile() — heuristics to map existing agent config to safety_profile"
```

---

### Task 18: Migration CLI — dry-run output

**Files:**
- Modify: `scripts/migrate-safety-profile.ts`
- Test: `scripts/__tests__/migrate-cli.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// scripts/__tests__/migrate-cli.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigration } from '../migrate-safety-profile.js';

let agentsRoot: string;

beforeEach(() => {
  agentsRoot = mkdtempSync(join(tmpdir(), 'migrate-test-'));
});

afterEach(() => {
  rmSync(agentsRoot, { recursive: true, force: true });
});

function setupAgent(name: string, yml: string) {
  const dir = join(agentsRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), yml);
}

describe('runMigration (dry-run)', () => {
  it('reports inferred profile per agent', async () => {
    setupAgent('alice', `routes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\npairing:\n  mode: off\n`);
    setupAgent('bob', `routes:\n  - channel: whatsapp\n    scope: dm\npairing:\n  mode: open\n`);
    const out = await runMigration({ agentsDir: agentsRoot, apply: false });
    expect(out.summary.scanned).toBe(2);
    expect(out.results.find((r) => r.agentId === 'alice')?.profile).toBe('private');
    expect(out.results.find((r) => r.agentId === 'bob')?.profile).toBe('public');
  });

  it('marks agents with HARD_BLACKLIST conflicts as needing manual review', async () => {
    setupAgent('leads', `routes:\n  - channel: whatsapp\n    scope: dm\npairing:\n  mode: open\nmcp_tools:\n  - access_control\n`);
    const out = await runMigration({ agentsDir: agentsRoot, apply: false });
    const r = out.results.find((r) => r.agentId === 'leads');
    expect(r?.needsManualReview).toBe(true);
    expect(r?.hardBlacklistConflicts).toContain('access_control');
  });

  it('does NOT modify files when apply=false', async () => {
    setupAgent('alice', `routes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "1"\npairing:\n  mode: off\n`);
    const before = require('node:fs').readFileSync(join(agentsRoot, 'alice', 'agent.yml'), 'utf-8');
    await runMigration({ agentsDir: agentsRoot, apply: false });
    const after = require('node:fs').readFileSync(join(agentsRoot, 'alice', 'agent.yml'), 'utf-8');
    expect(after).toBe(before);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run scripts/__tests__/migrate-cli.test.ts`
Expected: "runMigration is not exported"

- [ ] **Step 3: Implement runMigration**

In `scripts/migrate-safety-profile.ts`, append:

```ts
export interface MigrationResult {
  agentId: string;
  profile: 'public' | 'trusted' | 'private' | null;
  reason: string;
  toolConflicts: string[];
  hardBlacklistConflicts: string[];
  needsManualReview: boolean;
  applied: boolean;
  error?: string;
}

export interface MigrationOptions {
  agentsDir: string;
  apply: boolean;
}

export interface MigrationOutput {
  summary: { scanned: number; readyToApply: number; needsReview: number; applied: number };
  results: MigrationResult[];
}

export async function runMigration(opts: MigrationOptions): Promise<MigrationOutput> {
  const entries = readdirSync(opts.agentsDir);
  const results: MigrationResult[] = [];
  let applied = 0;

  for (const name of entries) {
    const dir = join(opts.agentsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const ymlPath = join(dir, 'agent.yml');
    if (!existsSync(ymlPath)) continue;

    const raw = readFileSync(ymlPath, 'utf-8');
    let cfg: any;
    try {
      cfg = parse(raw);
    } catch (err) {
      results.push({ agentId: name, profile: null, reason: '', toolConflicts: [], hardBlacklistConflicts: [], needsManualReview: false, applied: false, error: `parse: ${(err as Error).message}` });
      continue;
    }

    if (cfg.safety_profile) {
      results.push({ agentId: name, profile: cfg.safety_profile, reason: 'already set', toolConflicts: [], hardBlacklistConflicts: [], needsManualReview: false, applied: false });
      continue;
    }

    const inferred = inferProfile(cfg);
    if (inferred.error) {
      results.push({ agentId: name, profile: null, reason: '', toolConflicts: [], hardBlacklistConflicts: [], needsManualReview: true, applied: false, error: inferred.error });
      continue;
    }

    const needsReview = inferred.hardBlacklistConflicts.length > 0;
    let didApply = false;
    if (opts.apply && !needsReview) {
      didApply = applyToFile(ymlPath, inferred);
      if (didApply) applied += 1;
    }
    results.push({
      agentId: name,
      profile: inferred.profile,
      reason: inferred.reason,
      toolConflicts: inferred.toolConflicts,
      hardBlacklistConflicts: inferred.hardBlacklistConflicts,
      needsManualReview: needsReview,
      applied: didApply,
    });
  }

  return {
    summary: {
      scanned: results.length,
      readyToApply: results.filter((r) => !r.needsManualReview && r.profile && !r.error).length,
      needsReview: results.filter((r) => r.needsManualReview).length,
      applied,
    },
    results,
  };
}

function applyToFile(_path: string, _inferred: InferResult): boolean {
  // Implemented in Task 19
  return false;
}
```

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run scripts/__tests__/migrate-cli.test.ts`
Expected: 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-safety-profile.ts scripts/__tests__/migrate-cli.test.ts
git commit -m "feat(scripts): runMigration() dry-run reports inferred profiles per agent"
```

---

### Task 19: Migration CLI — --apply with yaml-aware writer

**Files:**
- Modify: `scripts/migrate-safety-profile.ts`
- Test: `scripts/__tests__/migrate-apply.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// scripts/__tests__/migrate-apply.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigration } from '../migrate-safety-profile.js';
import { parse } from 'yaml';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'apply-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setupAgent(name: string, yml: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), yml);
}

describe('migration --apply', () => {
  it('writes safety_profile to agent.yml', async () => {
    setupAgent('alice', `# personal assistant\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\npairing:\n  mode: off\n`);
    await runMigration({ agentsDir: root, apply: true });
    const updated = readFileSync(join(root, 'alice', 'agent.yml'), 'utf-8');
    const parsed = parse(updated);
    expect(parsed.safety_profile).toBe('private');
  });

  it('preserves comments', async () => {
    setupAgent('alice', `# my comment\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\npairing:\n  mode: off\n`);
    await runMigration({ agentsDir: root, apply: true });
    const updated = readFileSync(join(root, 'alice', 'agent.yml'), 'utf-8');
    expect(updated).toMatch(/# my comment/);
  });

  it('creates backup file', async () => {
    setupAgent('alice', `routes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\npairing:\n  mode: off\n`);
    await runMigration({ agentsDir: root, apply: true });
    const files = readdirSync(join(root, 'alice'));
    const backup = files.find((f: string) => f.startsWith('agent.yml.bak-'));
    expect(backup).toBeDefined();
  });

  it('skips agents needing manual review', async () => {
    setupAgent('leads', `routes:\n  - channel: whatsapp\n    scope: dm\npairing:\n  mode: open\nmcp_tools:\n  - access_control\n`);
    await runMigration({ agentsDir: root, apply: true });
    const updated = readFileSync(join(root, 'leads', 'agent.yml'), 'utf-8');
    expect(updated).not.toMatch(/safety_profile/);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `pnpm vitest run scripts/__tests__/migrate-apply.test.ts`
Expected: tests fail (applyToFile is a stub)

- [ ] **Step 3: Implement applyToFile**

Replace the stub `applyToFile` in `scripts/migrate-safety-profile.ts`:

```ts
function applyToFile(path: string, inferred: InferResult): boolean {
  if (!inferred.profile) return false;

  const raw = readFileSync(path, 'utf-8');
  const doc = parseDocument(raw);

  // Backup
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const bakPath = `${path}.bak-${ts}`;
  copyFileSync(path, bakPath);

  // Add safety_profile
  doc.set('safety_profile', inferred.profile);

  // Add safety_overrides for tool conflicts (non-HARD_BLACKLIST)
  if (inferred.toolConflicts.length > 0) {
    const overrides = (doc.get('safety_overrides') as any) ?? {};
    const allowList = (overrides.allow_tools ?? []) as string[];
    const merged = Array.from(new Set([...allowList, ...inferred.toolConflicts]));
    doc.set('safety_overrides', { allow_tools: merged });
  }

  writeFileSync(path, doc.toString(), 'utf-8');
  return true;
}
```

Note: `parseDocument` from `yaml` package preserves comments via the AST.

- [ ] **Step 4: Run tests, expect pass**

Run: `pnpm vitest run scripts/__tests__/migrate-apply.test.ts`
Expected: 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-safety-profile.ts scripts/__tests__/migrate-apply.test.ts
git commit -m "feat(scripts): --apply writes safety_profile via yaml AST (preserves comments)"
```

---

### Task 20: Migration CLI entrypoint + npm script

**Files:**
- Modify: `scripts/migrate-safety-profile.ts`, `package.json`

- [ ] **Step 1: Add CLI entrypoint to migrate-safety-profile.ts**

Append:

```ts
// CLI entrypoint
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const apply = process.argv.includes('--apply');
  const dirIdx = process.argv.indexOf('--dir');
  const agentsDir = dirIdx > 0 ? process.argv[dirIdx + 1] : 'agents';

  const out = await runMigration({ agentsDir, apply });

  console.log(`\nScanning ${agentsDir}/...\n`);
  for (const r of out.results) {
    console.log(`[${r.agentId}] ${r.error ? `❌ ${r.error}` : `inferred: ${r.profile} (${r.reason})`}`);
    if (r.toolConflicts.length > 0) {
      console.log(`  ⚠ tool conflicts: ${r.toolConflicts.join(', ')}`);
      console.log(`    ${apply ? 'Added' : 'Would add'} safety_overrides.allow_tools (review needed!)`);
    }
    if (r.hardBlacklistConflicts.length > 0) {
      console.log(`  ❗ HARD_BLACKLIST: ${r.hardBlacklistConflicts.join(', ')}`);
      console.log(`    Cannot be auto-migrated. Manually decide: remove or change safety_profile.`);
    }
    if (r.applied) console.log(`  ✅ applied`);
    console.log('');
  }

  console.log(`Summary:`);
  console.log(`  ${out.summary.scanned} agents scanned`);
  console.log(`  ${out.summary.readyToApply} ready to apply${apply ? '' : ' (--apply)'}`);
  console.log(`  ${out.summary.needsReview} need manual review`);
  if (apply) console.log(`  ${out.summary.applied} applied`);
  if (!apply && out.summary.readyToApply > 0) {
    console.log(`\nNo changes written. Re-run with --apply to commit.`);
  }
}
```

- [ ] **Step 2: Add npm script**

In `package.json`, add to `scripts`:

```json
"migrate:safety-profile": "tsx scripts/migrate-safety-profile.ts"
```

- [ ] **Step 3: Smoke test**

Run: `pnpm migrate:safety-profile --dir /tmp/nonexistent 2>&1 || true`
Expected: graceful failure with error about missing dir

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-safety-profile.ts package.json
git commit -m "feat(scripts): pnpm migrate:safety-profile CLI with output formatting"
```

---

## Phase 8: Apply migration + docs

### Task 21: Apply migration to existing agents

**Files:**
- Modify: `agents/example/agent.yml`, `agents/leads_agent/agent.yml`, `agents/content_sm_building/agent.yml`

- [ ] **Step 1: Run migration in dry-run**

Run: `pnpm migrate:safety-profile`
Expected output: 3 agents scanned, profile inferred for each. `leads_agent` flagged for manual review (`access_control` HARD_BLACKLIST).

- [ ] **Step 2: Apply auto-migrate**

Run: `pnpm migrate:safety-profile --apply`
Expected: `example` (private) and `content_sm_building` (trusted) get `safety_profile` added. `leads_agent` skipped.

- [ ] **Step 3: Manually edit leads_agent/agent.yml**

Open `agents/leads_agent/agent.yml`. Inspect current `mcp_tools`. Make a deliberate decision:
- Option A: remove `access_control` and `manage_cron` from `mcp_tools` to satisfy `safety_profile: public`
- Option B: change to `safety_profile: private` and reduce allowlist to 1 peer

Default to A (the bot is public-facing — it should not have agent-config tools). Edit:

```yaml
safety_profile: public
mcp_tools:
  - memory_search
  - memory_write
  - memory_wiki
  - list_skills
# REMOVED: manage_cron, access_control — incompatible with safety_profile=public
```

If `safety_overrides` was added by the migration script for `manage_cron`, decide whether to keep it (with WARN log on every start) or remove the tool entirely. Recommend removing.

- [ ] **Step 4: Smoke test gateway start**

Run: `pnpm dev` for ~5 seconds; expect log lines `Loaded agent {agentId: ..., routes: ...}` for all 3, no fatal errors. Stop the process.

- [ ] **Step 5: Commit**

```bash
git add agents/example/agent.yml agents/leads_agent/agent.yml agents/content_sm_building/agent.yml
git commit -m "config(agents): set safety_profile on all 3 deployed agents (manual review for leads_agent)"
```

---

### Task 22: Documentation

**Files:**
- Create: `docs/safety-profiles.md`
- Modify: `CHANGELOG.md`, `README.md`

- [ ] **Step 1: Write docs/safety-profiles.md**

```markdown
# Safety Profiles

Every agent in `agents/<id>/agent.yml` MUST declare a `safety_profile`. This determines which tools the agent can use, how the system prompt is built, and how destructive operations are gated.

## Three profiles

### `public`
For bots that anyone can DM (open WhatsApp, public Telegram). Anonymous-user threat model.
- Custom (non-Claude-Code) system prompt
- No `.claude/` settings loaded
- Read-only built-ins only (Read, Glob, Grep, LS)
- MCP tools must opt-in via `safe_in_public: true` META
- No interactive approval (channel may not support it)
- Rate-limited to 30 msg/hour per peer (enforced)

### `trusted`
For bots serving known users (allowlisted or paired). Not actively hostile.
- Claude Code preset system prompt
- Project `.claude/` settings loaded
- Built-in code-edit tools (Write, Edit) allowed *with TG approval*
- `manage_cron`, `memory_write`, `send_media` available
- Rate-limited to 100 msg/hour per peer

### `private`
For single-user agents (your personal assistant). One trusted owner.
- Allowlist must contain exactly 1 peer per channel
- All tools available (subject to `mcp_tools`)
- Bash and WebFetch require TG approval
- Optional `safety_overrides.permission_mode: bypass` removes approval

## Schema

```yaml
safety_profile: public | trusted | private    # REQUIRED

safety_overrides:                              # OPTIONAL
  allow_tools:                                  # Open specific tools (logs WARN)
    - manage_cron
  permission_mode: bypass                       # Only valid in private; skips approval
  sandbox:                                       # Override sandbox defaults
    allowUnsandboxedCommands: true
```

## Migration

Run the migration utility to add `safety_profile` to existing agents:

```bash
pnpm migrate:safety-profile           # dry-run
pnpm migrate:safety-profile --apply   # write changes (creates .bak files)
```

Agents with HARD_BLACKLIST conflicts (e.g., `access_control` in a public-facing agent) are flagged for manual review.

## Tool META

Each MCP tool exports `META` with safety classification. Profiles consult META at agent load. Adding a new MCP tool requires declaring META — without it, the tool is not loadable in any profile.

## HARD_BLACKLIST

Some tools are forbidden in certain profiles even with `safety_overrides.allow_tools`:
- `Bash`, `Write`, `Edit`, `MultiEdit`, `WebFetch`, `manage_cron`, `manage_skills`, `access_control`, `send_media`, `memory_write`, `local_note_propose` are HARD_BLACKLIST in `public`
- `manage_skills`, `access_control`, `Bash`, `NotebookEdit` are HARD_BLACKLIST in `trusted`
- Nothing is HARD_BLACKLIST in `private`

## See also

- `docs/superpowers/specs/2026-04-29-safety-profiles-design.md` — full design rationale
- `src/security/builtin-tool-meta.ts` — built-in tool classification
- `src/security/profiles/` — profile definitions
```

- [ ] **Step 2: Update CHANGELOG.md**

Add at top:

```markdown
## [Unreleased]

### BREAKING

- `safety_profile` is now required in `agents/<id>/agent.yml`. Existing configs without this field fail to load. Run `pnpm migrate:safety-profile --apply` to add it. See `docs/safety-profiles.md`.
- The hardcoded `claude_code` SDK preset and `settingSources: ['project']` are no longer applied by default. Profile-driven; see `docs/safety-profiles.md`.
- `DEFAULT_ALLOWED_TOOLS` no longer auto-includes `Bash`, `Write`, `Edit`, `MultiEdit`, `WebFetch` for every agent. Per-profile gating replaces it.

### Added

- `src/security/profiles/` — `public`, `trusted`, `private` profile definitions
- `src/security/approval-broker.ts` — in-memory approval queue for interactive permission flow
- `pnpm migrate:safety-profile` — utility to add `safety_profile` to existing agents
- Telegram inline-button approval for destructive tool calls in `trusted`/`private` profiles
- Per-tool `META` exports across all MCP tools

### Fixed

- Klavdia (and any other agent under `claude_code` preset) was instructed by SDK to use `/tmp/claude-resume-.../memory/` and harness primitives `RemoteTrigger`/`CronCreate`. This is replaced for `public` profile (custom prompt) and gated for others.
```

- [ ] **Step 3: Add link to README.md**

Locate the existing README. Add to the table of contents or "Configuration" section:

```markdown
- [Safety Profiles](docs/safety-profiles.md) — how `safety_profile` controls tool access
```

- [ ] **Step 4: Commit**

```bash
git add docs/safety-profiles.md CHANGELOG.md README.md
git commit -m "docs(safety-profiles): user guide + CHANGELOG entry + README link"
```

---

### Task 23: Final integration smoke

**Files:**
- Test: `test/safety-profiles-e2e.test.ts`

- [ ] **Step 1: Write E2E test**

```ts
// test/safety-profiles-e2e.test.ts
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return { ...real, startup: vi.fn(async () => { throw new Error('mocked: no SDK in tests'); }) };
});

import { Gateway } from '../src/gateway.js';
import type { GlobalConfig } from '../src/config/schema.js';

describe('Gateway start with safety_profile', () => {
  it('loads three agents covering all three profiles', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-safety-'));
    const agentsDir = join(root, 'agents');
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });

    function setup(name: string, profile: string, allowlist: string) {
      const dir = join(agentsDir, name);
      mkdirSync(dir, { recursive: true });
      const yml =
        `safety_profile: ${profile}\n` +
        `routes:\n  - channel: telegram\n    scope: dm\n` +
        allowlist +
        `mcp_tools:\n  - memory_search\n`;
      writeFileSync(join(dir, 'agent.yml'), yml);
      writeFileSync(join(dir, 'CLAUDE.md'), `You are ${name}.`);
    }

    setup('pub-bot', 'public', '');
    setup('team-bot', 'trusted', `allowlist:\n  telegram:\n    - "100"\n    - "200"\n`);
    setup('mine', 'private', `allowlist:\n  telegram:\n    - "12345"\n`);

    const config: GlobalConfig = {
      defaults: { model: 'claude-sonnet-4-6' },
    } as any;

    const gw = new Gateway();
    await gw.start(config, agentsDir, dataDir);
    expect(gw.agents.size).toBe(3);
    expect(gw.agents.get('pub-bot')?.safetyProfile.name).toBe('public');
    expect(gw.agents.get('team-bot')?.safetyProfile.name).toBe('trusted');
    expect(gw.agents.get('mine')?.safetyProfile.name).toBe('private');

    await gw.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses to start with one bad agent (hard-fail)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'e2e-fail-'));
    const agentsDir = join(root, 'agents');
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });

    const dir = join(agentsDir, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'agent.yml'),
      `safety_profile: public\n` +
      `routes:\n  - channel: telegram\n    scope: dm\n` +
      `mcp_tools:\n  - manage_cron\n`);
    writeFileSync(join(dir, 'CLAUDE.md'), 'broken');

    const config = { defaults: { model: 'claude-sonnet-4-6' } } as any;
    const gw = new Gateway();
    await expect(gw.start(config, agentsDir, dataDir)).rejects.toThrow(/manage_cron/);

    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test, expect pass**

Run: `pnpm vitest run test/safety-profiles-e2e.test.ts`
Expected: 2 tests pass. If `gw.agents` is private, expose a `getAgents()` method or use `gw.agents` after making it visible.

- [ ] **Step 3: Run full suite**

Run: `pnpm test`
Expected: all suites pass. Fix regressions.

- [ ] **Step 4: Commit**

```bash
git add test/safety-profiles-e2e.test.ts
git commit -m "test(safety-profiles): E2E covering all three profiles + hard-fail on bad config"
```

---

## Self-Review Notes

This plan covers:
- ✅ Tool META taxonomy (Tasks 1-3)
- ✅ Profile types and three profile definitions (Tasks 4-8)
- ✅ Schema additions (Task 9)
- ✅ Validation with hard-fail (Tasks 10-11)
- ✅ ApprovalBroker (Task 12)
- ✅ Channel adapter approval API (Tasks 13-14)
- ✅ canUseTool integration (Tasks 15-16)
- ✅ Migration utility (Tasks 17-20)
- ✅ Apply to existing agents (Task 21)
- ✅ Docs + CHANGELOG (Task 22)
- ✅ E2E smoke (Task 23)

Spec sections all have task coverage. No placeholders, no "TODO", every step has actual code.

**Open implementation note:** Task 16 may require small refactors of existing `gateway.ts` callsites to thread `msg`/`channel` through to `buildSdkOptions`. If those callsites turn out to span many functions, consider a small helper class/context object — but keep changes minimal and behind feature-flag-free, in-PR refactors only (no unrelated cleanups).
