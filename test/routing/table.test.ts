import { describe, it, expect } from 'vitest';
import { RouteTable } from '../../src/routing/table.js';
import type { RouteEntry } from '../../src/routing/table.js';
import type { AgentYml } from '../../src/config/schema.js';

// Helper to build a minimal AgentYml with routes
function makeAgent(routes: AgentYml['routes']): AgentYml {
  return { routes } as AgentYml;
}

describe('RouteTable', () => {
  it('resolves DM route', () => {
    const table = RouteTable.build([
      {
        id: 'jarvis',
        config: makeAgent([{ channel: 'telegram', scope: 'dm', mention_only: false }]),
      },
    ]);

    const entry = table.resolve('telegram', 'default', 'dm', '123');
    expect(entry).not.toBeNull();
    expect(entry!.agentId).toBe('jarvis');
    expect(entry!.channel).toBe('telegram');
    expect(entry!.scope).toBe('dm');
  });

  it('resolves specific peer over broad scope (priority)', () => {
    const table = RouteTable.build([
      {
        id: 'broad',
        config: makeAgent([{ channel: 'telegram', scope: 'any', mention_only: false }]),
      },
      {
        id: 'specific',
        config: makeAgent([
          { channel: 'telegram', scope: 'dm', peers: ['123'], mention_only: false },
        ]),
      },
    ]);

    const entry = table.resolve('telegram', 'default', 'dm', '123');
    expect(entry).not.toBeNull();
    expect(entry!.agentId).toBe('specific');
  });

  it('returns null for unmatched route', () => {
    const table = RouteTable.build([
      {
        id: 'jarvis',
        config: makeAgent([{ channel: 'telegram', scope: 'dm', mention_only: false }]),
      },
    ]);

    const entry = table.resolve('whatsapp', 'default', 'dm', '123');
    expect(entry).toBeNull();
  });

  it('respects account filter', () => {
    const table = RouteTable.build([
      {
        id: 'jarvis',
        config: makeAgent([
          { channel: 'telegram', scope: 'any', account: 'bot1', mention_only: false },
        ]),
      },
    ]);

    // Matching account
    expect(table.resolve('telegram', 'bot1', 'dm', '123')).not.toBeNull();
    // Non-matching account
    expect(table.resolve('telegram', 'bot2', 'dm', '123')).toBeNull();
  });

  it('detects conflicts (throws)', () => {
    expect(() =>
      RouteTable.build([
        {
          id: 'agent1',
          config: makeAgent([{ channel: 'telegram', scope: 'dm', mention_only: false }]),
        },
        {
          id: 'agent2',
          config: makeAgent([{ channel: 'telegram', scope: 'dm', mention_only: false }]),
        },
      ]),
    ).toThrow(/conflict/i);
  });

  it('scope "any" matches both dm and group', () => {
    const table = RouteTable.build([
      {
        id: 'omni',
        config: makeAgent([{ channel: 'telegram', scope: 'any', mention_only: false }]),
      },
    ]);

    expect(table.resolve('telegram', 'default', 'dm', '100')).not.toBeNull();
    expect(table.resolve('telegram', 'default', 'group', '200')).not.toBeNull();
  });

  it('multiple agents on different channels do not conflict', () => {
    const table = RouteTable.build([
      {
        id: 'tg-bot',
        config: makeAgent([{ channel: 'telegram', scope: 'any', mention_only: false }]),
      },
      {
        id: 'wa-bot',
        config: makeAgent([{ channel: 'whatsapp', scope: 'any', mention_only: false }]),
      },
    ]);

    expect(table.resolve('telegram', 'default', 'dm', '1')!.agentId).toBe('tg-bot');
    expect(table.resolve('whatsapp', 'default', 'dm', '1')!.agentId).toBe('wa-bot');
  });

  it('handles agent with multiple routes', () => {
    const table = RouteTable.build([
      {
        id: 'multi',
        config: makeAgent([
          { channel: 'telegram', scope: 'dm', mention_only: false },
          { channel: 'whatsapp', scope: 'group', mention_only: true },
        ]),
      },
    ]);

    const tgEntry = table.resolve('telegram', 'default', 'dm', '1');
    expect(tgEntry).not.toBeNull();
    expect(tgEntry!.agentId).toBe('multi');
    expect(tgEntry!.mentionOnly).toBe(false);

    const waEntry = table.resolve('whatsapp', 'default', 'group', '2');
    expect(waEntry).not.toBeNull();
    expect(waEntry!.agentId).toBe('multi');
    expect(waEntry!.mentionOnly).toBe(true);
  });

  // ─── Topic-specific routing tests ───────────────────────────────

  it('resolves topic-specific route over peer-only route (priority)', () => {
    const table = RouteTable.build([
      {
        id: 'general-bot',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-1001234567890'], mention_only: true },
        ]),
      },
      {
        id: 'support-bot',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-1001234567890'], topics: ['123'], mention_only: false },
        ]),
      },
    ]);

    // Message in topic 123 -> support-bot (higher priority due to topics)
    const entry = table.resolve('telegram', 'default', 'group', '-1001234567890', '123');
    expect(entry).not.toBeNull();
    expect(entry!.agentId).toBe('support-bot');
    expect(entry!.mentionOnly).toBe(false);
  });

  it('falls back to peer-only route when threadId does not match topics', () => {
    const table = RouteTable.build([
      {
        id: 'general-bot',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-1001234567890'], mention_only: true },
        ]),
      },
      {
        id: 'support-bot',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-1001234567890'], topics: ['123'], mention_only: false },
        ]),
      },
    ]);

    // Message in topic 456 -> general-bot (support-bot only handles topic 123)
    const entry = table.resolve('telegram', 'default', 'group', '-1001234567890', '456');
    expect(entry).not.toBeNull();
    expect(entry!.agentId).toBe('general-bot');
  });

  it('falls back to peer-only route when no threadId is provided', () => {
    const table = RouteTable.build([
      {
        id: 'general-bot',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-1001234567890'], mention_only: true },
        ]),
      },
      {
        id: 'support-bot',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-1001234567890'], topics: ['123'], mention_only: false },
        ]),
      },
    ]);

    // No threadId -> general-bot
    const entry = table.resolve('telegram', 'default', 'group', '-1001234567890');
    expect(entry).not.toBeNull();
    expect(entry!.agentId).toBe('general-bot');
  });

  it('topic route matches one of multiple topics', () => {
    const table = RouteTable.build([
      {
        id: 'multi-topic-bot',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-100999'], topics: ['10', '20', '30'], mention_only: false },
        ]),
      },
    ]);

    expect(table.resolve('telegram', 'default', 'group', '-100999', '10')).not.toBeNull();
    expect(table.resolve('telegram', 'default', 'group', '-100999', '20')).not.toBeNull();
    expect(table.resolve('telegram', 'default', 'group', '-100999', '30')).not.toBeNull();
    // Non-matching topic
    expect(table.resolve('telegram', 'default', 'group', '-100999', '99')).toBeNull();
  });

  it('detects topic conflict (two agents claiming same peer + topic)', () => {
    expect(() =>
      RouteTable.build([
        {
          id: 'bot-a',
          config: makeAgent([
            { channel: 'telegram', scope: 'group', peers: ['-100999'], topics: ['123'], mention_only: false },
          ]),
        },
        {
          id: 'bot-b',
          config: makeAgent([
            { channel: 'telegram', scope: 'group', peers: ['-100999'], topics: ['123'], mention_only: false },
          ]),
        },
      ]),
    ).toThrow(/conflict/i);
  });

  it('different topics on same peer do not conflict', () => {
    const table = RouteTable.build([
      {
        id: 'bot-a',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-100999'], topics: ['111'], mention_only: false },
        ]),
      },
      {
        id: 'bot-b',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-100999'], topics: ['222'], mention_only: false },
        ]),
      },
    ]);

    expect(table.resolve('telegram', 'default', 'group', '-100999', '111')!.agentId).toBe('bot-a');
    expect(table.resolve('telegram', 'default', 'group', '-100999', '222')!.agentId).toBe('bot-b');
  });

  it('topic route has higher priority than peers-only route (priority value)', () => {
    // Build with topic route and peer-only route, verify priority ordering
    const table = RouteTable.build([
      {
        id: 'peer-only',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-100999'], mention_only: false },
        ]),
      },
      {
        id: 'topic-specific',
        config: makeAgent([
          { channel: 'telegram', scope: 'group', peers: ['-100999'], topics: ['42'], mention_only: false },
        ]),
      },
    ]);

    // topic-specific should win for topic 42
    const entry = table.resolve('telegram', 'default', 'group', '-100999', '42');
    expect(entry).not.toBeNull();
    expect(entry!.agentId).toBe('topic-specific');
    // priority: topics(+8) + peers(+4) + group(+2) = 14 vs peers(+4) + group(+2) = 6
    expect(entry!.priority).toBe(14);
  });
});
