import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContextEngine, AssembleInput, AssembleResult } from '../types.js';
import { tryPluginAssemble } from '../../gateway.js';
import { logger } from '../../logger.js';

describe('tryPluginAssemble — gateway prompt-assembly delegation helper', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
  });

  afterEach(() => {
    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('returns null when no ContextEngine is registered (pass-through)', async () => {
    const out = await tryPluginAssemble(null, 'agent-1', 'sk', 'hello');
    expect(out).toBeNull();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null when engine has no .assemble method (pass-through)', async () => {
    const engine: ContextEngine = {
      // no .assemble
    };
    const out = await tryPluginAssemble(engine, 'agent-1', 'sk', 'hello');
    expect(out).toBeNull();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null when assemble() returns null (pass-through, no logs)', async () => {
    const assembleFn = vi.fn(async (): Promise<AssembleResult | null> => null);
    const engine: ContextEngine = { assemble: assembleFn };

    const out = await tryPluginAssemble(engine, 'agent-1', 'sk', 'hello');

    expect(out).toBeNull();
    expect(assembleFn).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns flattened string and logs info on a successful AssembleResult', async () => {
    const result: AssembleResult = {
      messages: [
        { role: 'system', content: 'LCM summary D2/D1/D0' },
        { role: 'user', content: 'original prompt' },
      ],
    };
    const assembleFn = vi.fn(
      async (_input: AssembleInput): Promise<AssembleResult | null> => result,
    );
    const engine: ContextEngine = { assemble: assembleFn };

    const out = await tryPluginAssemble(
      engine,
      'agent-7',
      'sk-99',
      'original prompt',
      'lcm',
    );

    // forwarded input shape
    expect(assembleFn).toHaveBeenCalledTimes(1);
    expect(assembleFn).toHaveBeenCalledWith({
      agentId: 'agent-7',
      sessionKey: 'sk-99',
      messages: [{ role: 'user', content: 'original prompt' }],
    });

    // flattened: context block then user turn
    expect(out).toBe(
      '<lcm-context>\n[system]: LCM summary D2/D1/D0\n</lcm-context>\n\noriginal prompt',
    );

    // info log
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload, message] = infoSpy.mock.calls[0];
    expect(payload).toMatchObject({
      agentId: 'agent-7',
      sessionKey: 'sk-99',
      pluginName: 'lcm',
      originalLen: 'original prompt'.length,
    });
    expect((payload as { assembledLen: number }).assembledLen).toBe(out!.length);
    expect(message).toMatch(/plugin context-engine assemble succeeded/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns null and logs warn (with redacted err) when assemble() throws', async () => {
    const boom = new Error('engine kaboom');
    const assembleFn = vi.fn(async (): Promise<AssembleResult | null> => {
      throw boom;
    });
    const engine: ContextEngine = { assemble: assembleFn };

    const out = await tryPluginAssemble(engine, 'agent-2', 'sk-x', 'hi', 'lcm');

    expect(out).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload, message] = warnSpy.mock.calls[0];
    expect(payload).toMatchObject({
      agentId: 'agent-2',
      sessionKey: 'sk-x',
      pluginName: 'lcm',
    });
    // err redacted to a string (matches T20 redaction pattern)
    expect(typeof (payload as { err: unknown }).err).toBe('string');
    expect((payload as { err: string }).err).toContain('engine kaboom');
    expect(message).toMatch(/plugin context-engine assemble failed; pass-through/);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('returns null when assemble() yields an empty messages array', async () => {
    const result: AssembleResult = { messages: [] };
    const engine: ContextEngine = { assemble: vi.fn(async () => result) };

    const out = await tryPluginAssemble(engine, 'agent-x', 'sk-x', 'hi');

    // flattenAssembledMessages('') → outer returns null (use original prompt)
    expect(out).toBeNull();
    // should NOT log success info — there was nothing to use
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('flattens a single user message to its bare content (no <lcm-context> wrapper)', async () => {
    const result: AssembleResult = {
      messages: [{ role: 'user', content: 'just the user turn' }],
    };
    const engine: ContextEngine = { assemble: vi.fn(async () => result) };

    const out = await tryPluginAssemble(engine, 'a', 's', 'just the user turn');

    expect(out).toBe('just the user turn');
  });

  it('skips malformed entries (non-objects / missing content / non-string content)', async () => {
    const result: AssembleResult = {
      messages: [
        null,
        'not-an-object',
        { role: 'system' }, // missing content
        { role: 'system', content: 42 }, // non-string content
        { role: 'system', content: 'kept system' },
        { role: 'user', content: 'kept user' },
      ] as unknown[],
    };
    const engine: ContextEngine = { assemble: vi.fn(async () => result) };

    const out = await tryPluginAssemble(engine, 'a', 's', 'kept user');

    expect(out).toBe(
      '<lcm-context>\n[system]: kept system\n</lcm-context>\n\nkept user',
    );
  });

  it('falls back to "[context]:" label for entries with non-string role', async () => {
    const result: AssembleResult = {
      messages: [
        { role: 123, content: 'weird role' },
        { role: 'user', content: 'u' },
      ] as unknown[],
    };
    const engine: ContextEngine = { assemble: vi.fn(async () => result) };

    const out = await tryPluginAssemble(engine, 'a', 's', 'u');

    expect(out).toBe('<lcm-context>\n[context]: weird role\n</lcm-context>\n\nu');
  });

  it('joins multiple user turns with blank-line separators', async () => {
    const result: AssembleResult = {
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
      ],
    };
    const engine: ContextEngine = { assemble: vi.fn(async () => result) };

    const out = await tryPluginAssemble(engine, 'a', 's', 'first');

    expect(out).toBe('first\n\nsecond');
  });

  it('handles null pluginName (e.g. when called without registry context)', async () => {
    const result: AssembleResult = {
      messages: [{ role: 'user', content: 'x' }],
    };
    const engine: ContextEngine = { assemble: vi.fn(async () => result) };

    await tryPluginAssemble(engine, 'a', 's', 'x', null);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload] = infoSpy.mock.calls[0];
    expect(payload).toMatchObject({ pluginName: null });
  });
});
