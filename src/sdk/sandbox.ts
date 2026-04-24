import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { SdkSandboxConfig } from '../config/schema.js';

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

export function normalizeSandboxSettings(
  config: SdkSandboxConfig | undefined,
): Options['sandbox'] | undefined {
  if (!config) return undefined;

  const network = config.network && Object.fromEntries(
    Object.entries(config.network).filter(([, value]) => isDefined(value)),
  );

  const filesystem = config.filesystem && Object.fromEntries(
    Object.entries(config.filesystem).filter(([, value]) => isDefined(value)),
  );

  const normalized = {
    enabled: config.enabled,
    failIfUnavailable: config.failIfUnavailable,
    autoAllowBashIfSandboxed: config.autoAllowBashIfSandboxed,
    allowUnsandboxedCommands: config.allowUnsandboxedCommands,
    network: network && Object.keys(network).length > 0 ? network : undefined,
    filesystem: filesystem && Object.keys(filesystem).length > 0 ? filesystem : undefined,
  };

  return Object.values(normalized).some((value) => value !== undefined)
    ? normalized
    : undefined;
}
