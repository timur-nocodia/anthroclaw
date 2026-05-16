import { describe, expect, it, vi } from 'vitest';
import {
  buildClaudeRuntimeOptions,
  claudeAgentSdkRuntime,
  ClaudeRuntimeRunHandle,
  createClaudeSdkMcpServer,
  initializeClaudeAgentRuntime,
  runClaudeAgentHandle,
  runClaudeAgentQuery,
  startClaudeAgentRuntime,
} from '../claude-agent-sdk.js';
import { buildSdkOptions } from '../../sdk/options.js';
import { query, startup, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
  startup: vi.fn(),
  createSdkMcpServer: vi.fn(),
}));

vi.mock('../../sdk/options.js', () => ({
  buildSdkOptions: vi.fn(),
}));

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const mockedStartup = startup as unknown as ReturnType<typeof vi.fn>;
const mockedCreateSdkMcpServer = createSdkMcpServer as unknown as ReturnType<typeof vi.fn>;
const mockedBuildSdkOptions = buildSdkOptions as unknown as ReturnType<typeof vi.fn>;

describe('claude-agent-sdk runtime adapter', () => {
  it('advertises the current Claude runtime capabilities', () => {
    expect(claudeAgentSdkRuntime).toMatchObject({
      id: 'claude-agent-sdk',
      capabilities: {
        streaming: true,
        sessions: true,
        interrupt: true,
        approvals: true,
        mcp: true,
        subagents: true,
        checkpoints: true,
        warmStart: true,
      },
    });
  });

  it('delegates options construction to buildSdkOptions', () => {
    const options = { model: 'claude-sonnet-4-6' };
    mockedBuildSdkOptions.mockReturnValueOnce(options);

    const params = { agent: { id: 'agent-1' } };
    expect(buildClaudeRuntimeOptions(params as any)).toBe(options);
    expect(mockedBuildSdkOptions).toHaveBeenCalledWith(params);
  });

  it('delegates query calls without changing prompt or options', () => {
    const stream = { [Symbol.asyncIterator]: vi.fn() };
    mockedQuery.mockReturnValueOnce(stream);
    const options = { model: 'claude-sonnet-4-6' };

    expect(runClaudeAgentQuery({ prompt: 'hello', options: options as any })).toBe(stream);
    expect(mockedQuery).toHaveBeenCalledWith({ prompt: 'hello', options });
  });

  it('creates runtime run handles over Claude Query objects', async () => {
    const events = (async function* () {
      yield { type: 'assistant', message: { content: [] } };
      yield { type: 'result', result: 'done' };
    })();
    const queryHandle = {
      [Symbol.asyncIterator]: () => events,
      interrupt: vi.fn(async () => undefined),
      close: vi.fn(),
      rewindFiles: vi.fn(async () => ({ canRewind: true, filesChanged: ['a.ts'] })),
    };
    mockedQuery.mockReturnValueOnce(queryHandle);

    const handle = runClaudeAgentHandle({ prompt: 'hello', options: { model: 'x' } as any });
    expect(handle).toBeInstanceOf(ClaudeRuntimeRunHandle);
    expect(handle.query).toBe(queryHandle);

    const seen: unknown[] = [];
    for await (const event of handle) {
      seen.push(event);
    }
    expect(seen).toEqual([
      { type: 'assistant', message: { content: [] } },
      { type: 'result', result: 'done' },
    ]);

    await expect(handle.interrupt()).resolves.toBeUndefined();
    expect(queryHandle.interrupt).toHaveBeenCalledTimes(1);

    await expect(handle.rewindFiles('msg-1', { dryRun: true })).resolves.toEqual({
      canRewind: true,
      filesChanged: ['a.ts'],
    });
    expect(queryHandle.rewindFiles).toHaveBeenCalledWith('msg-1', { dryRun: true });

    handle.close();
    expect(queryHandle.close).toHaveBeenCalledTimes(1);
  });

  it('exposes run() on the adapter for new runtime-handle callers', () => {
    const queryHandle = {
      [Symbol.asyncIterator]: () => (async function* () {})(),
      interrupt: vi.fn(async () => undefined),
      close: vi.fn(),
      rewindFiles: vi.fn(),
    };
    mockedQuery.mockReturnValueOnce(queryHandle);

    const handle = claudeAgentSdkRuntime.run?.({ prompt: 'hello', options: { model: 'x' } as any });
    expect(handle).toBeInstanceOf(ClaudeRuntimeRunHandle);
    expect(mockedQuery).toHaveBeenCalledWith({ prompt: 'hello', options: { model: 'x' } });
  });

  it('delegates startup calls with and without options', async () => {
    const warm = { close: vi.fn() };
    mockedStartup.mockResolvedValueOnce(warm).mockResolvedValueOnce(warm);

    await expect(startClaudeAgentRuntime({ options: { model: 'x' } as any })).resolves.toBe(warm);
    expect(mockedStartup).toHaveBeenNthCalledWith(1, { options: { model: 'x' } });

    await expect(initializeClaudeAgentRuntime()).resolves.toBe(warm);
    expect(mockedStartup).toHaveBeenNthCalledWith(2);
  });

  it('delegates MCP server creation without changing tool definitions', () => {
    const server = { name: 'agent-tools' };
    mockedCreateSdkMcpServer.mockReturnValueOnce(server);
    const tools = [{ name: 'send_message' }];

    expect(createClaudeSdkMcpServer({ name: 'agent-tools', tools })).toBe(server);
    expect(mockedCreateSdkMcpServer).toHaveBeenCalledWith({ name: 'agent-tools', tools });
  });
});
