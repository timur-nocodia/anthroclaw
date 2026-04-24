import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSessionInfo: vi.fn(),
  getSessionMessages: vi.fn(),
  forkSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => sdkMocks);

import {
  normalizeSessionMessage,
  SdkSessionService,
} from '../../src/sdk/sessions.js';

describe('SdkSessionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes session store query options and delegates session map operations to Agent', () => {
    const sessionStore = {
      append: vi.fn(async () => {}),
      load: vi.fn(async () => null),
    };
    const service = new SdkSessionService({ sessionStore, loadTimeoutMs: 5000 });
    const agent = {
      getSessionId: vi.fn(() => 'session-1'),
      setSessionId: vi.fn(),
      clearSession: vi.fn(),
    } as any;

    expect(service.getQueryOptions()).toEqual({
      sessionStore,
      loadTimeoutMs: 5000,
    });
    expect(service.getResumeSessionId(agent, 'chat-1')).toBe('session-1');

    service.rememberSessionId(agent, 'chat-1', 'session-2');
    service.clearSession(agent, 'chat-1');

    expect(agent.setSessionId).toHaveBeenCalledWith('chat-1', 'session-2');
    expect(agent.clearSession).toHaveBeenCalledWith('chat-1');
  });

  it('lists sessions through SDK with the configured session store', async () => {
    const sessionStore = {
      append: vi.fn(async () => {}),
      load: vi.fn(async () => null),
    };
    const service = new SdkSessionService({ sessionStore });
    const agent = { workspacePath: '/tmp/agent' } as any;
    sdkMocks.listSessions.mockResolvedValueOnce([
      { sessionId: 'session-1', summary: 'First', lastModified: 123 },
    ]);

    await expect(service.listAgentSessions(agent, { limit: 10, offset: 5 })).resolves.toEqual([
      { sessionId: 'session-1', summary: 'First', lastModified: 123 },
    ]);
    expect(sdkMocks.listSessions).toHaveBeenCalledWith({
      dir: '/tmp/agent',
      limit: 10,
      offset: 5,
      sessionStore,
    });
  });

  it('falls back to SessionStore.listSessions when SDK metadata listing fails', async () => {
    const sessionStore = {
      append: vi.fn(async () => {}),
      load: vi.fn(async () => null),
      listSessions: vi.fn(async () => [
        { sessionId: 'session-2', mtime: 200 },
        { sessionId: 'session-1', mtime: 100 },
      ]),
    };
    const service = new SdkSessionService({ sessionStore });
    const agent = { workspacePath: '/tmp/agent' } as any;
    sdkMocks.listSessions.mockRejectedValueOnce(new Error('metadata unavailable'));

    await expect(service.listAgentSessions(agent, { limit: 1 })).resolves.toEqual([
      {
        sessionId: 'session-2',
        summary: 'session-2',
        lastModified: 200,
        cwd: '/tmp/agent',
      },
    ]);
  });

  it('reads session info, messages, forks, and deletes through SDK APIs', async () => {
    const sessionStore = {
      append: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      load: vi.fn(async () => null),
    };
    const service = new SdkSessionService({ sessionStore });
    const agent = { workspacePath: '/tmp/agent' } as any;

    sdkMocks.getSessionInfo.mockResolvedValueOnce({
      sessionId: 'session-1',
      summary: 'A session',
      lastModified: 100,
    });
    sdkMocks.getSessionMessages.mockResolvedValueOnce([
      {
        type: 'user',
        uuid: 'msg-1',
        session_id: 'session-1',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        parent_tool_use_id: null,
      },
    ]);
    sdkMocks.forkSession.mockResolvedValueOnce({ sessionId: 'fork-1' });

    await expect(service.getAgentSessionInfo(agent, 'session-1')).resolves.toEqual({
      sessionId: 'session-1',
      summary: 'A session',
      lastModified: 100,
    });
    await expect(service.getAgentSessionMessages(agent, 'session-1')).resolves.toEqual([
      {
        type: 'user',
        uuid: 'msg-1',
        sessionId: 'session-1',
        text: 'hello',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      },
    ]);
    await expect(service.forkAgentSession(agent, {
      sourceSessionId: 'session-1',
      upToMessageId: 'msg-1',
      title: 'Fork',
    })).resolves.toEqual({ sessionId: 'fork-1' });
    await service.deleteAgentSession(agent, 'session-1');

    expect(sdkMocks.forkSession).toHaveBeenCalledWith('session-1', {
      dir: '/tmp/agent',
      sessionStore,
      upToMessageId: 'msg-1',
      title: 'Fork',
    });
    expect(sdkMocks.deleteSession).toHaveBeenCalledWith('session-1', {
      dir: '/tmp/agent',
      sessionStore,
    });
    expect(sessionStore.delete).toHaveBeenCalledWith({
      projectKey: '/tmp/agent',
      sessionId: 'fork-1',
      subpath: '__session_title',
    });
    expect(sessionStore.append).toHaveBeenCalledWith({
      projectKey: '/tmp/agent',
      sessionId: 'fork-1',
      subpath: '__session_title',
    }, [expect.objectContaining({ title: 'Fork', type: 'session_title' })]);
  });

  it('stores and reads session title metadata through sessionStore subkeys', async () => {
    const sessionStore = {
      append: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      load: vi.fn(async () => [
        { type: 'session_title', timestamp: '2026-04-23T00:00:00.000Z', title: 'Debugging Session' },
      ]),
    };
    const service = new SdkSessionService({ sessionStore });
    const agent = { workspacePath: '/tmp/agent' } as any;

    await service.setAgentSessionTitle(agent, 'session-1', 'Debugging Session');
    await expect(service.getAgentSessionTitle(agent, 'session-1')).resolves.toBe('Debugging Session');

    expect(sessionStore.delete).toHaveBeenCalledWith({
      projectKey: '/tmp/agent',
      sessionId: 'session-1',
      subpath: '__session_title',
    });
    expect(sessionStore.append).toHaveBeenCalledWith({
      projectKey: '/tmp/agent',
      sessionId: 'session-1',
      subpath: '__session_title',
    }, [expect.objectContaining({ title: 'Debugging Session', type: 'session_title' })]);
    expect(sessionStore.load).toHaveBeenCalledWith({
      projectKey: '/tmp/agent',
      sessionId: 'session-1',
      subpath: '__session_title',
    });
  });

  it('normalizes string message payloads', () => {
    expect(normalizeSessionMessage({
      type: 'assistant',
      uuid: 'msg-2',
      session_id: 'session-1',
      message: 'plain text',
      parent_tool_use_id: null,
    })).toEqual({
      type: 'assistant',
      uuid: 'msg-2',
      sessionId: 'session-1',
      text: 'plain text',
      message: 'plain text',
    });
  });
});
