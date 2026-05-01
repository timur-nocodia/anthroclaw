import { describe, it, expect, vi } from 'vitest';
import { Gateway } from '../../gateway.js';
import { createPeerPauseStore } from '../../routing/peer-pause.js';

// We import the operator-console plugin via a dynamic import so the
// (compiled-with-rootDir-src) backend tsc check doesn't try to compile
// the plugin's source. The plugin already has its own tsc step in its
// workspace; vitest happily runs the .ts source via its bundler.
async function loadOperatorConsole(): Promise<{
  register: (ctx: PluginContextShape) => Promise<{ shutdown?: () => Promise<void> | void }>;
}> {
  return (await import(
    '../../../plugins/operator-console/src/index.ts' as string
  )) as unknown as {
    register: (ctx: PluginContextShape) => Promise<{ shutdown?: () => Promise<void> | void }>;
  };
}

interface PluginContextShape {
  pluginName: string;
  pluginVersion: string;
  dataDir: string;
  registerHook: (event: string, handler: (...args: unknown[]) => unknown) => void;
  registerMcpTool: (tool: { name: string; handler: (input: unknown, ctx: { agentId: string }) => Promise<{ content: Array<{ text: string }> }> }) => void;
  registerContextEngine: (...args: unknown[]) => void;
  registerSlashCommand: (...args: unknown[]) => void;
  runSubagent: (...args: unknown[]) => Promise<string>;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void; debug: (...args: unknown[]) => void };
  getAgentConfig: (id: string) => unknown;
  getGlobalConfig: () => unknown;
  getPeerPauseStore?: () => unknown;
  getNotificationsEmitter?: () => unknown;
  dispatchSyntheticInbound?: (input: unknown) => Promise<{ messageId: string; sessionKey: string }>;
  searchAgentMemory?: (input: unknown) => Promise<{ results: Array<{ path: string; snippet: string; score: number }> }>;
}

/**
 * Stage 3 end-to-end integration test for the operator-console plugin.
 *
 * Patching strategy mirrors the Stage 1 e2e test:
 *   - Gateway() is instantiated directly; private fields are patched in
 *     so we don't need real channels, SDK init, or LLM calls.
 *   - The operator-console plugin's register() is invoked against a
 *     mostly-real PluginContext that points at the patched gateway, so the
 *     plugin's tool handlers exercise the same wiring used in production
 *     (getPeerPauseStore, dispatchSyntheticInbound).
 *   - Tool handlers are invoked directly with synthetic inputs — we don't
 *     spin up an LLM to choose them. This keeps the test fast and verifies
 *     the cross-agent wiring without dragging Anthropic SDK side-effects
 *     into the test runner.
 */

