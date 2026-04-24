import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  type WASocket,
  type BaileysEventMap,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import { createRequire } from 'node:module';
import pino from 'pino';

const require = createRequire(import.meta.url);
const qrTerminal = require('qrcode-terminal') as { generate: (text: string, opts: { small: boolean }) => void };
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  ChannelAdapter,
  InboundMessage,
  InboundMedia,
  OutboundMedia,
  SendOptions,
} from './types.js';
import { logger } from '../logger.js';
import { chunkText, mimeToExtension } from './utils.js';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

export interface WhatsAppConfig {
  accounts: Record<string, { auth_dir: string }>;
  mediaDir: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers (exported for testing)                                     */
/* ------------------------------------------------------------------ */

/**
 * Ensure a JID has the WhatsApp suffix.
 * If the string already contains `@`, return as-is.
 * Otherwise append `@s.whatsapp.net`.
 */
export function toWhatsAppJid(id: string): string {
  if (id.includes('@')) return id;
  return `${id}@s.whatsapp.net`;
}

/* ------------------------------------------------------------------ */
/*  WhatsAppChannel                                                    */
/* ------------------------------------------------------------------ */

const baileysLogger = pino({ level: 'silent' });

export class WhatsAppChannel implements ChannelAdapter {
  readonly id = 'whatsapp' as const;

  private config: WhatsAppConfig;
  private sockets = new Map<string, WASocket>();
  private handler: ((msg: InboundMessage) => Promise<void>) | undefined;
  private accountPhones = new Map<string, string>();
  private accountStatuses = new Map<string, string>();

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  /* ---------- ChannelAdapter interface ---------- */

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    fs.mkdirSync(this.config.mediaDir, { recursive: true });

    const { version } = await fetchLatestWaWebVersion();

    const entries = Object.entries(this.config.accounts);
    await Promise.all(entries.map(([accountId, acct]) => this.connectAccount(accountId, acct.auth_dir, version)));
  }

  async stop(): Promise<void> {
    for (const [accountId, sock] of this.sockets) {
      logger.info({ accountId }, 'whatsapp: closing socket');
      sock.end(undefined);
    }
    this.sockets.clear();
  }

  async sendText(
    peerId: string,
    text: string,
    opts?: SendOptions,
  ): Promise<string> {
    const jid = toWhatsAppJid(peerId);
    const sock = this.pickSocket(opts?.accountId);
    let lastId = '';

    await sock.sendPresenceUpdate('composing', jid);

    const chunks = chunkText(text);
    for (const chunk of chunks) {
      const sent = await sock.sendMessage(
        jid,
        { text: chunk },
        opts?.replyToId ? { quoted: { key: { id: opts.replyToId, remoteJid: jid } } as any } : undefined,
      );
      lastId = sent?.key?.id ?? '';
    }

    return lastId;
  }

  async sendMedia(
    peerId: string,
    media: OutboundMedia,
    opts?: SendOptions,
  ): Promise<string> {
    const jid = toWhatsAppJid(peerId);
    const sock = this.pickSocket(opts?.accountId);

    const buffer = media.buffer ?? fs.readFileSync(media.path!);

    let content: Record<string, unknown>;

    switch (media.type) {
      case 'image':
        content = { image: buffer, caption: media.caption, mimetype: media.mimeType };
        break;
      case 'video':
        content = { video: buffer, caption: media.caption, mimetype: media.mimeType };
        break;
      case 'audio':
      case 'voice':
        content = { audio: buffer, mimetype: media.mimeType, ptt: true };
        break;
      case 'document':
        content = {
          document: buffer,
          mimetype: media.mimeType,
          fileName: media.fileName ?? 'file',
          caption: media.caption,
        };
        break;
      default:
        throw new Error(`Unsupported media type: ${media.type}`);
    }

    const sent = await sock.sendMessage(
      jid,
      content as any,
      opts?.replyToId ? { quoted: { key: { id: opts.replyToId, remoteJid: jid } } as any } : undefined,
    );

    return sent?.key?.id ?? '';
  }

