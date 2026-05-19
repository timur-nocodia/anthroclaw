import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { InboundMessage } from '../../channels/types.js';
import { analyzeToolEvents, runMemoryReadGate } from '../side-effect-gates/memory-read.js';

describe('memory-read side-effect gate', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `anthroclaw-memory-read-gate-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('exercises read-only memory/session/local-note controls for an arbitrary agent in an isolated workspace', async () => {
    const agentId = 'custom_memory_agent';
    const peerId = 'peer-memory-42';
    const expectedResponse = 'CUSTOM_MEMORY_AGENT_MEMORY_READ_OK';
    const sourceAgentsDir = join(root, 'source-agents');
    const sourceAgentDir = join(sourceAgentsDir, agentId);
    const workspace = join(root, 'workspace');
    mkdirSync(sourceAgentDir, { recursive: true });
    writeFileSync(join(sourceAgentDir, 'agent.yml'), [
      'model: test-model',
      'runtime:',
      '  headless:',
      '    provider: pi',
      'safety_profile: private',
      'routes:',
      '  - channel: telegram',
      '    scope: dm',
      '    peers: [ "peer-memory-42" ]',
      'allowlist:',
      '  telegram: [ "peer-memory-42" ]',
      'mcp_tools:',
      '  - memory_search',
      '  - session_search',
      '  - local_note_search',
    ].join('\n'), 'utf8');

    const FakeGateway = createFakeGatewayCtor({
      agentId,
      expectedResponse,
    });
    const result = await runMemoryReadGate({
      GatewayCtor: FakeGateway,
      agentId,
      sourceAgentsDir,
      workspace,
      pluginsDir: join(root, 'plugins'),
      peerId,
      senderId: 'sender-memory-42',
      timeoutMs: 1_000,
      expectedResponse,
    });

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      agentId,
      gate: {
        id: 'memory-read',
        spec: {
          gateId: 'memory-read',
          agentId,
          risk: 'read_only',
          action: 'mcp.call',
          target: {
            channel: 'telegram',
            accountId: 'default',
            peerId,
          },
        },
        validation: {
          ok: true,
          errors: [],
          warnings: [],
        },
      },
      normalizedText: expectedResponse,
      approvals: 0,
      sessionId: 'fake-session',
      toolEvidence: {
        required: {
          memory_search: { started: 1, completed: 1, failed: 0 },
          session_search: { started: 1, completed: 1, failed: 0 },
          local_note_search: { started: 1, completed: 1, failed: 0 },
        },
        forbidden: {
          send_message: { started: 0, completed: 0, failed: 0 },
        },
      },
    });
    expect(existsSync(join(workspace, 'agents', agentId, 'notes', 'memory-read-gate.md'))).toBe(true);
    expect(existsSync(join(workspace, 'data', 'sdk-sessions'))).toBe(true);
  });

  it('aggregates required and forbidden tool evidence with MCP prefixes', () => {
    const evidence = analyzeToolEvents([
      { toolName: 'mcp__custom-agent-tools__memory_search', status: 'started', count: 1 },
      { toolName: 'mcp__custom-agent-tools__memory_search', status: 'completed', count: 1 },
      { toolName: 'session_search', status: 'started', count: 1 },
      { toolName: 'session_search', status: 'completed', count: 1 },
      { toolName: 'local_note_search', status: 'started', count: 1 },
      { toolName: 'local_note_search', status: 'completed', count: 1 },
      { toolName: 'mcp__custom-agent-tools__send_message', status: 'started', count: 1 },
    ]);

    expect(evidence.required.memory_search).toEqual({ started: 1, completed: 1, failed: 0 });
    expect(evidence.required.session_search).toEqual({ started: 1, completed: 1, failed: 0 });
    expect(evidence.required.local_note_search).toEqual({ started: 1, completed: 1, failed: 0 });
    expect(evidence.forbidden.send_message).toEqual({ started: 1, completed: 0, failed: 0 });
  });
});

function createFakeGatewayCtor(input: { agentId: string; expectedResponse: string }) {
  return class FakeGateway {
    private dataDir = '';
    private channel?: { sendText(peerId: string, text: string): Promise<string> };
    private agent = {
      memoryStore: {
        indexed: [] as Array<{ path: string; content: string; metadata: unknown }>,
        indexFile(path: string, content: string, metadata: unknown) {
          this.indexed.push({ path, content, metadata });
        },
      },
    };

    async start(_config: unknown, _agentsDir: string, dataDir: string): Promise<void> {
      this.dataDir = dataDir;
      mkdirSync(dataDir, { recursive: true });
    }

    _setChannel(_channelId: string, channel: { sendText(peerId: string, text: string): Promise<string> }): void {
      this.channel = channel;
    }

    getAgent(agentId: string): typeof this.agent | null {
      return agentId === input.agentId ? this.agent : null;
    }

    listAgentRuns(): Array<{ runId: string; error?: string }> {
      return [];
    }

    async dispatch(message: InboundMessage): Promise<void> {
      writeMetrics(this.dataDir, input.agentId);
      if (!message.text.includes(input.expectedResponse)) {
        throw new Error('dispatch prompt did not include expected response marker');
      }
      await this.channel?.sendText(message.peerId, input.expectedResponse);
    }

    async listAgentSessions(): Promise<Array<{ sessionId: string }>> {
      return [{ sessionId: 'fake-session' }];
    }

    handleApprovalCallback(): void {}

    async stop(): Promise<void> {}
  } as unknown as new () => import('../../gateway.js').Gateway;
}

function writeMetrics(dataDir: string, agentId: string): void {
  const db = new Database(join(dataDir, 'metrics.sqlite'));
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_events (
        agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL
      );
    `);
    const insert = db.prepare('INSERT INTO tool_events(agent_id, tool_name, status) VALUES (?, ?, ?)');
    for (const tool of ['memory_search', 'session_search', 'local_note_search']) {
      insert.run(agentId, tool, 'started');
      insert.run(agentId, tool, 'completed');
    }
  } finally {
    db.close();
  }
}
