/**
 * Carry-over and tool-prompt formatting helpers.
 *
 * Pure functions, no I/O — easy to unit-test independent of SQLite/DAG.
 */

import type { SummaryDAG } from './dag.js';

/**
 * Always-on system block prepended by `assemble()` when LCM is enabled.
 * Tells the model that historical context is searchable across all sessions
 * via the LCM tools, so the user doesn't have to wire instructions into
 * every agent's CLAUDE.md to get cross-session memory.
 */
export const LCM_TOOL_PROMPT = [
  '<lcm_memory>',
  'You have a persistent, cross-session memory store for this agent (LCM).',
  'It contains every prior conversation, automatically summarized into a hierarchical DAG.',
  '',
  'When the user references something from a previous conversation — e.g.',
  '"as we discussed before", "remember when…", "the project we set up last week" —',
  'or when relevant context might exist outside the current session:',
  '  • lcm_grep        — keyword/FTS search across all stored messages and summaries',
  '  • lcm_expand_query — natural-language search; returns the most relevant DAG nodes',
  '  • lcm_describe    — render the summary tree of a specific node',
  '  • lcm_expand      — pull a leaf node back to full text on demand',
  '',
  'Default: search across ALL sessions. Pass session_id only to narrow.',
  'Don\'t guess about prior context — search first.',
  '</lcm_memory>',
].join('\n');

export function formatToolPromptBlock(): string {
  return LCM_TOOL_PROMPT;
}

/**
 * Build a carry-over snippet from the DAG of a session that just ended.
 *
 * Strategy: walk depths from highest down to 0, taking up to `retainDepth`
 * levels' worth of nodes (most-condensed first). The snippet is plain text
 * with one node per separator line, capped to a reasonable size.
 *
 * Returns null when the source session has no DAG nodes (nothing to carry).
 */
export function buildCarryoverSnippet(
  dag: SummaryDAG,
  sourceSessionId: string,
  retainDepth: number,
  maxChars = 8_000,
): string | null {
  const byDepth = dag.countByDepth(sourceSessionId);
  const depths = Object.keys(byDepth).map(Number);
  if (depths.length === 0) return null;

  // Take up to (retainDepth + 1) levels, most-condensed (highest depth) first.
  const topDepths = depths.sort((a, b) => b - a).slice(0, retainDepth + 1);
  const taken = topDepths.flatMap((d) => dag.getNodesAtDepth(sourceSessionId, d));
  if (taken.length === 0) return null;

  const snippet = taken
    .map((node) => `[D${node.depth} · ${node.node_id.slice(0, 8)}]\n${node.summary}`)
    .join('\n\n---\n\n');

  if (snippet.length > maxChars) {
    return snippet.slice(0, maxChars) + '\n\n[…truncated]';
  }
  return snippet;
}

/**
 * Wrap a carry-over snippet in a `<previous_session_memory>` system block
 * the model can recognize. Includes the source session id so the model can
 * pass it to lcm_grep if it wants to dig deeper.
 */
export function formatCarryoverBlock(snippet: string, sourceSessionId: string): string {
  return [
    '<previous_session_memory>',
    `(carried over from session: ${sourceSessionId})`,
    '',
    snippet,
    '</previous_session_memory>',
  ].join('\n');
}
