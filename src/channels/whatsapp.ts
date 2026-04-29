import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  jidNormalizedUser,
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
  ApprovalRequest,
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

/**
 * Resolve `@lid` JIDs to their phone-number form before sending.
 *
 * Baileys 7.x has a known bug in `generateWAMessageFromContent` that throws
 * `Cannot read properties of undefined (reading 'undefined')` when sending
 * to bare `@lid` JIDs whose participant device list is in a partially
 * resolved state. The `LIDMappingStore` is populated during inbound
 * `messages.upsert` (the sender's PN ↔ LID mapping is recorded), so by the
 * time we reply we can substitute the standard `<phone>@s.whatsapp.net`
 * JID and avoid the bug entirely. Falls back to the original LID if no
 * mapping exists yet (rare; only a no-op resolution attempt).
 */
async function resolveSendableJid(sock: WASocket, jid: string): Promise<string> {
  if (!jid.endsWith('@lid')) return jid;
  try {
    const lidStore = (sock as any).signalRepository?.lidMapping;
    const pn: string | null | undefined = await lidStore?.getPNForLID?.(jid);
    if (pn && typeof pn === 'string') {
      // Strip device id (`<phone>:<n>@s.whatsapp.net` → `<phone>@s.whatsapp.net`).
      // Baileys' `generateWAMessageFromContent` chokes on device-tagged JIDs the
      // same way it does on bare `@lid` — we want the bare user JID for outbound.
      const normalized = jidNormalizedUser(pn);
      logger.debug({ lid: jid, pn, normalized }, 'whatsapp: resolved @lid → phone-number JID for outbound');
      return normalized;
    }
  } catch (err) {
    logger.debug({ err, jid }, 'whatsapp: PN resolution failed; sending to @lid as-is');
  }
  return jid;
}

/* ------------------------------------------------------------------ */
/*  WhatsAppChannel                                                    */
/* ------------------------------------------------------------------ */

const baileysLogger = pino({ level: 'silent' });

export class WhatsAppChannel implements ChannelAdapter {
  readonly id = 'whatsapp' as const;
  static readonly supportsApproval = false;
  readonly supportsApproval = false as const;

  private config: WhatsAppConfig;
  private sockets = new Map<string, WASocket>();
  private handler: ((msg: InboundMessage) => Promise<void>) | undefined;
  private accountPhones = new Map<string, string>();
  private accountStatuses = new Map<string, string>();
  // Accounts explicitly torn down via disconnectAccount(). The connection.update
  // 'close' handler checks this set to skip its automatic reconnect — without
  // it, sock.logout() would trigger a close event which would immediately try
  // to reconnect the socket we just removed.
  private disconnectedAccounts = new Set<string>();

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

  /**
   * Tear down a single account: best-effort WhatsApp-side logout, close socket,
   * wipe in-memory state, remove auth directory, drop from config.accounts.
   *
   * After this returns, getAccountInfo() no longer lists the account and a
   * future restart won't try to reconnect it. The caller is responsible for
   * removing the account from the persisted config.yml.
   */
  async disconnectAccount(accountId: string): Promise<void> {
    const acct = this.config.accounts[accountId];
    if (!acct) {
      throw new Error(`WhatsApp account "${accountId}" is not configured`);
    }

    this.disconnectedAccounts.add(accountId);

    const sock = this.sockets.get(accountId);
    if (sock) {
      logger.info({ accountId }, 'whatsapp: disconnecting account');
      // Best-effort logout (removes the device from WhatsApp's Linked Devices
      // list). Bounded by a 5s timeout — if the WA servers are unreachable we
      // still want to wipe local state.
      await Promise.race([
        Promise.resolve(sock.logout('User disconnected via UI')).catch((err) => {
          logger.warn({ err, accountId }, 'whatsapp: logout failed (non-fatal)');
        }),
        new Promise<void>((r) => setTimeout(r, 5000)),
      ]);
      try {
        sock.end(undefined);
      } catch (err) {
        logger.debug({ err, accountId }, 'whatsapp: sock.end after logout failed (non-fatal)');
      }
    }

    this.sockets.delete(accountId);
    this.accountPhones.delete(accountId);
    this.accountStatuses.delete(accountId);
    delete this.config.accounts[accountId];

    if (acct.auth_dir && fs.existsSync(acct.auth_dir)) {
      fs.rmSync(acct.auth_dir, { recursive: true, force: true });
      logger.info({ accountId, authDir: acct.auth_dir }, 'whatsapp: auth directory removed');
    }
  }

