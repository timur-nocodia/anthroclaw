import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigration } from '../migrate-safety-profile.js';
import { parse } from 'yaml';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'apply-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function setupAgent(name: string, yml: string) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), yml);
}

describe('migration --apply', () => {
  it('writes safety_profile to agent.yml', async () => {
    setupAgent('alice', `# personal assistant\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\npairing:\n  mode: off\n`);
    await runMigration({ agentsDir: root, apply: true });
    const updated = readFileSync(join(root, 'alice', 'agent.yml'), 'utf-8');
    const parsed = parse(updated);
    expect(parsed.safety_profile).toBe('private');
  });

  it('preserves comments', async () => {
    setupAgent('alice', `# my comment\nroutes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\npairing:\n  mode: off\n`);
    await runMigration({ agentsDir: root, apply: true });
    const updated = readFileSync(join(root, 'alice', 'agent.yml'), 'utf-8');
    expect(updated).toMatch(/# my comment/);
  });

  it('creates backup file', async () => {
    setupAgent('alice', `routes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\npairing:\n  mode: off\n`);
    await runMigration({ agentsDir: root, apply: true });
    const files = readdirSync(join(root, 'alice'));
    const backup = files.find((f: string) => f.startsWith('agent.yml.bak-'));
    expect(backup).toBeDefined();
  });

  it('skips agents needing manual review', async () => {
    setupAgent('leads', `routes:\n  - channel: whatsapp\n    scope: dm\npairing:\n  mode: open\nmcp_tools:\n  - access_control\n`);
    await runMigration({ agentsDir: root, apply: true });
    const updated = readFileSync(join(root, 'leads', 'agent.yml'), 'utf-8');
    expect(updated).not.toMatch(/safety_profile/);
  });
});
