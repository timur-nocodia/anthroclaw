import { resolve } from 'node:path';
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type {
  ChannelAdapter,
  OutboundMedia,
  SendOptions,
} from '../../channels/types.js';
import type { ToolDefinition } from './types.js';

export function createSendMediaTool(
  workspacePath: string,
  getChannel: (id: string) => ChannelAdapter | undefined,
): ToolDefinition {
  const sdkTool = tool(
    'send_media',
    'Send a media file to a peer via a channel (telegram or whatsapp). File path is resolved relative to the workspace.',
    {
      channel: z.enum(['telegram', 'whatsapp']).describe('Channel to send through'),
      peer_id: z.string().describe('Recipient peer ID'),
      file_path: z.string().describe('Path to the media file (relative to workspace)'),
      type: z.enum(['image', 'video', 'audio', 'voice', 'document']).describe('Media type'),
      caption: z.string().optional().describe('Optional caption'),
      account_id: z.string().optional().describe('Optional account ID for multi-account setups'),
    },
    async (args: Record<string, unknown>) => {
      const channel = args.channel as 'telegram' | 'whatsapp';
      const peerId = args.peer_id as string;
      const filePath = args.file_path as string;
      const mediaType = args.type as OutboundMedia['type'];
      const caption = args.caption as string | undefined;
      const accountId = args.account_id as string | undefined;

      // Resolve path and block traversal
      const resolvedPath = resolve(workspacePath, filePath);
      if (!resolvedPath.startsWith(resolve(workspacePath))) {
        return {
          content: [
            {
              type: 'text',
              text: 'Path traversal blocked: file must be within workspace.',
            },
          ],
          isError: true,
        };
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
        const media: OutboundMedia = {
          type: mediaType,
          path: resolvedPath,
          mimeType: guessMimeType(mediaType),
        };
        if (caption) media.caption = caption;

        const opts: SendOptions = {};
        if (accountId) opts.accountId = accountId;

        const messageId = await adapter.sendMedia(peerId, media, opts);
        return {
          content: [
            { type: 'text', text: `Media sent. ID: ${messageId}` },
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

function guessMimeType(
  type: 'image' | 'video' | 'audio' | 'voice' | 'document',
): string {
  switch (type) {
    case 'image':
      return 'image/jpeg';
    case 'video':
      return 'video/mp4';
    case 'audio':
    case 'voice':
      return 'audio/mpeg';
    case 'document':
      return 'application/octet-stream';
  }
}

import type { ToolMeta } from '../../security/types.js';
export const META: ToolMeta = {
  category: 'messaging',
  safe_in_public: false, safe_in_trusted: true, safe_in_private: true,
  destructive: true, reads_only: false, hard_blacklist_in: [],
};
