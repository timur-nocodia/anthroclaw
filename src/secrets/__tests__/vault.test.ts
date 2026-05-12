import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  deleteSecretSync,
  getSecretMetadataSync,
  getSecretValueSync,
  listSecretsSync,
  setSecretSync,
} from '../vault.js';
import { GlobalConfigSchema } from '../../config/schema.js';

let dir: string;
const ORIGINAL_DATA_DIR = process.env.OC_DATA_DIR;
const ORIGINAL_MASTER_KEY = process.env.ANTHROCLAW_MASTER_KEY;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'secret-vault-test-'));
  process.env.OC_DATA_DIR = dir;
  process.env.ANTHROCLAW_MASTER_KEY = 'b'.repeat(64);
});
afterEach(() => {
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.OC_DATA_DIR;
  else process.env.OC_DATA_DIR = ORIGINAL_DATA_DIR;
  if (ORIGINAL_MASTER_KEY === undefined) delete process.env.ANTHROCLAW_MASTER_KEY;
  else process.env.ANTHROCLAW_MASTER_KEY = ORIGINAL_MASTER_KEY;
  rmSync(dir, { recursive: true, force: true });
});

describe('generic secret vault', () => {
  it('stores encrypted secret bytes and returns metadata without value', () => {
    const metadata = setSecretSync({
      scope: 'global',
      service: 'honcho',
      key: 'anthropic_api_key',
      label: 'Honcho Anthropic API key',
      value: 'sk-ant-secret-value',
    });

    expect(metadata.ref).toBe('vault://global/honcho/anthropic_api_key');
    expect(metadata).not.toHaveProperty('value');
    expect(getSecretValueSync(metadata.ref)).toBe('sk-ant-secret-value');

    const blob = readFileSync(join(dir, 'secrets', 'global', 'honcho', 'anthropic_api_key.enc'));
    expect(blob.includes(Buffer.from('sk-ant-secret-value'))).toBe(false);
  });

  it('lists and deletes metadata records', () => {
    const first = setSecretSync({
      scope: 'fleet',
      ownerId: 'prod-eu',
      service: 'control_api',
      key: 'api_key',
      value: 'fleet-token',
    });
    setSecretSync({
      scope: 'agent',
      ownerId: 'timur_agent',
      service: 'mcp',
      key: 'headers',
      value: 'Authorization=Bearer test',
    });

    expect(listSecretsSync()).toHaveLength(2);
    expect(listSecretsSync({ scope: 'fleet' })).toEqual([
      expect.objectContaining({ ref: first.ref, scope: 'fleet', ownerId: 'prod-eu' }),
    ]);

    deleteSecretSync(first.ref);
    expect(listSecretsSync()).toHaveLength(1);
  });

  it('rotates a secret while preserving createdAt', () => {
    const first = setSecretSync({
      scope: 'global',
      service: 'brave',
      key: 'api_key',
      value: 'old',
    });
    const second = setSecretSync({
      scope: 'global',
      service: 'brave',
      key: 'api_key',
      value: 'new',
    });

    expect(second.createdAt).toBe(first.createdAt);
    expect(getSecretValueSync(first.ref)).toBe('new');
    expect(getSecretMetadataSync(first.ref)).not.toHaveProperty('value');
  });

  it('lets global config use secret_ref objects while runtime sees strings', () => {
    const secret = setSecretSync({
      scope: 'global',
      service: 'brave',
      key: 'api_key',
      value: 'brave-secret',
    });

    const parsed = GlobalConfigSchema.parse({
      defaults: { model: 'claude-sonnet-4-6' },
      brave: { api_key: { secret_ref: secret.ref } },
    });

    expect(parsed.brave?.api_key).toBe('brave-secret');
  });
});
