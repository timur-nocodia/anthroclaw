import type { AgentMcpServerSpec } from '@anthropic-ai/claude-agent-sdk';

export type McpPreflightTransport = 'in_process' | 'stdio' | 'http' | 'sse' | 'unknown';
export type McpPreflightRisk = 'low' | 'medium' | 'high';
export type McpPreflightApprovalStatus = 'approved' | 'review_required' | 'blocked';

/**
 * Options for credential-aware preflight. When `credentialResolver` returns
 * true for a spec's `credential_ref`, the spec is approved as an
 * AnthroClaw-managed remote MCP — no headers required, no review needed.
 *
 * `agentId` is the owning agent (used as the isolation boundary when looking
 * up the credential). Both fields are optional so legacy sync callers that
 * pre-date credential_ref don't have to construct a resolver.
 */
export interface PreflightOptions {
  credentialResolver?: (ref: string, agentId: string) => Promise<boolean>;
  agentId?: string;
}

export interface McpServerPreflightInput {
  serverName: string;
  ownerAgentId?: string;
  source: 'agent_local' | 'subagent_portable' | 'external';
  transport: McpPreflightTransport;
  toolNames?: string[];
  command?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
}

export interface McpServerPreflight {
  serverName: string;
  ownerAgentId?: string;
  source: McpServerPreflightInput['source'];
  transport: McpPreflightTransport;
  toolNames: string[];
  command?: string;
  args: string[];
  envVarNames: string[];
  networkRisk: McpPreflightRisk;
  filesystemRisk: McpPreflightRisk;
  packageSource: string;
  approvalStatus: McpPreflightApprovalStatus;
  reasons: string[];
}

