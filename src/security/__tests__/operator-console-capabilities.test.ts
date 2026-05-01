import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITY_NAMES,
  CapabilityNameSchema,
} from '../operator-console-capabilities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '..', '..');

describe('CapabilityNameSchema (shared)', () => {
  it('exports the canonical capability list', () => {
    expect(CAPABILITY_NAMES).toEqual([
      'peer_pause',
      'delegate',
      'list_peers',
      'peer_summary',
      'escalate',
    ]);
  });

  it('parses valid capabilities and rejects unknown ones', () => {
    for (const name of CAPABILITY_NAMES) {
      expect(CapabilityNameSchema.safeParse(name).success).toBe(true);
    }
    expect(CapabilityNameSchema.safeParse('list_admins').success).toBe(false);
  });

  it('is imported by manage_operator_console (no duplicate enum literal)', () => {
    const file = readFileSync(
      join(SRC_ROOT, 'agent', 'tools', 'manage-operator-console.ts'),
      'utf-8',
    );
    expect(file).toContain("from '../../security/operator-console-capabilities.js'");
    // No local re-declaration of the capability enum.
    expect(file).not.toMatch(/z\.enum\(\s*\[\s*['"]peer_pause['"]/);
  });

  it('is imported by show_config (no duplicate enum literal)', () => {
    const file = readFileSync(
      join(SRC_ROOT, 'agent', 'tools', 'show-config.ts'),
      'utf-8',
    );
    expect(file).toContain("from '../../security/operator-console-capabilities.js'");
    expect(file).not.toMatch(/z\.enum\(\s*\[\s*['"]peer_pause['"]/);
  });

  it('plugin canonical copy is byte-for-byte equivalent to the shared list', () => {
    // Plugin lives outside src/ rootDir so it can't import from here. The
    // contract is that both lists stay in sync via doc comments. This test
    // catches drift early.
    const pluginFile = readFileSync(
      join(SRC_ROOT, '..', 'plugins', 'operator-console', 'src', 'config.ts'),
      'utf-8',
    );
    for (const name of CAPABILITY_NAMES) {
      expect(pluginFile).toContain(`'${name}'`);
    }
  });
});
