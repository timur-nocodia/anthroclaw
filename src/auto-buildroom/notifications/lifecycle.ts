import type { BuildroomArtifact } from '../artifacts/model.js';
import { redactSecrets } from '../../security/redact.js';

export function formatBuildroomLifecycleNotification(
  artifact: BuildroomArtifact,
): string | null {
  if (artifact.type === 'coder_receipt') {
    return withNotificationBoundary([
      'Buildroom: builder completed',
      `Receipt: ${artifact.id}`,
      `Next: /buildroom qa ${artifact.id}`,
    ]);
  }

  if (artifact.type === 'error_receipt') {
    return withNotificationBoundary([
      'Buildroom: BLOCKED',
      `Receipt: ${artifact.id}`,
      `Reason: ${field(artifact.payload.errorType ?? 'error')}`,
      `Next: /buildroom show ${artifact.id}`,
    ]);
  }

  if (artifact.type === 'qa_report') {
    return withNotificationBoundary([
      'Buildroom: QA completed',
      `Receipt: ${artifact.id}`,
      `Status: ${field(artifact.payload.qaStatus ?? artifact.status)}`,
      `Next: /buildroom trust ${artifact.parentIds[0] ?? artifact.id}`,
    ]);
  }

  if (artifact.type === 'trust_report') {
    const trustState = field(artifact.payload.trustState ?? artifact.status).toUpperCase();
    return withNotificationBoundary([
      `Buildroom trust: ${trustState}`,
      `Receipt: ${artifact.id}`,
      `Reason: ${firstReason(artifact)}`,
      'Next: /buildroom report',
    ]);
  }

  if (artifact.type === 'retention_review') {
    return withNotificationBoundary([
      'Buildroom: retention review created',
      `Receipt: ${artifact.id}`,
      `Recommendation: ${field(artifact.payload.recommendation ?? 'review')}`,
      `Next: /buildroom show ${artifact.id}`,
    ]);
  }

  return null;
}

function withNotificationBoundary(lines: string[]): string {
  return [
    ...lines,
    '',
    'Notification only. Approval still requires explicit /buildroom commands.',
  ].join('\n');
}

function firstReason(artifact: BuildroomArtifact): string {
  const reasons = artifact.payload.reasons;
  if (Array.isArray(reasons)) {
    const first = reasons.find((reason): reason is string => typeof reason === 'string' && reason.trim().length > 0);
    if (first) return field(first);
  }
  return 'none';
}

function field(value: unknown): string {
  return redactSecrets(String(value));
}
