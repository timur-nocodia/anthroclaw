# System-prompt resolution — Design Spec

**Status:** Draft for review
**Branch:** `feat/v0.9-system-prompt-fix`
**Date:** 2026-05-05
**Target release:** v0.9.0 (first PR of the release)
**Tracks tasks:** #72 (non-chat profiles read CLAUDE.md) + #73 (`@-import` resolver)

## Goal

After this release, every agent's `agent CLAUDE.md` (and every `@./...` file it imports) is the canonical body of the system prompt the SDK sees, regardless of `safety_profile`. The model receives the agent's actual instructions — Amina sees SOUL.md / IDENTITY.md, Klavdia sees her operational rules — instead of a 6-line generic placeholder or a literal `@./SOUL.md` string the model can't follow.

This release closes a pre-existing two-part bug discovered while investigating the Amina-hallucination incident on 2026-05-04:

1. **`safety_profile=public|trusted|private` agents never see their own CLAUDE.md.** `src/sdk/options.ts:91-102` only calls `resolveChatSystemPrompt(agent)` when `profile.name === 'chat_like_openclaw'`. All other profiles pass `profile.systemPrompt.text` (a generic 6-line description) or a `claude_code` preset — the agent's authored instructions are simply absent from the prompt.
2. **`resolveChatSystemPrompt` performs a raw `readFileSync`** of `agent/CLAUDE.md` and does not resolve `@./...` import lines. Production CLAUDE.md files are typically 5–10 lines of `@./SOUL.md`, `@./IDENTITY.md`, etc. — the Claude Code interactive CLI's native composition feature. Through the SDK API those lines pass to the model as **literal text** like `@./SOUL.md`. The model has no file-reader and cannot follow them, so it ignores them and falls back to the personality baseline.

In production this combined into the visible failure: `leads_agent` was set to `safety_profile: public` since 2026-04-27 *and* its CLAUDE.md was made of `@-imports`, so for ~7 days every customer dialog ran with **none** of the agent's authored rules. The hotfix on 2026-05-04 swapped the profile to `chat_like_openclaw` *and* replaced CLAUDE.md with a manually inlined 318-line concatenation. This is the permanent fix for both halves.

## Motivation

Concrete failures with citations:

- `src/sdk/options.ts:47-65` — `resolveChatSystemPrompt`:
  ```ts
  const claudeMdPath = join(agent.workspacePath, 'CLAUDE.md');
  let claudeMd = '';
  if (existsSync(claudeMdPath)) {
    try { claudeMd = readFileSync(claudeMdPath, 'utf-8').trim(); } catch { claudeMd = ''; }
  }
  ```
  Plain `readFileSync`, no import resolution. Production CLAUDE.md files like:
  ```
  @./SOUL.md
  @./IDENTITY.md
  @./TOOLS.md
  ```
  are passed as-is, and the model receives literal `@./SOUL.md` strings.

- `src/sdk/options.ts:91-102` — only `chat_like_openclaw` calls the resolver:
  ```ts
  if (profile.name === 'chat_like_openclaw') {
    systemPrompt = resolveChatSystemPrompt(agent);
  } else if (profile.systemPrompt.mode === 'string') {
    systemPrompt = profile.systemPrompt.text;
  } else {
    systemPrompt = { type: 'preset', preset: ..., excludeDynamicSections: ... };
  }
  ```
  `public.ts`'s `PUBLIC_SYSTEM_PROMPT` is six lines beginning with "You are a public-facing assistant on {channel}" — no agent-specific instructions reach the model.

Today's hotfix on prod (4 agents, 1167 lines of CLAUDE.md inlined by hand) is a band-aid. Every future agent created with imports is silently broken under any non-chat profile. The structural fix is: the resolver runs for *all* profiles, and it understands `@-imports`.

## Non-goals

