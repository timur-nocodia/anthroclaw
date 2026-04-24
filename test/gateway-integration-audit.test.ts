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
    brave: {
      api_key: 'brave-key',
    },
  };
}

describe('Gateway integration audit', () => {
  let tmpDir: string;
  let agentsDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gw-integration-audit-'));
    agentsDir = join(tmpDir, 'agents');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('records integration audit events from SDK hook bridge payloads', async () => {
    const agentDir = join(agentsDir, 'main-agent');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'agent.yml'), `
routes:
  - channel: telegram
    scope: dm
mcp_tools:
  - web_search_brave
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const emitter = gw._hookEmitters.get('main-agent')!;
    await emitter.emit('on_tool_use', {
      source: 'claude-agent-sdk',
      agentId: 'main-agent',
      sdkSessionId: 'sdk-session-1',
      toolName: 'mcp__main-agent-tools__web_search_brave',
    });
    await emitter.emit('on_tool_result', {
      source: 'claude-agent-sdk',
      agentId: 'main-agent',
      sdkSessionId: 'sdk-session-1',
      toolName: 'mcp__main-agent-tools__web_search_brave',
    });

    expect(gw.listIntegrationAuditEvents({ provider: 'brave' })).toMatchObject([
      {
        agentId: 'main-agent',
        sdkSessionId: 'sdk-session-1',
        toolName: 'mcp__main-agent-tools__web_search_brave',
        provider: 'brave',
        capabilityId: 'web.brave',
        status: 'completed',
      },
      {
        status: 'started',
      },
    ]);

    await gw.stop();
  });

  it('records external MCP integration audit events by server name', async () => {
    const agentDir = join(agentsDir, 'ops-agent');
    mkdirSync(agentDir);
    writeFileSync(join(agentDir, 'agent.yml'), `
routes:
  - channel: telegram
    scope: dm
external_mcp_servers:
  calendar:
    type: stdio
    command: npx
    args:
      - google-calendar-mcp
    allowed_tools:
      - calendar_daily_brief
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const emitter = gw._hookEmitters.get('ops-agent')!;
    await emitter.emit('on_tool_use', {
      source: 'claude-agent-sdk',
      agentId: 'ops-agent',
      sdkSessionId: 'sdk-session-2',
      toolName: 'mcp__calendar__calendar_daily_brief',
    });

    expect(gw.listIntegrationAuditEvents({ provider: 'calendar' })).toMatchObject([
      {
        agentId: 'ops-agent',
        sdkSessionId: 'sdk-session-2',
        toolName: 'mcp__calendar__calendar_daily_brief',
        provider: 'calendar',
        capabilityId: 'external_mcp.calendar',
        status: 'started',
      },
    ]);

    await gw.stop();
  });
});
