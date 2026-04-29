# Safety Profiles

Every agent in `agents/<id>/agent.yml` MUST declare a `safety_profile`. This determines which tools the agent can use, how the system prompt is built, and how destructive operations are gated.

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

```yaml
safety_profile: chat_like_openclaw
personality: |
  You are an extremely formal British butler. Address the user as "Sir."
  Never use contractions. Never use emoji.
```

**Use when:** your personal assistant bot, family-shared bot, single-user
side projects. Anyone who can DM the bot has full trust.

**Don't use when:** the bot accepts inbound DMs from strangers
(public WhatsApp/Telegram). Use `public` for that case.

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
- `Bash`, `Write`, `Edit`, `MultiEdit`, `WebFetch`, `manage_skills`, `access_control` are HARD_BLACKLIST in `public`
- `manage_skills`, `access_control`, `Bash`, `NotebookEdit` are HARD_BLACKLIST in `trusted`
- Nothing is HARD_BLACKLIST in `private`

## See also

- `docs/superpowers/specs/2026-04-29-safety-profiles-design.md` — full design rationale
- `src/security/builtin-tool-meta.ts` — built-in tool classification
- `src/security/profiles/` — profile definitions
