import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAgentYmlEntry } from '../write-agent-yml.js';

describe('writeAgentYmlEntry', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wyml-'));
    mkdirSync(join(dir, 'a1'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(content: string): string {
    const p = join(dir, 'a1', 'agent.yml');
    writeFileSync(p, content);
    return p;
  }

  it('adds external_mcp_servers block when absent', () => {
    const path = seed('model: claude-sonnet-4-6\n');
    writeAgentYmlEntry({
      agentId: 'a1',
      key: 'postmypost',
      entry: {
        type: 'http',
        url: 'https://mcp.postmypost.io/mcp',
        display_name: 'postmypost',
        credential_ref: 'mcp:postmypost',
        allowed_tools: ['post_create'],
      },
      agentsDir: dir,
    });
    const out = readFileSync(path, 'utf8');
    expect(out).toMatch(/external_mcp_servers:/);
    expect(out).toMatch(/postmypost:/);
    expect(out).toMatch(/credential_ref:\s*mcp:postmypost/);
    expect(out).toMatch(/post_create/);
    // Pre-existing keys preserved.
    expect(out).toMatch(/model: claude-sonnet-4-6/);
  });

  it('appends to existing external_mcp_servers block', () => {
    const path = seed(
      `model: claude-sonnet-4-6
external_mcp_servers:
  existing:
    type: http
    url: https://x/y
`,
    );
    writeAgentYmlEntry({
      agentId: 'a1',
      key: 'postmypost',
      entry: {
        type: 'http',
        url: 'https://mcp.postmypost.io/mcp',
      },
      agentsDir: dir,
    });
    const out = readFileSync(path, 'utf8');
    expect(out).toMatch(/existing:/);
    expect(out).toMatch(/postmypost:/);
  });

  it('rejects adding an entry whose key already exists', () => {
    seed(
      `model: claude-sonnet-4-6
external_mcp_servers:
  postmypost:
    type: http
    url: https://mcp.postmypost.io/mcp
`,
    );
    expect(() =>
      writeAgentYmlEntry({
        agentId: 'a1',
        key: 'postmypost',
        entry: { type: 'http', url: 'https://mcp.postmypost.io/mcp' },
        agentsDir: dir,
      }),
    ).toThrow(/already_connected: postmypost/);
  });

  it('preserves YAML comments and key order', () => {
    const path = seed(
      `# Top of file
model: claude-sonnet-4-6
# About routes
routes: []
`,
    );
    writeAgentYmlEntry({
      agentId: 'a1',
      key: 'srv',
      entry: { type: 'http', url: 'https://x' },
      agentsDir: dir,
    });
    const out = readFileSync(path, 'utf8');
    expect(out).toMatch(/# Top of file/);
    expect(out).toMatch(/# About routes/);
    // Original keys come before the new block.
    expect(out.indexOf('model:')).toBeLessThan(out.indexOf('external_mcp_servers:'));
    expect(out.indexOf('routes:')).toBeLessThan(out.indexOf('external_mcp_servers:'));
  });

  it('throws if agent.yml does not exist', () => {
    expect(() =>
      writeAgentYmlEntry({
        agentId: 'nonexistent',
        key: 'x',
        entry: { type: 'http', url: 'https://x' },
        agentsDir: dir,
      }),
    ).toThrow();
  });
});