  async editText(_peerId: string, _messageId: string, _text: string, _opts?: SendOptions): Promise<void> {
    // WhatsApp doesn't support editing messages easily — no-op
    logger.debug('whatsapp: editText is a no-op (not supported)');
  }

  async sendTyping(peerId: string, accountId?: string): Promise<void> {
    const jid = toWhatsAppJid(peerId);
    const sock = this.pickSocket(accountId);
    await sock.sendPresenceUpdate('composing', jid);
  }

  /* ---------- Account info (for web UI) ---------- */

  getAccountInfo(): { accountId: string; phone: string; status: string }[] {
    return Object.keys(this.config.accounts).map((accountId) => ({
      accountId,
      phone: this.accountPhones.get(accountId) ?? '',
      status: this.accountStatuses.get(accountId) ?? 'disconnected',
    }));
  }

  /* ---------- Internal ---------- */

  private pickSocket(accountId?: string): WASocket {
    if (accountId && this.sockets.has(accountId)) {
      return this.sockets.get(accountId)!;
    }
    // Return first available socket
    const first = this.sockets.values().next();
    if (first.done) throw new Error('No WhatsApp sockets connected');
    return first.value;
  }

  private async connectAccount(
    accountId: string,
    authDir: string,
    version: [number, number, number],
  ): Promise<void> {
    fs.mkdirSync(authDir, { recursive: true });

    // Restore from backup if creds.json is corrupted/truncated
    const credsPath = path.join(authDir, 'creds.json');
    const credsBackupPath = path.join(authDir, 'creds.json.bak');
    if (fs.existsSync(credsPath)) {
      try {
        const raw = fs.readFileSync(credsPath, 'utf-8');
        if (raw.length <= 1) throw new Error('empty');
        JSON.parse(raw);
      } catch {
        if (fs.existsSync(credsBackupPath)) {
          logger.warn({ accountId }, 'whatsapp: creds.json corrupted, restoring from backup');
          fs.copyFileSync(credsBackupPath, credsPath);
        }
      }
    }

    const { state, saveCreds: rawSaveCreds } = await useMultiFileAuthState(authDir);

    const saveCreds = async () => {
      // Backup current creds before overwriting
      if (fs.existsSync(credsPath)) {
        try {
          const raw = fs.readFileSync(credsPath, 'utf-8');
          JSON.parse(raw);
          fs.copyFileSync(credsPath, credsBackupPath);
        } catch {
          // don't overwrite backup with bad data
        }
      }
      await rawSaveCreds();
    };

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      printQRInTerminal: false,
      browser: ['openclaw-replica', 'cli', '0.1.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
    });

    this.sockets.set(accountId, sock);

