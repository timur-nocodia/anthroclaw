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

vi.mock('@backend/config/loader.js', () => ({
  loadGlobalConfig: vi.fn().mockReturnValue({
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

  vi.mock('@backend/config/loader.js', () => ({
    loadGlobalConfig: vi.fn().mockReturnValue({
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
