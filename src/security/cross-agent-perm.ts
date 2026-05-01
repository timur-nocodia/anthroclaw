/**
 * Cross-agent management permission helper.
 *
 * Single source of truth for "is caller authorised to mutate target?".
 * Used by self-config tools (manage_notifications / manage_human_takeover /
 * manage_operator_console / show_config) and any future cross-agent tool.
 *
 * The operator-console plugin keeps a thin local mirror (`canManage`) for
 * back-compat — it predates this extraction and lives outside the backend
 * rootDir. Both implementations share the identical semantics:
 *   - self target → always allowed
 *   - cross-agent → requires `operator_console.enabled === true` AND the
 *     target appearing in `manages` (array form) OR `manages === '*'`
 *     (super-admin)
 */

export interface OperatorConsoleConfigShape {
  enabled?: boolean;
  manages?: string[] | '*';
}

export interface CanManageAgentArgs {
  callerId: string;
  targetId: string;
  operatorConsoleConfig?: OperatorConsoleConfigShape;
}

export function canManageAgent(args: CanManageAgentArgs): boolean {
  const { callerId, targetId, operatorConsoleConfig } = args;
  if (callerId === targetId) return true;
  if (!operatorConsoleConfig?.enabled) return false;
  const manages = operatorConsoleConfig.manages;
  if (manages === '*') return true;
  if (Array.isArray(manages)) return manages.includes(targetId);
  return false;
}
