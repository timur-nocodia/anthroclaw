import type { SubagentPolicy } from '../config/schema.js';

const WRITE_CAPABLE_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'Bash',
]);

const WRITE_CAPABLE_MCP_NAME = /(^|_)(write|edit|delete|remove|create|update|upload|send|manage|mutate)(_|$)/i;

export interface ResolvedSubagentPolicy {
  subagentId: string;
  kind: 'explorer' | 'worker' | 'custom';
  writePolicy: 'allow' | 'deny' | 'claim_required';
  conflictMode: 'soft' | 'strict';
  description?: string;
}

export function resolveSubagentPolicy(
  policy: SubagentPolicy | undefined,
  subagentId: string,
): ResolvedSubagentPolicy {
  const role = policy?.roles?.[subagentId];
  return {
    subagentId,
    kind: role?.kind ?? 'custom',
    writePolicy: role?.write_policy ?? 'allow',
    conflictMode: policy?.conflict_mode ?? 'soft',
    description: role?.description,
  };
}

export function shouldExposeDirectSubagents(policy: SubagentPolicy | undefined): boolean {
  const maxDepth = policy?.max_spawn_depth;
  return maxDepth === undefined || maxDepth >= 1;
}

export function shouldExposeNestedSubagents(policy: SubagentPolicy | undefined): boolean {
  const maxDepth = policy?.max_spawn_depth;
  return maxDepth === undefined || maxDepth >= 2;
}

export function filterSubagentTools(
  tools: string[],
  policy: Pick<ResolvedSubagentPolicy, 'writePolicy'>,
): string[] {
  if (policy.writePolicy !== 'deny') return tools;
  return tools.filter((toolName) => !isWriteCapableTool(toolName));
}

export function describeSubagentPolicy(policy: ResolvedSubagentPolicy): string {
  const parts = [`role=${policy.kind}`, `write_policy=${policy.writePolicy}`];
  if (policy.conflictMode !== 'soft') parts.push(`conflict_mode=${policy.conflictMode}`);
  return parts.join(', ');
}

function isWriteCapableTool(toolName: string): boolean {
  if (WRITE_CAPABLE_TOOLS.has(toolName)) return true;
  if (!toolName.startsWith('mcp__')) return false;
  const localName = toolName.split('__').at(-1) ?? toolName;
  return WRITE_CAPABLE_MCP_NAME.test(localName);
}
