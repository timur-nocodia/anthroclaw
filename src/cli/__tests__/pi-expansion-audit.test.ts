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

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
  });

  it('classifies low-risk and high-risk production expansion candidates', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-'));
    writeAgent(root, 'example', `
routes:
  - channel: telegram
    scope: dm
allowlist:
  telegram: ["48705953"]
safety_profile: chat_like_openclaw
learning:
  enabled: true
  mode: propose
`);
    writeAgent(root, 'leads_agent', `
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
    writeAgent(root, 'project-manager', `
routes:
  - channel: telegram
    scope: group
    topics: ["8"]
safety_profile: chat_like_openclaw
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
    expect(result.agents.find((agent) => agent.id === 'leads_agent')).toMatchObject({
      risk: 'critical',
      recommendedRing: 'ring4',
      routes: ['whatsapp:dm'],
    });
    expect(result.agents.find((agent) => agent.id === 'leads_agent')?.blockers).toEqual(expect.arrayContaining([
      'public safety profile',
      'WhatsApp route',
      'operator escalation tool',
    ]));
    expect(result.agents.find((agent) => agent.id === 'project-manager')).toMatchObject({
      risk: 'high',
      recommendedRing: 'ring4',
    });
  });

  it('emits JSON and fails when max risk budget is exceeded', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-'));
    writeAgent(root, 'leads_agent', `
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
  });

  it('reports skipped directories and fails when expected live agents are absent', async () => {
    root = mkdtempSync(join(tmpdir(), 'pi-expansion-audit-'));
    writeAgent(root, 'example', `
routes:
  - channel: telegram
    scope: dm
    peers: ["48705953"]
safety_profile: chat_like_openclaw
`);
    mkdirSync(join(root, 'amina', 'credentials'), { recursive: true });
    writeFileSync(join(root, 'amina', 'credentials', 'mcp:test.enc'), 'encrypted', 'utf8');
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiExpansionAuditCli([
      '--agents-dir', root,
      '--expect-agent', 'leads_agent',
      '--json',
    ], { stdout, stderr });

    expect(code).toBe(1);
    expect(stderr.text()).toBe('');
    const body = JSON.parse(stdout.text());
    expect(body).toMatchObject({
      status: 'attention',
      coverageGap: true,
      expectedAgentsMissing: ['leads_agent'],
      skippedDirectories: [
        { name: 'amina', reason: 'missing agent.yml' },
      ],
    });
  });

  it('parses flags narrowly', () => {
    expect(parsePiExpansionAuditArgs([
      '--',
      '--agents-dir', '/tmp/agents',
      '--agent', 'example',
      '--expect-agent', 'example',
      '--expect-agent', 'leads_agent',
      '--max-risk', 'high',
      '--json',
    ])).toMatchObject({
      agentsDir: '/tmp/agents',
      agent: 'example',
      expectAgents: ['example', 'leads_agent'],
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
