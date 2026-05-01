import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext } from '../src/types-shim.js';
import { register } from '../src/index.js';

function makeStubCtx(overrides: Partial<PluginContext> = {}): PluginContext & { _tmp: string } {
  const _tmp = mkdtempSync(join(tmpdir(), 'mission-register-'));
  return {
    pluginName: 'mission',
    pluginVersion: '0.1.0',
    dataDir: _tmp,
    registerHook: vi.fn(),
    registerMcpTool: vi.fn(),
    registerContextEngine: vi.fn(),
    registerSlashCommand: vi.fn(),
    runSubagent: vi.fn(async () => ''),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    getAgentConfig: vi.fn(() => ({ plugins: { mission: { enabled: true } } })),
    getGlobalConfig: vi.fn(() => ({})),
    _tmp,
    ...overrides,
  };
}

const tmps: string[] = [];
afterEach(() => {
  for (const tmp of tmps.splice(0)) {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
  }
});

describe('mission register()', () => {
  it('registers context engine, hook, and MCP tools', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    await register(ctx);

    expect(ctx.registerContextEngine).toHaveBeenCalledOnce();
    expect(ctx.registerHook).toHaveBeenCalledWith('on_session_reset', expect.any(Function));
    expect(ctx.registerMcpTool).toHaveBeenCalledTimes(10);
    const toolNames = (ctx.registerMcpTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool.name);
    expect(toolNames).toEqual([
      'status',
      'create',
      'update_state',
      'add_objective',
      'validate_objective',
      'reject_objective',
      'add_decision',
      'transition_phase',
      'wrap_session',
      'archive',
    ]);
  });

  it('assemble returns null when plugin config is disabled', async () => {
    const ctx = makeStubCtx({
      getAgentConfig: vi.fn(() => ({ plugins: { mission: { enabled: false } } })),
    });
    tmps.push(ctx._tmp);
    await register(ctx);
    const engine = (ctx.registerContextEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];

    const result = await engine.assemble({
      agentId: 'agent-1',
      sessionKey: 'session-1',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result).toBeNull();
  });

  it('create tool creates mission and assemble injects mission state', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    await register(ctx);
    const tools = (ctx.registerMcpTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool);
    const createTool = tools.find((tool) => tool.name === 'create')!;

    await createTool.handler(
      {
        title: 'Mission State MVP',
        goal: 'Keep agent work scoped across sessions',
        current_state: 'Scaffold started',
        next_actions: ['add tests'],
      },
      { agentId: 'agent-1', sessionKey: 'session-1' },
    );

    const engine = (ctx.registerContextEngine as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const result = await engine.assemble({
      agentId: 'agent-1',
      sessionKey: 'session-1',
      messages: [{ role: 'user', content: 'continue' }],
    });

    expect(result).not.toBeNull();
    expect(result!.messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('<mission_state>'),
    });
    expect(result!.messages[0].content).toContain('Mission State MVP');
  });

  it('shutdown closes initialized DBs without logging errors', async () => {
    const ctx = makeStubCtx();
    tmps.push(ctx._tmp);
    const instance = await register(ctx);
    const tools = (ctx.registerMcpTool as ReturnType<typeof vi.fn>).mock.calls.map(([tool]) => tool);
    await tools.find((tool) => tool.name === 'status')!.handler({}, { agentId: 'agent-1' });

    await instance.shutdown?.();

    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });
});
