/**
 * MCP onboarding facade singleton. Wires the pending-store, credential store,
 * UI base URL, and agent.yml writer together into a single `createOnboarding`
 * instance shared across all `/api/mcp/connect/*` routes within the UI
 * process.
 */

import { resolve } from 'node:path';
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

export function getOnboarding(): ReturnType<typeof createOnboarding> {
  if (cached) return cached;
  const pending = openPendingStore(pendingDbPath());
  cached = createOnboarding({
    pending,
    credentials: getCredentialStore(),
    uiBaseUrl: getUiBaseUrl(),
    writeAgentYml: (args) => writeAgentYmlEntry(args),
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
