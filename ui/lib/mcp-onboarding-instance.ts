/**
 * MCP onboarding facade singleton. Wires the pending-store, credential store,
 * UI base URL, and agent.yml writer together into a single `createOnboarding`
 * instance shared across all `/api/mcp/connect/*` routes within the UI
 * process.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseDocument, YAMLMap } from 'yaml';
import { createOnboarding } from '@backend/integrations/mcp-onboarding/index.js';
import { openPendingStore } from '@backend/integrations/mcp-onboarding/pending-store.js';
import { writeAgentYmlEntry } from '@backend/config/write-agent-yml.js';
import { getCredentialStore } from './credential-store-instance';
import { getUiBaseUrl } from './ui-base-url';

let cached: ReturnType<typeof createOnboarding> | null = null;

function pendingDbPath(): string {
  const dataDir
    = process.env.OC_DATA_DIR
      ?? resolve(process.cwd(), '..', 'data');
  return resolve(dataDir, 'mcp.sqlite');
}

function agentsRoot(): string {
  if (process.env.OC_AGENTS_DIR) return resolve(process.env.OC_AGENTS_DIR);
  return resolve(process.cwd(), '..', 'agents');
}

/**
 * Read the `external_mcp_servers` keys currently in the agent's yml so the
 * facade can pick a non-colliding id when two concurrent flows target the
 * same hostname. Returns an empty set if the yml is missing or unparsable —
 * the writer will reject duplicates at finalize time anyway.
 */
async function listTakenServerIds(agentId: string): Promise<Set<string>> {
  const path = join(agentsRoot(), agentId, 'agent.yml');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return new Set<string>();
  }
  try {
    const doc = parseDocument(raw);
    const root = doc.contents instanceof YAMLMap ? doc.contents : null;
    if (!root) return new Set<string>();
    const servers = root.get('external_mcp_servers', true) as unknown;
    if (!(servers instanceof YAMLMap)) return new Set<string>();
    const out = new Set<string>();
    for (const item of servers.items) {
      const k = item.key as { value?: unknown } | string | null;
      const key = typeof k === 'string' ? k : (k as { value?: unknown })?.value;
      if (typeof key === 'string') out.add(key);
    }
    return out;
  } catch {
    return new Set<string>();
  }
}

export function getOnboarding(): ReturnType<typeof createOnboarding> {
  if (cached) return cached;
  const pending = openPendingStore(pendingDbPath());
  cached = createOnboarding({
    pending,
    credentials: getCredentialStore(),
    uiBaseUrl: getUiBaseUrl(),
    writeAgentYml: (args) => writeAgentYmlEntry(args),
    listTakenServerIds,
  });
  return cached;
}

/** @internal Reset for tests. */
export function _resetForTest(): void {
  cached = null;
}

/** @internal Inject a mock onboarding facade for tests. */
export function _setForTest(
  onboarding: ReturnType<typeof createOnboarding>,
): void {
  cached = onboarding;
}
