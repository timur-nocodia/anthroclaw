import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildPiExpansionStatus,
  parsePiExpansionStatusArgs,
  runPiExpansionStatusCli,
} from '../pi-expansion-status.js';

describe('Pi expansion status CLI', () => {
  let root: string | undefined;
  let packetsRoot: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (packetsRoot) rmSync(packetsRoot, { recursive: true, force: true });
    root = undefined;
    packetsRoot = undefined;
  });

  it('summarizes closed, open, and missing packet states', () => {
    root = mktemp('pi-expansion-status-agents-');
    packetsRoot = mktemp('pi-expansion-status-packets-');
    writeAgent(root, 'closed_agent', `
routes:
  - channel: telegram
    scope: dm
    peers: ["42"]
safety_profile: chat_like_openclaw
mcp_onboarding:
  enabled: false
`);
    writeAgent(root, 'ready_agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_openclaw
mcp_tools:
  - manage_cron
`);
    writeAgent(root, 'missing_packet_agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_openclaw
`);
    writePacket(packetsRoot, 'closed_agent', 'Status: closed\n');
    writePacket(packetsRoot, 'ready_agent', 'Status: ready_for_execution\n\n- [ ] manual evidence\n');

    const status = buildPiExpansionStatus({
      agentsDir: root,
      agentsDirs: [root],
      packetsDir: packetsRoot,
    });

    expect(status.status).toBe('attention');
    expect(status.summary).toMatchObject({
      totalAgents: 3,
      highOrCriticalAgents: 2,
      closedAgents: 1,
      openAgents: 2,
      packetMissing: 1,
    });
    expect(status.agents.find((agent) => agent.id === 'closed_agent')).toMatchObject({
      state: 'closed',
    });
    expect(status.agents.find((agent) => agent.id === 'ready_agent')).toMatchObject({
      state: 'evidence_open',
      packet: { uncheckedItems: 1 },
    });
    expect(status.agents.find((agent) => agent.id === 'missing_packet_agent')).toMatchObject({
      state: 'packet_missing',
    });
    expect(status.gaps.missingPackets).toEqual(['missing_packet_agent']);
  });

  it('fails only with --fail-on-open when open expansion work remains', async () => {
    root = mktemp('pi-expansion-status-agents-');
    packetsRoot = mktemp('pi-expansion-status-packets-');
    writeAgent(root, 'ready_agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_openclaw
`);
    writePacket(packetsRoot, 'ready_agent', 'Status: ready_for_execution\n');

    const firstStdout = createWriter();
    const firstCode = await runPiExpansionStatusCli([
      '--agents-dir', root,
      '--packets-dir', packetsRoot,
      '--json',
    ], { stdout: firstStdout, stderr: createWriter() });
    const secondCode = await runPiExpansionStatusCli([
      '--agents-dir', root,
      '--packets-dir', packetsRoot,
      '--json',
      '--fail-on-open',
    ], { stdout: createWriter(), stderr: createWriter() });

    expect(firstCode).toBe(0);
    expect(JSON.parse(firstStdout.text())).toMatchObject({ status: 'attention' });
    expect(secondCode).toBe(1);
  });

  it('parses flags narrowly', () => {
    expect(parsePiExpansionStatusArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--agents-dir', '/tmp/live agents',
      '--packets-dir', '/tmp/packets',
      '--agent', 'ops_agent',
      '--json',
      '--fail-on-open',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      agentsDirs: ['/tmp/agents', '/tmp/live agents'],
      packetsDir: '/tmp/packets',
      agent: 'ops_agent',
      json: true,
      failOnOpen: true,
    });
    expect(() => parsePiExpansionStatusArgs(['--wat'])).toThrow(/Unknown argument/);
  });
});

function mktemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeAgent(root: string, agentId: string, body: string): void {
  const dir = join(root, agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent.yml'), body.trimStart(), 'utf8');
}

function writePacket(root: string, agentId: string, body: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, `${agentId}.md`), body, 'utf8');
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
