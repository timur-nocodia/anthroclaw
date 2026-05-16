import type { GlobalConfig, HeadlessRuntimeProvider } from '../config/schema.js';
import type {
  HeadlessRuntimeResolverOptions,
  HeadlessRuntimeSelection,
} from '../runtime/headless-registry.js';

export interface HeadlessReviewRuntimeConfig {
  runtime?: HeadlessRuntimeSelection;
  runtimeOptions?: HeadlessRuntimeResolverOptions;
}

export function headlessRuntimeOptionsForProvider(
  provider?: HeadlessRuntimeProvider,
): HeadlessReviewRuntimeConfig {
  if (!provider || provider === 'claude-agent-sdk') {
    return {};
  }

  return { runtime: provider };
}

export function headlessRuntimeOptionsFromConfig(
  config?: Pick<GlobalConfig, 'runtime'> | null,
): HeadlessReviewRuntimeConfig {
  const base = headlessRuntimeOptionsForProvider(config?.runtime?.headless.provider);
  const piConfig = config?.runtime?.headless.pi;
  if (base.runtime !== 'pi' || !piConfig) return base;

  const piOptions: NonNullable<HeadlessRuntimeResolverOptions['pi']> = {};
  if (piConfig.auth_path) piOptions.authStoragePath = piConfig.auth_path;
  if (piConfig.models_path) piOptions.modelsPath = piConfig.models_path;

  if (Object.keys(piOptions).length === 0) return base;
  return {
    ...base,
    runtimeOptions: {
      pi: piOptions,
    },
  };
}

export function withConfiguredHeadlessRuntime<T extends HeadlessReviewRuntimeConfig>(
  input: T,
  config?: Pick<GlobalConfig, 'runtime'> | null,
): T {
  if (input.runtime) return input;
  const configured = headlessRuntimeOptionsFromConfig(config);
  if (!configured.runtime) return input;
  return {
    ...input,
    ...configured,
  };
}
