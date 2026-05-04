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
import type { CanUseTool, Options as SdkOptions } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../agent/agent.js';
import { agentWorkspaceDir } from '../agent/sandbox/agent-workspace.js';
import { logger } from '../logger.js';

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
 * Compose two CanUseTool gates. `upstream` runs first; if it returns a
 * non-`'allow'` result (the SDK's `PermissionResult` is `'allow' | 'deny'`)
 * that result is returned verbatim and `cutoff` is not consulted. Otherwise
 * `cutoff` runs and its result is returned.
 *
 * `updatedInput` threading. When upstream allows with an `updatedInput`
 * (e.g. a user-supplied redaction layer), that value is the effective input
 * the tool will receive — so it MUST be what `cutoff` inspects. The
 * composition therefore passes `upRes.updatedInput ?? input` into `cutoff`,
 * and propagates upstream's `updatedInput` if `cutoff` allows without
 * supplying its own:
 *   - cutoff allow with own `updatedInput` → cutoff's wins (cutoff has final say)
 *   - cutoff allow without `updatedInput`, upstream had one → upstream's preserved
 *   - cutoff allow, neither side supplied `updatedInput` → no `updatedInput`
 *
 * Used by the cutoff layer to chain a user-supplied gate (if any) with
 * the cutoff's own runtime check; both must allow for a tool to fire.
 */
export function composeToolGates(
  upstream: CanUseTool | undefined,
  cutoff: CanUseTool,
): CanUseTool {
  return async (toolName, input, ctx) => {
    let effectiveInput = input;
    let upstreamUpdatedInput: Record<string, unknown> | undefined;
    if (upstream) {
      const upRes = await upstream(toolName, input, ctx);
      if (upRes.behavior !== 'allow') return upRes;
      if (upRes.updatedInput !== undefined) {
        upstreamUpdatedInput = upRes.updatedInput;
        effectiveInput = upRes.updatedInput;
      }
    }
    const cutRes = await cutoff(toolName, effectiveInput, ctx);
    if (
      cutRes.behavior === 'allow'
      && cutRes.updatedInput === undefined
      && upstreamUpdatedInput !== undefined
    ) {
      return { ...cutRes, updatedInput: upstreamUpdatedInput };
    }
    return cutRes;
  };
}

/**
 * Compute the list of tool names an agent is permitted to invoke. Combines:
 *   1. The conservative built-in whitelist (Read/Write/Edit/Bash/Glob/Grep/TodoWrite).
 *   2. The agent's declared in-process MCP tools (bare names from
 *      `agent.config.mcp_tools`). At runtime `canUseTool` only ever sees
 *      the prefixed form `mcp__<server>__<tool>`, so these bare names are
 *      not consulted by `agentToolGate`'s exact-name set in the normal
 *      runtime path. They are kept here intentionally as a public-API
 *      affordance: callers using `buildAllowedToolNames` to clamp the SDK
 *      option `allowedTools` (belt-and-suspenders) need bare names because
 *      the SDK matches `allowedTools` against both bare and prefixed forms
 *      depending on the surface. Removing them would silently break that
 *      clamp pattern.
 *   3. A `mcp__<agent.mcpServer.name>__*` glob — the agent's own in-process
 *      SDK MCP server (created by `createSdkMcpServer`) exposes its tools
 *      to the model under this prefix. Without this glob the model would be
 *      blocked from calling its own declared tools at runtime, since
 *      `canUseTool` receives the prefixed form `mcp__<server>__<tool>`.
 *   4. One `mcp__<server>__*` glob per entry in `agent.config.external_mcp_servers`.
 *      External servers are out-of-process, so the gateway has no a-priori knowledge
 *      of which tool names they expose; we permit any tool prefixed for that server.
 *
 * Used by `agentToolGate` for runtime enforcement. Note: the SDK option
 * `allowedTools` is NOT set from this list by `applyCutoffOptions` — the
 * cutoff enforces capability via `canUseTool` instead, leaving upstream
 * `allowedTools` untouched. Callers may use this helper for diagnostics
 * or for an additional `allowedTools` clamp when they want belt-and-
 * suspenders.
 */
export function buildAllowedToolNames(agent: Agent): string[] {
  const names: string[] = [...AGENT_BUILTIN_TOOL_WHITELIST];
  for (const t of agent.config.mcp_tools ?? []) names.push(t);
  // The agent's own in-process SDK MCP server (createSdkMcpServer) prefixes
  // every tool it exposes with `mcp__<server-name>__`. Allow that whole
  // namespace; the SDK has already restricted what tools the server publishes
  // to those declared by the agent (`agent.tools`).
  const ownServerName = agent.mcpServer?.name;
  if (ownServerName) {
    names.push(`mcp__${ownServerName}__*`);
  }
  for (const serverName of Object.keys(agent.config.external_mcp_servers ?? {})) {
    names.push(`mcp__${serverName}__*`);
  }
  return names;
}

/**
 * Build a `CanUseTool` gate that allows only tools an agent has declared
 * (per `buildAllowedToolNames`). Anything else is denied with a stable
 * `decisionReason: { type: 'other', reason: 'capability_cutoff' }` so
 * downstream telemetry / hook listeners can identify cutoff-driven blocks
 * distinctly from user permission denials.
 */
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
      { agentId: agent.id, toolName, sessionId: (ctx as Record<string, unknown> | undefined)?.sessionId },
      'capability-cutoff: tool blocked at runtime',
    );
    return {
      behavior: 'deny',
      message: `Tool "${toolName}" is not declared in this agent's capabilities. Use only the tools listed in your system prompt.`,
      decisionReason: { type: 'other', reason: 'capability_cutoff' },
    };
  };
}

