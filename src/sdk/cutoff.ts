/**
 * Capability cutoff — foundation of agent isolation.
 *
 * This module gates which built-in tools and env vars are visible to an
 * agent's SDK process. A leak here means another agent (or a customer
 * reaching an agent through prompt injection) can read the operator's
 * credentials.
 *
 * Changes require security review.
 *
 * Policy:
 *   - Tool whitelist is conservative: only tools whose blast radius is
 *     bounded by the agent's filesystem sandbox (cwd) are allowed by
 *     default. Network-egress tools (WebFetch, WebSearch) and arbitrary
 *     code execution helpers (Task, NotebookEdit) are deliberately
 *     excluded.
 *   - Env scrubbing matches case-insensitively. Both an explicit denylist
 *     of full names and a prefix denylist are applied; any var matching
 *     either is removed.
 *   - Prefix list intentionally covers entire credential namespaces
 *     (e.g. AWS_, GCP_) — non-secret config like AWS_REGION is also
 *     stripped. If an agent legitimately needs such a value, expose it
 *     via that agent's `external_mcp_servers` configuration, not env.
 *   - Some entries in ENV_VAR_DENYLIST are also covered by a prefix in
 *     ENV_VAR_DENYLIST_PREFIXES. The redundancy is intentional
 *     defence-in-depth: a typo or accidental edit to the prefix list
 *     still leaves the exact-name entry as a backstop.
 */
import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';

/**
 * Built-in tools agents may use by default. Excludes WebFetch, WebSearch,
 * Task, NotebookEdit, KillShell, BashOutput — those require explicit
 * per-agent opt-in.
 */
export const AGENT_BUILTIN_TOOL_WHITELIST = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'TodoWrite',
] as const;

/**
 * Exact-match env-var denylist. Names matched case-insensitively.
 * Some entries are also covered by ENV_VAR_DENYLIST_PREFIXES — kept here
 * as defence-in-depth (a typo in the prefix list still catches these).
 */
export const ENV_VAR_DENYLIST = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CALENDAR_ID',
  'GMAIL_OAUTH_TOKEN',
  'NOTION_API_KEY',
  'LINEAR_API_KEY',
  'CLAUDE_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROCLAW_MASTER_KEY',
  // Database / cache connection strings (audit: may carry embedded creds)
  'DATABASE_URL',
  'REDIS_URL',
  'MONGO_URL',
  'MONGODB_URI',
  'POSTGRES_URL',
  'MYSQL_URL',
  // Filesystem paths the agent must not be allowed to dictate
  'OC_AGENTS_DIR',
  'OC_DATA_DIR',
  // Project-internal secrets discovered by audit (process.env.* grep)
  'JWT_SECRET',
  'ADMIN_PASSWORD',
] as const;

/**
 * Env-var prefix denylist. Prefixes matched case-insensitively against
 * the upper-cased var name.
 */
export const ENV_VAR_DENYLIST_PREFIXES = [
  // LLM / Anthropic stack
  'ANTHROPIC_',
  'CLAUDE_',
  'OPENAI_',
  // Cloud providers
  'GOOGLE_',
  'AWS_',
  'GCP_',
  'AZURE_',
  'CLOUDFLARE_',
  'CF_',
  'DO_',
  'DIGITALOCEAN_',
  // Secrets stores / source control / CI
  'VAULT_',
  'GITHUB_',
  'GH_',
  'NPM_',
  'BUILDKITE_',
  'CIRCLE_',
  'SSH_',
  // Productivity SaaS
  'NOTION_',
  'LINEAR_',
  'GMAIL_',
  'SLACK_',
  'DISCORD_',
  // Project-internal namespaces (covers everything we ship under these
  // prefixes — ANTHROCLAW_*, OPENCLAW_*, etc.)
  'ANTHROCLAW_',
  'OPENCLAW_',
  // Channel adapters used by this project
  'TELEGRAM_',
  'WHATSAPP_',
  'BAILEYS_',
  // Search / transcription / ML providers used by built-in tools
  'BRAVE_',
  'EXA_',
  'ASSEMBLYAI_',
  'HF_',
  'HUGGINGFACE_',
  // Payments / messaging
  'STRIPE_',
  'TWILIO_',
  // BaaS
  'SUPABASE_',
  'FIREBASE_',
  // Observability
  'SENTRY_',
  'DATADOG_',
  'DD_',
] as const;

const DENY_SET: ReadonlySet<string> = new Set(ENV_VAR_DENYLIST);

/**
 * Filter env so secrets and operator credentials are not visible to the
 * agent's SDK process. Removes any var whose name (upper-cased) is in
 * ENV_VAR_DENYLIST or starts with any entry in ENV_VAR_DENYLIST_PREFIXES.
 * Drops keys with undefined values.
 */
export function scrubAgentEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    const K = k.toUpperCase();
    if (DENY_SET.has(K)) continue;
    if (ENV_VAR_DENYLIST_PREFIXES.some((p) => K.startsWith(p))) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Compose two CanUseTool gates. `upstream` runs first; if it returns
 * anything other than 'allow' (deny, ask, etc.) that result is returned
 * verbatim and `cutoff` is not consulted. Otherwise `cutoff` runs and
 * its result is returned.
 *
 * Used by the cutoff layer to chain a user-supplied gate (if any) with
 * the cutoff's own runtime check; both must allow for a tool to fire.
 */
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
