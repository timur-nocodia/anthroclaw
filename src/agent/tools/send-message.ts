import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { ChannelAdapter, SendOptions } from '../../channels/types.js';
import type { ToolDefinition } from './types.js';
import type { ToolMeta } from '../../security/types.js';

export function createSendMessageTool(
  getChannel: (id: string) => ChannelAdapter | undefined,
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
        const opts: SendOptions = {};
        if (accountId) opts.accountId = accountId;

        const messageId = await adapter.sendText(peerId, text, opts);
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
