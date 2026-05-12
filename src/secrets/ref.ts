export type SecretScope = 'global' | 'agent' | 'fleet';

export interface SecretRef {
  scope: SecretScope;
  ownerId?: string;
  service: string;
  key: string;
}
const SAFE_SEGMENT_RE = /^[A-Za-z0-9_.-]{1,96}$/;

export function parseSecretRef(input: string): SecretRef {
  if (!input.startsWith('vault://')) {
    throw new Error('secret ref must start with vault://');
  }

  const path = input.slice('vault://'.length);
  const parts = path.split('/').filter(Boolean);
  const [scope] = parts;

  if (scope !== 'global' && scope !== 'agent' && scope !== 'fleet') {
    throw new Error(`unsupported secret scope: ${scope || '<empty>'}`);
  }

  if (scope === 'global') {
    if (parts.length !== 3) {
      throw new Error('global secret refs must be vault://global/<service>/<key>');
    }
    const [, service, key] = parts;
    assertSafeSegment(service, 'service');
    assertSafeSegment(key, 'key');
    return { scope, service, key };
  }

  if (parts.length !== 4) {
    throw new Error(`${scope} secret refs must be vault://${scope}/<owner>/<service>/<key>`);
  }
  const [, ownerId, service, key] = parts;
  assertSafeSegment(ownerId, 'owner');
  assertSafeSegment(service, 'service');
  assertSafeSegment(key, 'key');
  return { scope, ownerId, service, key };
}

export function formatSecretRef(ref: SecretRef): string {
  assertSafeSegment(ref.service, 'service');
  assertSafeSegment(ref.key, 'key');

  if (ref.scope === 'global') {
    return `vault://global/${ref.service}/${ref.key}`;
  }

  if (!ref.ownerId) {
    throw new Error(`${ref.scope} secret refs require ownerId`);
  }
  assertSafeSegment(ref.ownerId, 'owner');
  return `vault://${ref.scope}/${ref.ownerId}/${ref.service}/${ref.key}`;
}

export function isSecretRefString(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('vault://');
}

export function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT_RE.test(value)) {
    throw new Error(
      `invalid secret ${label}: use 1-96 chars from A-Z, a-z, 0-9, _, ., -`,
    );
  }
}
