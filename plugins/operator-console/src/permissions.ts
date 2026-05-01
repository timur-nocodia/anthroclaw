import type { OperatorConsoleConfig } from './config.js';

/**
 * Returns true iff the calling operator agent (whose config is `cfg`) is
 * authorised to perform an action against `targetAgentId`.
 *
 * Rules:
 *   - `enabled === false` → never authorised.
 *   - `manages === '*'`   → super-admin, any target authorised.
 *   - `manages: string[]` → authorised iff the array contains targetAgentId.
 *
 * This is a plugin-local mirror of the shared helper at
 * `src/security/cross-agent-perm.ts` (`canManageAgent`). The plugin lives
 * outside the backend `rootDir` and cannot import directly; both
 * implementations are intentionally pinned to the same semantics. If you
 * change one, change the other and update both test suites.
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
