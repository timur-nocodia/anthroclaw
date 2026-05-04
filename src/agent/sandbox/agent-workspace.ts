/**
 * Agent filesystem workspace resolution.
 *
 * Each agent's SDK process is constrained to its own workspace directory
 * (`agents/<id>/`) via the SDK `cwd` option, plus an empty
 * `additionalDirectories` list. This module computes that path and the
 * list of sibling-agent directories used by the Bash hardening layer.
 *
 * The agent-id format is conservative: must start with lowercase
 * alphanumeric, followed by lowercase alphanumeric, `_`, or `-`,
 * max 64 chars. Any deviation is rejected — preventing path traversal
 * and accidental injection through agent-id mishandling upstream.
 */

import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';

// Canonical agent-id form. Lowercase alphanumeric + `_` and `-`, leading
// char must be alphanumeric (this is what excludes dotfiles like `.git`,
// `.DS_Store` from the sibling list — they would never be valid agent
// ids), max 64 chars. All production agent ids conform: content_sm_building,
// leads_agent, operator_agent, timur_agent.
export const AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;
export const AGENT_ID_MAX_LEN = 64;

function agentsRoot(): string {
  return process.env.OC_AGENTS_DIR
    ? resolve(process.env.OC_AGENTS_DIR)
    : resolve(process.cwd(), 'agents');
}

/**
 * Resolve the absolute filesystem path for an agent's workspace
 * (`<agents-root>/<id>`). Throws if the agent id is malformed.
 */
export function agentWorkspaceDir(agentId: string): string {
  if (
    !agentId ||
    agentId.length > AGENT_ID_MAX_LEN ||
    !AGENT_ID_RE.test(agentId)
  ) {
    throw new Error(`agent-workspace: invalid agentId: ${agentId}`);
  }
  return resolve(agentsRoot(), agentId);
}

/**
 * Return absolute paths of all sibling-agent directories (every directory
 * directly under <agents-root> with a valid agent-id name, excluding
 * `currentAgentId`). Used by Bash hardening to deny commands that
 * reference another agent's directory.
 *
 * Returns an empty list when the agents root does not exist or contains
 * no valid sibling directories.
 *
 * Symlinks are NOT followed: we use `readdirSync(..., withFileTypes)` and
 * inspect each `Dirent`'s type — `Dirent.isDirectory()` checks the dirent
 * itself rather than calling `stat` on the link target. A symlink under
 * <agents-root> whose name passes the regex but points outside the agents
 * tree (or to another agent's workspace) is not classified as a sibling.
 */
export function siblingAgentDirs(currentAgentId: string): string[] {
  const root = agentsRoot();
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory()) // Dirent.isDirectory() inspects dirent type, does NOT follow symlinks
    .map((e) => e.name)
    .filter((name) => name !== currentAgentId)
    .filter((name) => name.length <= AGENT_ID_MAX_LEN && AGENT_ID_RE.test(name))
    .map((name) => resolve(root, name));
}