/**
 * Apply capability-cutoff hardening to an SDK Options object. This is the
 * ground-truth enforcement layer — it runs after `buildSdkOptions` has
 * computed profile-derived options, and overrides anything that could
 * leak operator capabilities out to an agent's SDK process.
 *
 * What it forces (overriding upstream values):
 *   - `enabledMcpjsonServers: []` — no .mcp.json server can attach.
 *   - `settingSources: []` — ignore user/project/managed Claude settings,
 *     including any inherited MCP servers, allowed tools, or skill packs.
 *   - `additionalDirectories: []` — agent process gets only its own
 *     workspace cwd; no upward path access.
 *   - `cwd: agentWorkspaceDir(agent.id)` — canonical agent workspace,
 *     resolved independently of the loader's `agent.workspacePath` so a
 *     loader regression cannot escape cutoff. The agent-id regex in
 *     `agent-workspace.ts` rejects path-traversal attempts.
 *   - `env: scrubAgentEnv(base.env ?? process.env)` — strip operator
 *     credentials and provider API keys before they reach the SDK
 *     process.
 *   - `canUseTool: composeToolGates(base.canUseTool, agentToolGate(agent))`
 *     — runtime gate denying any tool the agent has not declared.
 *
 * What it does NOT touch (passes through verbatim):
 *   - `mcpServers` — `buildSdkOptions` already restricts this to
 *     `agent.mcpServer` plus the agent's declared `external_mcp_servers`,
 *     which is itself cutoff-compliant. Replacing this would break the
 *     agent's in-process tools (memory_search, send_message, etc.).
 *   - `allowedTools` — left to upstream (`buildAllowedTools(agent, ...)`).
 *     The cutoff enforces capability at runtime via `canUseTool`; an
 *     additional clamp on `allowedTools` would be redundant here and
 *     would risk dropping legitimate tool names unrelated to capability
 *     (e.g. tool aliases the SDK introduces). Auditors who want a
 *     belt-and-suspenders intersection can compose `buildAllowedToolNames`
 *     into `allowedTools` themselves at call sites.
 *
 * Idempotent: applying twice produces the same forced fields and an
 * equivalently-composed `canUseTool` (the second pass wraps the first
 * pass's already-composed gate; runtime semantics are identical).
 */
export function applyCutoffOptions(base: SdkOptions, agent: Agent): SdkOptions {
  // `enabledMcpjsonServers` is not declared on the top-level SDK `Options`
  // type — it is consumed via `settingSources` when reading project / user
  // .mcp.json files. We force `settingSources: []` below, which already
  // neutralizes that discovery path. Setting `enabledMcpjsonServers: []`
  // here is defence-in-depth for any future SDK version that surfaces
  // this field at the top level; today it is a noop. Cast bypasses the
  // missing-key check on the current Options type.
  const out = {
    ...base,
    enabledMcpjsonServers: [],
    settingSources: [],
    additionalDirectories: [],
    cwd: agentWorkspaceDir(agent.id),
    env: scrubAgentEnv(base.env ?? process.env),
    canUseTool: composeToolGates(base.canUseTool, agentToolGate(agent)),
  } as SdkOptions & { enabledMcpjsonServers: string[] };
  return out;
}
