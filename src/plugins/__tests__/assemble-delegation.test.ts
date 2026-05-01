import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContextEngine, AssembleInput, AssembleResult } from '../types.js';
import { tryPluginAssemble, tryPluginAssembleChain } from '../../gateway.js';
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
    // Use a prompt long enough that flattening (boundary tag adds ~50 chars
    // of overhead) does not trip the 4x size-cap defensive check.
    const userPrompt = 'original prompt that is long enough to satisfy size cap';
    const result: AssembleResult = {
      messages: [
        { role: 'system', content: 'LCM summary D2/D1/D0' },
        { role: 'user', content: userPrompt },
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
      userPrompt,
      'lcm',
    );

    // forwarded input shape
    expect(assembleFn).toHaveBeenCalledTimes(1);
    expect(assembleFn).toHaveBeenCalledWith({
      agentId: 'agent-7',
      sessionKey: 'sk-99',
      messages: [{ role: 'user', content: userPrompt }],
    });

    // flattened: context block then user turn — boundary tag is randomized
    // per call (`<lcm-context-NNNNNNNN>`) to defeat tag-forgery prompt
    // injection, so we match a regex shape rather than a fixed string.
    expect(out).toMatch(
      new RegExp(
        `^<lcm-context-[0-9a-f]{8}>\\n\\[system\\]: LCM summary D2/D1/D0\\n</lcm-context-[0-9a-f]{8}>\\n\\n${userPrompt}$`,
      ),
    );

    // info log
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload, message] = infoSpy.mock.calls[0];
    expect(payload).toMatchObject({
      agentId: 'agent-7',
      sessionKey: 'sk-99',
      pluginName: 'lcm',
      originalLen: userPrompt.length,
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
    // Pad system + user content so the flattened string stays under the
    // 4x size-cap (boundary tag adds ~50 chars).
    const sys = 'kept system content padded long enough';
    const user = 'kept user content padded long enough';
    const result: AssembleResult = {
      messages: [
        null,
        'not-an-object',
        { role: 'system' }, // missing content
        { role: 'system', content: 42 }, // non-string content
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ] as unknown[],
    };
    const engine: ContextEngine = { assemble: vi.fn(async () => result) };

    const out = await tryPluginAssemble(engine, 'a', 's', user);

    expect(out).toMatch(
      new RegExp(
        `^<lcm-context-[0-9a-f]{8}>\\n\\[system\\]: ${sys}\\n</lcm-context-[0-9a-f]{8}>\\n\\n${user}$`,
      ),
    );
  });

  it('falls back to "[context]:" label for entries with non-string role', async () => {
    // Pad content so flattening doesn't trip the 4x size-cap check.
    const ctx = 'weird role content padded long enough for size cap';
    const user = 'user content padded long enough for size cap';
    const result: AssembleResult = {
      messages: [
        { role: 123, content: ctx },
        { role: 'user', content: user },
      ] as unknown[],
    };
    const engine: ContextEngine = { assemble: vi.fn(async () => result) };

    const out = await tryPluginAssemble(engine, 'a', 's', user);

    expect(out).toMatch(
      new RegExp(
        `^<lcm-context-[0-9a-f]{8}>\\n\\[context\\]: ${ctx}\\n</lcm-context-[0-9a-f]{8}>\\n\\n${user}$`,
      ),
    );
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

  // --- T21 review fix #4: container-level malformation tests ---

  it('returns null when result.messages is null', async () => {
    const engine: ContextEngine = {
      assemble: vi.fn(async () => ({ messages: null as unknown as never[] })),
    };
    const out = await tryPluginAssemble(engine, 'a', 's', 'prompt');
    expect(out).toBeNull();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('returns null when result.messages is undefined', async () => {
    const engine: ContextEngine = {
      assemble: vi.fn(async () => ({}) as never),
    };
    const out = await tryPluginAssemble(engine, 'a', 's', 'prompt');
    expect(out).toBeNull();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('returns null when result.messages is a string (not an array)', async () => {
    const engine: ContextEngine = {
      assemble: vi.fn(async () => ({ messages: 'not-array' as unknown as never[] })),
    };
    const out = await tryPluginAssemble(engine, 'a', 's', 'prompt');
    expect(out).toBeNull();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  // --- T21 review fix #2: size-cap tests ---

  it('falls back to original when assembled exceeds absolute cap', async () => {
    const huge = 'x'.repeat(600_000);
    const engine: ContextEngine = {
      assemble: vi.fn(async () => ({
        messages: [{ role: 'user', content: huge }],
      })),
    };
    const out = await tryPluginAssemble(engine, 'a', 's', 'short prompt');
    expect(out).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, msg] = warnSpy.mock.calls[0];
    expect(msg).toMatch(/exceeded sanity cap/);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('falls back to original when assembled exceeds 4x ratio', async () => {
    const original = 'a'.repeat(100);
    const big = 'b'.repeat(401); // 401 > 100*4 = 400
    const engine: ContextEngine = {
      assemble: vi.fn(async () => ({
        messages: [{ role: 'user', content: big }],
      })),
    };
    const out = await tryPluginAssemble(engine, 'a', 's', original);
    expect(out).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [, msg] = warnSpy.mock.calls[0];
    expect(msg).toMatch(/exceeded sanity cap/);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  // --- T21 review fix #3: soft timeout test ---

  it('falls back to original when assemble exceeds soft timeout', async () => {
    vi.useFakeTimers();
    try {
      const engine: ContextEngine = {
        assemble: vi.fn(
          () =>
            new Promise<AssembleResult | null>(() => {
              /* never resolves */
            }),
        ),
      };
      const promise = tryPluginAssemble(engine, 'a', 's', 'prompt');
      await vi.advanceTimersByTimeAsync(6_000); // > ASSEMBLE_TIMEOUT_MS
      const out = await promise;
      expect(out).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [, msg] = warnSpy.mock.calls[0];
      expect(msg).toMatch(/timed out/);
      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('composes multiple ContextEngines in order', async () => {
    const original = 'original prompt padded enough for assembly size caps';
    const engineA: ContextEngine = {
      assemble: vi.fn(async (input) => ({
        messages: [
          { role: 'system', content: 'LCM context' },
          ...(input.messages as unknown[]),
        ],
      })),
    };
    const engineB: ContextEngine = {
      assemble: vi.fn(async (input) => ({
        messages: [
          { role: 'system', content: 'Mission context' },
          ...(input.messages as unknown[]),
        ],
      })),
    };

    const out = await tryPluginAssembleChain(
      [
        { name: 'lcm', engine: engineA },
        { name: 'mission-state', engine: engineB },
      ],
      'agent-1',
      'session-1',
      original,
    );

    expect(out).toContain('[system]: Mission context');
    expect(out).toContain('[system]: LCM context');
    expect(out).toContain(original);
    expect(engineA.assemble).toHaveBeenCalledWith({
      agentId: 'agent-1',
      sessionKey: 'session-1',
      messages: [{ role: 'user', content: original }],
    });
    expect(engineB.assemble).toHaveBeenCalledTimes(1);
    const engineBInput = (engineB.assemble as ReturnType<typeof vi.fn>).mock.calls[0][0] as AssembleInput;
    expect(engineBInput.messages).toEqual([{ role: 'user', content: expect.stringContaining(original) }]);
  });

  it('continues assemble chain when one ContextEngine is pass-through', async () => {
    const original = 'original prompt padded enough for assembly size caps';
    const passThrough: ContextEngine = {
      assemble: vi.fn(async () => null),
    };
    const injector: ContextEngine = {
      assemble: vi.fn(async (input) => ({
        messages: [
          { role: 'system', content: 'Mission context' },
          ...(input.messages as unknown[]),
        ],
      })),
    };

    const out = await tryPluginAssembleChain(
      [
        { name: 'noop', engine: passThrough },
        { name: 'mission-state', engine: injector },
      ],
      'agent-1',
      'session-1',
      original,
    );

    expect(out).toContain('[system]: Mission context');
    expect(out).toContain(original);
  });

  it('returns null from assemble chain when every ContextEngine is pass-through', async () => {
    const engineA: ContextEngine = { assemble: vi.fn(async () => null) };
    const engineB: ContextEngine = {};

    const out = await tryPluginAssembleChain(
      [
        { name: 'a', engine: engineA },
        { name: 'b', engine: engineB },
      ],
      'agent-1',
      'session-1',
      'prompt',
    );

    expect(out).toBeNull();
  });
});
