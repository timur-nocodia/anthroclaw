import { describe, expect, it } from 'vitest';
import {
  parsePiAuthSmokeArgs,
  runPiAuthSmoke,
  runPiAuthSmokeCli,
} from '../pi-auth-smoke.js';

describe('Pi auth smoke CLI', () => {
  it('passes when the requested model exists and is available with configured auth', async () => {
    const result = await runPiAuthSmoke('anthropic/claude-sonnet-4-6', undefined, fakeSdk({
      models: [
        { provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      ],
      available: [
        { provider: 'anthropic', id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      ],
      configuredProviders: ['anthropic'],
    }));

    expect(result).toMatchObject({
      status: 'passed',
      runtime: 'pi',
      package: {
        name: '@earendil-works/pi-coding-agent',
        version: '0.74.0-test',
        importable: true,
      },
      model: {
        requested: 'anthropic/claude-sonnet-4-6',
        found: true,
        available: true,
        name: 'Claude Sonnet 4.6',
      },
      auth: {
        provider: 'anthropic',
        configured: true,
      },
      availableModelCount: 1,
    });
  });

  it('fails with a setup next action when provider auth is missing', async () => {
    const result = await runPiAuthSmoke('anthropic/claude-sonnet-4-6', undefined, fakeSdk({
      models: [
        { provider: 'anthropic', id: 'claude-sonnet-4-6' },
      ],
      available: [],
      configuredProviders: [],
    }));

    expect(result).toMatchObject({
      status: 'failed',
      model: {
        found: true,
        available: false,
      },
      auth: {
        provider: 'anthropic',
        configured: false,
      },
      error: 'Pi provider anthropic has no configured credentials.',
      nextAction: expect.stringContaining('Configure Pi credentials for provider anthropic.'),
    });
  });

  it('fails when a configured provider does not expose the requested model', async () => {
    const result = await runPiAuthSmoke('anthropic/claude-sonnet-4-6', undefined, fakeSdk({
      models: [
        { provider: 'anthropic', id: 'claude-sonnet-4-6' },
        { provider: 'anthropic', id: 'claude-haiku-4-5' },
      ],
      available: [
        { provider: 'anthropic', id: 'claude-haiku-4-5' },
      ],
      configuredProviders: ['anthropic'],
    }));

    expect(result).toMatchObject({
      status: 'failed',
      model: {
        found: true,
        available: false,
      },
      auth: {
        configured: true,
      },
      error: 'Pi model anthropic/claude-sonnet-4-6 exists but is not available with the configured credentials.',
    });
  });

  it('can turn missing optional Pi setup into an explicit skip', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiAuthSmokeCli(['--allow-skip', '--json'], {
      loadSdk: async () => {
        throw new Error('Pi auth smoke requires optional package @earendil-works/pi-coding-agent.');
      },
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'skipped',
      runtime: 'pi',
      package: {
        importable: false,
      },
      error: expect.stringContaining('@earendil-works/pi-coding-agent'),
    });
  });

  it('can turn missing provider auth into an explicit skip', async () => {
    const stdout = createWriter();
    const stderr = createWriter();

    const code = await runPiAuthSmokeCli(['--allow-skip', '--json'], {
      loadSdk: async () => fakeSdk({
        models: [
          { provider: 'anthropic', id: 'claude-sonnet-4-6' },
        ],
        available: [],
        configuredProviders: [],
      }),
      stdout,
      stderr,
    });

    expect(code).toBe(0);
    expect(stderr.text()).toBe('');
    expect(JSON.parse(stdout.text())).toMatchObject({
      status: 'skipped',
      runtime: 'pi',
      package: {
        importable: true,
      },
      error: 'Pi provider anthropic has no configured credentials.',
    });
  });

  it('parses flags narrowly', () => {
    expect(parsePiAuthSmokeArgs([
      '--',
      '--model', 'openai/gpt-5-mini',
      '--allow-skip',
      '--json',
    ])).toEqual({
      model: 'openai/gpt-5-mini',
      allowSkip: true,
      json: true,
      help: false,
    });
    expect(() => parsePiAuthSmokeArgs(['--runtime', 'pi'])).toThrow(/Unknown argument/);
  });
});

function fakeSdk(input: {
  models: Array<{ provider: string; id: string; name?: string }>;
  available: Array<{ provider: string; id: string; name?: string }>;
  configuredProviders: string[];
}) {
  return {
    VERSION: '0.74.0-test',
    AuthStorage: {
      create: () => ({}),
    },
    ModelRegistry: {
      create: () => ({
        find: (provider: string, modelId: string) =>
          input.models.find((model) => model.provider === provider && model.id === modelId),
        getAvailable: async () => input.available,
        hasConfiguredAuth: async (provider: string) => input.configuredProviders.includes(provider),
        getProviderAuthStatus: async (provider: string) => ({
          configured: input.configuredProviders.includes(provider),
          key: 'must-not-leak',
        }),
      }),
    },
  };
}

function createWriter() {
  const chunks: string[] = [];
  return {
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    text() {
      return chunks.join('');
    },
  };
}
