import { z } from 'zod';

/**
 * Canonical list of operator-console capability names.
 *
 * The operator-console plugin owns the authoritative schema in
 * `plugins/operator-console/src/config.ts`. The plugin lives outside the
 * backend rootDir so it cannot import this file directly — its copy of
 * the enum stays in sync via the doc comment on `CapabilityNameSchema`.
 *
 * Backend-side tools (`manage_operator_console`, `show_config`) MUST
 * import from here so adding a new capability is a single-file change
 * for everything inside `src/`.
 */
export const CAPABILITY_NAMES = [
  'peer_pause',
  'delegate',
  'list_peers',
  'peer_summary',
  'escalate',
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export const CapabilityNameSchema = z.enum(CAPABILITY_NAMES);
