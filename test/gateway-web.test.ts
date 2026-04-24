import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the SDK so gateway tests don't require real auth or spawn SDK processes.
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>();
  return {
    ...real,
    startup: vi.fn(async () => { throw new Error('mocked: no SDK in tests'); }),
  };
});

import { Gateway } from '../src/gateway.js';
import { Agent } from '../src/agent/agent.js';
import type { GlobalConfig } from '../src/config/schema.js';

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

describe('Gateway public methods', () => {
  let tmpDir: string;
  let agentsDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'gw-web-test-'));
    agentsDir = join(tmpDir, 'agents');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentsDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── getStatus ────────────────────────────────────────────────────

  it('getStatus() returns correct structure', async () => {
    const botDir = join(agentsDir, 'status-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
pairing:
  mode: open
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const status = gw.getStatus();

    expect(typeof status.uptime).toBe('number');
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.agents).toEqual(['status-bot']);
    expect(typeof status.activeSessions).toBe('number');
    expect(status.activeSessions).toBe(0);
    expect(status.nodeVersion).toMatch(/^v\d+/);
    expect(typeof status.platform).toBe('string');
    expect(status.channels).toHaveProperty('telegram');
    expect(status.channels).toHaveProperty('whatsapp');
    expect(Array.isArray(status.channels.telegram)).toBe(true);
    expect(Array.isArray(status.channels.whatsapp)).toBe(true);

    await gw.stop();
  });

  it('getStatus() returns multiple agents', async () => {
    const botA = join(agentsDir, 'bot-a');
    const botB = join(agentsDir, 'bot-b');
    mkdirSync(botA);
    mkdirSync(botB);

    writeAgentYml(botA, `
routes:
  - channel: telegram
    scope: dm
`);
    writeAgentYml(botB, `
routes:
  - channel: telegram
    scope: group
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const status = gw.getStatus();
    expect(status.agents).toHaveLength(2);
    expect(status.agents).toContain('bot-a');
    expect(status.agents).toContain('bot-b');

    await gw.stop();
  });

  // ─── getAgent ─────────────────────────────────────────────────────

  it('getAgent() returns agent by ID', async () => {
    const botDir = join(agentsDir, 'my-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const agent = gw.getAgent('my-bot');
    expect(agent).toBeDefined();
    expect(agent!.id).toBe('my-bot');

    await gw.stop();
  });

  it('getAgent() returns undefined for unknown ID', async () => {
    const botDir = join(agentsDir, 'my-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const agent = gw.getAgent('nonexistent');
    expect(agent).toBeUndefined();

    await gw.stop();
  });

  // ─── getAgentList ─────────────────────────────────────────────────

  it('getAgentList() returns all agents', async () => {
    const botA = join(agentsDir, 'alpha');
    const botB = join(agentsDir, 'beta');
    mkdirSync(botA);
    mkdirSync(botB);

    writeAgentYml(botA, `
routes:
  - channel: telegram
    scope: dm
`);
    writeAgentYml(botB, `
routes:
  - channel: whatsapp
    scope: dm
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const agents = gw.getAgentList();
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id).sort()).toEqual(['alpha', 'beta']);

    await gw.stop();
  });

  it('getAgentList() returns empty array when no agents', async () => {
    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const agents = gw.getAgentList();
    expect(agents).toEqual([]);

    await gw.stop();
  });

  // ─── getGlobalConfig / getAgentsDir / getDataDir ─────────────────

  it('getGlobalConfig() returns the config', async () => {
    const config = minimalConfig();
    const gw = new Gateway();
    await gw.start(config, agentsDir, dataDir);

    const result = gw.getGlobalConfig();
    expect(result).toEqual(config);

    await gw.stop();
  });

  it('getAgentsDir() returns agents directory', async () => {
    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    expect(gw.getAgentsDir()).toBe(agentsDir);

    await gw.stop();
  });

  it('getDataDir() returns data directory', async () => {
    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    expect(gw.getDataDir()).toBe(dataDir);

    await gw.stop();
  });

  // ─── dispatchWebUI (fallback path — SDK not ready) ────────────────

  it('dispatchWebUI sends fallback when SDK not ready', async () => {
    const botDir = join(agentsDir, 'web-bot');
    mkdirSync(botDir);
    writeAgentYml(botDir, `
routes:
  - channel: telegram
    scope: dm
`);

    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    const textParts: string[] = [];
    let doneSessionId = '';
    let doneTotalTokens = -1;

    await gw.dispatchWebUI('web-bot', 'hello', undefined, {}, {
      onText: (chunk) => textParts.push(chunk),
      onToolCall: () => {},
      onToolResult: () => {},
      onDone: (sid, tokens) => { doneSessionId = sid; doneTotalTokens = tokens; },
      onError: () => {},
    });

    expect(textParts.join('')).toContain('Agent web-bot received: hello');
    expect(doneTotalTokens).toBe(0);
    expect(doneSessionId).toBeTruthy();

    await gw.stop();
  });

  it('dispatchWebUI calls onError for unknown agent', async () => {
    const gw = new Gateway();
    await gw.start(minimalConfig(), agentsDir, dataDir);

    let errorMsg = '';
    await gw.dispatchWebUI('nonexistent', 'hello', undefined, {}, {
      onText: () => {},
      onToolCall: () => {},
      onToolResult: () => {},
      onDone: () => {},
      onError: (err) => { errorMsg = err.message; },
    });

    expect(errorMsg).toContain('nonexistent');
    expect(errorMsg).toContain('not found');

    await gw.stop();
  });
});

