import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { ChannelAdapter, SendOptions } from '../../channels/types.js';
import type { PeerPauseStore } from '../../routing/peer-pause.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';
import { logger } from '../../logger.js';

export interface SendMessageToolOptions {
  /** Owning agent id; used to scope the human_takeover pause check. */
  agentId?: string;
  /**
   * Optional pause store. If supplied and the target peer is currently
   * paused (and not expired), the tool short-circuits and returns a
   * `suppressed: true` payload without calling the channel adapter.
   */
  peerPauseStore?: PeerPauseStore | null;
}

export function createSendMessageTool(
  getChannel: (id: string) => ChannelAdapter | undefined,
  opts: SendMessageToolOptions = {},
): ToolDefinition {
  const sdkTool = tool(
    'send_message',
    'Send a text message to a peer via a channel (telegram or whatsapp).',
    {
      channel: z.enum(['telegram', 'whatsapp']).describe('Channel to send through'),
      peer_id: z.string().describe('Recipient peer ID'),
      text: z.string().describe('Message text to send'),
      account_id: z.string().optional().describe('Optional account ID for multi-account setups'),
    },
    async (args: Record<string, unknown>) => {
      const channel = args.channel as 'telegram' | 'whatsapp';
      const peerId = args.peer_id as string;
      const text = args.text as string;
      const accountId = args.account_id as string | undefined;

      // ─── human_takeover pause check ────────────────────────────────
      // If the operator is currently driving this peer, suppress the send
      // entirely. Mid-generation suppression covers the case where the
      // pause started after the agent decided to reply but before the tool
      // call landed.
      if (opts.agentId && opts.peerPauseStore) {
        const peerKey = `${channel}:${accountId ?? 'default'}:${peerId}`;
        const status = opts.peerPauseStore.isPaused(opts.agentId, peerKey);
        if (status.paused && !status.expired) {
          logger.info(
            {
              agentId: opts.agentId,
              peerKey,
              expiresAt: status.entry?.expiresAt,
            },
            'send_message: suppressed; peer is paused',
          );
          // TODO Stage 2: notificationsEmitter.emit('peer_pause_intervened_during_generation', ...)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  suppressed: true,
                  reason: 'paused',
                  expires_at: status.entry?.expiresAt ?? null,
                }),
              },
            ],
          };
        }
      }

      const adapter = getChannel(channel);
      if (!adapter) {
        return {
          content: [
            { type: 'text', text: `Channel not found: ${channel}` },
          ],
          isError: true,
        };
      }

      try {
        const sendOpts: SendOptions = {};
        if (accountId) sendOpts.accountId = accountId;

        const messageId = await adapter.sendText(peerId, text, sendOpts);
        return {
          content: [
            { type: 'text', text: `Message sent. ID: ${messageId}` },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text',
              text: `Send failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  return sdkTool as unknown as ToolDefinition;
}

export const META: ToolMeta = {
  category: 'messaging',
  safe_in_public: true, safe_in_trusted: true, safe_in_private: true,
  destructive: false, reads_only: false, hard_blacklist_in: [],
};
