import { describe, expect, it } from 'vitest';
import {
  HonchoConfigSchema,
  resolveConfig,
} from '../src/config.js';

describe('Honcho config', () => {
  it('defaults to disabled observe mode with privacy-preserving IDs', () => {
    const config = resolveConfig(undefined);

    expect(config).toMatchObject({
      enabled: false,
      mode: 'observe',
      connection: {
        workspace_id: 'anthroclaw-local',
        environment: 'production',
        base_url: 'https://api.honcho.dev',
        api_key_env: 'HONCHO_API_KEY',
        timeout_ms: 15_000,
        max_retries: 2,
      },
      peers: {
        agent_peer_prefix: 'agent',
        user_peer_prefix: 'user',
        group_peer_prefix: 'group',
        hash_ids: true,
      },
      privacy: {
        include_display_names: false,
        strip_prompt_context_blocks: true,
        strip_tool_progress: true,
        redact_secrets: true,
      },
    });
  });

  it('deep-merges global defaults and per-agent overrides', () => {
    const config = resolveConfig(
      {
        enabled: true,
        mode: 'context',
        connection: {
          workspace_id: 'anthroclaw-prod',
          timeout_ms: 10_000,
        },
        tools: {
          ask: false,
        },
      },
      {
        mode: 'hybrid',
        connection: {
          api_key_env: 'HONCHO_PROD_KEY',
        },
        context: {
          token_budget: 2400,
        },
      },
    );

    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('hybrid');
    expect(config.connection).toMatchObject({
      workspace_id: 'anthroclaw-prod',
      timeout_ms: 10_000,
      api_key_env: 'HONCHO_PROD_KEY',
      base_url: 'https://api.honcho.dev',
    });
    expect(config.context.token_budget).toBe(2400);
    expect(config.tools.ask).toBe(false);
    expect(config.tools.context).toBe(true);
  });

  it('exports a Zod schema usable by the plugin catalog UI', () => {
    const parsed = HonchoConfigSchema.parse({
      enabled: true,
      mode: 'tools',
      context: { max_chars: 4000 },
    });

    expect(parsed.enabled).toBe(true);
    expect(parsed.mode).toBe('tools');
    expect(parsed.context.max_chars).toBe(4000);
  });
});