- **Not changing how Claude Code interactive CLI resolves imports.** We mirror its observable behaviour for files we read here, but we don't share its implementation or guarantee identical edge-case semantics. We document our exact rules in this spec.
- **Not adding nested-frontmatter or templating support.** No Jinja-style tags, no env-var interpolation, no Markdown transformation. Pure include of file body, recursive.
- **Not changing profile policy.** `settingSources`, `hardBlacklist`, `allowsPluginTools`, `permissionFlow`, sandbox defaults — all unchanged. This release only changes what *body* of `systemPrompt` the SDK gets.
- **Not changing `chat_like_openclaw` behaviour outside of import resolution.** Personality baseline + CLAUDE.md continues to be the structure; CLAUDE.md content is now pre-resolved through the importer.
- **Not adding a "claude_code preset + agent instructions concatenated" mode for `private`.** Private uses preset mode and we will use the SDK's `append` field — no string-mode fallback.
- **Not removing the production hotfixes in this PR.** We ship the structural fix first, validate on prod, then revert hotfixes (separate commit / separate session).

## High-level architecture

```
┌────────────────────────────────────────────────────────────────┐
│ Gateway — buildSdkOptions(agent, ...)                          │
│                                                                │
│  resolveAgentSystemPrompt(agent, profile)                      │
│    │                                                           │
│    │ 1. loadResolvedAgentClaudeMd(workspaceRoot)               │
│    │      ├ readFile(agent/CLAUDE.md)                          │
│    │      └ resolveImports(content, fromFile, opts) ← recursive │
│    │                                                           │
│    └─→ profile-aware composition:                              │
│         chat_like_openclaw  → personality + CLAUDE.md          │
│         public/trusted      → profile.text + CLAUDE.md         │
│         private (preset)    → { type: 'preset', append: CLAUDE.md } │
│                                                                │
│  options.systemPrompt = <result>                               │
└────────────────────────────────────────────────────────────────┘
```

Two new modules + one modified module:

```
src/sdk/
  system-prompt.ts                          # NEW — resolver + composer
  __tests__/system-prompt.test.ts           # NEW — resolver unit tests
  __tests__/system-prompt-composer.test.ts  # NEW — profile-aware composition tests
  options.ts                                 # MODIFIED — wire the new helpers
  __tests__/options.test.ts                  # MODIFIED — assertions for all 4 profiles
```

## Resolver — exact rules

### Import-line syntax

A line is an import iff it matches `^[ \t]*@(\S+)[ \t]*$`. Examples:

| Line | Import? | Path |
|------|---------|------|
| `@./SOUL.md` | yes | `./SOUL.md` |
| `  @./SOUL.md  ` | yes | `./SOUL.md` |
| `@SOUL.md` | yes | `SOUL.md` |
| `@subdir/file.md` | yes | `subdir/file.md` |
| `# @./SOUL.md` | **no** (leading `#`) | — |
| `Read @./file.md for context` | **no** (not whole line) | — |
| `@./a.md @./b.md` | **no** (two paths) | — |
| `@/etc/passwd` | matches regex, but path-policy rejects (see below) |
| `@http://example.com` | matches regex, but path-policy rejects |

Rationale: matching exactly one whole-line `@<path>` keeps the rule simple, matches what production CLAUDE.md files actually contain, and avoids accidentally rewriting prose that mentions `@-something` inside a sentence.

### Path resolution

Given an import line `@<path>` inside file `from`:

1. **Reject absolute paths** (`@/...` or paths with a `:` drive on Windows). Keep the line as-is, log warning. Rationale: defense against `@/etc/passwd` style probes; agents should only refer to files inside their own workspace.
2. **Reject URL-like paths** (`http://`, `https://`, `file://`). Keep as-is, log warning.
3. **Resolve relative to `dirname(from)`** using `path.resolve`.
4. **Compute realpath** (`fs.realpathSync.native` if file exists). This collapses symlinks.
5. **Compute `path.relative(workspaceRoot, realpath)`**. If it starts with `..` or `path.isAbsolute()` returns true (cross-volume), the import escaped the workspace — keep the `@<path>` line as-is, log warning.
6. **If the file does not exist**, keep the `@<path>` line as-is, log info (not error — common during agent authoring).
7. **Cap individual file size at 1 MB.** If larger, keep `@<path>` as-is, log warning.

