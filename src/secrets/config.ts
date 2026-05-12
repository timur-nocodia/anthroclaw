import { getSecretValueSync } from './vault.js';
import { isSecretRefString } from './ref.js';

export interface SecretRefObject {
  secret_ref: string;
}

export function resolveSecretConfigValueSync(value: unknown): unknown {
  if (isSecretRefString(value)) {
    return getSecretValueSync(value);
  }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as SecretRefObject).secret_ref === 'string'
  ) {
    return getSecretValueSync((value as SecretRefObject).secret_ref);
  }
  return value;
}

export function resolveSecretStringSync(value: string): string {
  return isSecretRefString(value) ? getSecretValueSync(value) : value;
}

export function isSecretRefObject(value: unknown): value is SecretRefObject {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof (value as SecretRefObject).secret_ref === 'string',
  );
}
