import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditPiExpansionReadiness,
  parsePiExpansionAuditArgs,
  runPiExpansionAuditCli,
} from '../pi-expansion-audit.js';

describe('Pi expansion audit CLI', () => {
  let root: string | undefined;
  let secondRoot: string | undefined;

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    if (secondRoot) rmSync(secondRoot, { recursive: true, force: true });
    root = undefined;
    secondRoot = undefined;
  });

  it('classifies low-risk and high-risk production expansion candidates', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-'));
    writeAgent(root, 'example', `
routes:
  - channel: telegram
    scope: dm
allowlist:
  telegram: ["123456789"]
safety_profile: chat_like_anthroclaw
mcp_onboarding:
  enabled: false
learning:
  enabled: true
  mode: propose
`);
    writeAgent(root, 'public_agent', `
routes:
  - channel: whatsapp
    scope: dm
safety_profile: public
mcp_tools:
  - memory_search
  - memory_wiki
  - escalate
learning:
  enabled: true
  mode: propose
`);
    writeAgent(root, 'group-agent', `
routes:
  - channel: telegram
    scope: group
    topics: ["8"]
safety_profile: chat_like_anthroclaw
mcp_tools:
  - manage_cron
cron:
  - id: daily
    schedule: "0 9 * * *"
    prompt: "Summarize status"
    enabled: true
`);

    const result = auditPiExpansionReadiness({ agentsDir: root });

    expect(result.status).toBe('attention');
    expect(result.summary).toMatchObject({
      totalAgents: 3,
      byRisk: {
        low: 1,
        high: 1,
        critical: 1,
      },
      recommendedNextAgents: ['example'],
    });
    expect(result.agents.find((agent) => agent.id === 'example')).toMatchObject({
      risk: 'low',
      recommendedRing: 'ring2',
      blockers: [],
    });
    expect(result.agents.find((agent) => agent.id === 'public_agent')).toMatchObject({
      risk: 'critical',
      recommendedRing: 'ring4',
      routes: ['whatsapp:dm'],
      evidencePlan: expect.arrayContaining([
        {
          check: 'public-profile policy canary',
          mode: 'automated',
          command: 'pnpm smoke:pi-public-escalation -- --json',
        },
        {
          check: 'customer-facing dry run with no real customer delivery',
          mode: 'manual',
        },
      ]),
    });
    expect(result.agents.find((agent) => agent.id === 'public_agent')?.blockers).toEqual(expect.arrayContaining([
      'public safety profile',
      'WhatsApp route',
      'operator escalation tool',
    ]));
    expect(result.agents.find((agent) => agent.id === 'group-agent')).toMatchObject({
      risk: 'high',
      recommendedRing: 'ring4',
    });
  });

  it('emits JSON and fails when max risk budget is exceeded', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-'));
    writeAgent(root, 'public_agent', `
routes:
  - channel: whatsapp
    scope: dm
safety_profile: public
mcp_tools:
  - escalate
`);
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiExpansionAuditCli([
      '--agents-dir', root,
      '--max-risk', 'medium',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(1);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body.status).toBe('attention');
    expect(body.riskBudgetExceeded).toBe(true);
    expect(body.agents[0].evidencePlan).toEqual(expect.arrayContaining([
      expect.objectContaining({
        check: 'smoke:pi-public-escalation',
        mode: 'automated',
        command: 'pnpm smoke:pi-public-escalation -- --json',
      }),
    ]));
  });

  it('reports skipped directories and fails when expected live agents are absent', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-'));
    writeAgent(root, 'example', `
routes:
  - channel: telegram
    scope: dm
    peers: ["123456789"]
safety_profile: chat_like_anthroclaw
mcp_onboarding:
  enabled: false
`);
    mkdirSync(join(root, 'agent_alpha', 'credentials'), { recursive: true });
    writeFileSync(join(root, 'agent_alpha', 'credentials', 'mcp:test.enc'), 'encrypted', 'utf8');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiExpansionAuditCli([
      '--agents-dir', root,
      '--expect-agent', 'public_agent',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(1);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'attention',
      coverageGap: true,
      expectedAgentsMissing: ['public_agent'],
      skippedDirectories: [
        { name: 'agent_alpha', reason: 'missing agent.yml' },
      ],
    });
  });

  it('audits multiple agent roots and satisfies expected agents across roots', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-a-'));
    secondRoot = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-b-'));
    writeAgent(root, 'example', `
routes:
  - channel: telegram
    scope: dm
    peers: ["123456789"]
safety_profile: chat_like_anthroclaw
mcp_onboarding:
  enabled: false
`);
    writeAgent(secondRoot, 'public_agent', `
routes:
  - channel: whatsapp
    scope: dm
safety_profile: public
mcp_tools:
  - escalate
`);
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiExpansionAuditCli([
      '--agents-dir', root,
      '--agents-dir', secondRoot,
      '--expect-agent', 'example',
      '--expect-agent', 'public_agent',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      coverageGap: false,
      expectedAgentsMissing: [],
      agentsDirs: [root, secondRoot],
      summary: {
        totalAgents: 2,
      },
    });
    expect(body.agents.map((agent: { id: string; agentsDir: string }) => [agent.id, agent.agentsDir])).toEqual([
      ['public_agent', secondRoot],
      ['example', root],
    ]);
  });

  it('reports duplicate agent ids across multiple roots as a coverage error', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-a-'));
    secondRoot = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-b-'));
    for (const dir of [root, secondRoot]) {
      writeAgent(dir, 'example', `
routes:
  - channel: telegram
    scope: dm
    peers: ["123456789"]
safety_profile: chat_like_anthroclaw
mcp_onboarding:
  enabled: false
`);
    }

    const result = auditPiExpansionReadiness({ agentsDir: root, agentsDirs: [root, secondRoot] });

    expect(result.coverageGap).toBe(true);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: 'example',
        error: expect.stringContaining('duplicate agent id'),
      }),
    ]));
  });

  it('fails packet coverage when high-risk audited agents have no expansion packet', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-'));
    secondRoot = mkdtempSync(join(tmpdir(), 'pi-expansion-packets-'));
    writeAgent(root, 'group-agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_anthroclaw
mcp_tools:
  - manage_cron
`);
    writeAgent(root, 'example', `
routes:
  - channel: telegram
    scope: dm
    peers: ["123456789"]
safety_profile: chat_like_anthroclaw
mcp_onboarding:
  enabled: false
`);

    const result = auditPiExpansionReadiness({
      agentsDir: root,
      requirePacketsDir: secondRoot,
    });

    expect(result.packetCoverageGap).toBe(true);
    expect(result.packetCoverage).toMatchObject({
      packetsDir: secondRoot,
      requiredAgents: ['group-agent'],
      present: [],
      missing: ['group-agent'],
    });
  });

  it('passes packet coverage when high-risk audited agents have expansion packets', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-'));
    secondRoot = mkdtempSync(join(tmpdir(), 'pi-expansion-packets-'));
    writeAgent(root, 'group-agent', `
routes:
  - channel: telegram
    scope: group
safety_profile: chat_like_anthroclaw
mcp_tools:
  - manage_cron
`);
    writeFileSync(join(secondRoot, 'group-agent.md'), '# packet\n', 'utf8');

    const stdout = createWriter();
    const stderr = createWriter();
    const code = await runPiExpansionAuditCli([
      '--agents-dir', root,
      '--require-packets-dir', secondRoot,
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body.packetCoverageGap).toBe(false);
    expect(body.packetCoverage).toMatchObject({
      requiredAgents: ['group-agent'],
      present: ['group-agent'],
      missing: [],
    });
  });

  it('parses flags narrowly', () => {
    expect(parsePiExpansionAuditArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--agents-dir', '/tmp/live-agents',
      '--agent', 'example',
      '--expect-agent', 'example',
      '--expect-agent', 'public_agent',
      '--require-packets-dir', '/tmp/packets',
      '--max-risk', 'high',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      agentsDirs: ['/tmp/agents', '/tmp/live-agents'],
      agent: 'example',
      expectAgents: ['example', 'public_agent'],
      requirePacketsDir: '/tmp/packets',
      maxRisk: 'high',
      json: true,
    });
    expect(() => parsePiExpansionAuditArgs(['--max-risk', 'extreme'])).toThrow(/must be one of/);
    expect(() => parsePiExpansionAuditArgs(['--wat'])).toThrow(/Unknown argument/);
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
