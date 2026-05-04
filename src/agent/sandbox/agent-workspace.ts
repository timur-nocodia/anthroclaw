/**
 * Agent filesystem workspace resolution.
 *
 * Each agent's SDK process is constrained to its own workspace directory
 * (`agents/<id>/`) via the SDK `cwd` option, plus an empty
 * `additionalDirectories` list. This module computes that path and the
 * list of sibling-agent directories used by the Bash hardening layer.
 *
 * The agent-id format is conservative: must start with lowercase
 * alphanumeric, followed by alphanumeric (any case), `_`, or `-`,
 * max 64 chars. Any deviation is rejected — preventing path traversal
 * and accidental injection through agent-id mishandling upstream.
 */

import { resolve } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const AGENT_ID_RE = /^[a-z0-9][a-zA-Z0-9_-]*$/;
const AGENT_ID_MAX_LEN = 64;

function agentsRoot(): string {
  return process.env.OC_AGENTS_DIR
    ? resolve(process.env.OC_AGENTS_DIR)
    : resolve(process.cwd(), 'agents');
}

/**
 * Resolve the absolute filesystem path for an agent's workspace
 * (`<agents-root>/<id>`). Throws if the agent id is malformed.
 */
export function agentWorkspaceDir(agent: { id: string }): string {
  if (
    !agent.id ||
    agent.id.length > AGENT_ID_MAX_LEN ||
    !AGENT_ID_RE.test(agent.id)
  ) {
    throw new Error(`agent-workspace: invalid agentId: ${agent.id}`);
  }
  return resolve(agentsRoot(), agent.id);
}

/**
 * Return absolute paths of all sibling-agent directories (every directory
 * directly under <agents-root> with a valid agent-id name, excluding
 * `currentAgentId`). Used by Bash hardening to deny commands that
 * reference another agent's directory.
 *
 * Returns an empty list when the agents root does not exist or contains
 * no valid sibling directories.
 */
export function siblingAgentDirs(currentAgentId: string): string[] {
  const root = agentsRoot();
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name !== currentAgentId)
    .filter((name) => name.length <= AGENT_ID_MAX_LEN && AGENT_ID_RE.test(name))
    .map((name) => resolve(root, name))
    .filter((path) => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    });
}
