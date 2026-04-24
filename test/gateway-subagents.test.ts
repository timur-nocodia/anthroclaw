import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the SDK so tests don't require real auth or spawn SDK processes.
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: vi.fn(async () => { throw new Error('mocked: no SDK in tests'); }),
  };
});

import { Gateway } from '../src/gateway.js';
import type { GlobalConfig } from '../src/config/schema.js';
import { metrics } from '../src/metrics/collector.js';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function minimalConfig(): GlobalConfig {
  return {
    defaults: {
      model: 'claude-sonnet-4-6',
      embedding_provider: 'openai',
      embedding_model: 'text-embedding-3-small',
      debounce_ms: 0,
    },
  };
}

function writeAgentYml(dir: string, content: string): void {
  writeFileSync(join(dir, 'agent.yml'), content);
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('Gateway subagents', () => {
  let tmpDir: string;
  let agentsDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gw-subagents-'));
    agentsDir = join(tmpDir, 'agents');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('buildSubagents returns agent definitions when subagents are configured', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
model: claude-haiku-3-5
mcp_tools:
  - memory_search
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    expect(mainAgent).toBeDefined();

    const result = gw.buildSubagents(mainAgent);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('helper');
    expect(result!.helper.description).toContain('Delegate tasks to the helper agent');
    expect(result!.helper.model).toBe('claude-haiku-3-5');
    expect(result!.helper.prompt).toContain('helper');
    expect(result!.helper.tools).toBeDefined();
    expect(result!.helper.tools).toContain('Read');
    expect(result!.helper.tools).toContain('mcp__helper-subagent-tools__memory_search');
    expect(result!.helper.tools).not.toContain('ListMcpResources');
    expect(result!.helper.mcpServers).toEqual([
      expect.objectContaining({
        'helper-subagent-tools': expect.objectContaining({
          type: 'stdio',
          command: process.execPath,
        }),
      }),
    ]);

    await gw.stop();
  });

  it('buildSubagents applies role write policy without custom subagent runtime', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
  roles:
    helper:
      kind: explorer
      write_policy: deny
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
mcp_tools:
  - memory_search
  - memory_write
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    const result = gw.buildSubagents(mainAgent);

    expect(result!.helper.description).toContain('role=explorer');
    expect(result!.helper.description).toContain('write_policy=deny');
    expect(result!.helper.tools).toContain('Read');
    expect(result!.helper.tools).toContain('mcp__helper-subagent-tools__memory_search');
    expect(result!.helper.tools).not.toContain('Write');
    expect(result!.helper.tools).not.toContain('Edit');
    expect(result!.helper.tools).not.toContain('Bash');
    expect(result!.helper.tools).not.toContain('mcp__helper-subagent-tools__memory_write');

    await gw.stop();
  });

  it('buildSubagents treats max_spawn_depth as SDK delegation-surface policy', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
  max_spawn_depth: 1
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
subagents:
  allow:
    - leaf
`);

    const leafDir = join(agentsDir, 'leaf');
    mkdirSync(leafDir);
    writeAgentYml(leafDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-leaf"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    const result = gw.buildSubagents(mainAgent);

    expect(result!.helper.tools).not.toContain('Task');

    await gw.stop();
  });

  it('buildSubagents returns undefined when no subagents configured', async () => {
    const botDir = join(agentsDir, 'solo-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const agent = gw._agents.get('solo-bot')!;
    const result = gw.buildSubagents(agent);
    expect(result).toBeUndefined();

    await gw.stop();
  });

  it('buildSubagents skips unknown agent IDs in allow list', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
subagents:
  allow:
    - nonexistent-agent
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    const result = gw.buildSubagents(mainAgent);
    // All agents in allow list are missing, so should return undefined
    expect(result).toBeUndefined();

    await gw.stop();
  });

  it('buildSubagents reads CLAUDE.md for subagent prompt', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);
    writeFileSync(join(helperDir, 'CLAUDE.md'), 'You are a helpful assistant that specializes in research.');

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    const result = gw.buildSubagents(mainAgent);
    expect(result).toBeDefined();
    expect(result!.helper.prompt).toBe('You are a helpful assistant that specializes in research.');

    await gw.stop();
  });

  it('buildSubagents uses default prompt when CLAUDE.md is absent', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);
    // No CLAUDE.md

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    const result = gw.buildSubagents(mainAgent);
    expect(result).toBeDefined();
    expect(result!.helper.prompt).toBe('You are the helper agent.');

    await gw.stop();
  });

  it('buildSubagents handles multiple subagents', async () => {
    const mainDir = join(agentsDir, 'orchestrator');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-orch"]
subagents:
  allow:
    - worker-a
    - worker-b
`);

    const workerADir = join(agentsDir, 'worker-a');
    mkdirSync(workerADir);
    writeAgentYml(workerADir, `
model: claude-haiku-3-5
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-wa"]
`);

    const workerBDir = join(agentsDir, 'worker-b');
    mkdirSync(workerBDir);
    writeAgentYml(workerBDir, `
model: claude-sonnet-4-6
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-wb"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const orchestrator = gw._agents.get('orchestrator')!;
    const result = gw.buildSubagents(orchestrator);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toHaveLength(2);
    expect(result!['worker-a']).toBeDefined();
    expect(result!['worker-b']).toBeDefined();
    expect(result!['worker-a'].model).toBe('claude-haiku-3-5');
    expect(result!['worker-b'].model).toBe('claude-sonnet-4-6');
    expect(result!['worker-a'].tools).toContain('Read');
    expect(result!['worker-b'].tools).toContain('Read');
    expect(result!['worker-a'].mcpServers).toBeUndefined();
    expect(result!['worker-b'].mcpServers).toBeUndefined();

    await gw.stop();
  });

  it('buildSubagents keeps only the portable stdio-safe subset of MCP tools', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
mcp_tools:
  - memory_search
  - session_search
  - manage_cron
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    const result = gw.buildSubagents(mainAgent);
    expect(result).toBeDefined();
    expect(result!.helper.tools).toContain('mcp__helper-subagent-tools__memory_search');
    expect(result!.helper.tools).toContain('mcp__helper-subagent-tools__session_search');
    expect(result!.helper.tools).not.toContain('mcp__helper-subagent-tools__manage_cron');
    expect(result!.helper.mcpServers).toEqual([
      expect.objectContaining({
        'helper-subagent-tools': expect.any(Object),
      }),
    ]);

    await gw.stop();
  });

  it('buildSubagents skips MCP wiring when no portable subagent MCP tools exist', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
mcp_tools:
  - manage_cron
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    const result = gw.buildSubagents(mainAgent);
    expect(result).toBeDefined();
    expect(result!.helper.tools).toContain('Read');
    expect(result!.helper.tools.some((tool) => tool.startsWith('mcp__'))).toBe(false);
    expect(result!.helper.mcpServers).toBeUndefined();

    await gw.stop();
  });

  it('buildSubagents includes only found agents when some are missing', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
    - missing-agent
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    const result = gw.buildSubagents(mainAgent);
    expect(result).toBeDefined();
    expect(Object.keys(result!)).toHaveLength(1);
    expect(result!.helper).toBeDefined();
    expect(result!['missing-agent']).toBeUndefined();

    await gw.stop();
  });

  it('tracks subagent runs through the always-on SDK hook bridge', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    mainAgent.setSessionId('web:main-agent:temp-1', 'sdk-session-1');

    const emitter = gw._hookEmitters.get('main-agent');
    expect(emitter).toBeDefined();

    await emitter!.emit('on_subagent_start', {
      source: 'claude-agent-sdk',
      agentId: 'main-agent',
      sdkSessionId: 'sdk-session-1',
      transcriptPath: '/tmp/parent.jsonl',
      cwd: '/tmp/workspace',
      subagentId: 'helper',
      subagentType: 'research',
    });

    await emitter!.emit('on_subagent_stop', {
      source: 'claude-agent-sdk',
      agentId: 'main-agent',
      sdkSessionId: 'sdk-session-1',
      transcriptPath: '/tmp/parent.jsonl',
      cwd: '/tmp/workspace',
      subagentId: 'helper',
      subagentType: 'research',
      subagentTranscriptPath: '/tmp/subagent.jsonl',
      lastAssistantMessage: 'Finished task',
    });

    const runs = gw.listAgentSubagentRuns('main-agent');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      agentId: 'main-agent',
      parentSessionId: 'sdk-session-1',
      parentSessionKeys: ['web:main-agent:temp-1'],
      subagentId: 'helper',
      subagentType: 'research',
      status: 'completed',
      parentTranscriptPath: '/tmp/parent.jsonl',
      subagentTranscriptPath: '/tmp/subagent.jsonl',
      lastAssistantMessage: 'Finished task',
    });

    const detail = gw.getAgentSubagentRun('main-agent', runs[0].runId);
    expect(detail).toMatchObject({
      runId: runs[0].runId,
      interruptSupported: false,
    });
    expect(detail?.interruptReason).toContain('already finished');

    await gw.stop();
  });

  it('marks a running subagent as interruptable only through the parent session handle', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    mainAgent.setSessionId('web:main-agent:web-session', 'sdk-session-1');

    const interrupt = vi.fn(async () => {});
    gw._controlRegistry.register(
      ['main-agent:telegram:dm:peer-main', 'sdk-session-1'],
      { interrupt, close: vi.fn() } as any,
      new AbortController(),
    );

    const emitter = gw._hookEmitters.get('main-agent')!;
    await emitter.emit('on_subagent_start', {
      sdkSessionId: 'sdk-session-1',
      subagentId: 'helper',
      subagentType: 'research',
    });

    const run = gw.listAgentSubagentRuns('main-agent', { status: 'running' })[0];
    const now = Date.now();
    gw._fileOwnershipRegistry.claim({
      sessionKey: 'web:main-agent:web-session',
      runId: 'other-run',
      subagentId: 'other-helper',
      path: '/tmp/workspace/src/app.ts',
      mode: 'write',
    }, 'soft', now);
    const ownershipDecision = gw._fileOwnershipRegistry.claim({
      sessionKey: 'web:main-agent:web-session',
      runId: run.runId,
      subagentId: 'helper',
      path: '/tmp/workspace/src/app.ts',
      mode: 'write',
    }, 'soft', now + 1);
    metrics.recordFileOwnershipEvent({
      agentId: 'main-agent',
      sessionKey: 'web:main-agent:web-session',
      runId: run.runId,
      subagentId: 'helper',
      path: '/tmp/workspace/src/app.ts',
      eventType: 'conflict',
      action: 'allow',
      reason: 'soft file ownership records conflict and allows the claim',
    });

    const enrichedRuns = gw.listAgentSubagentRuns('main-agent', { status: 'running' });
    expect(enrichedRuns[0].ownership.claims).toMatchObject([{
      claimId: ownershipDecision.claim!.claimId,
      runId: run.runId,
      subagentId: 'helper',
      path: '/tmp/workspace/src/app.ts',
      mode: 'write',
    }]);
    expect(enrichedRuns[0].ownership.conflicts).toHaveLength(1);
    expect(enrichedRuns[0].ownership.events).toMatchObject([{
      eventType: 'conflict',
      action: 'allow',
      runId: run.runId,
      path: '/tmp/workspace/src/app.ts',
    }]);

    const detail = gw.getAgentSubagentRun('main-agent', run.runId);

    expect(detail).toMatchObject({
      runId: run.runId,
      status: 'running',
      interruptSupported: true,
      interruptScope: 'parent_session',
      ownership: {
        claims: [{
          claimId: ownershipDecision.claim!.claimId,
          runId: run.runId,
          subagentId: 'helper',
          path: '/tmp/workspace/src/app.ts',
          mode: 'write',
        }],
        conflicts: [{
          action: 'allow',
          requested: {
            runId: run.runId,
          },
          existing: {
            runId: 'other-run',
          },
        }],
        events: [{
          eventType: 'conflict',
          action: 'allow',
          runId: run.runId,
        }],
      },
    });
    expect(detail?.interruptReason).toContain('parent agent query');

    const result = await gw.interruptAgentSubagentRun('main-agent', run.runId);
    expect(result).toEqual({
      runId: run.runId,
      parentSessionId: 'sdk-session-1',
      interrupted: true,
      interruptScope: 'parent_session',
      reason: 'Parent query interrupt requested successfully.',
    });
    expect(interrupt).toHaveBeenCalledTimes(1);

    await gw.stop();
  });

  it('filters tracked runs by aliased session id', async () => {
    const mainDir = join(agentsDir, 'main-agent');
    mkdirSync(mainDir);
    writeAgentYml(mainDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-main"]
subagents:
  allow:
    - helper
`);

    const helperDir = join(agentsDir, 'helper');
    mkdirSync(helperDir);
    writeAgentYml(helperDir, `
routes:
  - channel: telegram
    scope: dm
    peers: ["peer-helper"]
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const mainAgent = gw._agents.get('main-agent')!;
    mainAgent.setSessionId('web:main-agent:web-session', 'sdk-session-1');

    const emitter = gw._hookEmitters.get('main-agent')!;
    await emitter.emit('on_subagent_start', {
      sdkSessionId: 'sdk-session-1',
      subagentId: 'helper',
    });

    expect(gw.listAgentSubagentRuns('main-agent', { sessionId: 'web-session' })).toHaveLength(1);
    expect(gw.listAgentSubagentRuns('main-agent', { sessionId: 'missing' })).toHaveLength(0);

    await gw.stop();
  });
});
