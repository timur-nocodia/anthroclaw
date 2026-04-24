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
    tmpDir = mkdtempSync(join(tmpdir(), 'gw-memory-hook-'));
    agentsDir = join(tmpDir, 'agents');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
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
});
