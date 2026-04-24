import { describe, expect, it } from 'vitest';
import { AgentYmlSchema } from '../../src/config/schema.js';
import {
  formatChannelOperatorContext,
  resolveChannelContext,
  resolveReplyToId,
} from '../../src/channels/context.js';

describe('channel context resolver', () => {
  it('uses telegram topic behavior before peer and wildcard behavior', () => {
    const config = AgentYmlSchema.parse({
      routes: [{ channel: 'telegram' }],
      channel_context: {
        reply_to_mode: 'incoming_reply_only',
        telegram: {
          wildcard: { prompt: 'default telegram behavior' },
          peers: {
            'chat-1': { prompt: 'peer behavior' },
          },
          topics: {
            'topic-9': { prompt: 'topic behavior', reply_to_mode: 'never' },
          },
        },
      },
    }).channel_context;

    const resolved = resolveChannelContext(config, {
      channel: 'telegram',
      chatType: 'group',
      peerId: 'chat-1',
      threadId: 'topic-9',
    });

    expect(resolved).toMatchObject({
      prompt: 'topic behavior',
      replyToMode: 'never',
      source: 'telegram_topic',
    });
  });

  it('uses whatsapp group behavior and falls back to global reply mode', () => {
    const config = AgentYmlSchema.parse({
      routes: [{ channel: 'whatsapp' }],
      channel_context: {
        reply_to_mode: 'incoming_reply_only',
        whatsapp: {
          groups: {
            'group@g.us': { prompt: 'group behavior' },
          },
        },
      },
    }).channel_context;

    const resolved = resolveChannelContext(config, {
      channel: 'whatsapp',
      chatType: 'group',
      peerId: 'group@g.us',
    });

    expect(resolved).toMatchObject({
      prompt: 'group behavior',
      replyToMode: 'incoming_reply_only',
      source: 'whatsapp_group',
    });
  });

  it('formats operator snippets as fenced additive context', () => {
    const formatted = formatChannelOperatorContext({
      prompt: 'Use short replies. ``` do not break fence.',
      replyToMode: 'always',
      source: 'telegram_peer',
    });

    expect(formatted).toContain('<channel-operator-context>');
    expect(formatted).toContain('additive to CLAUDE.md');
    expect(formatted).toContain("''' do not break fence.");
    expect(formatted).not.toContain('``` do not break fence.');
  });

  it('resolves reply targets without changing the default behavior', () => {
    const msg = { messageId: 'incoming-1', replyToId: 'parent-1' };

    expect(resolveReplyToId(msg, 'always')).toBe('incoming-1');
    expect(resolveReplyToId(msg, 'incoming_reply_only')).toBe('incoming-1');
    expect(resolveReplyToId({ messageId: 'incoming-2' }, 'incoming_reply_only')).toBeUndefined();
    expect(resolveReplyToId(msg, 'never')).toBeUndefined();
  });
});
