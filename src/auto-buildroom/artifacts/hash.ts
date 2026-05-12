import { createHash } from 'node:crypto';

export function serializeCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeArtifactContentHash(artifact: unknown): string {
  const hashInput = omitContentHash(artifact);
  const digest = createHash('sha256').update(serializeCanonicalJson(hashInput)).digest('hex');
  return `sha256:${digest}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }

  return value;
}

function omitContentHash(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => omitContentHash(item));
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const copy: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(record)) {
      if (key === 'contentHash') continue;
      copy[key] = omitContentHash(nested);
    }
    return copy;
  }

  return value;
}

