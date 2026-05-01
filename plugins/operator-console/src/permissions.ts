import type { OperatorConsoleConfig } from './config.js';

/**
 * Returns true iff the calling operator agent (whose config is `cfg`) is
 * authorised to perform an action against `targetAgentId`.
 *
 * Rules:
 *   - `enabled === false` → never authorised.
 *   - `manages === '*'`   → super-admin, any target authorised.
 *   - `manages: string[]` → authorised iff the array contains targetAgentId.
 */
export function canManage(
  cfg: OperatorConsoleConfig,
  targetAgentId: string,
): boolean {
  if (!cfg.enabled) return false;
  if (cfg.manages === '*') return true;
  if (Array.isArray(cfg.manages)) return cfg.manages.includes(targetAgentId);
  return false;
}
