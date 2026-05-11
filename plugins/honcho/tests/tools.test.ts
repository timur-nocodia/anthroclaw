import { describe, expect, it, vi } from 'vitest';
import { createHonchoTools } from '../src/tools.js';
import { resolveConfig, type HonchoConfig } from '../src/config.js';
import { buildHonchoSessionId } from '../src/ids.js';

describe('Honcho MCP tools', () => {
  it('registers the expected Honcho tool surface', () => {
    const tools = createHonchoTools({
      resolveConfig: () => resolveConfig({}, { enabled: true, mode: 'tools' }),
      resolveSdk: async () => ({}) as never,
    });

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'ask',
      'context',
      'search_conclusions',
      'search_messages',
      'session',
      'status',
    ]);
  });

  it('returns current session context using the dispatch session key', async () => {
    const session = {
      context: vi.fn(async () => ({ toString: () => 'session memory' })),
    };
    const sdk = {
      session: vi.fn(async () => session),
    };
    const tools = makeTools(sdk);
    const tool = tools.find((candidate) => candidate.name === 'context')!;

    const result = await tool.handler({ tokens: 512 }, {
      agentId: 'agent-a',
      sessionKey: 'agent-a:telegram:dm:user-1',
    });

    expect(sdk.session).toHaveBeenCalledWith(buildHonchoSessionId('agent-a:telegram:dm:user-1'));
    expect(session.context).toHaveBeenCalledWith({
      summary: true,
      tokens: 512,
      peerTarget: expect.any(String),
      peerPerspective: 'agent_agent-a',
      limitToSession: true,
    });
    expect(result.content[0].text).toContain('<honcho-context');
    expect(result.content[0].text).toContain('session memory');
  });

  it('renders real SessionContext fields from context/session tools', async () => {
    const session = {
      context: vi.fn(async () => ({
        messages: [{ peerId: 'user_abc', content: 'prefers short answers' }],
        summary: { content: 'Earlier summary' },
        peerRepresentation: 'Direct communication style.',
        peerCard: ['Uses Russian'],
        toString: () => 'SessionContext(messages=1, summary=present)',
      })),
      summaries: vi.fn(async () => ({
        shortSummary: { content: 'Short summary' },
        longSummary: { content: 'Long summary' },
      })),
    };
    const sdk = {
      session: vi.fn(async () => session),
    };
    const tools = makeTools(sdk);

    const contextResult = await tools.find((candidate) => candidate.name === 'context')!
      .handler({}, { agentId: 'agent-a', sessionKey: 's1' });
    const sessionResult = await tools.find((candidate) => candidate.name === 'session')!
      .handler({}, { agentId: 'agent-a', sessionKey: 's1' });

    expect(contextResult.content[0].text).toContain('Earlier summary');
    expect(contextResult.content[0].text).toContain('Direct communication style.');
    expect(contextResult.content[0].text).toContain('Uses Russian');
    expect(contextResult.content[0].text).toContain('prefers short answers');
    expect(contextResult.content[0].text).not.toContain('SessionContext(messages=');
    expect(sessionResult.content[0].text).toContain('Short summary');
    expect(sessionResult.content[0].text).toContain('Long summary');
  });

  it('asks Honcho from the agent peer scoped to the current session', async () => {
    const peer = {
      chat: vi.fn(async () => 'answer from honcho'),
    };
    const sdk = {
      peer: vi.fn(async () => peer),
    };
    const tools = makeTools(sdk);
    const tool = tools.find((candidate) => candidate.name === 'ask')!;

    const result = await tool.handler({
      question: 'what matters here?',
      reasoning_level: 'high',
      target_peer_id: 'user_abc',
    }, {
      agentId: 'agent-a',
      sessionKey: 'session-key',
    });

    expect(sdk.peer).toHaveBeenCalledWith('agent_agent-a');
    expect(peer.chat).toHaveBeenCalledWith('what matters here?', {
      session: buildHonchoSessionId('session-key'),
      reasoningLevel: 'high',
      target: 'user_abc',
    });
    expect(result.content[0].text).toContain('answer from honcho');
  });

  it('searches messages and conclusions in the current session', async () => {
    const session = {
      search: vi.fn(async () => [{ id: 'm1', content: 'matched message' }]),
      representation: vi.fn(async () => 'matched conclusion'),
    };
    const sdk = {
      session: vi.fn(async () => session),
    };
    const tools = makeTools(sdk);

    const messageResult = await tools.find((tool) => tool.name === 'search_messages')!
      .handler({ query: 'preference', limit: 3 }, { agentId: 'agent-a', sessionKey: 's1' });
    const conclusionResult = await tools.find((tool) => tool.name === 'search_conclusions')!
      .handler({ query: 'preference', limit: 4 }, { agentId: 'agent-a', sessionKey: 's1' });

    expect(session.search).toHaveBeenCalledWith('preference', { limit: 3 });
    expect(session.representation).toHaveBeenCalledWith('agent_agent-a', {
      searchQuery: 'preference',
      searchTopK: 4,
      includeMostFrequent: true,
      maxConclusions: 4,
    });
    expect(messageResult.content[0].text).toContain('matched message');
    expect(conclusionResult.content[0].text).toContain('matched conclusion');
  });

  it('returns a tool error when a session-scoped tool is called outside dispatch', async () => {
    const tools = makeTools({});
    const result = await tools.find((tool) => tool.name === 'session')!
      .handler({}, { agentId: 'agent-a' });

    expect(result.content[0].text).toContain('requires an active AnthroClaw session');
  });

  it('honors per-agent tool switches', async () => {
    const tools = makeTools({}, resolveConfig({}, {
      enabled: true,
      mode: 'tools',
      tools: { ask: false },
    }));
    const result = await tools.find((tool) => tool.name === 'ask')!
      .handler({ question: 'ignored' }, { agentId: 'agent-a', sessionKey: 's1' });

    expect(result.content[0].text).toContain('Honcho tool disabled');
  });
});

function makeTools(sdk: unknown, config: HonchoConfig = resolveConfig({}, { enabled: true, mode: 'tools' })) {
  return createHonchoTools({
    resolveConfig: () => config,
    resolveSdk: async () => sdk as never,
  });
}
