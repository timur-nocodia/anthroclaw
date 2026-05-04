import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk';

export const AGENT_BUILTIN_TOOL_WHITELIST = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'TodoWrite',
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
  'ANTHROPIC_',
  'CLAUDE_',
  'GOOGLE_',
  'NOTION_',
  'LINEAR_',
  'GMAIL_',
  'OPENAI_',
  'AWS_',
  'GCP_',
  'AZURE_',
  'VAULT_',
  'GITHUB_TOKEN',
] as const;

const DENY_SET: ReadonlySet<string> = new Set(ENV_VAR_DENYLIST);

export function scrubAgentEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    if (DENY_SET.has(k)) continue;
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
