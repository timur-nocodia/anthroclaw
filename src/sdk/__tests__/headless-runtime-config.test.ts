import { describe, expect, it } from 'vitest';
import { GlobalConfigSchema } from '../../config/schema.js';
import {
  headlessRuntimeOptionsForProvider,
  headlessRuntimeOptionsFromConfig,
  withConfiguredHeadlessRuntime,
} from '../headless-runtime-config.js';

describe('headless runtime config helpers', () => {
  it('keeps Claude Agent SDK as the default runtime', () => {
    const config = GlobalConfigSchema.parse({});

    expect(config.runtime.headless.provider).toBe('claude-agent-sdk');
    expect(headlessRuntimeOptionsFromConfig(config)).toEqual({});
    expect(headlessRuntimeOptionsForProvider('claude-agent-sdk')).toEqual({});
  });

  it('maps explicit Pi config to a runtime selection', () => {
    const config = GlobalConfigSchema.parse({
      runtime: {
        headless: {
          provider: 'pi',
        },
      },
    });

    expect(headlessRuntimeOptionsFromConfig(config)).toEqual({ runtime: 'pi' });
  });

  it('maps Pi auth/model storage paths into runtime options', () => {
    const config = GlobalConfigSchema.parse({
      runtime: {
        headless: {
          provider: 'pi',
          pi: {
            auth_path: '/secure/pi-auth.json',
            models_path: '/secure/pi-models.json',
            max_output_tokens: 1024,
            provider_max_output_tokens: {
              openrouter: 512,
            },
            model_max_output_tokens: {
              'openrouter/qwen/qwen3.6-max-preview': 192,
            },
          },
        },
      },
    });

    expect(headlessRuntimeOptionsFromConfig(config)).toEqual({
      runtime: 'pi',
      runtimeOptions: {
        pi: {
          authStoragePath: '/secure/pi-auth.json',
          modelsPath: '/secure/pi-models.json',
          maxOutputTokens: 1024,
          providerMaxOutputTokens: {
            openrouter: 512,
          },
          modelMaxOutputTokens: {
            'openrouter/qwen/qwen3.6-max-preview': 192,
          },
        },
      },
    });
  });

  it('maps explicit OpenCode config to a runtime selection', () => {
    const config = GlobalConfigSchema.parse({
      runtime: {
        headless: {
          provider: 'opencode',
        },
      },
    });

    expect(headlessRuntimeOptionsFromConfig(config)).toEqual({ runtime: 'opencode' });
  });

  it('does not overwrite an explicitly supplied runtime object', async () => {
    const runtime = {
      id: 'custom',
      runText: async () => 'ok',
    };
    const config = GlobalConfigSchema.parse({
      runtime: {
        headless: {
          provider: 'pi',
        },
      },
    });

    expect(withConfiguredHeadlessRuntime({ runtime }, config)).toEqual({ runtime });
  });
});
