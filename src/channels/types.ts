export interface ApprovalRequest {
  id: string;                  // ApprovalBroker id
  toolName: string;
  argsPreview: string;          // human-readable summary
  argsFull?: string;             // full JSON
  peerId: string;
  accountId?: string;
  threadId?: string;
}

export interface InboundMessage {
  channel: 'telegram' | 'whatsapp';
  accountId: string;
  chatType: 'dm' | 'group';
  peerId: string;
  senderId: string;
  senderName?: string;
  text: string;
  messageId: string;
  replyToId?: string;
  replyToText?: string;
  threadId?: string;
  mentionedBot: boolean;
  media?: InboundMedia;
  raw: unknown;
  /** Populated by gateway media enrichment */
  transcript?: string;
  pdfText?: string;
}

export interface InboundMedia {
  type: 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';
  path: string;
  mimeType: string;
  fileName?: string;
}

export interface OutboundMedia {
  type: 'image' | 'video' | 'audio' | 'voice' | 'document';
  path?: string;
  buffer?: Buffer;
  mimeType: string;
  fileName?: string;
  caption?: string;
}

export interface SendOptions {
  accountId?: string;
  replyToId?: string;
  threadId?: string;
  buttons?: InlineButton[][];
  parseMode?: 'markdown' | 'html' | 'plain';
}

export interface InlineButton {
  text: string;
  callbackData?: string;
  url?: string;
}

export interface CallbackEvent {
  channel: 'telegram' | 'whatsapp';
  accountId: string;
  peerId: string;
  senderId: string;
  senderName?: string;
  threadId?: string;
  messageId?: string;
  data: string;
  callbackQueryId: string;
}

/**
 * Emitted by a channel adapter when the operator (the WhatsApp account
 * owner) sends a message to a peer outside the bot — Baileys delivers
 * these as `key.fromMe = true`. The gateway uses this signal to drive
 * the human_takeover subsystem (peer-pause).
 *
 * Reactions, receipts, protocol envelopes, and typing indicators are
 * filtered out by the adapter and never produce this event.
 */
export interface OperatorOutboundEvent {
  channel: 'telegram' | 'whatsapp';
  accountId: string;
  /** Stable peer key in `{channel}:{accountId}:{peerId}` form. */
  peerKey: string;
  /** Raw remoteJid / chat id without channel/account prefix. */
  peerId: string;
  textPreview: string;
  hasMedia: boolean;
  messageId: string;
  /** Adapter-supplied unix timestamp (seconds). */
  timestamp: number;
}

export type ChannelAdapterEvents = {
  operator_outbound: OperatorOutboundEvent;
};

export interface ChannelAdapter {
  readonly id: 'telegram' | 'whatsapp';
  start(): Promise<void>;
  stop(): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
  onCallbackQuery?(handler: (cb: CallbackEvent) => Promise<void>): void;
  answerCallbackQuery?(callbackQueryId: string, text?: string, accountId?: string): Promise<void>;
  sendText(peerId: string, text: string, opts?: SendOptions): Promise<string>;
  editText(peerId: string, messageId: string, text: string, opts?: SendOptions): Promise<void>;
  sendMedia(peerId: string, media: OutboundMedia, opts?: SendOptions): Promise<string>;
  sendTyping(peerId: string, accountId?: string, threadId?: string): Promise<void>;
  setReaction?(peerId: string, messageId: string, emoji: string, accountId?: string): Promise<void>;
  readonly supportsApproval: boolean;
  promptForApproval(req: ApprovalRequest): Promise<void>;
  /** Subscribe to adapter-level events such as `operator_outbound`. */
  on?<E extends keyof ChannelAdapterEvents>(
    event: E,
    handler: (payload: ChannelAdapterEvents[E]) => void,
  ): void;
  off?<E extends keyof ChannelAdapterEvents>(
    event: E,
    handler: (payload: ChannelAdapterEvents[E]) => void,
  ): void;
}
