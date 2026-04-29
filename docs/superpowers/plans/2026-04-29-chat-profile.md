# `chat_like_openclaw` Profile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth `safety_profile` value `chat_like_openclaw` — friendly conversational mode with all tools auto-allowed, pure-string system prompt with embedded personality baseline (per-agent override editable in dashboard). Make it the default for new agent scaffold. Migrate `agents/example` (Klavdia) to it.

**Architecture:** New profile slots into the existing `SafetyProfile` interface. System prompt for chat is resolved at runtime in `buildSdkOptions` by combining `personality` field (or baseline) + agent's `CLAUDE.md`. Validator and canUseTool short-circuit chat to "allow everything". UI dropdown gets a new option (first), conditionally renders a Personality textarea, and the scaffold writes the new profile by default. A read-only API endpoint returns the baseline string so the UI placeholder can read it.

**Tech Stack:** TypeScript, Zod, vitest (UI uses vitest+react-testing-library), Next.js 15 App Router, yaml package (for migration write), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-04-29-chat-profile-design.md`

---

## File Structure

### Created files

| Path | Responsibility |
|---|---|
| `src/security/profiles/chat-personality-baseline.ts` | Single export: `CHAT_PERSONALITY_BASELINE` string constant |
| `src/security/profiles/chat-like-openclaw.ts` | `chatLikeOpenclawProfile: SafetyProfile` |
| `src/security/profiles/__tests__/chat-like-openclaw-profile.test.ts` | Unit tests for the profile |
| `src/security/profiles/__tests__/validate-chat.test.ts` | Validator behaviour on chat profile |
| `src/sdk/__tests__/options-chat.test.ts` | `buildSdkOptions` chat-specific tests |
| `src/sdk/__tests__/permissions-chat.test.ts` | `createCanUseTool` chat-specific tests |
| `src/__tests__/chat-profile-e2e.test.ts` | End-to-end sanity (config → profile → buildSdkOptions) |
| `ui/app/api/security/profiles/[name]/baseline/route.ts` | GET endpoint returning baseline string |
| `ui/__tests__/api/profiles-baseline.test.ts` | Endpoint tests |
| `ui/__tests__/components/agent-config-chat.test.tsx` | UI dropdown + textarea behaviour |
| `ui/__tests__/lib/agents-create-default.test.ts` | Scaffold default tests |
| `scripts/__tests__/migrate-chat-suggestion.test.ts` | `inferProfile` chat detection |

### Modified files

| Path | What changes |
|---|---|
| `src/security/types.ts` | `ProfileName` enum +1 value |
| `src/security/profiles/index.ts` | Register chat profile + export `getDefaultProfile()` |
| `src/config/schema.ts` | `safety_profile` enum +1 value, `personality` field added |
| `src/sdk/options.ts` | `buildSdkOptions` resolves chat systemPrompt via baseline + CLAUDE.md |
| `src/sdk/permissions.ts` | `createCanUseTool` short-circuits allow-all on chat profile |
| `src/security/profiles/validate.ts` | Info-warnings for `safety_overrides` on chat |
| `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` | Dropdown options, tooltip, fallback default, Personality textarea |
| `ui/lib/agents.ts` | `createAgent` writes `safety_profile: getDefaultProfile()` |
| `scripts/migrate-safety-profile.ts` | `inferProfile()` returns chat for bypass/wildcard/empty |
| `agents/example/agent.yml` | Switch to chat profile, drop overrides/sdk.disallowedTools |
| `agents/example/CLAUDE.md` + `soul.md` | Rewrite for warm tone (no "be concise") |
| `docs/safety-profiles.md` | New `## chat_like_openclaw` section |
| `README.md` | One-line addition in profiles list |
| `CHANGELOG.md` | `[Unreleased]` entry |

---

## Glossary of constants/types referenced across tasks

- `ProfileName = 'public' | 'trusted' | 'private' | 'chat_like_openclaw'`
- `CHAT_PERSONALITY_BASELINE: string` — defined in Task 2, referenced in Tasks 3, 7, 9
- `chatLikeOpenclawProfile: SafetyProfile` — defined in Task 3, registered in Task 4
- `getDefaultProfile(): ProfileName` — defined in Task 4, used by Task 13 (scaffold)
- `resolveChatSystemPrompt(agent: Agent): string` — defined in Task 7

---

## Implementation Tasks

### Task 1: Extend `ProfileName` type

**Files:**
- Modify: `src/security/types.ts:1`
- Test: `src/security/profiles/__tests__/types.test.ts` (extend existing)

- [ ] **Step 1: Update existing type test**

Add to `src/security/profiles/__tests__/types.test.ts` (append after existing tests):

```ts
import type { ProfileName } from '../../types.js';

describe('ProfileName extended', () => {
  it('accepts "chat_like_openclaw" as a valid value', () => {
    const p: ProfileName = 'chat_like_openclaw';
    expect(p).toBe('chat_like_openclaw');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/security/profiles/__tests__/types.test.ts`
Expected: TS error — `Type '"chat_like_openclaw"' is not assignable to type 'ProfileName'`

- [ ] **Step 3: Update the type**

In `src/security/types.ts:1`:

```ts
export type ProfileName = 'public' | 'trusted' | 'private' | 'chat_like_openclaw';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/security/profiles/__tests__/types.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/security/types.ts src/security/profiles/__tests__/types.test.ts
git commit -m "feat(security): add chat_like_openclaw to ProfileName enum"
```

---

### Task 2: Personality baseline constant

**Files:**
- Create: `src/security/profiles/chat-personality-baseline.ts`
- Test: `src/security/profiles/__tests__/chat-personality-baseline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/security/profiles/__tests__/chat-personality-baseline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CHAT_PERSONALITY_BASELINE } from '../chat-personality-baseline.js';

describe('CHAT_PERSONALITY_BASELINE', () => {
  it('is a non-empty string', () => {
    expect(typeof CHAT_PERSONALITY_BASELINE).toBe('string');
    expect(CHAT_PERSONALITY_BASELINE.length).toBeGreaterThan(50);
  });

  it('describes a messaging agent (not CLI helper)', () => {
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toContain('messaging');
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toContain('not a cli');
  });

  it('encourages warm conversational tone', () => {
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toMatch(/warm|conversational|curious/);
  });

  it('is trimmed (no leading/trailing whitespace)', () => {
    expect(CHAT_PERSONALITY_BASELINE).toBe(CHAT_PERSONALITY_BASELINE.trim());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/security/profiles/__tests__/chat-personality-baseline.test.ts`
Expected: FAIL — `Cannot find module '../chat-personality-baseline.js'`

- [ ] **Step 3: Implement the baseline**

Create `src/security/profiles/chat-personality-baseline.ts`:

```ts
/**
 * Default personality baseline for the `chat_like_openclaw` safety profile.
 *
 * Injected as the leading section of the system prompt for any agent on this
 * profile. Per-agent override: set `personality: <string>` in agent.yml.
 *
 * Tweaked here when the project-wide chat tone needs adjustment. Keep it
 * short (≤ 100 words) — long preambles dilute agent-specific instructions
 * from CLAUDE.md.
 */
export const CHAT_PERSONALITY_BASELINE = `You are an autonomous Telegram/WhatsApp messaging agent — not a CLI helper.
Communicate like a person, not a tool. Be warm, conversational, curious.
It's fine to ask clarifying questions, share reasoning out loud, use emoji
where natural. Don't robot-rapport ("done.", "confirmed."). When something
fails — narrate, propose alternatives, don't just dump the error. The user
is here for a relationship with you, not a function call.`.trim();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/security/profiles/__tests__/chat-personality-baseline.test.ts`
Expected: PASS, 4/4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/chat-personality-baseline.ts src/security/profiles/__tests__/chat-personality-baseline.test.ts
git commit -m "feat(security): add CHAT_PERSONALITY_BASELINE constant"
```

---

### Task 3: `chatLikeOpenclawProfile` definition

**Files:**
- Create: `src/security/profiles/chat-like-openclaw.ts`
- Test: `src/security/profiles/__tests__/chat-like-openclaw-profile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/security/profiles/__tests__/chat-like-openclaw-profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chatLikeOpenclawProfile } from '../chat-like-openclaw.js';
import { BUILTIN_META } from '../../builtin-tool-meta.js';