describe('operator-console e2e (klavdia → amina)', () => {
  it('peer_pause: operator agent pauses a managed agent peer via the live gateway store', async () => {
    const gw = new Gateway() as unknown as {
      peerPauseStore: ReturnType<typeof createPeerPauseStore>;
      notificationsEmitter: { emit: () => Promise<void> };
      agents: Map<string, unknown>;
      globalConfig: unknown;
      dispatchSyntheticInbound: Gateway['dispatchSyntheticInbound'];
      searchAgentMemory: Gateway['searchAgentMemory'];
    };
    gw.peerPauseStore = createPeerPauseStore({ filePath: ':memory:' });
    gw.notificationsEmitter = { emit: vi.fn(async () => undefined) };
    gw.agents = new Map();
    gw.globalConfig = {};

    // Build a stub PluginContext that points at the patched gateway.
    const ctx: PluginContextShape = {
      pluginName: 'operator-console',
      pluginVersion: '0.1.0',
      dataDir: '/tmp/op-console-e2e',
      registerHook: vi.fn(),
      registerMcpTool: vi.fn(),
      registerContextEngine: vi.fn(),
      registerSlashCommand: vi.fn(),
      runSubagent: vi.fn(async () => ''),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getAgentConfig: (id: string) => {
        if (id === 'klavdia') {
          return {
            plugins: {
              'operator-console': {
                enabled: true,
                manages: ['amina'],
                capabilities: ['peer_pause', 'delegate', 'list_peers', 'peer_summary', 'escalate'],
              },
            },
          };
        }
        return {};
      },
      getGlobalConfig: () => ({
        plugins: { 'operator-console': { enabled: true, manages: '*' } },
      }),
      getPeerPauseStore: () => gw.peerPauseStore,
      getNotificationsEmitter: () => gw.notificationsEmitter,
    };

    const { register } = await loadOperatorConsole(); await register(ctx);

    const peerPauseTool = (ctx.registerMcpTool as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .find((t: { name: string }) => t.name === 'peer_pause');
    expect(peerPauseTool).toBeDefined();

    const result = await peerPauseTool!.handler(
      {
        target_agent_id: 'amina',
        peer: { channel: 'whatsapp', account_id: 'business', peer_id: '37120@s.whatsapp.net' },
        action: 'pause',
        ttl_minutes: 60,
      },
      { agentId: 'klavdia' },
    );
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.ok).toBe(true);

    // Verify the pause hit the live gateway pause store.
    const list = gw.peerPauseStore.list('amina');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      agentId: 'amina',
      peerKey: 'whatsapp:business:37120@s.whatsapp.net',
      reason: 'manual',
      source: 'mcp:operator-console',
    });
  });

  it('delegate_to_peer: dispatches a synthesised inbound to the managed agent', async () => {
    const gw = new Gateway() as unknown as {
      peerPauseStore: ReturnType<typeof createPeerPauseStore>;
      agents: Map<string, unknown>;
      globalConfig: unknown;
      dispatchSyntheticInbound: Gateway['dispatchSyntheticInbound'];
      queryAgent: (...args: unknown[]) => Promise<string>;
    };
    gw.peerPauseStore = createPeerPauseStore({ filePath: ':memory:' });
    gw.globalConfig = {};

    // Stubbed Agent with the minimal interface dispatchSyntheticInbound + queryAgent reach.
    const aminaStub = {
      id: 'amina',
      memoryStore: { textSearch: vi.fn(() => []) },
    };
    gw.agents = new Map([['amina', aminaStub as unknown]]);

    // Replace queryAgent with a spy. dispatchSyntheticInbound's own code
    // uses `this.queryAgent` — we patch the method on the instance.
    const queryAgent = vi.fn(async () => 'ok');
    gw.queryAgent = queryAgent;

    // Capture dispatchSyntheticInbound calls by wrapping the gateway's bound method.
    const dispatchSpy = vi.spyOn(
      gw as unknown as { dispatchSyntheticInbound: (...args: unknown[]) => Promise<unknown> },
      'dispatchSyntheticInbound',
    );

    const ctx: PluginContextShape = {
      pluginName: 'operator-console',
      pluginVersion: '0.1.0',
      dataDir: '/tmp/op-console-e2e',
      registerHook: vi.fn(),
      registerMcpTool: vi.fn(),
      registerContextEngine: vi.fn(),
      registerSlashCommand: vi.fn(),
      runSubagent: vi.fn(async () => ''),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getAgentConfig: (id: string) => {
        if (id === 'klavdia') {
          return {
            plugins: {
              'operator-console': {
                enabled: true,
                manages: ['amina'],
                capabilities: ['peer_pause', 'delegate', 'list_peers', 'peer_summary', 'escalate'],
              },
            },
          };
        }
        return {};
      },
      getGlobalConfig: () => ({
        plugins: { 'operator-console': { enabled: true, manages: '*' } },
      }),
      getPeerPauseStore: () => gw.peerPauseStore,
      dispatchSyntheticInbound: (input) =>
        (gw as unknown as { dispatchSyntheticInbound: (i: unknown) => Promise<{ messageId: string; sessionKey: string }> }).dispatchSyntheticInbound(input),
    };

    const { register } = await loadOperatorConsole(); await register(ctx);

    const delegateTool = (ctx.registerMcpTool as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .find((t: { name: string }) => t.name === 'delegate_to_peer');
    expect(delegateTool).toBeDefined();

    const result = await delegateTool!.handler(
      {
        target_agent_id: 'amina',
        peer: { channel: 'whatsapp', account_id: 'business', peer_id: '37120@s.whatsapp.net' },
        instruction: 'find out a convenient time for a call',
      },
      { agentId: 'klavdia' },
    );
    const body = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(typeof body.dispatched_message_id).toBe('string');
    expect(typeof body.target_session_id).toBe('string');

    // Verify gateway-side wiring: dispatchSyntheticInbound was called with
    // the wrapped instruction, targeting amina.
    expect(dispatchSpy).toHaveBeenCalledOnce();
    const arg = dispatchSpy.mock.calls[0][0] as {
      targetAgentId: string;
      channel: string;
      peerId: string;
      text: string;
    };
    expect(arg.targetAgentId).toBe('amina');
    expect(arg.channel).toBe('whatsapp');
    expect(arg.peerId).toBe('37120@s.whatsapp.net');
    expect(arg.text).toContain('[Operator delegation]');
    expect(arg.text).toContain('find out a convenient time for a call');

    // queryAgent fired (fire-and-forget); we await a tick to let the void
    // promise from dispatchSyntheticInbound resolve.
    await new Promise((r) => setTimeout(r, 10));
    expect(queryAgent).toHaveBeenCalled();
    const callArgs = queryAgent.mock.calls[0] as unknown as [
      unknown,
      { channel: string; accountId: string; peerId: string; senderId: string; text: string },
    ];
    expect(callArgs[0]).toBe(aminaStub);
    expect(callArgs[1]).toMatchObject({
      channel: 'whatsapp',
      accountId: 'business',
      peerId: '37120@s.whatsapp.net',
      senderId: 'operator-console',
    });
    expect(callArgs[1].text).toContain('[Operator delegation]');
  });

  it('rejects unmanaged target — pause/delegate/list_peers/peer_summary', async () => {
    const gw = new Gateway() as unknown as {
      peerPauseStore: ReturnType<typeof createPeerPauseStore>;
      agents: Map<string, unknown>;
      globalConfig: unknown;
    };
    gw.peerPauseStore = createPeerPauseStore({ filePath: ':memory:' });
    gw.agents = new Map();
    gw.globalConfig = {};

    const ctx: PluginContextShape = {
      pluginName: 'operator-console',
      pluginVersion: '0.1.0',
      dataDir: '/tmp/op-console-e2e',
      registerHook: vi.fn(),
      registerMcpTool: vi.fn(),
      registerContextEngine: vi.fn(),
      registerSlashCommand: vi.fn(),
      runSubagent: vi.fn(async () => ''),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getAgentConfig: () => ({
        plugins: {
          'operator-console': { enabled: true, manages: ['amina'] },
        },
      }),
      getGlobalConfig: () => ({
        plugins: { 'operator-console': { enabled: true, manages: '*' } },
      }),
      getPeerPauseStore: () => gw.peerPauseStore,
    };

    const { register } = await loadOperatorConsole(); await register(ctx);

    const peerPauseTool = (ctx.registerMcpTool as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .find((t: { name: string }) => t.name === 'peer_pause');

    const r = await peerPauseTool!.handler(
      {
        target_agent_id: 'mallory',
        peer: { channel: 'whatsapp', account_id: 'b', peer_id: '1' },
        action: 'pause',
        ttl_minutes: 5,
      },
      { agentId: 'klavdia' },
    );
    const body = JSON.parse(r.content[0].text) as Record<string, unknown>;
    expect(body.error).toMatch(/not authorized/i);
    expect(gw.peerPauseStore.list()).toHaveLength(0);
  });
});
