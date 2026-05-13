/**
 * Blocklist for `mcp__claude_ai_*` tools that leak into agent context via the
 * operator's Claude Code subscription OAuth scope (`user:mcp_servers`).
 *
 * Problem (issue #71): when AnthroClaw boots its agents through a Claude Code
 * subscription auth, the SDK process inherits the user's claude.ai-attached
 * MCP servers (Gmail, Linear, Notion, ...). Their tool names appear in the
 * model's deferred-tool announcement even when `settingSources: []` and
 * `enabledMcpjsonServers: []` are forced — the names come from the OAuth
 * token's `user:mcp_servers` scope, not from any settings file.
 *
 * The existing capability cutoff (`agentToolGate`) already denies execution
 * — but the model still SEES the names and confidently advertises Gmail/
 * Linear/etc. integrations it cannot actually call. Hallucinated promises
 * are the user-visible bug.
 *
 * Fix: strip the names from the model's context via three native SDK options
 * (all documented, no runtime patching):
 *
 *   1. `Options.disallowedTools` — enumerate full tool names. SDK doc: "These
 *      tools will be removed from the model's context and cannot be used."
 *
 *   2. `Options.settings.permissions.deny` — wildcard permission rules. CC
 *      permission-rule syntax supports `mcp__<server>` (whole server) and
 *      `mcp__<server>__<tool>` (specific tool). We add per-server entries.
 *
 *   3. `Options.settings.deniedMcpServers` — per-server denial entries.
 *
 * Layering all three gives defence-in-depth: any one of them honored by the
 * runtime closes the leak; the canUseTool cutoff remains as final backstop.
 *
 * Server list snapshot
 * ---------------------
 *
 * `CLAUDE_AI_KNOWN_SERVERS` is a snapshot of server names observed in prod
 * SDK transcripts (2026-05-14). When the operator adds a new integration on
 * claude.ai (e.g. a Composio sub-app), its server name appears here too with
 * `claude_ai_` prefix. The wildcard rule in `permissions.deny` catches new
 * servers without code change IF the runtime honors patterns at the server
 * level; otherwise extend this list.
 *
 * Refresh procedure: tail SDK transcripts on prod and re-extract:
 *   ssh root@prod 'docker exec anthroclaw-app-1 sh -c \
 *     "cat /home/node/.claude/projects/-app-agents-*\/*.jsonl | \
 *      grep -oE \"mcp__claude_ai_[A-Za-z_0-9]+__[A-Za-z_0-9]+\" | \
 *      sort -u"' | sed -E 's/^mcp__claude_ai_(.+)__[A-Za-z][a-zA-Z_0-9]*$/\1/' \
 *   | sort -u
 */

/**
 * Known `claude_ai_*` MCP server names from the operator's subscription.
 *
 * Each name is a server suffix — the full MCP tool name format is
 * `mcp__claude_ai_<server>__<tool>`. Lowercase variants (`composio` vs
 * `Composio`) appear in transcripts and are intentionally listed separately:
 * the OAuth-injected server registry is case-sensitive.
 */
export const CLAUDE_AI_KNOWN_SERVERS: readonly string[] = [
  'Academy3',
  'Canva',
  'Cloudflare_Developer_Platform',
  'Cloudflare_Developer_Platform_2',
  'Cloudinary',
  'Composio',
  'composio',
  'Exa',
  'Excalidraw',
  'Figma',
  'Gamma',
  'Gmail',
  'Google_Calendar',
  'Google_Drive',
  'Linear',
  'Meta_Ads',
  'Miro',
  'Netlify',
  'Notion',
  'Pipeboard_Meta_Ads_MCP',
  'Postmypost',
  'Spotify',
  'Vercel',
];

/**
 * Permission-rule strings for `Options.settings.permissions.deny`. Claude
 * Code permission-rule syntax supports:
 *   - `Bash`            — entire tool
 *   - `Bash(git *)`     — tool with argument matcher
 *   - `mcp__server`     — MCP server (all tools)
 *   - `mcp__server__t`  — specific MCP tool
 *
 * Wildcard support on server prefix (`mcp__claude_ai_*`) is undocumented but
 * included as belt-and-suspenders: if the runtime honors it, no enumeration
 * is needed for forward-compatibility; if not, the per-server rules below
 * still cover the known set.
 */
export function buildClaudeAiDenyRules(): string[] {
  return [
    'mcp__claude_ai_*',
    ...CLAUDE_AI_KNOWN_SERVERS.map((s) => `mcp__claude_ai_${s}`),
  ];
}

/**
 * `Options.settings.deniedMcpServers` entries. One per known server.
 *
 * The denylist takes precedence over the allowlist, so even if `user:mcp_servers`
 * OAuth scope brings the server in, this entry blocks it at the SDK's
 * MCP-server-attachment layer.
 */
export function buildClaudeAiDeniedMcpServers(): Array<{ serverName: string }> {
  return CLAUDE_AI_KNOWN_SERVERS.map((s) => ({ serverName: `claude_ai_${s}` }));
}

/**
 * Returns true if a tool name belongs to the OAuth-injected claude.ai server
 * namespace. Used by tests and any per-call gate that wants to fail fast
 * on a leaked name.
 */
export function isClaudeAiMcpToolName(name: string): boolean {
  return name.startsWith('mcp__claude_ai_');
}
