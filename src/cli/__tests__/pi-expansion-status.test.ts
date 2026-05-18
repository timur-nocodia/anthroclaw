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
    writePacket(packetsRoot, 'closed_agent', 'Status: closed\n\n- [x] closed evidence\n');
    writePacket(packetsRoot, 'ready_agent', 'Status: ready_for_execution\n\n- [x] automated evidence\n- [ ] manual evidence\n');

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
      closedEvidenceItems: 2,
      openEvidenceItems: 1,
      totalEvidenceItems: 3,
      evidenceProgressPercent: 67,
      openEvidenceByKind: {
        operatorApproval: 0,
        postExpansionMonitor: 0,
        liveAction: 0,
        automated: 0,
        manual: 1,
      },
    });
    expect(status.agents.find((agent) => agent.id === 'closed_agent')).toMatchObject({
      state: 'closed',
    });
    expect(status.agents.find((agent) => agent.id === 'ready_agent')).toMatchObject({
      state: 'evidence_open',
      packet: {
        checkedItems: 1,
        uncheckedItems: 1,
        totalItems: 2,
        uncheckedLabels: ['manual evidence'],
        uncheckedByKind: {
          manual: 1,
        },
      },
      nextActions: ['Resolve packet item: manual evidence'],
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

  it('can allow specific open evidence kinds while still failing on other open work', async () => {
    root = mktemp('pi-expansion-status-agents-');
    packetsRoot = mktemp('pi-expansion-status-packets-');
    writeAgent(root, 'operator_agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_openclaw
`);
    writeAgent(root, 'manual_agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_openclaw
`);
    writePacket(packetsRoot, 'operator_agent', [
      'Status: pre-live evidence pending',
      '',
      '- [ ] operator go/no-go for controlled group expansion',
      '- [ ] runtime:pi-monitor after expansion: `pnpm runtime:pi-monitor -- --json`',
      '',
    ].join('\n'));
    writePacket(packetsRoot, 'manual_agent', 'Status: ready_for_execution\n\n- [ ] manual packet review\n');

    const allowedStdout = createWriter();
    const allowedCode = await runPiExpansionStatusCli([
      '--agents-dir', root,
      '--packets-dir', packetsRoot,
      '--agent', 'operator_agent',
      '--json',
      '--fail-on-open',
      '--allow-open-kind', 'operatorApproval',
      '--allow-open-kind', 'postExpansionMonitor',
    ], { stdout: allowedStdout, stderr: createWriter() });
    const blockedCode = await runPiExpansionStatusCli([
      '--agents-dir', root,
      '--packets-dir', packetsRoot,
      '--json',
      '--fail-on-open',
      '--allow-open-kind', 'operatorApproval',
      '--allow-open-kind', 'postExpansionMonitor',
    ], { stdout: createWriter(), stderr: createWriter() });

    expect(allowedCode).toBe(0);
    expect(JSON.parse(allowedStdout.text())).toMatchObject({
      status: 'attention',
      summary: {
        openEvidenceByKind: {
          operatorApproval: 1,
          postExpansionMonitor: 1,
          manual: 0,
        },
      },
    });
    expect(blockedCode).toBe(1);
  });

  it('prints only open agents with --open-only while preserving full summary', async () => {
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
    writeAgent(root, 'open_agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_openclaw
`);
    writePacket(packetsRoot, 'closed_agent', 'Status: closed\n\n- [x] closed evidence\n');
    writePacket(packetsRoot, 'open_agent', 'Status: ready_for_execution\n\n- [ ] manual evidence\n');

    const stdout = createWriter();
    const code = await runPiExpansionStatusCli([
      '--agents-dir', root,
      '--packets-dir', packetsRoot,
      '--json',
      '--open-only',
    ], { stdout, stderr: createWriter() });

    expect(code).toBe(0);
    const body = JSON.parse(stdout.text());
    expect(body.summary).toMatchObject({
      totalAgents: 2,
      closedAgents: 1,
      openAgents: 1,
      totalEvidenceItems: 2,
      openEvidenceByKind: {
        manual: 1,
      },
    });
    expect(body.agents.map((agent: { id: string }) => agent.id)).toEqual(['open_agent']);
  });

  it('classifies open evidence by operator approval, post-monitor, live action, automated, and manual work', () => {
    root = mktemp('pi-expansion-status-agents-');
    packetsRoot = mktemp('pi-expansion-status-packets-');
    writeAgent(root, 'open_agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_openclaw
`);
    writePacket(packetsRoot, 'open_agent', [
      'Status: pre-live evidence pending',
      '',
      '- [x] closed evidence',
      '- [ ] operator go/no-go for controlled group expansion',
      '- [ ] runtime:pi-monitor after expansion: `pnpm runtime:pi-monitor -- --json`',
      '- [ ] controlled live group turn approved by product lead',
      '- [ ] smoke:pi-external-mcp: `pnpm smoke:pi-external-mcp -- --json`',
      '- [ ] manual packet review',
      '',
    ].join('\n'));

    const status = buildPiExpansionStatus({
      agentsDir: root,
      agentsDirs: [root],
      packetsDir: packetsRoot,
    });

    expect(status.summary).toMatchObject({
      closedEvidenceItems: 1,
      openEvidenceItems: 5,
      totalEvidenceItems: 6,
      openEvidenceByKind: {
        operatorApproval: 1,
        postExpansionMonitor: 1,
        liveAction: 1,
        automated: 1,
        manual: 1,
      },
    });
    expect(status.agents[0]?.packet.uncheckedByKind).toEqual(status.summary.openEvidenceByKind);
  });

  it('parses flags narrowly', () => {
    expect(parsePiExpansionStatusArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--agents-dir', '/tmp/live agents',
      '--packets-dir', '/tmp/packets',
      '--agent', 'ops_agent',
      '--json',
      '--open-only',
      '--fail-on-open',
      '--allow-open-kind', 'operatorApproval',
      '--allow-open-kind', 'postExpansionMonitor',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      agentsDirs: ['/tmp/agents', '/tmp/live agents'],
      packetsDir: '/tmp/packets',
      agent: 'ops_agent',
      json: true,
      openOnly: true,
      failOnOpen: true,
      allowedOpenKinds: ['operatorApproval', 'postExpansionMonitor'],
    });
    expect(() => parsePiExpansionStatusArgs(['--allow-open-kind', 'unknown'])).toThrow(/Unknown open evidence kind/);
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