  async sendText(
    peerId: string,
    text: string,
    opts?: SendOptions,
  ): Promise<string> {
    const sock = this.pickSocket(opts?.accountId);
    const jid = await resolveSendableJid(sock, toWhatsAppJid(peerId));
    let lastId = '';

    // Best-effort typing indicator — Baileys 7.x can throw on @lid JIDs with
    // "Cannot read properties of undefined (reading 'undefined')" depending on
    // the participant device list state. Failing here would block the actual
    // message send, so swallow.
    await sock.sendPresenceUpdate('composing', jid).catch((err) => {
      logger.debug({ err, jid }, 'whatsapp: composing presence update failed (non-fatal)');
    });

    const chunks = chunkText(text);
    for (const chunk of chunks) {
      try {
        // NOTE: replyToId is intentionally ignored. Baileys' quoted-message
        // rendering requires `quoted.message` (the original message body), and
        // synthesizing one from just the message id breaks `generateWAMessageFromContent`
        // with `Cannot read properties of undefined (reading 'undefined')`. WhatsApp
        // bots also don't typically use reply-quotes — the next message lands
        // adjacent to the user's question anyway, so quoting only adds clutter.
        const sent = await sock.sendMessage(jid, { text: chunk });
        lastId = sent?.key?.id ?? '';
      } catch (err) {
        // Baileys 7.x throws "Cannot read properties of undefined (reading
        // 'undefined')" on @lid JIDs whose participant device list is in a
        // bad state — same root cause as the typing-presence catch above,
        // but on the actual message send. Without this guard the error
        // bubbles up as an unhandledRejection and silently breaks the user
        // conversation with no log of what happened.
        logger.warn(
          { err, jid, accountId: opts?.accountId, chunkIndex: chunks.indexOf(chunk) },
          'whatsapp: sendMessage failed (likely @lid device-list issue); skipping chunk',
        );
        // Re-throw on non-@lid JIDs so genuine failures still surface.
        if (!jid.endsWith('@lid')) throw err;
      }
    }

    return lastId;
  }

  async sendMedia(
    peerId: string,
    media: OutboundMedia,
    opts?: SendOptions,
  ): Promise<string> {
    const sock = this.pickSocket(opts?.accountId);
    const jid = await resolveSendableJid(sock, toWhatsAppJid(peerId));

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

    // See sendText for why replyToId is ignored.
    const sent = await sock.sendMessage(jid, content as any);

    return sent?.key?.id ?? '';
  }

  async editText(_peerId: string, _messageId: string, _text: string, _opts?: SendOptions): Promise<void> {
    // WhatsApp doesn't support editing messages easily — no-op
    logger.debug('whatsapp: editText is a no-op (not supported)');
  }

  async sendTyping(peerId: string, accountId?: string, _threadId?: string): Promise<void> {
    const sock = this.pickSocket(accountId);
    const jid = await resolveSendableJid(sock, toWhatsAppJid(peerId));
    await sock.sendPresenceUpdate('composing', jid).catch((err) => {
      logger.debug({ err, jid }, 'whatsapp: typing indicator failed (non-fatal)');
    });
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
    // Re-pairing the same accountId after a disconnect should be allowed.
    this.disconnectedAccounts.delete(accountId);

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
      browser: ['openclaw-replica', 'web-ui', '0.1.0'],
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

        // Account was explicitly torn down via disconnectAccount() — don't
        // reconnect, regardless of whether the close came from logout() or
        // from sock.end(). disconnectAccount() handles its own cleanup.
        if (this.disconnectedAccounts.has(accountId)) {
          this.sockets.delete(accountId);
          return;
        }

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

          // Diagnostic: dump the full message key for @lid contacts so we can
          // see if Baileys exposes a phone JID alternative (senderPn, etc.)
          // that would let us route around the device-list-resolution bug
          // that breaks sendMessage on bare @lid JIDs.
          if (jid.endsWith('@lid') || msg.key.participant?.endsWith('@lid')) {
            logger.debug({ accountId, key: msg.key }, 'whatsapp: received message from @lid contact');
          }

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

  async promptForApproval(_req: ApprovalRequest): Promise<void> {
    throw new Error('WhatsApp channel does not support interactive approval');
  }

}

/** Alias for consistency with camelCase naming conventions. */
export const WhatsappChannel = WhatsAppChannel;
