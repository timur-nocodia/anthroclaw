import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigration } from '../migrate-safety-profile.js';

let agentsRoot: string;

beforeEach(() => {
  agentsRoot = mkdtempSync(join(tmpdir(), 'migrate-test-'));
});

afterEach(() => {
  rmSync(agentsRoot, { recursive: true, force: true });
});

function setupAgent(name: string, yml: string) {
  const dir = join(agentsRoot, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), yml);
}

describe('runMigration (dry-run)', () => {
  it('reports inferred profile per agent', async () => {
    setupAgent('alice', `routes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "12345"\npairing:\n  mode: off\n`);
    setupAgent('bob', `routes:\n  - channel: whatsapp\n    scope: dm\npairing:\n  mode: open\n`);
    const out = await runMigration({ agentsDir: agentsRoot, apply: false });
    expect(out.summary.scanned).toBe(2);
    expect(out.results.find((r) => r.agentId === 'alice')?.profile).toBe('private');
    expect(out.results.find((r) => r.agentId === 'bob')?.profile).toBe('public');
  });

  it('marks agents with HARD_BLACKLIST conflicts as needing manual review', async () => {
    setupAgent('leads', `routes:\n  - channel: whatsapp\n    scope: dm\npairing:\n  mode: open\nmcp_tools:\n  - access_control\n`);
    const out = await runMigration({ agentsDir: agentsRoot, apply: false });
    const r = out.results.find((r) => r.agentId === 'leads');
    expect(r?.needsManualReview).toBe(true);
    expect(r?.hardBlacklistConflicts).toContain('access_control');
  });

  it('does NOT modify files when apply=false', async () => {
    setupAgent('alice', `routes:\n  - channel: telegram\n    scope: dm\nallowlist:\n  telegram:\n    - "1"\npairing:\n  mode: off\n`);
    const before = readFileSync(join(agentsRoot, 'alice', 'agent.yml'), 'utf-8');
    await runMigration({ agentsDir: agentsRoot, apply: false });
    const after = readFileSync(join(agentsRoot, 'alice', 'agent.yml'), 'utf-8');
    expect(after).toBe(before);
  });
});
