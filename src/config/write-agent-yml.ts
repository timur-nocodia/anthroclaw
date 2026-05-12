/**
 * `external_mcp_servers` writer — append a single connected MCP server entry
 * into the agent's `agent.yml`.
 *
 * Uses `yaml`'s `parseDocument` so comments and unrelated key order survive
 * the round-trip — agents often hand-edit other parts of their yml and we
 * MUST NOT clobber that work when the operator-driven onboarding flow
 * persists a new server. Conflict guard: if a key by the same name already
 * exists under `external_mcp_servers`, throws `already_connected: <key>`
 * — the caller (facade `finalize`) must either rename or report.
 */

import {
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument, YAMLMap, YAMLSeq } from 'yaml';

export interface ExternalMcpEntry {
  type: 'http' | 'sse' | 'stdio';
  url?: string;
  command?: string;
  display_name?: string;
  credential_ref?: string;
  headers?: Record<string, string>;
  allowed_tools?: string[];
}

export interface WriteAgentYmlEntryArgs {
  agentId: string;
  key: string;
  entry: ExternalMcpEntry;
  /**
   * Override the agents root. Falls back to `OC_AGENTS_DIR` env var, then to
   * `./agents` relative to cwd. Tests should always pass this explicitly so
   * they aren't sensitive to process-level env.
   */
  agentsDir?: string;
}

function agentsRoot(override?: string): string {
  if (override) return resolve(override);
  if (process.env.OC_AGENTS_DIR) return resolve(process.env.OC_AGENTS_DIR);
  return resolve(process.cwd(), 'agents');
}

export function writeAgentYmlEntry(args: WriteAgentYmlEntryArgs): void {
  const path = join(agentsRoot(args.agentsDir), args.agentId, 'agent.yml');
  const raw = readFileSync(path, 'utf-8');
  const doc = parseDocument(raw, { keepSourceTokens: true });

  // doc.contents is null for an empty file; treat that as a fresh root.
  // We cast through `unknown` so we can interoperate with both the
  // `Parsed`-narrowed types yaml emits from `parseDocument` and the plain
  // `YAMLMap` we construct ourselves.
  const root = (doc.contents instanceof YAMLMap
    ? doc.contents
    : (doc.contents = new YAMLMap() as unknown as typeof doc.contents,
      doc.contents)) as unknown as YAMLMap;

  let serversNode = root.get('external_mcp_servers', true) as unknown;
  let serversMap: YAMLMap;
  if (serversNode instanceof YAMLMap) {
    serversMap = serversNode;
  } else {
    serversMap = new YAMLMap();
    root.set('external_mcp_servers', serversMap as unknown as never);
  }
  // Reference `YAMLSeq` so the type-only import isn't pruned; future variants
  // may want to detect a misconfigured sequence-shaped block.
  void YAMLSeq;

  if (serversMap.has(args.key)) {
    throw new Error(`already_connected: ${args.key}`);
  }

  // Construct a plain JS value and let the YAML library serialize it. This
  // preserves the entry's natural field order (type, url, ...) without us
  // having to manually build the node tree.
  serversMap.set(args.key, args.entry);

  // Write atomically: serialize to <path>.tmp, then rename. On POSIX same-
  // filesystem renames are atomic, so a crash mid-write can never leave
  // agent.yml truncated. If anything fails between writeFileSync and the
  // rename completing, the finally block cleans up the leftover tmp file.
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, String(doc));
    renameSync(tmp, path);
  } finally {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // best-effort cleanup; renameSync removes the source on success so this
      // is normally a no-op.
    }
  }
}