    /* --- Connection lifecycle --- */
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        logger.info({ accountId }, 'whatsapp: QR code generated — scan in WhatsApp > Linked Devices');
        qrTerminal.generate(qr, { small: true });
      }

      if (connection === 'open') {
        this.accountStatuses.set(accountId, 'connected');
        // Cache phone number from socket user info
        const phone = sock.user?.id?.split(':')[0] ?? sock.user?.id ?? '';
        if (phone) this.accountPhones.set(accountId, phone);
        logger.info({ accountId }, 'whatsapp: connected');
      }

      if (connection === 'close') {
        this.accountStatuses.set(accountId, 'disconnected');
        const statusCode =
          (lastDisconnect?.error as any)?.output?.statusCode as number | undefined;
        const loggedOut = statusCode === DisconnectReason.loggedOut;

        if (loggedOut) {
          logger.warn({ accountId }, 'whatsapp: logged out — will not reconnect');
          this.sockets.delete(accountId);
          return;
        }

        logger.info({ accountId, statusCode }, 'whatsapp: reconnecting…');
        // Reconnect
        void this.connectAccount(accountId, authDir, version);
      }
    });

    // Catch WebSocket errors to prevent unhandled exceptions from killing the process
    if (sock.ws && typeof (sock.ws as unknown as { on?: unknown }).on === 'function') {
      (sock.ws as any).on('error', (err: Error) => {
        logger.error({ err, accountId }, 'whatsapp: WebSocket error');
      });
    }

    /* --- Credentials persistence --- */
    sock.ev.on('creds.update', saveCreds);

    /* --- Message handling --- */
    sock.ev.on('messages.upsert', async (upsert: BaileysEventMap['messages.upsert']) => {
      if (upsert.type !== 'notify') return;

      for (const msg of upsert.messages) {
        try {
          if (msg.key.fromMe) continue;
          if (!msg.message) continue;

          const jid = msg.key.remoteJid ?? '';
          const isGroup = jid.endsWith('@g.us');
          const senderId = isGroup
            ? msg.key.participant ?? ''
            : jid;

          // Extract text
          const msgContent = msg.message;
          const text =
            msgContent.conversation ??
            msgContent.extendedTextMessage?.text ??
            msgContent.imageMessage?.caption ??
            msgContent.videoMessage?.caption ??
            msgContent.documentMessage?.caption ??
            '';

          // Mention detection
          const mentionedJids =
            msgContent.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
          const mentionedBot = mentionedJids.length > 0;

          // Reply context
          const quotedMsg = msgContent.extendedTextMessage?.contextInfo?.quotedMessage;
          const replyToId = msgContent.extendedTextMessage?.contextInfo?.stanzaId ?? undefined;
          const replyToText =
            quotedMsg?.conversation ??
            quotedMsg?.extendedTextMessage?.text ??
            undefined;

          // Media handling
          let media: InboundMedia | undefined;
          const mediaType = this.detectMediaType(msgContent);
          if (mediaType) {
            try {
              const downloaded = await downloadMediaMessage(msg, 'buffer', {});
              const ext = mimeToExtension(mediaType.mimeType) || '.bin';
              const fileName = `${randomUUID()}${ext}`;
              const filePath = path.join(this.config.mediaDir, fileName);
              fs.writeFileSync(filePath, downloaded as Buffer);

              media = {
                type: mediaType.type,
                path: filePath,
                mimeType: mediaType.mimeType,
                fileName: mediaType.fileName,
              };
            } catch (err) {
              logger.warn({ err, accountId, messageId: msg.key.id }, 'whatsapp: failed to download media');
            }
          }

          const pushName = msg.pushName ?? undefined;

          const inbound: InboundMessage = {
            channel: 'whatsapp',
            accountId,
            chatType: isGroup ? 'group' : 'dm',
            peerId: jid,
            senderId,
            senderName: pushName,
            text,
            messageId: msg.key.id ?? '',
            replyToId,
            replyToText,
            mentionedBot,
            media,
            raw: msg,
          };

          if (this.handler) {
            await this.handler(inbound);
          }
        } catch (err) {
          logger.error({ err, accountId }, 'whatsapp: error processing message');
        }
      }
    });
  }

  private detectMediaType(
    msgContent: Record<string, any>,
  ): { type: InboundMedia['type']; mimeType: string; fileName?: string } | null {
    if (msgContent.imageMessage) {
      return { type: 'image', mimeType: msgContent.imageMessage.mimetype ?? 'image/jpeg' };
    }
    if (msgContent.videoMessage) {
      return { type: 'video', mimeType: msgContent.videoMessage.mimetype ?? 'video/mp4' };
    }
    if (msgContent.audioMessage) {
      const isVoice = msgContent.audioMessage.ptt === true;
      return {
        type: isVoice ? 'voice' : 'audio',
        mimeType: msgContent.audioMessage.mimetype ?? 'audio/ogg',
      };
    }
    if (msgContent.documentMessage) {
      return {
        type: 'document',
        mimeType: msgContent.documentMessage.mimetype ?? 'application/octet-stream',
        fileName: msgContent.documentMessage.fileName,
      };
    }
    if (msgContent.stickerMessage) {
      return { type: 'sticker', mimeType: msgContent.stickerMessage.mimetype ?? 'image/webp' };
    }
    return null;
  }

}
