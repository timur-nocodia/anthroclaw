import { describe, expect, it, vi } from 'vitest';
import { SdkControlRegistry } from '../../src/sdk/control-registry.js';

describe('SdkControlRegistry', () => {
  it('interrupts a registered query through an alias', async () => {
    const registry = new SdkControlRegistry();
    const interrupt = vi.fn(async () => {});
    const close = vi.fn();
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, 'abort');

    registry.register(
      ['session-key', 'sdk-session-1'],
      { interrupt, close } as any,
      abortController,
    );
    registry.alias('web:agent:sdk-session-1', 'session-key');

    const result = await registry.interrupt('web:agent:sdk-session-1');

    expect(result).toEqual({ interrupted: true });
    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(abortSpy).toHaveBeenCalledTimes(1);
  });

  it('drops aliases when the canonical handle is unregistered', () => {
    const registry = new SdkControlRegistry();

    registry.register(['session-key', 'sdk-session-1'], { interrupt: vi.fn(), close: vi.fn() } as any);
    registry.alias('alias-session', 'session-key');
    expect(registry.has('alias-session')).toBe(true);

    registry.unregister('session-key');
    expect(registry.has('alias-session')).toBe(false);
    expect(registry.has('sdk-session-1')).toBe(false);
  });
});