### Recursion

- Each invocation tracks a `visited: Set<string>` of realpath'd absolute paths.
- Before recursing into an imported file, check `visited.has(realpath)`:
  - If yes → cycle. Drop the import line entirely (no inline content). Log info.
  - If no → add to visited, read, recurse.
- After recursion returns, **do not remove from visited** (we want to inline a given file at most once even if it is referenced from multiple places — the second reference is dropped silently). Rationale: prevents prompt explosion from diamond imports; matches Claude Code's de-dupe behaviour.
- **Max depth = 5.** If exceeded, drop the import line, log warning.

### Output format

Imported content is inlined verbatim, preceded by a separator and followed by a trailing newline:

```
<line before>
<<< inlined content of @./SOUL.md, with @-imports recursively resolved >>>
<line after>
```

No extra header, no comments inserted. Just the file contents in place of the `@<path>` line. Imports inside the imported file are resolved before inlining.

## Composer — profile-aware system prompt assembly

```ts
function composeSystemPrompt(agent: Agent, profile: SafetyProfile): Options['systemPrompt'] {
  const claudeMd = loadResolvedAgentClaudeMd({ workspaceRoot: agent.workspacePath });

  if (profile.name === 'chat_like_openclaw') {
    const personality = (agent.config.personality?.trim()) || CHAT_PERSONALITY_BASELINE;
    return claudeMd ? `${personality}\n\n─────────\n\n${claudeMd}` : personality;
  }

  if (profile.systemPrompt.mode === 'string') {
    const base = profile.systemPrompt.text;
    return claudeMd ? `${base}\n\n─────────\n\n${claudeMd}` : base;
  }

  // preset mode (private uses claude_code preset)
  return {
    type: 'preset',
    preset: profile.systemPrompt.preset,
    excludeDynamicSections: profile.systemPrompt.excludeDynamicSections,
    ...(claudeMd ? { append: claudeMd } : {}),
  };
}
```

The `─────────` separator matches the existing `chat_like_openclaw` style, kept for visual consistency in transcripts.

For preset mode we use the SDK's `append` field (`Options.systemPrompt.append`, confirmed present in `@anthropic-ai/claude-agent-sdk` `sdk.d.ts`). This appends the agent's CLAUDE.md after the `claude_code` preset, preserving the preset's tool docs and dynamic sections.

## Logging

Use the existing module logger at `src/logger.ts`. New log calls:

