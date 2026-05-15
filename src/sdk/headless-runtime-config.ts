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
  return headlessRuntimeOptionsForProvider(config?.runtime?.headless.provider);
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
