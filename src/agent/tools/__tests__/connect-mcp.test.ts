import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createConnectMcpTool, type ConnectMcpDispatchContext } from '../connect-mcp.js';

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function getHandler(t: unknown): (a: Record<string, unknown>) => Promise<ToolResult> {
  return (t as { handler: (a: Record<string, unknown>) => Promise<ToolResult> }).handler;
}

function parseResultJson(r: ToolResult): Record<string, unknown> {
  expect(r.content[0]?.type).toBe('text');
  return JSON.parse(r.content[0].text) as Record<string, unknown>;
}

interface FakeOnboarding {
  startConnection: ReturnType<typeof vi.fn>;
  attachApiKey: ReturnType<typeof vi.fn>;
  finalize: ReturnType<typeof vi.fn>;
  getPending: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

let facade: FakeOnboarding;

function makeFacade(): FakeOnboarding {
  return {
    startConnection: vi.fn(),
    attachApiKey: vi.fn(),
    finalize: vi.fn(),
    getPending: vi.fn(),
    cancel: vi.fn(),
  };
}

type RealOnboarding = ReturnType<
  typeof import('../../../integrations/mcp-onboarding/index.js').createOnboarding
>;

const getFacade = (): RealOnboarding =>
  facade as unknown as RealOnboarding;

const DM_CONTEXT: ConnectMcpDispatchContext = {
  agentSessionKey: 'agent_alpha:telegram:dm:123',
  chatType: 'private',
};

describe('connect_mcp built-in tool', () => {
  beforeEach(() => {
    facade = makeFacade();
  });

  it('exposes a single discriminated-union tool named "connect_mcp"', () => {
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const meta = def as unknown as { name: string; description: string };
    expect(meta.name).toBe('connect_mcp');
    expect(meta.description).toMatch(/MCP/);
  });

  it('op=connect (oauth) forwards the requester and returns an instructional message', async () => {
    facade.startConnection.mockResolvedValueOnce({
      status: 'authorize',
      pendingId: 'pnd_1',
      authUrl: 'https://ui.test/api/mcp/oauth/start/pnd_1',
      serverName: 'notion',
    });
    const def = createConnectMcpTool('agent_alpha', getFacade, () => DM_CONTEXT);
    const r = await getHandler(def)({ op: 'connect', url: 'https://mcp.notion.com' });
    expect(r.isError).toBeFalsy();
    const payload = parseResultJson(r);
    expect(payload.status).toBe('authorize');
    expect(payload.pendingId).toBe('pnd_1');
    expect(payload.authUrl).toBe('https://ui.test/api/mcp/oauth/start/pnd_1');
    expect(typeof payload.message).toBe('string');
    expect(payload.message).toMatch(/Forward this auth URL/);
    expect(payload.message).toMatch(/\[system\] mcp_connected/);
    expect(payload.message).toMatch(/Do not poll/);

    expect(facade.startConnection).toHaveBeenCalledTimes(1);
    const call = facade.startConnection.mock.calls[0][0] as {
      url: string;
      requester: { kind: string; agentId: string; agentSessionKey?: string; chatType?: string };
    };
    expect(call.url).toBe('https://mcp.notion.com');
    expect(call.requester).toEqual({
      kind: 'agent',
      agentId: 'agent_alpha',
      agentSessionKey: 'agent_alpha:telegram:dm:123',
      chatType: 'private',
    });
  });

  it('op=connect (awaiting_apikey) returns the apikeyUrl with the apikey-flow message', async () => {
    facade.startConnection.mockResolvedValueOnce({
      status: 'awaiting_apikey',
      pendingId: 'pnd_2',
      apikeyUrl: 'https://ui.test/mcp/connect/pnd_2/apikey',
      serverName: 'postmypost',
    });
    const def = createConnectMcpTool('agent_alpha', getFacade, () => DM_CONTEXT);
    const r = await getHandler(def)({ op: 'connect', url: 'https://mcp.postmypost.io' });
    const payload = parseResultJson(r);
    expect(payload.status).toBe('awaiting_apikey');
    expect(payload.apikeyUrl).toBe('https://ui.test/mcp/connect/pnd_2/apikey');
    expect(payload.message).toMatch(/Forward the apikeyUrl/);
    expect(payload.message).toMatch(/\[system\] mcp_connected/);
  });

  it('op=connect surfaces the DM-only rejection with a user-friendly message', async () => {
    facade.startConnection.mockResolvedValueOnce({
      status: 'rejected',
      reason: 'mcp_onboarding_requires_dm',
    });
    const def = createConnectMcpTool('agent_alpha', getFacade, () => ({
      agentSessionKey: 'agent_alpha:telegram:group:-100123',
      chatType: 'group' as const,
    }));
    const r = await getHandler(def)({ op: 'connect', url: 'https://mcp.notion.com' });
    expect(r.isError).toBeFalsy();
    const payload = parseResultJson(r);
    expect(payload.status).toBe('rejected');
    expect(payload.reason).toBe('mcp_onboarding_requires_dm');
    expect(payload.message).toMatch(/requires a private chat/);
    expect(payload.message).toMatch(/message me directly/);
  });

  it('op=connect passes a generic message for other rejection reasons', async () => {
    facade.startConnection.mockResolvedValueOnce({
      status: 'rejected',
      reason: 'dcr_required_but_not_supported',
    });
    const def = createConnectMcpTool('agent_alpha', getFacade, () => DM_CONTEXT);
    const r = await getHandler(def)({ op: 'connect', url: 'https://mcp.notion.com' });
    const payload = parseResultJson(r);
    expect(payload.status).toBe('rejected');
    expect(payload.reason).toBe('dcr_required_but_not_supported');
    expect(typeof payload.message).toBe('string');
  });

  it('op=apikey forwards pendingId + token and returns the facade result', async () => {
    facade.attachApiKey.mockResolvedValueOnce({
      status: 'connected',
      pendingId: 'pnd_3',
      serverId: 'postmypost',
      tools: [{ name: 'create_post' }],
    });
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const r = await getHandler(def)({
      op: 'apikey',
      pendingId: 'pnd_3',
      token: 'sk_xyz',
    });
    expect(r.isError).toBeFalsy();
    const payload = parseResultJson(r);
    expect(payload.status).toBe('connected');
    expect(payload.serverId).toBe('postmypost');
    expect(facade.attachApiKey).toHaveBeenCalledWith({
      pendingId: 'pnd_3',
      token: 'sk_xyz',
    });
  });

  it('op=finalize forwards allowed_tools and returns the facade result', async () => {
    facade.finalize.mockResolvedValueOnce({
      status: 'connected',
      server: 'postmypost',
      tools: [{ name: 'create_post' }, { name: 'delete_post' }],
    });
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const r = await getHandler(def)({
      op: 'finalize',
      pendingId: 'pnd_3',
      allowed_tools: ['create_post'],
    });
    const payload = parseResultJson(r);
    expect(payload.status).toBe('connected');
    expect(payload.server).toBe('postmypost');
    expect(facade.finalize).toHaveBeenCalledWith({
      pendingId: 'pnd_3',
      allowed_tools: ['create_post'],
    });
  });

  it('op=check returns the status / age / TTL projection from the facade', async () => {
    facade.getPending.mockReturnValueOnce({
      status: 'pending',
      age_seconds: 12,
      expires_in_seconds: 588,
    });
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const r = await getHandler(def)({ op: 'check', pendingId: 'pnd_4' });
    const payload = parseResultJson(r);
    expect(payload).toEqual({
      status: 'pending',
      age_seconds: 12,
      expires_in_seconds: 588,
    });
    expect(facade.getPending).toHaveBeenCalledWith('pnd_4');
  });

  it('op=check returns a not-found marker when the pending row is unknown', async () => {
    facade.getPending.mockReturnValueOnce(null);
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const r = await getHandler(def)({ op: 'check', pendingId: 'pnd_missing' });
    const payload = parseResultJson(r);
    expect(payload.status).toBe('not_found');
  });

  it('op=cancel returns success when the row is cancelled', async () => {
    facade.cancel.mockReturnValueOnce({ status: 'cancelled' });
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const r = await getHandler(def)({ op: 'cancel', pendingId: 'pnd_5' });
    const payload = parseResultJson(r);
    expect(payload.status).toBe('cancelled');
    expect(facade.cancel).toHaveBeenCalledWith('pnd_5');
  });

  it('op=cancel returns not_found when the row is unknown', async () => {
    facade.cancel.mockReturnValueOnce({ status: 'not_found' });
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const r = await getHandler(def)({ op: 'cancel', pendingId: 'pnd_missing' });
    const payload = parseResultJson(r);
    expect(payload.status).toBe('not_found');
  });

  it('op=cancel returns not_cancellable when the row is in a terminal state', async () => {
    facade.cancel.mockReturnValueOnce({ status: 'not_cancellable' });
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const r = await getHandler(def)({ op: 'cancel', pendingId: 'pnd_done' });
    const payload = parseResultJson(r);
    expect(payload.status).toBe('not_cancellable');
  });

  it('returns isError=true when the underlying facade throws', async () => {
    facade.startConnection.mockRejectedValueOnce(new Error('boom'));
    const def = createConnectMcpTool('agent_alpha', getFacade, () => DM_CONTEXT);
    const r = await getHandler(def)({ op: 'connect', url: 'https://mcp.notion.com' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/boom/);
  });

  it('op=connect without an active dispatch context still forwards as agent requester (admin path)', async () => {
    // Tools may be invoked outside a chat dispatch (e.g. headless / warm
    // path). In that case agentSessionKey and chatType are omitted so the
    // facade falls back to its admin-style behaviour for the request.
    facade.startConnection.mockResolvedValueOnce({
      status: 'authorize',
      pendingId: 'pnd_x',
      authUrl: 'https://ui.test/api/mcp/oauth/start/pnd_x',
    });
    const def = createConnectMcpTool('agent_alpha', getFacade);
    const r = await getHandler(def)({ op: 'connect', url: 'https://mcp.notion.com' });
    expect(r.isError).toBeFalsy();
    const call = facade.startConnection.mock.calls[0][0] as {
      requester: { kind: string; agentId: string; agentSessionKey?: string; chatType?: string };
    };
    expect(call.requester.kind).toBe('agent');
    expect(call.requester.agentId).toBe('agent_alpha');
    expect(call.requester.agentSessionKey).toBeUndefined();
    expect(call.requester.chatType).toBeUndefined();
  });
});
