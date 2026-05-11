import type { HonchoConfig } from './config.js';

export interface HonchoSdkOptions {
  apiKey?: string;
  baseURL: string;
  workspaceId: string;
  environment: 'production' | 'local';
  timeout: number;
  maxRetries: number;
}

export type HonchoSdkFactory = (options: HonchoSdkOptions) => unknown;

export interface HonchoRuntimeClient {
  sdk: unknown;
  workspaceId: string;
  baseUrlHost: string;
}

export class HonchoClientConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HonchoClientConfigError';
  }
}

export async function createHonchoClient(
  config: HonchoConfig,
  opts: {
    env?: Record<string, string | undefined>;
    sdkFactory?: HonchoSdkFactory;
  } = {},
): Promise<HonchoRuntimeClient> {
  const env = opts.env ?? process.env;
  const apiKey = env[config.connection.api_key_env];
  if (config.connection.environment !== 'local' && !apiKey) {
    throw new HonchoClientConfigError(
      `Honcho API key env var ${config.connection.api_key_env} is required for ${config.connection.environment} mode`,
    );
  }

  const options: HonchoSdkOptions = {
    apiKey,
    baseURL: config.connection.base_url,
    workspaceId: config.connection.workspace_id,
    environment: config.connection.environment,
    timeout: config.connection.timeout_ms,
    maxRetries: config.connection.max_retries,
  };

  try {
    const factory = opts.sdkFactory ?? await loadDefaultFactory();
    const sdk = factory(options);
    return {
      sdk,
      workspaceId: config.connection.workspace_id,
      baseUrlHost: new URL(config.connection.base_url).host,
    };
  } catch (err) {
    throw new HonchoClientConfigError(
      `Honcho client init failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`,
    );
  }
}

async function loadDefaultFactory(): Promise<HonchoSdkFactory> {
  // Keep the SDK out of Vitest/Vite's eager transform path. Runtime still
  // resolves the normal package, while tests inject `sdkFactory`.
  const dynamicImport = new Function('specifier', 'return import(specifier)') as
    (specifier: string) => Promise<typeof import('@honcho-ai/sdk')>;
  const mod = await dynamicImport('@honcho-ai/sdk');
  return (options) => new mod.Honcho(options);
}

function redactSecrets(text: string): string {
  return text.replace(
    /(?:api[_-]?key|token|secret|password)["':\s=]+([a-zA-Z0-9_-]{20,})/gi,
    (full, value: string) => {
      const prefix = full.slice(0, full.length - value.length);
      return `${prefix}${maskSecret(value)}`;
    },
  );
}

function maskSecret(value: string): string {
  if (value.length < 18) return '[REDACTED]';
  return `${value.slice(0, 6)}****${value.slice(-4)}`;
}
