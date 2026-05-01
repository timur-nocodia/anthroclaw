import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadAgentYml } from '../loader.js';
import { GlobalConfigSchema, AgentYmlSchema } from '../schema.js';

describe('plugins config schema', () => {
  // Minimal valid AgentYml with all required fields
  const minimalValidAgentYml = {
    safety_profile: 'trusted' as const,
    routes: [{ channel: 'telegram' }],
    memory_extraction: undefined,
    subagents: undefined,
  };

  it('GlobalConfigSchema accepts plugins.{name}.defaults section', () => {
    const result = GlobalConfigSchema.safeParse({
      plugins: { lcm: { defaults: { enabled: false, foo: 'bar' } } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plugins?.lcm?.defaults?.enabled).toBe(false);
    }
  });

  it('AgentYmlSchema accepts plugins.{name}.enabled', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      plugins: { lcm: { enabled: true } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plugins?.lcm?.enabled).toBe(true);
    }
  });

  it('AgentYmlSchema accepts plugins.{name} with extra fields (passthrough)', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      plugins: { lcm: { enabled: true, customSetting: 42 } },
    });
    expect(result.success).toBe(true);
  });

  it('plugins section is fully optional in GlobalConfigSchema', () => {
    const result = GlobalConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.plugins).toBeUndefined();
    }
  });

  it('plugins section is fully optional in AgentYmlSchema', () => {
    const result = AgentYmlSchema.safeParse(minimalValidAgentYml);
    expect(result.success).toBe(true);
  });

  it('AgentYmlSchema rejects plugins.{name}.enabled with non-boolean', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      plugins: { lcm: { enabled: 'yes' } },     // not a boolean
    });
    expect(result.success).toBe(false);
  });

  it('AgentYmlSchema defaults learning to disabled/off', () => {
    const result = AgentYmlSchema.safeParse(minimalValidAgentYml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.learning).toMatchObject({
        enabled: false,
        mode: 'off',
        review_interval_turns: 10,
        skill_review_min_tool_calls: 8,
        max_actions_per_review: 8,
        max_input_chars: 24_000,
        artifacts: {
          max_files: 32,
          max_file_bytes: 65_536,
          max_total_bytes: 262_144,
          max_prompt_chars: 24_000,
          max_snippet_chars: 4_000,
        },
      });
    }
  });

  it('AgentYmlSchema accepts heartbeat config and applies defaults', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      heartbeat: {
        enabled: true,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.heartbeat).toMatchObject({
        enabled: true,
        every: '30m',
        target: 'last',
        isolated_session: true,
        show_ok: false,
        ack_token: 'HEARTBEAT_OK',
      });
      expect(result.data.heartbeat?.prompt).toContain('HEARTBEAT.md');
    }
  });

  it('AgentYmlSchema accepts learning propose config and artifact limits', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      learning: {
        enabled: true,
        mode: 'propose',
        review_interval_turns: 5,
        skill_review_min_tool_calls: 12,
        max_actions_per_review: 4,
        max_input_chars: 12_000,
        artifacts: {
          max_files: 10,
          max_file_bytes: 32_768,
          max_total_bytes: 100_000,
          max_prompt_chars: 10_000,
          max_snippet_chars: 2_000,
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.learning.mode).toBe('propose');
      expect(result.data.learning.artifacts.max_files).toBe(10);
    }
  });

  it('example agent is configured for propose-only learning rollout', () => {
    const config = loadAgentYml(resolve(process.cwd(), 'agents', 'example'));
    expect(config.safety_profile).toBe('chat_like_openclaw');
    expect(config.learning).toMatchObject({
      enabled: true,
      mode: 'propose',
    });
  });

  it('AgentYmlSchema accepts human_takeover block with defaults', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      human_takeover: { enabled: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.human_takeover).toMatchObject({
        enabled: true,
        pause_ttl_minutes: 30,
        channels: ['whatsapp'],
        ignore: ['reactions', 'receipts', 'typing', 'protocol'],
        notification_throttle_minutes: 5,
      });
    }
  });

  it('human_takeover defaults to disabled (block omitted entirely)', () => {
    const result = AgentYmlSchema.safeParse(minimalValidAgentYml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.human_takeover).toBeUndefined();
      expect(result.data.human_takeover?.enabled ?? false).toBe(false);
    }
  });

  it('AgentYmlSchema rejects human_takeover.pause_ttl_minutes <= 0', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      human_takeover: { enabled: true, pause_ttl_minutes: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('AgentYmlSchema rejects negative human_takeover.pause_ttl_minutes', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      human_takeover: { enabled: true, pause_ttl_minutes: -5 },
    });
    expect(result.success).toBe(false);
  });

  it('AgentYmlSchema rejects unknown channel in human_takeover.channels', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      human_takeover: { enabled: true, channels: ['discord'] },
    });
    expect(result.success).toBe(false);
  });

  it('human_takeover allows custom pause_ttl_minutes and channels', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      human_takeover: {
        enabled: true,
        pause_ttl_minutes: 60,
        channels: ['whatsapp', 'telegram'],
        notification_throttle_minutes: 0,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.human_takeover).toMatchObject({
        enabled: true,
        pause_ttl_minutes: 60,
        channels: ['whatsapp', 'telegram'],
        notification_throttle_minutes: 0,
      });
    }
  });

  // ─── notifications ────────────────────────────────────────────

  it('AgentYmlSchema accepts notifications block with defaults applied', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      notifications: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifications).toMatchObject({
        enabled: false,
        routes: {},
        subscriptions: [],
      });
    }
  });

  it('notifications is optional and absent when omitted', () => {
    const result = AgentYmlSchema.safeParse(minimalValidAgentYml);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifications).toBeUndefined();
    }
  });

  it('AgentYmlSchema accepts notifications routes record + subscriptions array', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      notifications: {
        enabled: true,
        routes: {
          operator: { channel: 'telegram', account_id: 'control', peer_id: '48705953' },
          team: { channel: 'whatsapp', account_id: 'business', peer_id: '37120000@s.whatsapp.net' },
        },
        subscriptions: [
          { event: 'peer_pause_started', route: 'operator' },
          { event: 'peer_pause_ended', route: 'operator', throttle: '5m' },
          { event: 'peer_pause_summary_daily', route: 'team', schedule: '0 9 * * *' },
        ],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifications?.routes.operator).toMatchObject({
        channel: 'telegram',
        account_id: 'control',
        peer_id: '48705953',
      });
      expect(result.data.notifications?.subscriptions).toHaveLength(3);
    }
  });

  it('notifications throttle is freeform — accepts "5m", "1h", "30s"', () => {
    const cases = ['5m', '1h', '30s', '90m'];
    for (const throttle of cases) {
      const result = AgentYmlSchema.safeParse({
        ...minimalValidAgentYml,
        notifications: {
          enabled: true,
          routes: { op: { channel: 'telegram', account_id: 'a', peer_id: 'p' } },
          subscriptions: [{ event: 'peer_pause_started', route: 'op', throttle }],
        },
      });
      expect(result.success).toBe(true);
    }
  });

  it('notifications rejects empty-string throttle', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      notifications: {
        enabled: true,
        routes: { op: { channel: 'telegram', account_id: 'a', peer_id: 'p' } },
        subscriptions: [{ event: 'peer_pause_started', route: 'op', throttle: '' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('notifications rejects unknown event name', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      notifications: {
        enabled: true,
        routes: { op: { channel: 'telegram', account_id: 'a', peer_id: 'p' } },
        subscriptions: [{ event: 'bogus_event', route: 'op' }],
      },
    });
    expect(result.success).toBe(false);
  });

  it('notifications rejects route with unknown channel', () => {
    const result = AgentYmlSchema.safeParse({
      ...minimalValidAgentYml,
      notifications: {
        enabled: true,
        routes: { op: { channel: 'discord', account_id: 'a', peer_id: 'p' } },
        subscriptions: [],
      },
    });
    expect(result.success).toBe(false);
  });
});
