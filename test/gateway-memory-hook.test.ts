import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('Gateway memory write hook', () => {
  let tmpDir: string;
  let agentsDir: string;
  let dataDir: string;

  beforeEach(() => {
    metrics._reset();
    tmpDir = mkdtempSync(join(tmpdir(), 'gw-memory-hook-'));
    agentsDir = join(tmpDir, 'agents');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    metrics._reset();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('emits on_memory_write from the memory_write tool without exposing memory text', async () => {
    const agentDir = join(agentsDir, 'memory-agent');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'agent.yml'), `
routes:
  - channel: telegram
    scope: dm
mcp_tools:
  - memory_write
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const events: Record<string, unknown>[] = [];
    gw._hookEmitters.get('memory-agent')!.subscribe('on_memory_write', (payload) => {
      events.push(payload);
    });

    const tool = gw.getAgent('memory-agent')!.tools.find((item) => item.name === 'memory_write')!;
    await tool.handler({ file: 'memory/test.md', content: 'secret durable fact' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agentId: 'memory-agent',
      file: 'memory/test.md',
      mode: 'append',
      contentLength: 'secret durable fact'.length,
      entryPath: 'memory/test.md',
      source: 'memory_write',
      reviewStatus: 'approved',
    });
    expect(JSON.stringify(events[0])).not.toContain('secret durable fact');

    await gw.stop();
  });

  it('records memory_search influence refs from SDK hook output', async () => {
    const agentDir = join(agentsDir, 'memory-agent');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'agent.yml'), `
routes:
  - channel: telegram
    scope: dm
mcp_tools:
  - memory_search
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);
    metrics.recordAgentRunStart({
      runId: 'run-1',
      agentId: 'memory-agent',
      sessionKey: 'telegram:memory-agent:peer',
      sdkSessionId: 'sdk-session-1',
      source: 'channel',
      channel: 'telegram',
      status: 'running',
    });

    await gw._hookEmitters.get('memory-agent')!.emit('on_tool_result', {
      agentId: 'memory-agent',
      sdkSessionId: 'sdk-session-1',
      toolName: 'mcp__memory-agent-tools__memory_search',
      toolInput: { query: 'owner' },
      toolResponse: {
        content: [{
          type: 'text',
          text: '<memory-context>\n**memory/profile.md#L1-L3** (score: 0.42)\nOwner: Alice\n</memory-context>',
        }],
      },
    });

    expect(gw.listMemoryInfluenceEvents({ agentId: 'memory-agent', source: 'memory_search' })).toMatchObject([{
      agentId: 'memory-agent',
      sessionKey: 'telegram:memory-agent:peer',
      runId: 'run-1',
      sdkSessionId: 'sdk-session-1',
      source: 'memory_search',
      query: 'owner',
      refs: [{
        path: 'memory/profile.md',
        startLine: 1,
        endLine: 3,
        score: 0.42,
      }],
    }]);

    await gw.stop();
  });
});
