import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the backend modules
vi.mock('@backend/gateway.js', () => {
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockStop = vi.fn().mockResolvedValue(undefined);
  const mockGetStatus = vi.fn().mockReturnValue({
    uptime: 1000,
    agents: ['test'],
    activeSessions: 0,
    nodeVersion: 'v22.0.0',
    platform: 'darwin',
    channels: { telegram: [], whatsapp: [] },
  });

  class MockGateway {
    start = mockStart;
    stop = mockStop;
    getStatus = mockGetStatus;
  }

  return { Gateway: MockGateway, _mockStart: mockStart, _mockStop: mockStop };
});

vi.mock('@backend/config/overlay.js', () => ({
  getOverlayPath: vi.fn().mockReturnValue('/tmp/test-overlay.yml'),
  loadGlobalConfigWithOverlay: vi.fn().mockReturnValue({
    defaults: { model: 'claude-sonnet-4-6', embedding_provider: 'off', embedding_model: '', debounce_ms: 0 },
  }),
}));

let gatewayModule: typeof import('@/lib/gateway');

beforeEach(async () => {
  vi.resetModules();

  // Re-mock after resetModules
  vi.mock('@backend/gateway.js', () => {
    const mockStart = vi.fn().mockResolvedValue(undefined);
    const mockStop = vi.fn().mockResolvedValue(undefined);

    class MockGateway {
      start = mockStart;
      stop = mockStop;
      getStatus = vi.fn().mockReturnValue({ uptime: 1000 });
    }

    return { Gateway: MockGateway };
  });

  vi.mock('@backend/config/overlay.js', () => ({
    getOverlayPath: vi.fn().mockReturnValue('/tmp/test-overlay.yml'),
    loadGlobalConfigWithOverlay: vi.fn().mockReturnValue({
      defaults: { model: 'claude-sonnet-4-6', embedding_provider: 'off', embedding_model: '', debounce_ms: 0 },
    }),
  }));

  gatewayModule = await import('@/lib/gateway');
  gatewayModule._resetForTest();
});

describe('getGateway', () => {
  it('returns a Gateway instance', async () => {
    const gw = await gatewayModule.getGateway();
    expect(gw).toBeDefined();
    expect(typeof gw.start).toBe('function');
  });

  it('returns same instance on multiple calls', async () => {
    const gw1 = await gatewayModule.getGateway();
    const gw2 = await gatewayModule.getGateway();
    expect(gw1).toBe(gw2);
  });

  it('concurrent calls return same instance', async () => {
    const [gw1, gw2, gw3] = await Promise.all([
      gatewayModule.getGateway(),
      gatewayModule.getGateway(),
      gatewayModule.getGateway(),
    ]);
    expect(gw1).toBe(gw2);
    expect(gw2).toBe(gw3);
  });
});

describe('restartGateway', () => {
  it('creates new instance after restart', async () => {
    const gw1 = await gatewayModule.getGateway();
    await gatewayModule.restartGateway();
    const gw2 = await gatewayModule.getGateway();

    // After restart, should be a different instance
    expect(gw1).not.toBe(gw2);
  });
});

describe('getStartedAt', () => {
  it('returns null before initialization', () => {
    expect(gatewayModule.getStartedAt()).toBeNull();
  });

  it('returns a Date after initialization', async () => {
    await gatewayModule.getGateway();
    const started = gatewayModule.getStartedAt();
    expect(started).toBeInstanceOf(Date);
  });
});

describe('cross module-instance singleton (Next.js double-load scenario)', () => {
  it('returns the SAME gateway after vi.resetModules() re-imports this file', async () => {
    // Simulates the prod bug: instrumentation.ts does `await import('./lib/gateway')`
    // while API routes do `import { ... } from '@/lib/gateway'`. Webpack can treat
    // those as separate module instances, each with its own module-level
    // `let instance`. globalThis is what makes the singleton survive that.

    // First load — fresh state, create instance #1
    const moduleA = await import('@/lib/gateway');
    const gw1 = await moduleA.getGateway();
    expect(gw1).toBeDefined();

    // Force a second evaluation of this same module file. resetModules clears
    // Vitest's module cache, so `import()` below produces a NEW module instance
    // (different `let` bindings, different closures). DO NOT call
    // `_resetForTest()` here — that would defeat the test by wiping globalThis.
    vi.resetModules();
    vi.doMock('@backend/gateway.js', () => {
      class MockGateway {
        start = vi.fn().mockResolvedValue(undefined);
        stop = vi.fn().mockResolvedValue(undefined);
        getStatus = vi.fn().mockReturnValue({ uptime: 1 });
      }
      return { Gateway: MockGateway };
    });
    vi.doMock('@backend/config/overlay.js', () => ({
      getOverlayPath: vi.fn().mockReturnValue('/tmp/test-overlay.yml'),
      loadGlobalConfigWithOverlay: vi.fn().mockReturnValue({
        defaults: { model: 'claude-sonnet-4-6', embedding_provider: 'off', embedding_model: '', debounce_ms: 0 },
      }),
    }));

    const moduleB = await import('@/lib/gateway');
    expect(moduleB).not.toBe(moduleA); // confirm we really got a fresh module
    const gw2 = await moduleB.getGateway();

    // Without globalThis, gw2 would be a freshly-booted second gateway
    // instance — i.e. the double-boot bug.
    expect(gw2).toBe(gw1);
  });
});
