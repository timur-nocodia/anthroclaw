import type { ChannelContextConfig, ReplyToMode } from '../config/schema.js';
import type { InboundMessage } from './types.js';

interface ChannelBehaviorRule {
  prompt?: string;
  reply_to_mode?: ReplyToMode;
}

export interface ResolvedChannelContext {
  prompt?: string;
  replyToMode: ReplyToMode;
  source: 'telegram_topic' | 'telegram_peer' | 'telegram_wildcard' | 'whatsapp_direct' | 'whatsapp_group' | 'whatsapp_wildcard' | 'none';
}

export function resolveChannelContext(
  config: ChannelContextConfig | undefined,
  msg: Pick<InboundMessage, 'channel' | 'chatType' | 'peerId' | 'threadId'>,
): ResolvedChannelContext {
  const fallbackMode = config?.reply_to_mode ?? 'always';
  if (!config) {
    return { replyToMode: fallbackMode, source: 'none' };
  }

  if (msg.channel === 'telegram') {
    const channelConfig = config.telegram;
    if (!channelConfig) return { replyToMode: fallbackMode, source: 'none' };

    const topicRule = msg.threadId ? channelConfig.topics?.[msg.threadId] : undefined;
    if (topicRule) return toResolved(topicRule, fallbackMode, 'telegram_topic');

    const peerRule = channelConfig.peers?.[msg.peerId];
    if (peerRule) return toResolved(peerRule, fallbackMode, 'telegram_peer');

    if (channelConfig.wildcard) return toResolved(channelConfig.wildcard, fallbackMode, 'telegram_wildcard');
  }

  if (msg.channel === 'whatsapp') {
    const channelConfig = config.whatsapp;
    if (!channelConfig) return { replyToMode: fallbackMode, source: 'none' };

    const peerRule = msg.chatType === 'group'
      ? channelConfig.groups?.[msg.peerId]
      : channelConfig.direct?.[msg.peerId];
    if (peerRule) {
      return toResolved(peerRule, fallbackMode, msg.chatType === 'group' ? 'whatsapp_group' : 'whatsapp_direct');
    }

    if (channelConfig.wildcard) return toResolved(channelConfig.wildcard, fallbackMode, 'whatsapp_wildcard');
  }

  return { replyToMode: fallbackMode, source: 'none' };
}

export function formatChannelOperatorContext(resolved: ResolvedChannelContext): string {
  const prompt = resolved.prompt?.trim();
  if (!prompt) return '';

  return [
    '<channel-operator-context>',
    `[Operator-configured context for ${resolved.source}; additive to CLAUDE.md, not a replacement.]`,
    '```text',
    sanitizeFenceContent(prompt),
    '```',
    '</channel-operator-context>',
  ].join('\n');
}

export function resolveReplyToId(
  msg: Pick<InboundMessage, 'messageId' | 'replyToId'>,
  mode: ReplyToMode,
): string | undefined {
  if (mode === 'never') return undefined;
  if (mode === 'incoming_reply_only' && !msg.replyToId) return undefined;
  return msg.messageId;
}

function toResolved(
  rule: ChannelBehaviorRule,
  fallbackMode: ReplyToMode,
  source: ResolvedChannelContext['source'],
): ResolvedChannelContext {
  return {
    prompt: rule.prompt,
    replyToMode: rule.reply_to_mode ?? fallbackMode,
    source,
  };
}

function sanitizeFenceContent(value: string): string {
  return value.replace(/```/g, "'''");
}
