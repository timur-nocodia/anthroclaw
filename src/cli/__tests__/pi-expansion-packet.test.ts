import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPiExpansionPacket,
  parsePiExpansionPacketArgs,
  runPiExpansionPacketCli,
} from '../pi-expansion-packet.js';

describe('Pi expansion packet CLI', () => {
  let root: string | undefined;
  let secondRoot: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (secondRoot) rmSync(secondRoot, { recursive: true, force: true });
    root = undefined;
    secondRoot = undefined;
  });

  it('builds a ready packet with automated commands and manual evidence', () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-packet-'));
    writeAgent(root, 'leads_agent', `
routes:
  - channel: whatsapp
    scope: dm
safety_profile: public
mcp_tools:
  - escalate
plugins:
  lcm:
    enabled: true
learning:
  enabled: true
  mode: propose
`);

    const packet = buildPiExpansionPacket({
      agentsDir: root,
      agentsDirs: [root],
      agent: 'leads_agent',
      owner: 'ops',
      rollback: 'set runtime.headless.provider=claude-agent-sdk',
      json: false,
      help: false,
    });

    expect(packet).toMatchObject({
      status: 'ready_for_execution',
      agentId: 'leads_agent',
      risk: 'critical',
      recommendedRing: 'ring4',
      owner: 'ops',
      rollbackPath: 'set runtime.headless.provider=claude-agent-sdk',
    });
    expect(packet.automatedEvidence).toEqual(expect.arrayContaining([
      {
        check: 'smoke:pi-public-escalation',
        command: 'pnpm smoke:pi-public-escalation -- --json',
      },
      {
        check: 'smoke:pi-plugins-context',
        command: 'pnpm smoke:pi-plugins-context -- --json',
      },
    ]));
    expect(packet.manualEvidence).toEqual(expect.arrayContaining([
      'customer-facing dry run with no real customer delivery',
      'learning review remains propose-only or has operator approval evidence',
    ]));
  });

  it('renders markdown and writes an output file', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-packet-'));
    writeAgent(root, 'example', `
routes:
  - channel: telegram
    scope: dm
    peers: ["48705953"]
safety_profile: chat_like_openclaw
`);
    const out = join(root, 'packet.md');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiExpansionPacketCli([
      '--agents-dir', root,
      '--agent', 'example',
      '--owner', 'ops',
      '--rollback', 'restore original agent.yml backup',
      '--output', out,
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(stdout.text()).toContain('# Pi Expansion Packet: example');
    expect(stdout.text()).toContain('Status: ready_for_execution');
    expect(readFileSync(out, 'utf8')).toBe(stdout.text());
  });

  it('fails when expected agent coverage is missing across roots', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-packet-a-'));
    secondRoot = mkdtempSync(join(tmpdir(), 'pi-expansion-packet-b-'));
    writeAgent(root, 'example', `
routes:
  - channel: telegram
    scope: dm
    peers: ["48705953"]
safety_profile: chat_like_openclaw
`);
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiExpansionPacketCli([
      '--agents-dir', root,
      '--agents-dir', secondRoot,
      '--agent', 'leads_agent',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(1);
    expect(stdout.text()).toBe('');
    expect(stderr.text()).toContain('coverage gap for leads_agent');
  });

  it('parses packet flags narrowly', () => {
    expect(parsePiExpansionPacketArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--agents-dir', '/tmp/live agents',
      '--agent', 'leads_agent',
      '--owner', 'ops',
      '--rollback', 'rollback doc',
      '--output', '/tmp/packet.md',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      agentsDirs: ['/tmp/agents', '/tmp/live agents'],
      agent: 'leads_agent',
      owner: 'ops',
      rollback: 'rollback doc',
      output: '/tmp/packet.md',
      json: true,
    });
    expect(() => parsePiExpansionPacketArgs(['--wat'])).toThrow(/Unknown argument/);
  });
});

function writeAgent(root: string, agentId: string, body: string): void {
  const dir = join(root, agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), body.trimStart(), 'utf8');
}

function createWriter() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}
