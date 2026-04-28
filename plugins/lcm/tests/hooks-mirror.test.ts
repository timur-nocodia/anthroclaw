import { describe, it, expect, vi } from 'vitest';
import { createMirrorHook, type MirrorDeps } from '../src/hooks/mirror.js';

function makeDeps(overrides?: Partial<MirrorDeps>): MirrorDeps {
  const engine = { ingest: vi.fn() } as any;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const config = { ignoreSessionPatterns: [] } as any;
  return { engine, config, logger, ...overrides };
}

describe('createMirrorHook', () => {
  it('calls engine.ingest with sessionKey, source, newMessages from payload', () => {
    const deps = makeDeps();
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hello' }];
    hook({ agentId: 'agent1', sessionKey: 'sess:abc', source: 'telegram', newMessages });
    expect(deps.engine.ingest).toHaveBeenCalledOnce();
    expect(deps.engine.ingest).toHaveBeenCalledWith('sess:abc', 'telegram', newMessages);
  });

  it('source defaults to "unknown" if not provided in payload', () => {
    const deps = makeDeps();
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hi' }];
    hook({ agentId: 'agent1', sessionKey: 'sess:abc', newMessages });
    expect(deps.engine.ingest).toHaveBeenCalledWith('sess:abc', 'unknown', newMessages);
  });

  it('missing sessionKey → no ingest, logger.debug called', () => {
    const deps = makeDeps();
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hi' }];
    hook({ agentId: 'agent1', source: 'telegram', newMessages });
    expect(deps.engine.ingest).not.toHaveBeenCalled();
    expect(deps.logger.debug).toHaveBeenCalled();
  });

  it('empty newMessages array → no ingest', () => {
    const deps = makeDeps();
    const hook = createMirrorHook(deps);
    hook({ agentId: 'agent1', sessionKey: 'sess:abc', source: 'telegram', newMessages: [] });
    expect(deps.engine.ingest).not.toHaveBeenCalled();
  });

  it('newMessages not an array → no ingest, no throw', () => {
    const deps = makeDeps();
    const hook = createMirrorHook(deps);
    expect(() => {
      hook({ agentId: 'agent1', sessionKey: 'sess:abc', source: 'telegram', newMessages: 'bad' as any });
    }).not.toThrow();
    expect(deps.engine.ingest).not.toHaveBeenCalled();
  });

  it('sessionKey matches ignoreSessionPatterns glob → no ingest', () => {
    const deps = makeDeps({
      config: { ignoreSessionPatterns: ['lcm:smoke:*'] } as any,
    });
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hi' }];
    hook({ sessionKey: 'lcm:smoke:test123', source: 'telegram', newMessages });
    expect(deps.engine.ingest).not.toHaveBeenCalled();
    expect(deps.logger.debug).toHaveBeenCalled();
  });

  it('sessionKey does NOT match patterns → ingests', () => {
    const deps = makeDeps({
      config: { ignoreSessionPatterns: ['lcm:smoke:*'] } as any,
    });
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hi' }];
    hook({ sessionKey: 'agent1:telegram:private:user42', source: 'telegram', newMessages });
    expect(deps.engine.ingest).toHaveBeenCalledOnce();
  });

  it('ignoreSessionPatterns with ? wildcard works (single char match)', () => {
    const deps = makeDeps({
      config: { ignoreSessionPatterns: ['sess:ab?:end'] } as any,
    });
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hi' }];
    // Should match: 'sess:abc:end' (? matches one char)
    hook({ sessionKey: 'sess:abc:end', source: 'telegram', newMessages });
    expect(deps.engine.ingest).not.toHaveBeenCalled();
    // Should NOT match: 'sess:abcd:end' (? only matches single char)
    const deps2 = makeDeps({
      config: { ignoreSessionPatterns: ['sess:ab?:end'] } as any,
    });
    const hook2 = createMirrorHook(deps2);
    hook2({ sessionKey: 'sess:abcd:end', source: 'telegram', newMessages });
    expect(deps2.engine.ingest).toHaveBeenCalledOnce();
  });

  it('engine.ingest throws → handler swallows, logger.warn called, no rethrow', () => {
    const engine = { ingest: vi.fn().mockImplementation(() => { throw new Error('store error'); }) } as any;
    const deps = makeDeps({ engine });
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hi' }];
    expect(() => {
      hook({ sessionKey: 'sess:abc', source: 'telegram', newMessages });
    }).not.toThrow();
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('empty/null payload → no throw, no ingest', () => {
    const deps = makeDeps();
    const hook = createMirrorHook(deps);
    expect(() => hook({})).not.toThrow();
    expect(() => hook(null as any)).not.toThrow();
    expect(deps.engine.ingest).not.toHaveBeenCalled();
  });

  it('ignoreSessionPatterns empty → never matches, always ingests when valid payload', () => {
    const deps = makeDeps({
      config: { ignoreSessionPatterns: [] } as any,
    });
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hi' }];
    hook({ sessionKey: 'any:session:key', source: 'cli', newMessages });
    expect(deps.engine.ingest).toHaveBeenCalledOnce();
  });

  it('multiple patterns: matches at least one → ignored', () => {
    const deps = makeDeps({
      config: { ignoreSessionPatterns: ['test:*', 'smoke:*', 'lcm:debug:*'] } as any,
    });
    const hook = createMirrorHook(deps);
    const newMessages = [{ role: 'user', content: 'hi' }];
    // Matches the second pattern 'smoke:*'
    hook({ sessionKey: 'smoke:session1', source: 'telegram', newMessages });
    expect(deps.engine.ingest).not.toHaveBeenCalled();
    // Also matches first pattern
    const deps2 = makeDeps({
      config: { ignoreSessionPatterns: ['test:*', 'smoke:*', 'lcm:debug:*'] } as any,
    });
    const hook2 = createMirrorHook(deps2);
    hook2({ sessionKey: 'test:something', source: 'telegram', newMessages });
    expect(deps2.engine.ingest).not.toHaveBeenCalled();
  });
});