const SECRET_ENV_PATTERN = /(API|KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;
const NETWORK_TOOL_PATTERN = /web_search|gmail|calendar|slack|notion|linear|github|browser/i;
const WRITE_TOOL_PATTERN = /write|send_|manage_|access_control/i;

export function preflightMcpServer(input: McpServerPreflightInput): McpServerPreflight {
  const args = [...(input.args ?? [])];
  const envVarNames = Object.keys(input.env ?? {}).sort();
  const toolNames = [...(input.toolNames ?? [])].sort();
  const reasons: string[] = [];

  const networkRisk = resolveNetworkRisk({ ...input, toolNames }, envVarNames, reasons);
  const filesystemRisk = resolveFilesystemRisk({ ...input, toolNames }, envVarNames, args, reasons);
  const packageSource = resolvePackageSource(input.command, args);
  const approvalStatus = resolveApprovalStatus(input, packageSource, reasons);

  return {
    serverName: input.serverName,
    ownerAgentId: input.ownerAgentId,
    source: input.source,
    transport: input.transport,
    toolNames,
    command: input.command,
    args,
    envVarNames,
    networkRisk,
    filesystemRisk,
    packageSource,
    approvalStatus,
    reasons,
  };
}

export function preflightAgentMcpServer(params: {
  serverName: string;
  ownerAgentId: string;
  toolNames: string[];
}): McpServerPreflight {
  return preflightMcpServer({
    serverName: params.serverName,
    ownerAgentId: params.ownerAgentId,
    source: 'agent_local',
    transport: 'in_process',
    toolNames: params.toolNames,
  });
}

/**
 * Preflight a single MCP server spec (http / sse / stdio) and consider a
 * resolvable `credential_ref` as approval.
 *
 * Returns one preflight result for the given spec. When the spec is `http`
 * or `sse` and carries a `credential_ref` that the resolver confirms, the
 * decision short-circuits to `approved` with `packageSource: 'remote-managed'`
 * — the gateway will inject the managed credential at call time, so neither
 * a hardcoded Authorization header nor operator review is required.
 *
 * For specs without `credential_ref` (or with a stdio transport), this
 * delegates to the existing sync rules via `preflightAgentMcpServerSpec`.
 */
export async function preflightMcpServerSpec(
  spec: Record<string, unknown>,
  opts: PreflightOptions = {},
): Promise<McpServerPreflight> {
  const type = typeof spec.type === 'string' ? spec.type : undefined;
  const credentialRef = typeof spec.credential_ref === 'string' ? spec.credential_ref : undefined;
  const serverName = typeof spec.serverName === 'string' ? spec.serverName : 'mcp-server';

  if (
    (type === 'http' || type === 'sse')
    && credentialRef
    && opts.credentialResolver
    && opts.agentId
    && (await opts.credentialResolver(credentialRef, opts.agentId))
  ) {
    return {
      serverName,
      ownerAgentId: opts.agentId,
      source: 'external',
      transport: type,
      toolNames: Array.isArray(spec.allowed_tools)
        ? [...(spec.allowed_tools as string[])].sort()
        : [],
      args: [],
      envVarNames: [],
      networkRisk: 'low',
      filesystemRisk: 'low',
      packageSource: 'remote-managed',
      approvalStatus: 'approved',
      reasons: [`Credential ${credentialRef} is managed by AnthroClaw.`],
    };
  }

  // Fallback: reuse the existing sync rules. For http/sse without a managed
  // credential the transport drops to 'unknown' → review_required, which is
  // the same behaviour callers had before this function existed.
  const [result] = preflightAgentMcpServerSpec(
    { [serverName]: spec } as unknown as AgentMcpServerSpec,
    {
      ownerAgentId: opts.agentId,
      source: 'external',
    },
  );
  return result;
}

export function preflightAgentMcpServerSpec(
  spec: AgentMcpServerSpec,
  params: {
    ownerAgentId?: string;
    source?: McpServerPreflightInput['source'];
    toolNamesByServer?: Record<string, string[]>;
  } = {},
): McpServerPreflight[] {
  return Object.entries(spec).map(([serverName, server]) => {
    const entry = server as Record<string, unknown>;
    const env = isStringMap(entry.env) ? entry.env : undefined;
    const args = Array.isArray(entry.args) && entry.args.every((arg) => typeof arg === 'string')
      ? entry.args
      : undefined;
    return preflightMcpServer({
      serverName,
      ownerAgentId: params.ownerAgentId,
      source: params.source ?? 'external',
      transport: entry.type === 'stdio' ? 'stdio' : 'unknown',
      toolNames: params.toolNamesByServer?.[serverName],
      command: typeof entry.command === 'string' ? entry.command : undefined,
      args,
      env,
    });
  });
}

function resolveNetworkRisk(
  input: McpServerPreflightInput,
  envVarNames: string[],
  reasons: string[],
): McpPreflightRisk {
  if (envVarNames.some((name) => SECRET_ENV_PATTERN.test(name))) {
    reasons.push('MCP server receives credential-like environment variables.');
    return 'high';
  }
  if ((input.toolNames ?? []).some((toolName) => NETWORK_TOOL_PATTERN.test(toolName))) {
    reasons.push('MCP tools may call external network services.');
    return 'medium';
  }
  return 'low';
}

function resolveFilesystemRisk(
  input: McpServerPreflightInput,
  envVarNames: string[],
  args: string[],
  reasons: string[],
): McpPreflightRisk {
  if (envVarNames.some((name) => /WORKSPACE|DATA_DIR|HOME|PATH/i.test(name))) {
    reasons.push('MCP server receives filesystem path environment variables.');
    return 'high';
  }
  if (args.some((arg) => arg.startsWith('/') || arg.includes('/src/') || arg.includes('/dist/'))) {
    reasons.push('MCP server is launched with local filesystem paths.');
    return 'medium';
  }
  if ((input.toolNames ?? []).some((toolName) => WRITE_TOOL_PATTERN.test(toolName))) {
    reasons.push('MCP tools can modify local state or send outbound messages.');
    return 'medium';
  }
  return 'low';
}

function resolvePackageSource(command: string | undefined, args: string[]): string {
  const commandName = command?.split('/').at(-1) ?? '';
  if (commandName === 'node' && args.some((arg) => arg.includes('subagent-mcp-server'))) return 'anthroclaw-local-node';
  if (commandName === 'node') return 'local-node';
  if (commandName === 'npx' || commandName === 'npm' || commandName === 'pnpm' || commandName === 'yarn') return 'npm-package';
  if (!command) return 'in-process';
  return 'unknown';
}

function resolveApprovalStatus(
  input: McpServerPreflightInput,
  packageSource: string,
  reasons: string[],
): McpPreflightApprovalStatus {
  if (input.source === 'agent_local' && input.transport === 'in_process') return 'approved';
  if (
    input.source === 'subagent_portable'
    && input.transport === 'stdio'
    && packageSource === 'anthroclaw-local-node'
  ) {
    return 'approved';
  }
  reasons.push('MCP server is not recognized as an AnthroClaw-managed server.');
  return input.transport === 'unknown' ? 'blocked' : 'review_required';
}

function isStringMap(value: unknown): value is Record<string, string> {
  return Boolean(
    value
      && typeof value === 'object'
      && Object.values(value).every((entry) => typeof entry === 'string'),
  );
}