describe('chatLikeOpenclawProfile', () => {
  it('name is "chat_like_openclaw"', () => {
    expect(chatLikeOpenclawProfile.name).toBe('chat_like_openclaw');
  });

  it('systemPrompt is in string mode (placeholder, resolved at runtime)', () => {
    expect(chatLikeOpenclawProfile.systemPrompt.mode).toBe('string');
  });

  it('settingSources is empty array', () => {
    expect(chatLikeOpenclawProfile.settingSources).toEqual([]);
  });

  it('builtinTools.allowed contains every built-in (Bash, Write, Edit, Read, etc.)', () => {
    const allBuiltins = Object.keys(BUILTIN_META);
    for (const name of allBuiltins) {
      expect(chatLikeOpenclawProfile.builtinTools.allowed.has(name)).toBe(true);
    }
  });

  it('builtinTools.requiresApproval is empty', () => {
    expect(chatLikeOpenclawProfile.builtinTools.requiresApproval.size).toBe(0);
  });

  it('builtinTools.forbidden is empty', () => {
    expect(chatLikeOpenclawProfile.builtinTools.forbidden.size).toBe(0);
  });

  it('mcpToolPolicy.allowedByMeta returns true for any meta', () => {
    expect(chatLikeOpenclawProfile.mcpToolPolicy.allowedByMeta({
      category: 'agent-config',
      safe_in_public: false,
      safe_in_trusted: false,
      safe_in_private: false,
      destructive: true,
      reads_only: false,
      hard_blacklist_in: [],
    })).toBe(true);
  });

  it('mcpToolPolicy.requiresApproval returns false for any meta', () => {
    expect(chatLikeOpenclawProfile.mcpToolPolicy.requiresApproval({
      category: 'agent-config',
      safe_in_public: false,
      safe_in_trusted: false,
      safe_in_private: false,
      destructive: true,
      reads_only: false,
      hard_blacklist_in: [],
    })).toBe(false);
  });

  it('hardBlacklist is empty', () => {
    expect(chatLikeOpenclawProfile.hardBlacklist.size).toBe(0);
  });

  it('allowsPluginTools is true', () => {
    expect(chatLikeOpenclawProfile.allowsPluginTools).toBe(true);
  });

  it('permissionFlow is auto-allow', () => {
    expect(chatLikeOpenclawProfile.permissionFlow).toBe('auto-allow');
  });

  it('sandboxDefaults disables sandbox and allows unsandboxed commands', () => {
    expect(chatLikeOpenclawProfile.sandboxDefaults).toEqual({
      allowUnsandboxedCommands: true,
      enabled: false,
    });
  });

  it('rateLimitFloor is null', () => {
    expect(chatLikeOpenclawProfile.rateLimitFloor).toBeNull();
  });

  it('validateAllowlist accepts undefined allowlist', () => {
    expect(chatLikeOpenclawProfile.validateAllowlist(undefined)).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts wildcard', () => {
    expect(chatLikeOpenclawProfile.validateAllowlist({ telegram: ['*'] })).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts specific peers', () => {
    expect(chatLikeOpenclawProfile.validateAllowlist({ telegram: ['12345'] })).toEqual({ ok: true, warnings: [] });
  });

  it('validateAllowlist accepts mixed wildcard + specifics', () => {
    expect(
      chatLikeOpenclawProfile.validateAllowlist({ telegram: ['*', '12345'], whatsapp: ['*'] }),
    ).toEqual({ ok: true, warnings: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/security/profiles/__tests__/chat-like-openclaw-profile.test.ts`
Expected: FAIL — `Cannot find module '../chat-like-openclaw.js'`

- [ ] **Step 3: Implement the profile**

Create `src/security/profiles/chat-like-openclaw.ts`:

```ts
import type { SafetyProfile } from './types.js';
import { BUILTIN_META } from '../builtin-tool-meta.js';

const allowed = new Set<string>(Object.keys(BUILTIN_META));

/**
 * `chat_like_openclaw` — friendly conversational profile for personal/single-user
 * mode. Pure-string system prompt (no claude_code preset), all built-in and MCP
 * tools auto-allowed, no approval flow, wildcard allowlist permitted, no sandbox.
 *
 * The actual system prompt text is resolved at runtime in
 * `src/sdk/options.ts::buildSdkOptions` by combining the per-agent
 * `personality` field (or CHAT_PERSONALITY_BASELINE) with the agent's CLAUDE.md.
 * The `systemPrompt.text` here is a placeholder — never read directly when
 * profile.name === 'chat_like_openclaw'.
 */
export const chatLikeOpenclawProfile: SafetyProfile = {
  name: 'chat_like_openclaw',
  systemPrompt: { mode: 'string', text: '' },
  settingSources: [],
  builtinTools: {
    allowed,
    forbidden: new Set(),
    requiresApproval: new Set(),
  },
  mcpToolPolicy: {
    allowedByMeta: () => true,
    requiresApproval: () => false,
  },
  hardBlacklist: new Set(),
  allowsPluginTools: true,
  permissionFlow: 'auto-allow',
  sandboxDefaults: { allowUnsandboxedCommands: true, enabled: false },
  rateLimitFloor: null,
  validateAllowlist: () => ({ ok: true, warnings: [] }),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/security/profiles/__tests__/chat-like-openclaw-profile.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/chat-like-openclaw.ts src/security/profiles/__tests__/chat-like-openclaw-profile.test.ts
git commit -m "feat(security): add chatLikeOpenclawProfile definition"
```

---

### Task 4: Register profile + `getDefaultProfile` helper

**Files:**
- Modify: `src/security/profiles/index.ts`
- Test: `src/security/profiles/__tests__/index.test.ts` (extend existing or create)

- [ ] **Step 1: Write the failing test**

Add to (or create) `src/security/profiles/__tests__/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getProfile, ALL_PROFILES, getDefaultProfile, chatLikeOpenclawProfile } from '../index.js';

describe('profiles registry', () => {
  it('getProfile("chat_like_openclaw") returns chatLikeOpenclawProfile', () => {
    expect(getProfile('chat_like_openclaw')).toBe(chatLikeOpenclawProfile);
  });

  it('ALL_PROFILES contains chat profile', () => {
    expect(ALL_PROFILES.some((p) => p.name === 'chat_like_openclaw')).toBe(true);
  });

  it('getDefaultProfile returns "chat_like_openclaw"', () => {
    expect(getDefaultProfile()).toBe('chat_like_openclaw');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/security/profiles/__tests__/index.test.ts`
Expected: FAIL — `getDefaultProfile is not a function` and `unknown safety_profile: chat_like_openclaw`.

- [ ] **Step 3: Update the registry**

Replace `src/security/profiles/index.ts`:

```ts
import type { ProfileName } from '../types.js';
import type { SafetyProfile } from './types.js';
import { publicProfile } from './public.js';
import { trustedProfile } from './trusted.js';
import { privateProfile } from './private.js';
import { chatLikeOpenclawProfile } from './chat-like-openclaw.js';

export const ALL_PROFILES: SafetyProfile[] = [
  publicProfile,
  trustedProfile,
  privateProfile,
  chatLikeOpenclawProfile,
];

export function getProfile(name: ProfileName): SafetyProfile {
  switch (name) {
    case 'public':
      return publicProfile;
    case 'trusted':
      return trustedProfile;
    case 'private':
      return privateProfile;
    case 'chat_like_openclaw':
      return chatLikeOpenclawProfile;
    default:
      throw new Error(`unknown safety_profile: ${name as string}`);
  }
}

/**
 * Returns the default profile name to use when scaffolding a new agent.
 * Single source-of-truth for the UI scaffold, CLI scaffold, and test fixtures.
 */
export function getDefaultProfile(): ProfileName {
  return 'chat_like_openclaw';
}

export { publicProfile, trustedProfile, privateProfile, chatLikeOpenclawProfile };
export type { SafetyProfile, SystemPromptSpec, PermissionFlow } from './types.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/security/profiles/__tests__/index.test.ts`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/index.ts src/security/profiles/__tests__/index.test.ts
git commit -m "feat(security): register chat profile + getDefaultProfile helper"
```

---

### Task 5: Schema — extend enum + add `personality` field

**Files:**
- Modify: `src/config/schema.ts:347` (enum), `src/config/schema.ts:339-398` (AgentYmlSchema fields)
- Test: `src/config/__tests__/schema-chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/config/__tests__/schema-chat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AgentYmlSchema } from '../schema.js';

const baseConfig = {
  routes: [{ channel: 'telegram' as const, scope: 'dm' as const }],
};

describe('AgentYmlSchema chat extensions', () => {
  it('accepts safety_profile=chat_like_openclaw', () => {
    const result = AgentYmlSchema.safeParse({
      ...baseConfig,
      safety_profile: 'chat_like_openclaw',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional personality string', () => {
    const result = AgentYmlSchema.safeParse({
      ...baseConfig,
      safety_profile: 'chat_like_openclaw',
      personality: 'You are warm and chatty.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personality).toBe('You are warm and chatty.');
    }
  });

  it('personality field is optional (undefined when missing)', () => {
    const result = AgentYmlSchema.safeParse({
      ...baseConfig,
      safety_profile: 'chat_like_openclaw',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personality).toBeUndefined();
    }
  });

  it('rejects non-string personality', () => {
    const result = AgentYmlSchema.safeParse({
      ...baseConfig,
      safety_profile: 'chat_like_openclaw',
      personality: 42,
    });
    expect(result.success).toBe(false);
  });

  it('keeps backward compat: public/trusted/private still valid', () => {
    for (const p of ['public', 'trusted', 'private'] as const) {
      const r = AgentYmlSchema.safeParse({ ...baseConfig, safety_profile: p });
      expect(r.success).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/config/__tests__/schema-chat.test.ts`
Expected: FAIL — chat_like_openclaw not in enum, personality not in schema.

- [ ] **Step 3: Update schema**

In `src/config/schema.ts`, change line 347:

```ts
  safety_profile: z.enum(['public', 'trusted', 'private', 'chat_like_openclaw']),
```

Add `personality` field after `safety_overrides` (after line 348):

```ts
  safety_profile: z.enum(['public', 'trusted', 'private', 'chat_like_openclaw']),
  safety_overrides: SafetyOverridesSchema.optional(),
  personality: z
    .string()
    .optional()
    .describe('Personality baseline override for chat_like_openclaw profile. Empty/missing → uses CHAT_PERSONALITY_BASELINE. Has no effect on other profiles (info-warning emitted by validator).'),
  pairing: PairingSchema.optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/config/__tests__/schema-chat.test.ts`
Expected: PASS, 5/5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema-chat.test.ts
git commit -m "feat(schema): add chat_like_openclaw + personality field"
```

---

### Task 6: Validator — chat-specific warnings

**Files:**
- Modify: `src/security/profiles/validate.ts`
- Test: `src/security/profiles/__tests__/validate-chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/security/profiles/__tests__/validate-chat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateSafetyProfile } from '../validate.js';
import type { AgentYml } from '../../../config/schema.js';

const baseChat: AgentYml = {
  routes: [{ channel: 'telegram', scope: 'dm' }],
  safety_profile: 'chat_like_openclaw',
  timezone: 'UTC',
  // Required defaults from schema; these are the minimal AgentYml fields.
  // Use schema parse in real usage; for unit tests we cast a partial.
} as unknown as AgentYml;

describe('validateSafetyProfile on chat profile', () => {
  it('accepts wildcard allowlist', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      allowlist: { telegram: ['*'] },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts permission_mode=bypass', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_overrides: { permission_mode: 'bypass' },
    });
    expect(result.ok).toBe(true);
  });

  it('accepts permission_mode=default (explicit opt-in to approval flow)', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_overrides: { permission_mode: 'default' },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.find((w) => w.includes('permission_mode=default'))).toBeUndefined();
  });

  it('emits info-warning when allow_tools is set on chat (no-op)', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_overrides: { allow_tools: ['Bash'] },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) =>
      w.includes('safety_overrides.allow_tools') && w.includes('chat_like_openclaw'),
    )).toBe(true);
  });

  it('does NOT warn about deny_tools (it has real effect)', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_overrides: { deny_tools: ['Bash'] },
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.find((w) => w.includes('deny_tools'))).toBeUndefined();
  });

  it('emits info-warning when personality is set on non-chat profile', () => {
    const result = validateSafetyProfile({
      ...baseChat,
      safety_profile: 'trusted',
      personality: 'be warm',
    } as unknown as AgentYml);
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes('personality') && w.includes('trusted'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/security/profiles/__tests__/validate-chat.test.ts`
Expected: FAIL — current validator throws on bypass+!private, doesn't emit chat-specific warnings.

- [ ] **Step 3: Update validator**

Replace `validateSafetyProfile` body in `src/security/profiles/validate.ts`. Keep the function signature and existing behavior for non-chat profiles; add chat-specific branches:

```ts
export function validateSafetyProfile(config: AgentYml): ValidationResult {
  const warnings: string[] = [];
  const profile = getProfile(config.safety_profile);

  // Check allowlist shape
  const allowlistResult = profile.validateAllowlist(config.allowlist);
  if (!allowlistResult.ok) {
    return { ok: false, warnings: [], error: allowlistResult.error ?? 'allowlist invalid' };
  }
  warnings.push(...allowlistResult.warnings);

  // personality field info-warning on non-chat profiles
  if (config.personality && config.safety_profile !== 'chat_like_openclaw') {
    warnings.push(
      `personality field is set but has no effect on safety_profile=${config.safety_profile} (only applies to chat_like_openclaw)`,
    );
  }

  // Check overrides
  const overrides = config.safety_overrides ?? {};

  // bypass: chat permits, private permits, others reject
  if (
    overrides.permission_mode === 'bypass' &&
    config.safety_profile !== 'private' &&
    config.safety_profile !== 'chat_like_openclaw'
  ) {
    return {
      ok: false,
      warnings: [],
      error: `safety_overrides.permission_mode=bypass is only allowed with safety_profile=private or chat_like_openclaw (got ${config.safety_profile})`,
    };
  }
  if (overrides.permission_mode === 'bypass' && config.safety_profile !== 'chat_like_openclaw') {
    // chat already runs without approval — no need to log "running without approval" warning twice.
    warnings.push('safety_overrides.permission_mode=bypass: all tools will run without approval');
  }

  // chat profile: most overrides are no-op (everything is already allowed)
  if (config.safety_profile === 'chat_like_openclaw') {
    if (overrides.allow_tools && overrides.allow_tools.length > 0) {
      warnings.push(
        'safety_overrides.allow_tools have no effect on safety_profile=chat_like_openclaw — all tools are already allowed',
      );
    }
    // deny_tools and permission_mode=default DO have effect on chat — don't warn.
    return { ok: true, warnings };
  }

  // Existing tool-compat check (kept verbatim from current validator) for non-chat profiles
  const tools = config.mcp_tools ?? [];
  const allowOverrides = new Set(overrides.allow_tools ?? []);

  const incompatible: { name: string; reason: string }[] = [];
  for (const toolName of tools) {
    const meta = MCP_META[toolName] ?? BUILTIN_META[toolName];
    if (!meta) continue;
    if (meta.hard_blacklist_in.includes(profile.name)) {
      incompatible.push({
        name: toolName,
        reason: 'HARD_BLACKLIST — cannot be opened via override',
      });
      continue;
    }
    const allowedByProfile =
      profile.builtinTools.allowed.has(toolName) ||
      profile.mcpToolPolicy.allowedByMeta(meta);
    const allowedByOverride = allowOverrides.has(toolName);
    if (!allowedByProfile && !allowedByOverride) {
      incompatible.push({
        name: toolName,
        reason: `forbidden by safety_profile=${profile.name}`,
      });
    } else if (allowedByOverride && !allowedByProfile) {
      warnings.push(`safety_overrides.allow_tools opens "${toolName}" in safety_profile=${profile.name}`);
    }
  }

  if (incompatible.length > 0) {
    const lines = incompatible.map((i) => {
      const allowedIn = profilesAllowingTool(i.name).join(', ') || 'none';
      const toolMeta = MCP_META[i.name] ?? BUILTIN_META[i.name];
      const blacklist = toolMeta?.hard_blacklist_in ?? [];
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/security/profiles/__tests__/validate-chat.test.ts && pnpm test src/security/profiles/__tests__/validate.test.ts`
Expected: PASS for both — chat tests green, existing validate tests still green (no regressions on public/trusted/private).

- [ ] **Step 5: Commit**

```bash
git add src/security/profiles/validate.ts src/security/profiles/__tests__/validate-chat.test.ts
git commit -m "feat(security): validator handles chat profile (info-warnings, bypass acceptance)"
```

---

### Task 7: SDK — `buildSdkOptions` resolves chat systemPrompt

**Files:**
- Modify: `src/sdk/options.ts:54-88` (add resolveChatSystemPrompt + chat branch)
- Test: `src/sdk/__tests__/options-chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sdk/__tests__/options-chat.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSdkOptions } from '../options.js';
import { CHAT_PERSONALITY_BASELINE } from '../../security/profiles/chat-personality-baseline.js';
import { chatLikeOpenclawProfile } from '../../security/profiles/chat-like-openclaw.js';
import type { Agent } from '../../agent/agent.js';

function makeAgentStub(opts: {
  workspaceDir: string;
  personality?: string;
  claudeMd?: string;
}): Agent {
  if (opts.claudeMd !== undefined) {
    writeFileSync(join(opts.workspaceDir, 'CLAUDE.md'), opts.claudeMd, 'utf-8');
  }
  return {
    id: 'test-agent',
    workspacePath: opts.workspaceDir,
    safetyProfile: chatLikeOpenclawProfile,
    config: {
      model: 'claude-sonnet-4-6',
      personality: opts.personality,
      sdk: undefined,
    },
    mcpServer: { name: 'test-tools' },
    tools: [],
  } as unknown as Agent;
}

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'options-chat-'));
});

describe('buildSdkOptions on chat profile', () => {
  it('uses string systemPrompt (not preset)', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd: '# test' });
    const options = buildSdkOptions({ agent });
    expect(typeof options.systemPrompt).toBe('string');
  });

  it('systemPrompt includes baseline + CLAUDE.md when no personality override', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd: '# Klavdia\nYou love jokes.' });
    const options = buildSdkOptions({ agent });
    expect(options.systemPrompt).toContain(CHAT_PERSONALITY_BASELINE);
    expect(options.systemPrompt).toContain('# Klavdia');
    expect(options.systemPrompt).toContain('You love jokes.');
    expect(options.systemPrompt).toContain('─────────');
  });

  it('systemPrompt uses personality override when set', () => {
    const agent = makeAgentStub({
      workspaceDir: tmpRoot,
      personality: 'You are super formal and brief.',
      claudeMd: '# Klavdia',
    });
    const options = buildSdkOptions({ agent });
    expect(options.systemPrompt).toContain('You are super formal and brief.');
    expect(options.systemPrompt).not.toContain(CHAT_PERSONALITY_BASELINE);
  });

  it('handles missing CLAUDE.md gracefully (uses baseline only)', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot });
    const options = buildSdkOptions({ agent });
    expect(options.systemPrompt).toContain(CHAT_PERSONALITY_BASELINE);
  });

  it('settingSources is empty array', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd: '# test' });
    const options = buildSdkOptions({ agent });
    expect(options.settingSources).toEqual([]);
  });

  it('disallowedTools still includes harness blocklist', () => {
    const agent = makeAgentStub({ workspaceDir: tmpRoot, claudeMd: '# test' });
    const options = buildSdkOptions({ agent });
    expect(options.disallowedTools).toContain('CronCreate');
    expect(options.disallowedTools).toContain('RemoteTrigger');
  });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/sdk/__tests__/options-chat.test.ts`
Expected: FAIL — chat branch returns empty/wrong systemPrompt because resolver not yet added.

- [ ] **Step 3: Add the resolver to `src/sdk/options.ts`**

At the top of `src/sdk/options.ts`, add imports:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHAT_PERSONALITY_BASELINE } from '../security/profiles/chat-personality-baseline.js';
```

Add the resolver function near the top of the file (after `applySandboxProfile`):

```ts
/**
 * Resolves system prompt for chat_like_openclaw profile by combining:
 *   1. personality baseline (per-agent override OR CHAT_PERSONALITY_BASELINE)
 *   2. agent's CLAUDE.md content
 *
 * If CLAUDE.md doesn't exist, returns just the baseline.
 */
function resolveChatSystemPrompt(agent: Agent): string {
  const personality =
    typeof agent.config.personality === 'string' && agent.config.personality.trim().length > 0
      ? agent.config.personality.trim()
      : CHAT_PERSONALITY_BASELINE;

  const claudeMdPath = join(agent.workspacePath, 'CLAUDE.md');
  let claudeMd = '';
  if (existsSync(claudeMdPath)) {
    try {
      claudeMd = readFileSync(claudeMdPath, 'utf-8').trim();
    } catch {
      claudeMd = '';
    }
  }

  if (!claudeMd) return personality;
  return `${personality}\n\n─────────\n\n${claudeMd}`;
}
```

Modify the systemPrompt selection in `buildSdkOptions` (currently lines 60-67):

```ts
  let systemPrompt: Options['systemPrompt'];
  if (profile.name === 'chat_like_openclaw') {
    systemPrompt = resolveChatSystemPrompt(agent);
  } else if (profile.systemPrompt.mode === 'string') {
    systemPrompt = profile.systemPrompt.text;
  } else {
    systemPrompt = {
      type: 'preset',
      preset: profile.systemPrompt.preset,
      excludeDynamicSections: profile.systemPrompt.excludeDynamicSections,
    };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/sdk/__tests__/options-chat.test.ts && pnpm test src/sdk/__tests__/options.test.ts`
Expected: PASS — chat tests green, existing options tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/options.ts src/sdk/__tests__/options-chat.test.ts
git commit -m "feat(sdk): buildSdkOptions resolves chat systemPrompt at runtime (baseline + CLAUDE.md)"
```

---

### Task 8: SDK — `createCanUseTool` short-circuit on chat

**Files:**
- Modify: `src/sdk/permissions.ts:215-217` (add chat short-circuit)
- Test: `src/sdk/__tests__/permissions-chat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/sdk/__tests__/permissions-chat.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createCanUseTool } from '../permissions.js';
import { chatLikeOpenclawProfile } from '../../security/profiles/chat-like-openclaw.js';
import { ApprovalBroker } from '../../security/approval-broker.js';

function makeAgent(overrides?: Record<string, unknown>) {
  return {
    id: 'test-agent',
    safetyProfile: chatLikeOpenclawProfile,
    config: {
      safety_overrides: overrides ?? {},
      sdk: undefined,
    },
  } as any;
}

const ctx = { peerId: 'peer-1' };
const signal = new AbortController().signal;

describe('createCanUseTool on chat profile', () => {
  it('allows Bash without approval', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    const result = await fn('Bash', { command: 'ls' }, { signal, toolUseID: 't1' });
    expect(result.behavior).toBe('allow');
  });

  it('allows MCP plugin tools (mcp__example-tools__lcm_grep) without approval', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    const result = await fn('mcp__example-tools__lcm_grep', { q: 'test' }, { signal, toolUseID: 't2' });
    expect(result.behavior).toBe('allow');
  });

  it('allows MCP destructive tools (manage_cron, manage_skills, access_control) without approval', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    for (const name of ['manage_cron', 'manage_skills', 'access_control']) {
      const result = await fn(`mcp__test__${name}`, {}, { signal, toolUseID: `t-${name}` });
      expect(result.behavior).toBe('allow');
    }
  });

  it('respects deny_tools override (deny still wins on chat)', async () => {
    const fn = createCanUseTool({
      agent: makeAgent({ deny_tools: ['Bash'] }),
      approvalBroker: new ApprovalBroker(),
      sessionContext: ctx,
    });
    const result = await fn('Bash', { command: 'rm -rf /' }, { signal, toolUseID: 't3' });
    expect(result.behavior).toBe('deny');
  });

  it('does NOT trigger approval for any built-in tool', async () => {
    const fn = createCanUseTool({ agent: makeAgent(), approvalBroker: new ApprovalBroker(), sessionContext: ctx });
    for (const name of ['Read', 'Write', 'Edit', 'Bash', 'WebFetch']) {
      const result = await fn(name, {}, { signal, toolUseID: `t-${name}` });
      expect(result.behavior).toBe('allow');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/sdk/__tests__/permissions-chat.test.ts`
Expected: FAIL — `deny_tools` override not yet honored on the short-circuit branch (or test fails because chat short-circuit not yet present).

- [ ] **Step 3: Add chat short-circuit to `createCanUseTool` in `src/sdk/permissions.ts`**

After the `bypass` short-circuit block (around line 217 — `if (overrides.permission_mode === 'bypass')`), add chat short-circuit BEFORE meta resolution:

```ts
    // 1.5. Chat profile short-circuit — allow everything except explicit deny_tools
    if (profile.name === 'chat_like_openclaw') {
      const denyList = overrides.deny_tools ?? [];
      const localName = toolName.startsWith('mcp__')
        ? (toolName.split('__').at(-1) ?? toolName)
        : toolName;
      if (denyList.includes(toolName) || denyList.includes(localName)) {
        return deny(`Tool "${toolName}" is denied by safety_overrides.deny_tools`);
      }
      return allow(input);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/sdk/__tests__/permissions-chat.test.ts && pnpm test src/sdk/__tests__/permissions.test.ts`
Expected: PASS — chat tests green, existing permissions tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/sdk/permissions.ts src/sdk/__tests__/permissions-chat.test.ts
git commit -m "feat(sdk): canUseTool short-circuits to allow on chat profile (respects deny_tools)"
```

---

### Task 9: API — baseline endpoint

**Files:**
- Create: `ui/app/api/security/profiles/[name]/baseline/route.ts`
- Test: `ui/__tests__/api/profiles-baseline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ui/__tests__/api/profiles-baseline.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ email: 'admin@test.com', authMethod: 'cookie' }),
  handleAuthError: vi.fn(),
}));

describe('GET /api/security/profiles/[name]/baseline', () => {
  it('returns baseline for chat_like_openclaw', async () => {
    const { GET } = await import('@/app/api/security/profiles/[name]/baseline/route');
    const req = new NextRequest('http://localhost:3000/api/security/profiles/chat_like_openclaw/baseline');
    const res = await GET(req, { params: Promise.resolve({ name: 'chat_like_openclaw' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.baseline).toBe('string');
    expect(json.baseline.length).toBeGreaterThan(50);
    expect(json.baseline.toLowerCase()).toContain('messaging');
  });

  it('returns 404 for unknown profile', async () => {
    const { GET } = await import('@/app/api/security/profiles/[name]/baseline/route');
    const req = new NextRequest('http://localhost:3000/api/security/profiles/nonexistent/baseline');
    const res = await GET(req, { params: Promise.resolve({ name: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-chat profiles (no baseline concept)', async () => {
    const { GET } = await import('@/app/api/security/profiles/[name]/baseline/route');
    const req = new NextRequest('http://localhost:3000/api/security/profiles/public/baseline');
    const res = await GET(req, { params: Promise.resolve({ name: 'public' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run __tests__/api/profiles-baseline.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/security/profiles/[name]/baseline/route'`.

- [ ] **Step 3: Implement the endpoint**

Create `ui/app/api/security/profiles/[name]/baseline/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/route-handler';
import { CHAT_PERSONALITY_BASELINE } from '@backend/security/profiles/chat-personality-baseline.js';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  return withAuth(async () => {
    const { name } = await params;
    if (name !== 'chat_like_openclaw') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({ baseline: CHAT_PERSONALITY_BASELINE });
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run __tests__/api/profiles-baseline.test.ts`
Expected: PASS, 3/3 tests green.

- [ ] **Step 5: Commit**

```bash
git add ui/app/api/security/profiles/\[name\]/baseline/route.ts ui/__tests__/api/profiles-baseline.test.ts
git commit -m "feat(ui): GET /api/security/profiles/[name]/baseline endpoint"
```

---

### Task 10: UI — dropdown options + tooltip + type widening

**Files:**
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx:71`, `:397-426`, `:800`, `:1687`
- Test: `ui/__tests__/components/agent-config-chat.test.tsx` (created in Task 12 — for now test manually)

- [ ] **Step 1: Update type at line 71**

In `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`, line 71 (within `AgentConfig` interface):

```ts
  safety_profile?: 'public' | 'trusted' | 'private' | 'chat_like_openclaw';
```

Also add personality:

```ts
  personality?: string;
```

- [ ] **Step 2: Reorder dropdown options at line 397**

Replace the `SAFETY_PROFILES` array:

```ts
const SAFETY_PROFILES = [
  { value: "chat_like_openclaw", label: "chat — friendly conversational, all tools" },
  { value: "public", label: "public — anonymous-user threat model" },
  { value: "trusted", label: "trusted — known users, TG approval for destructive" },
  { value: "private", label: "private — single owner, all tools, optional bypass" },
];
```

- [ ] **Step 3: Update tooltip Record type and add chat tooltip at line 403**

Replace:

```ts
const SAFETY_PROFILE_TOOLTIP: Record<'public' | 'trusted' | 'private' | 'chat_like_openclaw', string> = {
  chat_like_openclaw:
    "Personal/single-user mode. Warm conversational tone (not a CLI helper).\n" +
    "All tools allowed without approval. Wildcard allowlist OK. No sandbox.\n" +
    "Per-agent personality override editable below.\n" +
    "\n" +
    "Use when: your personal Klavdia/Jarvis-style bot. Default for new agents.",
  public:
    "For bots that anyone can DM (open WhatsApp, public Telegram).\n" +
    "Read-only tools only, no claude_code preset, no settings loaded.\n" +
    "No interactive approval (channel may not support it).\n" +
    "Rate-limited to 30 msg/hour per peer (enforced).\n" +
    "\n" +
    "Use when: building a public lead-capture or info bot.",
  trusted:
    "For bots serving known users (allowlisted or paired). Not actively hostile.\n" +
    "Claude Code preset, project .claude/ settings loaded.\n" +
    "Built-in code-edit tools (Write, Edit) require TG approval.\n" +
    "manage_cron, memory_write, send_media available.\n" +
    "Rate-limited to 100 msg/hour per peer.\n" +
    "\n" +
    "Use when: small team chat, internal helper bot.",
  private:
    "For single-user agents (your personal assistant). One trusted owner.\n" +
    "Allowlist must contain exactly 1 peer per channel (validated on save).\n" +
    "All tools available; Bash and WebFetch require TG approval by default.\n" +
    "Optional safety_overrides.permission_mode: bypass removes all approvals.\n" +
    "\n" +
    "Use when: your personal Klavdia/Jarvis-style bot.",
};
```

- [ ] **Step 4: Update useState fallback at line 800**

Change:

```ts
    safety_profile: (agent.safety_profile ?? 'chat_like_openclaw') as 'public' | 'trusted' | 'private' | 'chat_like_openclaw',
```

And add personality to the state initializer (after the safety_overrides line ~801):

```ts
    personality: agent.personality ?? '',
```

- [ ] **Step 5: Update onChange handler type at line 1687**

```ts
                    update({ safety_profile: e.target.value as 'public' | 'trusted' | 'private' | 'chat_like_openclaw' })
```

- [ ] **Step 6: Manual verification (no automated test for this step — covered in Task 12)**

Run: `cd ui && pnpm build`
Expected: Build succeeds with no TS errors.

- [ ] **Step 7: Commit**

```bash
git add 'ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx'
git commit -m "feat(ui): chat profile dropdown option, tooltip, default fallback"
```

---

### Task 11: UI — Personality textarea (conditional render)

**Files:**
- Modify: `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` (insert after `<Field label="Profile">` block ending around line 1714)

- [ ] **Step 1: Add the textarea block**

Locate the closing of the Profile field around line 1714 (the `</Field>` after the validation warnings list). Add a new conditional block immediately after it:

```jsx
              {cfg.safety_profile === 'chat_like_openclaw' && (
                <Field
                  label="Personality"
                  tooltip={
                    "Personality baseline for this agent. Empty = use profile default.\n" +
                    "Edits hot-reload (next message picks up new prompt without restart).\n" +
                    "\n" +
                    "Tip: keep it under 100 words. The agent's CLAUDE.md is appended after this."
                  }
                >
                  <textarea
                    value={cfg.personality ?? ''}
                    placeholder={chatBaseline ?? 'Loading default…'}
                    onChange={(e) => update({ personality: e.target.value })}
                    rows={10}
                    className="w-full rounded-[5px] border px-2 py-1 text-xs"
                    style={{
                      background: "var(--oc-bg3)",
                      borderColor: "var(--oc-border)",
                      color: "var(--color-foreground)",
                    }}
                  />
                </Field>
              )}
```

- [ ] **Step 2: Add baseline fetch state**

At the top of `ConfigTab` component (near other useState hooks), add:

```ts
  const [chatBaseline, setChatBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (cfg.safety_profile !== 'chat_like_openclaw') return;
    if (chatBaseline !== null) return;
    fetch(`/api/fleet/${serverId}/security/profiles/chat_like_openclaw/baseline`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.baseline) setChatBaseline(d.baseline); })
      .catch(() => { /* silently fall back to "Loading default…" placeholder */ });
  }, [cfg.safety_profile, chatBaseline, serverId]);
```

(Make sure `useEffect` is imported alongside `useState`.)

- [ ] **Step 3: Manual verification**

Run: `cd ui && pnpm build`
Expected: Build succeeds.

Open agent edit page in dashboard manually after building → switch profile to chat → textarea appears with placeholder showing baseline.

- [ ] **Step 4: Commit**

```bash
git add 'ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx'
git commit -m "feat(ui): conditional Personality textarea on chat profile"
```

---

### Task 12: UI — config constants tests (dropdown options + tooltip)

Tests the static constants modified in Task 10 — the rendered ConfigTab UX is verified manually in Task 18 (step 4). The current `page.tsx` is monolithic (~5000 lines); extracting `ConfigTab` for unit testing is out of scope for this PR.

**Files:**
- Test: `ui/__tests__/components/agent-config-chat-constants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ui/__tests__/components/agent-config-chat-constants.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PAGE_PATH = resolve(
  process.cwd(),
  'app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx',
);

describe('agent config page — chat profile constants', () => {
  const source = readFileSync(PAGE_PATH, 'utf-8');

  it('SAFETY_PROFILES array includes chat_like_openclaw', () => {
    expect(source).toMatch(/value:\s*["']chat_like_openclaw["']/);
  });

  it('chat option appears before public/trusted/private in SAFETY_PROFILES', () => {
    const chatIdx = source.indexOf('"chat_like_openclaw"');
    const publicIdx = source.indexOf('"public"');
    const trustedIdx = source.indexOf('"trusted"');
    const privateIdx = source.indexOf('"private"');
    expect(chatIdx).toBeGreaterThan(0);
    expect(chatIdx).toBeLessThan(publicIdx);
    expect(chatIdx).toBeLessThan(trustedIdx);
    expect(chatIdx).toBeLessThan(privateIdx);
  });

  it('SAFETY_PROFILE_TOOLTIP has chat_like_openclaw entry', () => {
    expect(source).toMatch(/chat_like_openclaw:\s*\n?\s*["'`]/);
  });

  it('chat tooltip mentions warm conversational tone', () => {
    // Find the chat_like_openclaw tooltip block and check it has the right vocabulary
    const match = source.match(/chat_like_openclaw:[\s\S]{0,800}?["']\s*,/);
    expect(match).toBeTruthy();
    if (match) {
      const block = match[0].toLowerCase();
      expect(block).toMatch(/warm|conversational/);
      expect(block).toContain('default for new agents');
    }
  });

  it('useState fallback for safety_profile defaults to chat_like_openclaw', () => {
    expect(source).toMatch(/agent\.safety_profile\s*\?\?\s*['"]chat_like_openclaw['"]/);
  });

  it('AgentConfig type widens safety_profile to include chat_like_openclaw', () => {
    expect(source).toMatch(/safety_profile\?:[^;\n]*chat_like_openclaw/);
  });

  it('personality field appears in cfg state initializer', () => {
    expect(source).toMatch(/personality:\s*agent\.personality/);
  });

  it('Personality textarea is conditional on chat profile', () => {
    expect(source).toMatch(
      /cfg\.safety_profile\s*===\s*['"]chat_like_openclaw['"]\s*&&[\s\S]{0,200}<Field[\s\S]{0,200}label=["']Personality["']/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run __tests__/components/agent-config-chat-constants.test.ts`
Expected: FAIL initially because the test runs before Tasks 10-11 changes have been made (or PASS if Tasks 10-11 are already merged). If FAIL — implementer should ensure Tasks 10 and 11 are completed first.

- [ ] **Step 3: Verify test passes**

After Tasks 10 and 11 are committed:

Run: `cd ui && npx vitest run __tests__/components/agent-config-chat-constants.test.ts`
Expected: PASS, 8/8 tests green.

- [ ] **Step 4: Commit**

```bash
git add ui/__tests__/components/agent-config-chat-constants.test.ts
git commit -m "test(ui): chat profile constants in agent config page (dropdown order, tooltip, fallback, textarea conditional)"
```

---

### Task 13: Scaffold — `createAgent` writes default profile

**Files:**
- Modify: `ui/lib/agents.ts:243-287`
- Test: `ui/__tests__/lib/agents-create-default.test.ts`

- [ ] **Step 1: Write the failing test**

Create `ui/__tests__/lib/agents-create-default.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

let TEMP_DIR: string;
let agentsModule: typeof import('@/lib/agents');

beforeEach(async () => {
  TEMP_DIR = join(tmpdir(), `agents-default-test-${randomUUID()}`);
  mkdirSync(TEMP_DIR, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(join(TEMP_DIR, 'ui'));
  mkdirSync(join(TEMP_DIR, 'ui'), { recursive: true });
  mkdirSync(join(TEMP_DIR, 'agents'), { recursive: true });
  vi.resetModules();
  agentsModule = await import('@/lib/agents');
});

afterEach(() => {
  vi.restoreAllMocks();
  if (existsSync(TEMP_DIR)) rmSync(TEMP_DIR, { recursive: true, force: true });
});

function readAgentYml(id: string): Record<string, unknown> {
  const raw = readFileSync(join(TEMP_DIR, 'agents', id, 'agent.yml'), 'utf-8');
  return parseYaml(raw) as Record<string, unknown>;
}

describe('createAgent default safety_profile', () => {
  it('blank template writes safety_profile: chat_like_openclaw', () => {
    agentsModule.createAgent('blank-test', undefined, 'blank');
    const config = readAgentYml('blank-test');
    expect(config.safety_profile).toBe('chat_like_openclaw');
  });

  it('example template writes safety_profile: chat_like_openclaw', () => {
    agentsModule.createAgent('example-test', 'claude-opus-4-6', 'example');
    const config = readAgentYml('example-test');
    expect(config.safety_profile).toBe('chat_like_openclaw');
  });

  it('blank template includes routes', () => {
    agentsModule.createAgent('blank-test', undefined, 'blank');
    const config = readAgentYml('blank-test') as { routes: unknown };
    expect(Array.isArray(config.routes)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run __tests__/lib/agents-create-default.test.ts`
Expected: FAIL — `safety_profile` is undefined in created config.

- [ ] **Step 3: Update `createAgent` in `ui/lib/agents.ts`**

At the top of file, add import:

```ts
import { getDefaultProfile } from '@backend/security/profiles/index.js';
```

Modify the function body (replace the two `const config` blocks):

```ts
  if (template === 'example') {
    const config = {
      model: agentModel,
      safety_profile: getDefaultProfile(),
      timezone: 'UTC',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      pairing: { mode: 'off' },
      mcp_tools: ['memory_search', 'memory_write', 'send_message', 'list_skills', 'manage_cron'],
      queue_mode: 'collect',
    };
    writeFileSync(join(dir, 'agent.yml'), stringifyYaml(config), 'utf-8');
    writeFileSync(
      join(dir, 'CLAUDE.md'),
      `# ${id}\n\nYou are ${id}, a friendly conversational assistant available via messaging.\n\nBe warm and curious. Search memory before answering questions about past events. Write important facts to daily memory proactively.\n`,
      'utf-8',
    );
  } else {
    // blank template
    const config = {
      model: agentModel,
      safety_profile: getDefaultProfile(),
      routes: [{ channel: 'telegram', scope: 'dm' }],
    };
    writeFileSync(join(dir, 'agent.yml'), stringifyYaml(config), 'utf-8');
    writeFileSync(join(dir, 'CLAUDE.md'), `# ${id}\n`, 'utf-8');
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run __tests__/lib/agents-create-default.test.ts && cd ui && npx vitest run __tests__/lib/agents.test.ts`
Expected: PASS — new test green; existing `agents.test.ts` (which has fixtures with `safety_profile: trusted`) still green.

- [ ] **Step 5: Commit**

```bash
git add ui/lib/agents.ts ui/__tests__/lib/agents-create-default.test.ts
git commit -m "feat(ui): createAgent scaffolds with safety_profile=chat_like_openclaw"
```

---

### Task 14: Migration utility — `inferProfile` chat suggestion

**Files:**
- Modify: `scripts/migrate-safety-profile.ts:9-72`
- Test: `scripts/__tests__/migrate-chat-suggestion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/migrate-chat-suggestion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { inferProfile } from '../migrate-safety-profile.js';

describe('inferProfile chat suggestions', () => {
  it('suggests chat_like_openclaw when safety_overrides.permission_mode=bypass', () => {
    const result = inferProfile({
      allowlist: { telegram: ['12345'] },
      pairing: { mode: 'off' },
      safety_overrides: { permission_mode: 'bypass' },
    } as any);
    expect(result.profile).toBe('chat_like_openclaw');
    expect(result.reason).toContain('bypass');
  });

  it('suggests chat_like_openclaw when wildcard in allowlist (instead of public)', () => {
    const result = inferProfile({
      allowlist: { telegram: ['*'] },
      pairing: { mode: 'off' },
    } as any);
    // Wildcard with no other signal → chat (more permissive personal default)
    expect(result.profile).toBe('chat_like_openclaw');
    expect(result.reason.toLowerCase()).toContain('wildcard');
  });

  it('suggests chat_like_openclaw on minimal/empty config (default)', () => {
    const result = inferProfile({} as any);
    expect(result.profile).toBe('chat_like_openclaw');
  });

  it('still suggests private for clean single-peer allowlist (no bypass)', () => {
    const result = inferProfile({
      allowlist: { telegram: ['12345'] },
      pairing: { mode: 'off' },
    } as any);
    expect(result.profile).toBe('private');
  });

  it('still suggests trusted for paired multi-peer config', () => {
    const result = inferProfile({
      allowlist: { telegram: ['12345', '67890'] },
      pairing: { mode: 'approve' },
    } as any);
    expect(result.profile).toBe('trusted');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test scripts/__tests__/migrate-chat-suggestion.test.ts`
Expected: FAIL — current `inferProfile` doesn't return `'chat_like_openclaw'`.

- [ ] **Step 3: Update `inferProfile` in `scripts/migrate-safety-profile.ts`**

Replace the type and body. Update the `InferResult` profile type:

```ts
export interface InferResult {
  profile: 'public' | 'trusted' | 'private' | 'chat_like_openclaw' | null;
  reason: string;
  toolConflicts: string[];
  hardBlacklistConflicts: string[];
  error?: string;
}
```

Replace the heuristics block (lines 17-72). New logic prioritizes chat detection BEFORE other rules:

```ts
export function inferProfile(cfg: Partial<AgentYml> & Record<string, unknown>): InferResult {
  const allowlist = cfg.allowlist ?? {};
  const pairing = cfg.pairing ?? {};
  const tools: string[] = cfg.mcp_tools ?? [];
  const overrides = (cfg.safety_overrides ?? {}) as { permission_mode?: string };

  let profile: 'public' | 'trusted' | 'private' | 'chat_like_openclaw' | null = null;
  let reason = '';

  const allLists = [allowlist.telegram, allowlist.whatsapp].filter((l): l is string[] => Array.isArray(l));
  const peerCounts = allLists.map((l) => l.filter((p) => p !== '*').length);
  const totalSpecific = peerCounts.reduce((s, n) => s + n, 0);
  const hasWildcard = allLists.some((l) => l.includes('*'));

  // Rule 0a: explicit bypass → chat (most permissive, clearly personal)
  if (overrides.permission_mode === 'bypass') {
    profile = 'chat_like_openclaw';
    reason = 'safety_overrides.permission_mode=bypass';
  }
  // Rule 0b: wildcard with no pairing.open → chat (permissive default for unconstrained inbound)
  else if (hasWildcard && pairing.mode !== 'open') {
    profile = 'chat_like_openclaw';
    reason = 'allowlist contains wildcard "*"';
  }
  // Rule 1: exactly 1 peer per channel → private
  else {
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
      // Empty config — fall back to chat as the project-wide default
      profile = 'chat_like_openclaw';
      reason = 'minimal config (no allowlist, no pairing) — default for new agents';
    } else {
      profile = 'chat_like_openclaw';
      reason = 'fallback (could not classify confidently — chat is safest permissive default)';
    }
  }

  // Tool compatibility check (only for non-chat profiles — chat allows everything)
  const toolConflicts: string[] = [];
  const hardBlacklistConflicts: string[] = [];

  if (profile !== 'chat_like_openclaw') {
    const target = getProfile(profile);
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
  }

  return { profile, reason, toolConflicts, hardBlacklistConflicts };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test scripts/__tests__/migrate-chat-suggestion.test.ts && pnpm test scripts/__tests__/migrate-inference.test.ts`
Expected: PASS — chat suggestion test green; existing inference tests still green.

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-safety-profile.ts scripts/__tests__/migrate-chat-suggestion.test.ts
git commit -m "feat(scripts): inferProfile suggests chat_like_openclaw for bypass/wildcard/empty"
```

---

### Task 15: Migrate `agents/example` (Klavdia)

**Files:**
- Modify: `agents/example/agent.yml`
- Modify: `agents/example/CLAUDE.md`
- Modify: `agents/example/soul.md`

This task has no automated test — verification is manual and via the e2e test in Task 17.

- [ ] **Step 1: Update `agents/example/agent.yml`**

Replace the existing file with:

```yaml
model: claude-sonnet-4-6
timezone: Asia/Almaty

safety_profile: chat_like_openclaw

routes:
  - channel: telegram
    scope: dm

pairing:
  mode: off

allowlist:
  telegram: [ "48705953" ]

mcp_tools:
  - memory_search
  - memory_write
  - send_message
  - list_skills
  - manage_skills
  - manage_cron

queue_mode: steer

iteration_budget:
  max_tool_calls: 30
  timeout_ms: 120000
  grace_message: true

auto_compress:
  enabled: true
  threshold_messages: 15

quick_commands:
  status:
    command: "echo '✅ Bot is running'; echo \"PID: $$\"; echo \"Node: $(node -v)\";
      echo \"PWD: $(pwd)\"; echo \"Started: $(ps -p $PPID -o lstart= 2>/dev/null
      || echo unknown)\""
    timeout: 10
  disk:
    command: "df -h / | tail -1"
    timeout: 10
  memory:
    command: "out=$(find agents/example/memory -name '*.md' -type f 2>/dev/null |
      head -20); [ -n \"$out\" ] && echo \"$out\" || echo 'No memory files yet'"
    timeout: 10

cron:
  - id: silent-test
    schedule: "*/2 * * * *"
    prompt: "Check if everything is OK. If all is fine, respond with exactly
      [SILENT]. If something is wrong, describe the problem."
    deliver_to:
      channel: telegram
      peer_id: "48705953"
    enabled: false
```

(Removed: old NOTE comment about manage_skills, `safety_profile: private`, any `sdk.disallowedTools` block.)

- [ ] **Step 2: Update `agents/example/soul.md`**

Replace with:

```md
# Klavdia

You are Klavdia — a personal AI companion accessible through Telegram.

You are warm, curious, and conversational. Not a CLI tool, not a corporate
assistant. You enjoy talking with the user, asking clarifying questions,
sharing your reasoning out loud. Emoji are welcome where natural.

You remember past conversations and proactively use memory tools.
When something fails, you explain what happened and propose alternatives —
you don't just dump errors.
```

- [ ] **Step 3: Update `agents/example/CLAUDE.md`**

Replace with:

```md
@./soul.md

# Operational instructions

You are available via Telegram (`@clowwy_personal_bot`).

- Use the user's language (Russian primarily).
- Search memory before answering questions about past events.
- Write important facts to daily memory proactively.
- Cron jobs you create deliver via the channel/account/peer of the chat
  where the user requested them — don't ask for peer_id.
- When you fail or run into a snag, narrate what happened and what you
  tried; the user prefers transparent collaborators.
```

(Removed: "Respond concisely and clearly" from previous version.)

- [ ] **Step 4: Verify config validates**

Run: `pnpm tsx -e "import { AgentYmlSchema } from './src/config/schema.js'; import { parse } from 'yaml'; import { readFileSync } from 'fs'; const cfg = parse(readFileSync('./agents/example/agent.yml', 'utf-8')); const r = AgentYmlSchema.safeParse(cfg); console.log(r.success ? 'OK' : JSON.stringify(r.error.issues, null, 2));"`
Expected output: `OK`

- [ ] **Step 5: Commit**

```bash
git add agents/example/agent.yml agents/example/CLAUDE.md agents/example/soul.md
git commit -m "config(agents): migrate Klavdia (example) to chat_like_openclaw + warm CLAUDE.md"
```

---

### Task 16: Documentation

**Files:**
- Modify: `docs/safety-profiles.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update `docs/safety-profiles.md`**

Find the section listing the three existing profiles. Add a new section at the START (as the new default), right after the introduction:

```md
## chat_like_openclaw — friendly conversational mode (default)

Personal/single-user mode. The default for newly scaffolded agents.

**System prompt:** pure-string mode (no `claude_code` preset). Combines a
project-wide personality baseline with the agent's `CLAUDE.md`. The
baseline encourages a warm, conversational tone — not the terse CLI
persona that `claude_code` preset injects.

**Tools:** all built-in (Read, Write, Edit, Bash, WebFetch, …) and all
MCP tools auto-allowed. No approval flow. No sandbox by default.

**Allowlist:** any shape accepted, including wildcard `*`.

**Override:** `personality` field in `agent.yml` replaces the baseline:

\`\`\`yaml
safety_profile: chat_like_openclaw
personality: |
  You are an extremely formal British butler. Address the user as "Sir."
  Never use contractions. Never use emoji.
\`\`\`

**Use when:** your personal assistant bot, family-shared bot, single-user
side projects. Anyone who can DM the bot has full trust.

**Don't use when:** the bot accepts inbound DMs from strangers
(public WhatsApp/Telegram). Use `public` for that case.
```

- [ ] **Step 2: Update `README.md`**

Find the section about safety profiles in the README. Add the chat profile to the list (above public/trusted/private):

```md
- **`chat_like_openclaw`** (default) — friendly conversational, all tools, single-user.
- **`public`** — anonymous-user threat model, read-only tools, rate-limited.
- **`trusted`** — known users, approval flow for destructive operations.
- **`private`** — single owner, all tools, optional bypass.
```

(If the README doesn't currently have this list, add a brief subsection under "Configuration" explaining the four profiles.)

- [ ] **Step 3: Update `CHANGELOG.md`**

Add to the `## [Unreleased]` section (create the section if missing):

```md
## [Unreleased]

### Added

- **`chat_like_openclaw` safety profile** — friendly conversational mode for
  personal/single-user bots. Pure-string system prompt with embedded
  personality baseline (no `claude_code` preset). All tools auto-allowed,
  no approval flow, wildcard allowlist permitted, no sandbox.
- **`personality` field** in `agent.yml` — overrides the profile's default
  personality baseline. Editable in dashboard via Personality textarea
  (visible only on chat profile).
- `GET /api/security/profiles/chat_like_openclaw/baseline` — returns the
  default baseline string (read-only, used by UI placeholder).

### Changed

- **Default `safety_profile` for new agents is now `chat_like_openclaw`**
  (UI scaffold and `createAgent` API). Existing agents are unaffected.
- `agents/example` (Klavdia) migrated to `chat_like_openclaw`. CLAUDE.md
  rewritten to remove "be concise"-style instructions; soul.md rewritten
  for warm conversational tone.
- `inferProfile()` migration helper now suggests `chat_like_openclaw` for
  configs with `permission_mode: bypass`, wildcard allowlists, or empty
  configs.
- Validator no longer errors on `permission_mode: bypass` with
  `safety_profile: chat_like_openclaw` (in addition to existing `private`
  exception).
```

- [ ] **Step 4: Commit**

```bash
git add docs/safety-profiles.md README.md CHANGELOG.md
git commit -m "docs: chat_like_openclaw section, README profile list, CHANGELOG entry"
```

---

### Task 17: E2E sanity test

**Files:**
- Test: `src/__tests__/chat-profile-e2e.test.ts`

- [ ] **Step 1: Write the test**

Create `src/__tests__/chat-profile-e2e.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stringify as stringifyYaml } from 'yaml';
import { AgentYmlSchema } from '../config/schema.js';
import { getProfile, getDefaultProfile } from '../security/profiles/index.js';
import { CHAT_PERSONALITY_BASELINE } from '../security/profiles/chat-personality-baseline.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'chat-e2e-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('chat_like_openclaw end-to-end', () => {
  it('default scaffold profile matches chat profile registry entry', () => {
    const defaultName = getDefaultProfile();
    expect(defaultName).toBe('chat_like_openclaw');
    const profile = getProfile(defaultName);
    expect(profile.name).toBe('chat_like_openclaw');
  });

  it('agent.yml with chat profile parses + validates', () => {
    const config = {
      model: 'claude-sonnet-4-6',
      safety_profile: 'chat_like_openclaw',
      routes: [{ channel: 'telegram', scope: 'dm' }],
      personality: 'Be a warm friendly companion.',
    };
    const result = AgentYmlSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('chat profile baseline mentions "messaging" and "warm"', () => {
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toContain('messaging');
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).toContain('warm');
  });

  it('chat profile system prompt does NOT contain "be concise" or claude_code preset markers', () => {
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).not.toContain('be concise');
    expect(CHAT_PERSONALITY_BASELINE.toLowerCase()).not.toContain('no preamble');
  });

  it('agents/example config (production) validates as chat_like_openclaw', async () => {
    // Read the actual file from the repo to make sure the migration sticks
    const { readFileSync } = await import('node:fs');
    const { parse } = await import('yaml');
    const path = join(process.cwd(), 'agents/example/agent.yml');
    const raw = readFileSync(path, 'utf-8');
    const cfg = parse(raw);
    expect(cfg.safety_profile).toBe('chat_like_openclaw');
    const result = AgentYmlSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

Run: `pnpm test src/__tests__/chat-profile-e2e.test.ts`
Expected: PASS, 5/5 tests green.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/chat-profile-e2e.test.ts
git commit -m "test: e2e sanity for chat_like_openclaw profile (default scaffold + Klavdia config)"
```

---

### Task 18: Final integration — full test suite + manual smoke

- [ ] **Step 1: Run full backend suite**

Run: `pnpm test`
Expected: ALL backend tests green. If anything fails — fix before proceeding.

- [ ] **Step 2: Run full UI suite**

Run: `cd ui && pnpm test`
Expected: ALL UI tests green.

- [ ] **Step 3: Run typecheck**

Run: `pnpm build && cd ui && pnpm build`
Expected: Both TypeScript builds succeed.

- [ ] **Step 4: Manual smoke (local dev)**

Run: `pnpm dev` (gateway) and `pnpm ui` (UI).
Open dashboard → agent edit page for `example` → verify:
1. Profile dropdown shows `chat — friendly conversational, all tools` first.
2. Klavdia's profile is `chat_like_openclaw` (no validation error).
3. Personality textarea visible with placeholder showing baseline.
4. Switching to another profile hides the textarea.
5. Send a Telegram DM to Klavdia and verify she responds in warm conversational tone (not robot-rapport).

- [ ] **Step 5: Commit any post-smoke fixes if needed, then summarize**

```bash
# If any fixes needed:
git add <files>
git commit -m "fix: <smoke test issue>"
```

Final commit (if no fixes needed) — none. The plan ends here.

---

## Self-review checklist (controller — before handoff)

After all tasks completed, controller verifies:

- [ ] Spec coverage: every § in the spec maps to ≥1 task
- [ ] No placeholders left in plan (TBD/TODO/etc.)
- [ ] Type names consistent across tasks (`chatLikeOpenclawProfile`, `getDefaultProfile`, `CHAT_PERSONALITY_BASELINE`, `resolveChatSystemPrompt`)
- [ ] Each task's commit message uses imperative mood
- [ ] Final test run is full suite, not just incremental