| Level | Event |
|-------|-------|
| `warn` | Path escapes workspace, absolute path, URL path, file > 1 MB, max depth exceeded |
| `info` | File missing (`@./X.md` where X.md doesn't exist), cycle detected (skipped second occurrence) |
| `debug` | Successful import resolution per file (path + bytes) |

Each warn/info entry includes: `agent_id`, `from_file` (relative to workspace), `import_path`, and a short reason code (`escape` / `absolute` / `url` / `oversize` / `depth` / `missing` / `cycle`).

## Migration / compatibility

- **`chat_like_openclaw` agents**: previously, CLAUDE.md was inlined raw; now `@-imports` resolve. For an agent whose CLAUDE.md is plain text without imports, output is byte-identical. For an agent whose CLAUDE.md is `@./SOUL.md` and friends, output now includes the resolved bodies — this is the intended fix.
- **`public` / `trusted` / `private` agents**: previously, agent CLAUDE.md was ignored entirely. Now it's appended to the profile prompt. Existing agents on these profiles will start receiving their own instructions, which is the goal but is a behaviour change — operators must verify their CLAUDE.md is clean (no leaked credentials, no developer-only notes).
- **Production hotfixes**: leads_agent / timur_agent / content_sm_building have manually-inlined CLAUDE.md right now. After this PR ships and is verified, those will be reverted to `@-imports` form in a follow-up.

Changelog entry should call out the behaviour change for non-chat profiles explicitly.

## Test plan

### Unit — `src/sdk/__tests__/system-prompt.test.ts` (resolver)

1. No `CLAUDE.md` → returns empty string.
2. CLAUDE.md without imports → returns trimmed content unchanged.
3. CLAUDE.md with one `@./X.md` import → X.md inlined.
4. Recursive: A imports B, B imports C → all inlined depth-first.
5. Cycle: A imports B, B imports A → first A inlined, second A reference dropped silently.
6. Diamond: A imports B and C, both B and C import D → D inlined under B, dropped under C (de-dupe).
7. Max depth exceeded (depth 6 chain) → terminates, warning logged, deepest import line dropped.
8. Missing file `@./nonexistent.md` → line preserved as-is.
9. Path escape `@../../etc/passwd` → line preserved, warning logged.
10. Absolute path `@/etc/passwd` → line preserved, warning logged.
11. URL-like `@http://evil.example.com/x` → line preserved, warning logged.
12. Symlink-escape: `agent/link.md → /etc/passwd` then `@./link.md` → line preserved, warning logged.
13. File > 1 MB → line preserved, warning logged.
14. Whitespace variations (`  @./X.md  `, CRLF endings) → resolved correctly.
15. Non-import lines that mention `@` (`Use @username syntax`, `# @./X.md`) → preserved unchanged.
16. Empty imported file → inlined as empty (the `@<path>` line is replaced with nothing).

### Unit — `src/sdk/__tests__/system-prompt-composer.test.ts` (composer)

17. `chat_like_openclaw` + agent with CLAUDE.md → personality + CLAUDE.md.
18. `chat_like_openclaw` + agent without CLAUDE.md → personality only.
19. `chat_like_openclaw` + agent with custom `personality` field → custom + CLAUDE.md.
20. `public` + CLAUDE.md → public.text + separator + CLAUDE.md.
21. `public` + no CLAUDE.md → public.text only.
22. `trusted` + CLAUDE.md → trusted.text + separator + CLAUDE.md (currently trusted is preset; **see open question below — verify**).
23. `private` + CLAUDE.md → `{ type: 'preset', preset: 'claude_code', append: CLAUDE.md, excludeDynamicSections: false }`.
24. `private` + no CLAUDE.md → `{ type: 'preset', preset: 'claude_code', excludeDynamicSections: false }` (no `append`).

### Integration — `src/sdk/__tests__/options.test.ts`

25. `buildSdkOptions` with each of the 4 profiles, asserts the `systemPrompt` field has the agent's authored content (or its `append` for preset mode).

### Property test (optional, nice-to-have)

26. Random tree of imports up to depth 5 with cycles inserted at random points → resolver always terminates and produces deterministic output.

## Acceptance criteria

- [ ] All 4 profiles include the agent's CLAUDE.md (or its `append` equivalent) in the SDK system prompt.
- [ ] `@-imports` are resolved recursively with cycle detection and max depth.
- [ ] Path traversal, absolute paths, URLs, oversized files, symlink-escapes are rejected with warnings.
- [ ] Existing `chat_like_openclaw` agents without imports produce byte-identical output to v0.8.0.
- [ ] All 1771 existing tests still pass; ≥ 26 new tests pass.
- [ ] Integration smoke test: spawn one agent under each profile, capture the actual `systemPrompt` passed to SDK, assert agent-specific content present.

## Open questions for review

1. **Trusted profile is currently `preset` mode** (`src/security/profiles/trusted.ts:24`). Should trusted also use `append`? Spec test #22 above assumes string mode but trusted is actually preset. Likely answer: yes, use `append` for both `trusted` and `private`. This is cleaner — the only string-mode profile becomes `public`. **Decision needed before implementation.**
2. **Should the importer support `@<path>#section` anchor syntax?** Claude Code does. We don't, in this release — simpler. Open for v0.10 if requested.
3. **Should we cache resolved CLAUDE.md across query() calls?** Reading and resolving on every query is fine for the scale we're at (≤ tens of QPS). Cache invalidation would tie into the existing chokidar watcher. **Defer to follow-up PR if profiling shows hot-path cost.**
