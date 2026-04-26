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
}
