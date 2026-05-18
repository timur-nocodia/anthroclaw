export type RuntimeSideEffectChannel = 'telegram' | 'whatsapp' | 'web' | 'none' | (string & {});

export type RuntimeSideEffectKind =
  | 'message.send'
  | 'media.send'
  | 'notification.emit'
  | 'cron.fire'
  | 'cron.schedule'
  | 'config.mutate'
  | 'buildroom.handoff'
  | 'mcp.call'
  | 'memory.write'
  | (string & {});

export type RuntimeSideEffectRisk = 'read_only' | 'operator_only' | 'external_write' | 'destructive';

export interface RuntimeSideEffectTarget {
  channel: RuntimeSideEffectChannel;
  accountId?: string;
  peerId?: string;
  threadId?: string;
}

export interface RuntimeSideEffectPolicyAssertion {
  id: string;
  description: string;
  required: boolean;
}

export interface RuntimeSideEffectExpectedEffect {
  id: string;
  kind: RuntimeSideEffectKind;
  description: string;
  target?: RuntimeSideEffectTarget;
  maxCount?: number;
}

export interface RuntimeSideEffectCleanupCheck {
  id: string;
  description: string;
  required: boolean;
}

export interface RuntimeSideEffectMetricsExpectation {
  runStarted: boolean;
  runCompleted: boolean;
  toolStarted?: string[];
  toolCompleted?: string[];
  noFailedTools?: boolean;
}

export interface RuntimeSideEffectGateSpec {
  /**
   * Provider-neutral gate id. Must describe the capability, not the lab agent.
   */
  gateId: string;
  agentId: string;
  runtime: string;
  risk: RuntimeSideEffectRisk;
  action: RuntimeSideEffectKind;
  target: RuntimeSideEffectTarget;
  markerPrefix?: string;
  dryRunSupported: boolean;
  approvalRequired: boolean;
  policyAssertions: RuntimeSideEffectPolicyAssertion[];
  expectedEffects: RuntimeSideEffectExpectedEffect[];
  cleanupChecks: RuntimeSideEffectCleanupCheck[];
  metrics: RuntimeSideEffectMetricsExpectation;
}

export interface RuntimeSideEffectGateValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateRuntimeSideEffectGateSpec(
  spec: RuntimeSideEffectGateSpec,
): RuntimeSideEffectGateValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  requireNonEmpty(spec.gateId, 'gateId', errors);
  requireNonEmpty(spec.agentId, 'agentId', errors);
  requireNonEmpty(spec.runtime, 'runtime', errors);
  requireNonEmpty(spec.action, 'action', errors);
  requireNonEmpty(spec.target.channel, 'target.channel', errors);

  if (containsAgentId(spec.gateId, spec.agentId)) {
    errors.push('gateId must describe a reusable capability and must not include agentId.');
  }
  if (spec.markerPrefix && containsAgentId(spec.markerPrefix, spec.agentId)) {
    warnings.push('markerPrefix includes agentId; prefer passing agent-specific markers only from evidence fixtures.');
  }
  if (!spec.dryRunSupported) {
    errors.push('side-effect gates must support dry-run before live execution.');
  }
  if (spec.risk !== 'read_only' && !spec.approvalRequired) {
    errors.push('non-read-only side-effect gates must require explicit approval.');
  }
  if (spec.policyAssertions.length === 0) {
    errors.push('side-effect gates must declare policy assertions.');
  }
  if (spec.expectedEffects.length === 0) {
    errors.push('side-effect gates must declare expected effects.');
  }
  if (spec.cleanupChecks.length === 0) {
    warnings.push('side-effect gate has no cleanup checks.');
  }
  if (!spec.metrics.runStarted || !spec.metrics.runCompleted) {
    errors.push('side-effect gates must assert run start and completion metrics.');
  }

  for (const effect of spec.expectedEffects) {
    requireNonEmpty(effect.id, 'expectedEffects[].id', errors);
    requireNonEmpty(effect.kind, 'expectedEffects[].kind', errors);
    requireNonEmpty(effect.description, 'expectedEffects[].description', errors);
    if (effect.maxCount !== undefined && effect.maxCount < 1) {
      errors.push(`expected effect "${effect.id}" maxCount must be at least 1.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function requireNonEmpty(value: string | undefined, field: string, errors: string[]): void {
  if (!value || value.trim().length === 0) errors.push(`${field} is required.`);
}

function containsAgentId(value: string, agentId: string): boolean {
  const normalizedValue = normalizeName(value);
  const normalizedAgent = normalizeName(agentId);
  return normalizedAgent.length > 0 && normalizedValue.includes(normalizedAgent);
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}
