import { Bot, InputFile, type Context } from 'grammy';
import { sequentialize } from '@grammyjs/runner';
import { apiThrottler } from '@grammyjs/transformer-throttler';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { logger } from '../logger.js';
import type {
  ChannelAdapter,
  InboundMessage,
  InboundMedia,
  OutboundMedia,
  SendOptions,
  InlineButton,
  ApprovalRequest,
} from './types.js';
import { chunkText, mimeToExtension } from './utils.js';

/* ------------------------------------------------------------------ */
/*  Config                                                            */
/* ------------------------------------------------------------------ */

export interface TelegramConfig {
  accounts: Record<string, { token: string; webhook?: { url: string; secret?: string } }>;
  mediaDir: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function buildInlineKeyboard(buttons: InlineButton[][]): {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
} {
  return {
    inline_keyboard: buttons.map((row) =>
      row.map((btn) => {
        const entry: { text: string; callback_data?: string; url?: string } = { text: btn.text };
        if (btn.callbackData) entry.callback_data = btn.callbackData;
        if (btn.url) entry.url = btn.url;
        return entry;
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/*  TelegramChannel                                                   */
/* ------------------------------------------------------------------ */

export class TelegramChannel implements ChannelAdapter {
  readonly id = 'telegram' as const;
  static readonly supportsApproval = true;
  readonly supportsApproval = true as const;

  private bots = new Map<string, Bot>();
  private handler: ((msg: InboundMessage) => Promise<void>) | null = null;
  private callbackHandler: ((cb: import('./types.js').CallbackEvent) => Promise<void>) | null = null;
  private config: TelegramConfig;
  private log = logger.child({ channel: 'telegram' });
  private botUsernames = new Map<string, string>();
  private botStatuses = new Map<string, string>();

  constructor(config: TelegramConfig) {
    this.config = config;

    // Ensure media directory exists
    fs.mkdirSync(config.mediaDir, { recursive: true });

    // Create one grammy Bot per account
    for (const [accountId, acct] of Object.entries(config.accounts)) {
      const bot = new Bot(acct.token);

      // Sequentialize updates per chat to prevent race conditions
      bot.use(
        sequentialize((ctx: Context) => {
          const chatId = ctx.chat?.id;
          return chatId ? String(chatId) : undefined;
        }),
      );

      // Install API throttler
      bot.api.config.use(apiThrottler());

      // Register message handler
      bot.on('message', async (ctx) => {
        if (!this.handler) return;
        try {
          const msg = await this.normalizeMessage(ctx, accountId);
          if (msg) await this.handler(msg);
        } catch (err) {
          this.log.error({ err, accountId }, 'Error handling Telegram message');
        }
      });

      // Register callback_query handler (inline button clicks)
      bot.on('callback_query:data', async (ctx) => {
        if (!this.callbackHandler) {
          await ctx.answerCallbackQuery().catch(() => {});
          return;
        }
        try {
          const cq = ctx.callbackQuery;
          const chat = cq.message?.chat;
          if (!chat) {
            await ctx.answerCallbackQuery({ text: 'Чат не найден' }).catch(() => {});
            return;
          }
          await this.callbackHandler({
            channel: 'telegram',
            accountId,
            peerId: String(chat.id),
            senderId: String(cq.from.id),
            senderName: cq.from.first_name ?? cq.from.username,
            threadId: cq.message?.message_thread_id !== undefined ? String(cq.message.message_thread_id) : undefined,
            messageId: cq.message?.message_id !== undefined ? String(cq.message.message_id) : undefined,
            data: cq.data,
            callbackQueryId: cq.id,
          });
        } catch (err) {
          this.log.error({ err, accountId }, 'Error handling Telegram callback_query');
          await ctx.answerCallbackQuery({ text: 'Ошибка обработки' }).catch(() => {});
        }
      });

      bot.catch((err) => {
        this.log.error({ err: err.error, accountId }, 'grammy bot error');
      });

      this.bots.set(accountId, bot);
    }
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  onCallbackQuery(handler: (cb: import('./types.js').CallbackEvent) => Promise<void>): void {
    this.callbackHandler = handler;
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, accountId?: string): Promise<void> {
    const bot = this.resolveBot(accountId);
    await bot.api.answerCallbackQuery(callbackQueryId, text ? { text } : undefined);
  }

  async start(): Promise<void> {
    for (const [accountId, bot] of this.bots) {
      const acct = this.config.accounts[accountId];

      // Cache bot username
      try {
        const me = await bot.api.getMe();
        this.botUsernames.set(accountId, me.username ?? '');
        this.botStatuses.set(accountId, 'connected');
      } catch {
        this.botStatuses.set(accountId, 'error');
      }

      await bot.api.setMyCommands([
        { command: 'start', description: 'Начать разговор' },
        { command: 'newsession', description: 'Новая сессия (сбросить контекст)' },
        { command: 'compact', description: 'Сжать контекст (саммари + продолжить)' },
        { command: 'model', description: 'Выбрать модель для текущей сессии' },
        { command: 'skills', description: 'Список доступных скиллов' },
        { command: 'pending', description: 'Показать pending запросы доступа' },
        { command: 'whoami', description: 'Показать мой ID и статус' },
      ]).catch(() => {});

      if (acct?.webhook?.url) {
        // Webhook mode — set webhook and don't start polling
        await bot.api.setWebhook(acct.webhook.url, {
          secret_token: acct.webhook.secret,
        });
        this.log.info({ accountId, url: acct.webhook.url }, 'Telegram webhook set');
      } else {
        // Long-polling mode
        bot.start({
          drop_pending_updates: true,
          onStart: (info) => {
            this.botUsernames.set(accountId, info.username);
            this.botStatuses.set(accountId, 'connected');
            this.log.info({ accountId, username: info.username }, 'Telegram bot started polling');
          },
        });
      }
    }
  }

  async stop(): Promise<void> {
    for (const [accountId, bot] of this.bots) {
      try {
        await bot.stop();
        this.log.info({ accountId }, 'Telegram bot stopped');
      } catch {
        // Bot may not be running
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  sendText                                                        */
  /* ---------------------------------------------------------------- */

  async sendText(peerId: string, text: string, opts?: SendOptions): Promise<string> {
    const bot = this.resolveBot(opts?.accountId);
    const chatId = peerId;
    const chunks = chunkText(text, 4000);
    let lastMessageId = '';

    for (const chunk of chunks) {
      const extra: Record<string, unknown> = {};

      if (opts?.replyToId) extra.reply_to_message_id = Number(opts.replyToId);
      if (opts?.threadId) extra.message_thread_id = Number(opts.threadId);
      if (opts?.buttons) extra.reply_markup = buildInlineKeyboard(opts.buttons);

      try {
        const sent = await bot.api.sendMessage(chatId, chunk, {
          parse_mode: 'Markdown',
          ...extra,
        });
        lastMessageId = String(sent.message_id);
      } catch {
        // Fallback to plain text (no parse_mode)
        const sent = await bot.api.sendMessage(chatId, chunk, extra);
        lastMessageId = String(sent.message_id);
      }
    }

    return lastMessageId;
  }

  /* ---------------------------------------------------------------- */
  /*  editText                                                        */
  /* ---------------------------------------------------------------- */

  async editText(peerId: string, messageId: string, text: string, opts?: SendOptions): Promise<void> {
    const bot = this.resolveBot(opts?.accountId);
    const chatId = peerId;

    try {
      await bot.api.editMessageText(chatId, Number(messageId), text, {
        parse_mode: 'Markdown',
      });
    } catch (err: unknown) {
      // Telegram throws when the text hasn't changed — silently ignore
      if (err instanceof Error && err.message.includes('message is not modified')) {
        return;
      }
      // Fallback: retry without parse_mode
      try {
        await bot.api.editMessageText(chatId, Number(messageId), text);
      } catch (retryErr: unknown) {
        if (retryErr instanceof Error && retryErr.message.includes('message is not modified')) {
          return;
        }
        this.log.warn({ err: retryErr, chatId, messageId }, 'Failed to edit message');
      }
    }
  }

  /* ---------------------------------------------------------------- */
  /*  sendMedia                                                       */
  /* ---------------------------------------------------------------- */

  async sendMedia(peerId: string, media: OutboundMedia, opts?: SendOptions): Promise<string> {
    const bot = this.resolveBot(opts?.accountId);
    const chatId = peerId;

    const inputFile = media.buffer
      ? new InputFile(media.buffer, media.fileName)
      : new InputFile(media.path!, media.fileName);

    const extra: Record<string, unknown> = {};
    if (opts?.replyToId) extra.reply_to_message_id = Number(opts.replyToId);
    if (opts?.threadId) extra.message_thread_id = Number(opts.threadId);
    if (opts?.buttons) extra.reply_markup = buildInlineKeyboard(opts.buttons);
    if (media.caption) extra.caption = media.caption;

    let messageId: number;

    switch (media.type) {
      case 'image': {
        const sent = await bot.api.sendPhoto(chatId, inputFile, extra);
        messageId = sent.message_id;
        break;
      }
      case 'video': {
        const sent = await bot.api.sendVideo(chatId, inputFile, extra);
        messageId = sent.message_id;
        break;
      }
      case 'voice': {
        const sent = await bot.api.sendVoice(chatId, inputFile, extra);
        messageId = sent.message_id;
        break;
      }
      case 'audio': {
        const sent = await bot.api.sendAudio(chatId, inputFile, extra);
        messageId = sent.message_id;
        break;
      }
      case 'document':
      default: {
        const sent = await bot.api.sendDocument(chatId, inputFile, extra);
        messageId = sent.message_id;
        break;
      }
    }

    return String(messageId);
  }

  /* ---------------------------------------------------------------- */
  /*  sendTyping                                                      */
  /* ---------------------------------------------------------------- */

  async sendTyping(peerId: string, accountId?: string, threadId?: string): Promise<void> {
    const bot = this.resolveBot(accountId);
    const opts = threadId ? { message_thread_id: Number(threadId) } : undefined;
    await bot.api.sendChatAction(peerId, 'typing', opts);
  }

  async setReaction(peerId: string, messageId: string, emoji: string, accountId?: string): Promise<void> {
    const bot = this.resolveBot(accountId);
    // grammy types the emoji as a literal union; cast at the boundary.
    await bot.api.setMessageReaction(peerId, Number(messageId), [{ type: 'emoji', emoji } as never]);
  }

  async promptForApproval(req: ApprovalRequest): Promise<void> {
    const text = `🔧 Tool: ${req.toolName}\n\n${req.argsPreview}`;
    await this.sendText(req.peerId, text, {
      accountId: req.accountId,
      threadId: req.threadId,
      buttons: [[
        { text: '✅ Allow', callbackData: `approve:${req.id}` },
        { text: '❌ Deny', callbackData: `deny:${req.id}` },
      ]],
    });
  }

  /* ---------------------------------------------------------------- */
  /*  Account info (for web UI)                                       */
  /* ---------------------------------------------------------------- */

  getAccountInfo(): { accountId: string; botUsername: string; status: string }[] {
    return Array.from(this.bots.keys(), (accountId) => ({
      accountId,
      botUsername: this.botUsernames.get(accountId) ?? '',
      status: this.botStatuses.get(accountId) ?? 'unknown',
    }));
  }

  /* ---------------------------------------------------------------- */
  /*  Internal helpers                                                */
  /* ---------------------------------------------------------------- */

  private resolveBot(accountId?: string): Bot {
    if (accountId) {
      const bot = this.bots.get(accountId);
      if (!bot) throw new Error(`Telegram account "${accountId}" not found`);
      return bot;
    }
    // Default to first bot
    const first = this.bots.values().next();
    if (first.done) throw new Error('No Telegram bots configured');
    return first.value;
  }

  private async normalizeMessage(ctx: Context, accountId: string): Promise<InboundMessage | null> {
    const msg = ctx.message;
    if (!msg) return null;

    const chat = msg.chat;
    const isGroup = chat.type === 'group' || chat.type === 'supergroup';
    const chatType = isGroup ? 'group' : 'dm';

    const botInfo = ctx.me;
    const botUsername = botInfo.username;

    // Detect mention: @botUsername in text or reply to bot
    let mentionedBot = !isGroup; // DMs always count as mentioning the bot
    if (isGroup) {
      const text = msg.text ?? msg.caption ?? '';
      if (botUsername && text.includes(`@${botUsername}`)) {
        mentionedBot = true;
      }
      if (msg.reply_to_message?.from?.id === botInfo.id) {
        mentionedBot = true;
      }
    }

    // Extract reply info
    let replyToId: string | undefined;
    let replyToText: string | undefined;
    if (msg.reply_to_message) {
      replyToId = String(msg.reply_to_message.message_id);
      replyToText = msg.reply_to_message.text ?? msg.reply_to_message.caption;
    }

    // Forum thread support
    const threadId =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (msg as any).is_topic_message ? String(msg.message_thread_id) : undefined;

    // Download media if present
    const media = await this.extractMedia(ctx, accountId);

    const text = msg.text ?? msg.caption ?? '';

    const inbound: InboundMessage = {
      channel: 'telegram',
      accountId,
      chatType,
      peerId: String(chat.id),
      senderId: String(msg.from?.id ?? ''),
      senderName: this.formatSenderName(msg.from),
      text,
      messageId: String(msg.message_id),
      replyToId,
      replyToText,
      threadId,
      mentionedBot,
      media,
      raw: ctx,
    };

    return inbound;
  }

  private formatSenderName(from?: { first_name?: string; last_name?: string; username?: string }): string | undefined {
    if (!from) return undefined;
    const parts = [from.first_name, from.last_name].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : from.username;
  }

  private async extractMedia(ctx: Context, accountId: string): Promise<InboundMedia | undefined> {
    const msg = ctx.message;
    if (!msg) return undefined;

    let fileId: string | undefined;
    let type: InboundMedia['type'];
    let mimeType = 'application/octet-stream';
    let fileName: string | undefined;

    if (msg.photo && msg.photo.length > 0) {
      // Use the largest photo
      const photo = msg.photo[msg.photo.length - 1];
      fileId = photo.file_id;
      type = 'image';
      mimeType = 'image/jpeg';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      type = 'video';
      mimeType = msg.video.mime_type ?? 'video/mp4';
      fileName = msg.video.file_name;
    } else if (msg.voice) {
      fileId = msg.voice.file_id;
      type = 'voice';
      mimeType = msg.voice.mime_type ?? 'audio/ogg';
    } else if (msg.audio) {
      fileId = msg.audio.file_id;
      type = 'audio';
      mimeType = msg.audio.mime_type ?? 'audio/mpeg';
      fileName = msg.audio.file_name;
    } else if (msg.sticker) {
      fileId = msg.sticker.file_id;
      type = 'sticker';
      mimeType = msg.sticker.is_animated ? 'application/x-tgsticker' : 'image/webp';
    } else if (msg.document) {
      fileId = msg.document.file_id;
      type = 'document';
      mimeType = msg.document.mime_type ?? 'application/octet-stream';
      fileName = msg.document.file_name;
    } else {
      return undefined;
    }

    if (!fileId) return undefined;

    try {
      const file = await ctx.getFile();
      const filePath = file.file_path;
      if (!filePath) return undefined;

      const token = this.config.accounts[accountId].token;
      const url = `https://api.telegram.org/file/bot${token}/${filePath}`;

      const response = await fetch(url);
      if (!response.ok) {
        this.log.warn({ accountId, filePath }, 'Failed to download Telegram file');
        return undefined;
      }

      const ext = path.extname(filePath) || mimeToExtension(mimeType);
      const localName = `${Date.now()}-${fileId.slice(0, 8)}${ext}`;
      const localPath = path.join(this.config.mediaDir, localName);

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(localPath, buffer);

      return { type, path: localPath, mimeType, fileName };
    } catch (err) {
      this.log.warn({ err, accountId }, 'Failed to extract media from Telegram message');
      return undefined;
    }
  }

}
