import { describe, expect, it, vi } from 'vitest';
import {
  createHonchoClient,
  HonchoClientConfigError,
  type HonchoSdkFactory,
} from '../src/client.js';
import { resolveConfig } from '../src/config.js';

describe('Honcho client adapter', () => {
  it('constructs the SDK with explicit config and env-provided API key', async () => {
    const sdk = { marker: 'sdk' };
    const factory: HonchoSdkFactory = vi.fn(() => sdk);
    const config = resolveConfig({}, {
      connection: {
        workspace_id: 'anthroclaw-prod',
        base_url: 'https://memory.example.test',
        api_key_env: 'HONCHO_PROD_KEY',
        timeout_ms: 9000,
        max_retries: 3,
      },
    });

    const client = await createHonchoClient(config, {
      env: { HONCHO_PROD_KEY: 'secret-key' },
      sdkFactory: factory,
    });

    expect(client.sdk).toBe(sdk);
    expect(factory).toHaveBeenCalledWith({
      apiKey: 'secret-key',
      baseURL: 'https://memory.example.test',
      workspaceId: 'anthroclaw-prod',
      environment: 'production',
      timeout: 9000,
      maxRetries: 3,
    });
  });

  it('allows local self-hosted mode without an API key', async () => {
    const factory: HonchoSdkFactory = vi.fn(() => ({ ok: true }));
    const config = resolveConfig({}, {
      connection: {
        environment: 'local',
        base_url: 'http://localhost:8000',
      },
    });

    await createHonchoClient(config, {
      env: {},
      sdkFactory: factory,
    });

    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: undefined,
        environment: 'local',
        baseURL: 'http://localhost:8000',
      }),
    );
  });

  it('fails fast when production mode has no configured API key', async () => {
    const config = resolveConfig({}, {
      connection: { api_key_env: 'HONCHO_MISSING_KEY' },
    });

    await expect(createHonchoClient(config, {
      env: {},
      sdkFactory: vi.fn(),
    })).rejects.toThrow(HonchoClientConfigError);
    await expect(createHonchoClient(config, {
      env: {},
      sdkFactory: vi.fn(),
    })).rejects.toThrow('HONCHO_MISSING_KEY');
  });

  it('redacts secrets when SDK construction fails', async () => {
    const config = resolveConfig({}, {
      connection: { api_key_env: 'HONCHO_API_KEY' },
    });

    await expect(createHonchoClient(config, {
      env: { HONCHO_API_KEY: 'secret-token-value-1234567890' },
      sdkFactory: () => {
        throw new Error('bad token=secret-token-value-1234567890');
      },
    })).rejects.toThrow('secret****7890');
  });
});