describe('Agent public methods', () => {
  let tmpDir: string;
  let agentDir: string;
  let dataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agent-pub-test-'));
    agentDir = join(tmpDir, 'my-bot');
    dataDir = join(tmpDir, 'data');
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeMinimalAgentYml(dir: string): void {
    writeFileSync(
      join(dir, 'agent.yml'),
      `routes:
  - channel: telegram
    scope: dm
`,
    );
  }

  // ─── getSessionCount ──────────────────────────────────────────────

  it('getSessionCount() returns 0 initially', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);
    expect(agent.getSessionCount()).toBe(0);
  });

  it('getSessionCount() reflects active sessions', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    agent.setSessionId('key-1', 'sess-a');
    agent.setSessionId('key-2', 'sess-b');
    expect(agent.getSessionCount()).toBe(2);

    agent.clearSession('key-1');
    expect(agent.getSessionCount()).toBe(1);
  });

  // ─── getSessionIdByValue ──────────────────────────────────────────

  it('getSessionIdByValue() finds existing session ID', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    agent.setSessionId('key-1', 'sess-abc');

    const found = agent.getSessionIdByValue('sess-abc');
    expect(found).toBe('sess-abc');
  });

  it('getSessionIdByValue() returns undefined for nonexistent value', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    agent.setSessionId('key-1', 'sess-abc');

    const found = agent.getSessionIdByValue('sess-xyz');
    expect(found).toBeUndefined();
  });

  it('getSessionIdByValue() returns undefined when no sessions', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    const found = agent.getSessionIdByValue('anything');
    expect(found).toBeUndefined();
  });

  it('listSessionMappings() exposes aliases for SDK session IDs', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    agent.setSessionId('web:my-bot:sess-temp', 'sdk-session-1');
    agent.setSessionId('web:my-bot:sdk-session-1', 'sdk-session-1');
    agent.incrementMessageCount('web:my-bot:sess-temp');

    expect(agent.listSessionMappings()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionKey: 'web:my-bot:sess-temp',
        sessionId: 'sdk-session-1',
        messageCount: 1,
      }),
      expect.objectContaining({
        sessionKey: 'web:my-bot:sdk-session-1',
        sessionId: 'sdk-session-1',
        messageCount: 0,
      }),
    ]));
  });

  it('clearSessionByValue() removes all aliases for an SDK session ID', async () => {
    writeMinimalAgentYml(agentDir);
    const agent = await Agent.load(agentDir, dataDir);

    agent.setSessionId('web:my-bot:sess-temp', 'sdk-session-1');
    agent.setSessionId('web:my-bot:sdk-session-1', 'sdk-session-1');
    agent.setSessionId('web:my-bot:other', 'sdk-session-2');

    expect(agent.clearSessionByValue('sdk-session-1')).toBe(2);
    expect(agent.getSessionId('web:my-bot:sess-temp')).toBeUndefined();
    expect(agent.getSessionId('web:my-bot:sdk-session-1')).toBeUndefined();
    expect(agent.getSessionId('web:my-bot:other')).toBe('sdk-session-2');
  });
});
