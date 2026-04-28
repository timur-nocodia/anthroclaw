import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContextEngine, CompressInput, CompressResult } from '../types.js';
import { tryPluginCompress } from '../../gateway.js';
import { logger } from '../../logger.js';

describe('tryPluginCompress — gateway delegation helper', () => {
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

  it('returns false when no ContextEngine is registered (legacy should run)', async () => {
    const handled = await tryPluginCompress(null, 'agent-1', 'sk');
    expect(handled).toBe(false);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns false when engine has no .compress method (legacy should run)', async () => {
    const engine: ContextEngine = {
      // no .compress
    };
    const handled = await tryPluginCompress(engine, 'agent-1', 'sk');
    expect(handled).toBe(false);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns true and logs info when compress() returns a CompressResult (legacy bypassed)', async () => {
    const result: CompressResult = { messages: [{ role: 'user', content: 'compressed' }] };
    const compressFn = vi.fn(async (_input: CompressInput): Promise<CompressResult | null> => result);
    const engine: ContextEngine = { compress: compressFn };

    const handled = await tryPluginCompress(engine, 'agent-7', 'sk-99');

    expect(handled).toBe(true);
    expect(compressFn).toHaveBeenCalledTimes(1);
    expect(compressFn).toHaveBeenCalledWith({
      agentId: 'agent-7',
      sessionKey: 'sk-99',
      messages: [],
      currentTokens: 0,
    });
    // Verify info log: `{agentId, sessionKey}, 'plugin context-engine compress succeeded; legacy bypassed'`
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload, message] = infoSpy.mock.calls[0];
    expect(payload).toMatchObject({ agentId: 'agent-7', sessionKey: 'sk-99' });
    expect(message).toMatch(/plugin context-engine compress succeeded; legacy bypassed/);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns false when compress() returns null (legacy should run)', async () => {
    const compressFn = vi.fn(async (): Promise<CompressResult | null> => null);
    const engine: ContextEngine = { compress: compressFn };

    const handled = await tryPluginCompress(engine, 'agent-1', 'sk');

    expect(handled).toBe(false);
    expect(compressFn).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns false and logs warn when compress() throws (legacy should run)', async () => {
    const boom = new Error('engine kaboom');
    const compressFn = vi.fn(async (): Promise<CompressResult | null> => {
      throw boom;
    });
    const engine: ContextEngine = { compress: compressFn };

    const handled = await tryPluginCompress(engine, 'agent-2', 'sk-x');

    expect(handled).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload, message] = warnSpy.mock.calls[0];
    expect(payload).toMatchObject({ agentId: 'agent-2', sessionKey: 'sk-x' });
    // err is now redacted to a string (was: raw Error object) — see Fix #1.
    expect(typeof (payload as { err: unknown }).err).toBe('string');
    expect((payload as { err: string }).err).toContain('engine kaboom');
    expect(message).toMatch(/plugin context-engine compress failed; fallback to legacy/);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('forwards pluginName into the success info log payload', async () => {
    const result: CompressResult = { messages: [] };
    const compressFn = vi.fn(async (): Promise<CompressResult | null> => result);
    const engine: ContextEngine = { compress: compressFn };

    await tryPluginCompress(engine, 'agent-x', 'sk-x', 'lcm');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload] = infoSpy.mock.calls[0];
    expect(payload).toMatchObject({ agentId: 'agent-x', sessionKey: 'sk-x', pluginName: 'lcm' });
  });

  it('forwards pluginName into the failure warn log payload', async () => {
    const compressFn = vi.fn(async (): Promise<CompressResult | null> => {
      throw new Error('boom');
    });
    const engine: ContextEngine = { compress: compressFn };

    await tryPluginCompress(engine, 'agent-x', 'sk-x', 'lcm');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [payload] = warnSpy.mock.calls[0];
    expect(payload).toMatchObject({ agentId: 'agent-x', sessionKey: 'sk-x', pluginName: 'lcm' });
  });

  it('handles null pluginName (e.g., when called without registry context)', async () => {
    const result: CompressResult = { messages: [] };
    const engine: ContextEngine = { compress: vi.fn(async () => result) };

    await tryPluginCompress(engine, 'agent-x', 'sk-x', null);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [payload] = infoSpy.mock.calls[0];
    expect(payload).toMatchObject({ pluginName: null });
  });
});
