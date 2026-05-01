/**
 * Classifier for WhatsApp `key.fromMe = true` messages.
 *
 * The gateway must distinguish "the operator typed something to a peer
 * outside the bot" (operator_outbound — triggers human_takeover) from
 * framework noise like reactions, receipts, typing indicators, and
 * protocol messages, all of which Baileys also delivers under the same
 * fromMe flag and should be silently ignored.
 *
 * This module is pure — it takes a Baileys message and returns a tagged
 * union. Callers (the WA adapter) are responsible for emitting events.
 */

export type FromMeClassification =
  | { kind: 'ignore'; reason: 'reaction' | 'protocol' | 'receipt' | 'typing' | 'empty' }
  | {
      kind: 'operator_outbound';
      textPreview: string;
      hasMedia: boolean;
      messageId: string;
      timestamp: number;
    };

interface BaileysFromMeMessage {
  key?: {
    fromMe?: boolean;
    id?: string | null;
    remoteJid?: string | null;
  };
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | { toNumber?: () => number } | null;
}

const MAX_TEXT_PREVIEW = 200;

const MEDIA_KEYS = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'documentWithCaptionMessage',
  'ptvMessage',
]);

function extractText(message: Record<string, unknown>): string {
  const direct = (message as { conversation?: unknown }).conversation;
  if (typeof direct === 'string' && direct) return direct;

  const ext = (message as { extendedTextMessage?: { text?: unknown } }).extendedTextMessage;
  if (ext && typeof ext.text === 'string' && ext.text) return ext.text;

  for (const key of [
    'imageMessage',
    'videoMessage',
    'documentMessage',
    'audioMessage',
  ] as const) {
    const m = (message as Record<string, { caption?: unknown } | undefined>)[key];
    if (m && typeof m === 'object' && typeof m.caption === 'string' && m.caption) {
      return m.caption;
    }
  }
  return '';
}

function hasMediaContent(message: Record<string, unknown>): boolean {
  for (const key of Object.keys(message)) {
    if (MEDIA_KEYS.has(key) && message[key]) return true;
  }
  return false;
}

function normalizeTimestamp(raw: BaileysFromMeMessage['messageTimestamp']): number {
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw === 'object' && typeof raw.toNumber === 'function') {
    try {
      return raw.toNumber();
    } catch {
      return 0;
    }
  }
  return 0;
}

export function classifyFromMe(msg: BaileysFromMeMessage): FromMeClassification {
  const message = msg.message;
  if (!message || typeof message !== 'object') {
    return { kind: 'ignore', reason: 'empty' };
  }

  if ('reactionMessage' in message && message.reactionMessage) {
    return { kind: 'ignore', reason: 'reaction' };
  }
  if ('protocolMessage' in message && message.protocolMessage) {
    return { kind: 'ignore', reason: 'protocol' };
  }
  if ('receiptMessage' in message && message.receiptMessage) {
    return { kind: 'ignore', reason: 'receipt' };
  }
  // Ephemeral typing indicator (Baileys variants)
  if ('senderKeyDistributionMessage' in message && Object.keys(message).length === 1) {
    return { kind: 'ignore', reason: 'protocol' };
  }
  // Pure read/typing state messages have no content surface
  const text = extractText(message);
  const media = hasMediaContent(message);
  if (!text && !media) {
    return { kind: 'ignore', reason: 'typing' };
  }

  const preview = text.slice(0, MAX_TEXT_PREVIEW);
  return {
    kind: 'operator_outbound',
    textPreview: preview,
    hasMedia: media,
    messageId: msg.key?.id ?? '',
    timestamp: normalizeTimestamp(msg.messageTimestamp),
  };
}
