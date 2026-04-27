import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { mkdirSync, existsSync } from 'node:fs';

// ─── Types ───────────────────────────────────────────────────────────

export interface PairEvent {
  type: 'qr' | 'status' | 'paired' | 'error';
  code?: string;
  message?: string;
  accountId?: string;
  phone?: string;
}

// ─── Async generator ─────────────────────────────────────────────────

const MAX_RECONNECTS = 5;

/**
 * Yields WhatsApp pairing events (QR codes, status updates, errors).
 * Uses the same Baileys logic as the CLI but as an async generator
 * for SSE streaming.
 */
export async function* pairWhatsApp(authDir: string): AsyncGenerator<PairEvent> {
  if (!existsSync(authDir)) {
    mkdirSync(authDir, { recursive: true });
  }

  const { version } = await fetchLatestWaWebVersion();
  const silentLogger = pino({ level: 'silent' });

  let reconnectCount = 0;
  let done = false;

  while (!done && reconnectCount <= MAX_RECONNECTS) {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
      },
      version,
      browser: ['openclaw-replica', 'web-ui', '0.1.0'],
      printQRInTerminal: false,
      logger: silentLogger,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    sock.ev.on('creds.update', saveCreds);

    // Create a promise-based event queue
    const eventQueue: PairEvent[] = [];
    let resolveWait: (() => void) | null = null;

    const pushEvent = (evt: PairEvent) => {
      eventQueue.push(evt);
      if (resolveWait) {
        resolveWait();
        resolveWait = null;
      }
    };

    const waitForEvent = (): Promise<void> => {
      if (eventQueue.length > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveWait = resolve;
      });
    };

    let shouldReconnect = false;

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        pushEvent({ type: 'qr', code: qr });
      }

      if (connection === 'open') {
        const me = sock.user;
        pushEvent({
          type: 'paired',
          message: `Connected as ${me?.name ?? me?.id ?? 'unknown'}`,
          accountId: me?.id?.split(':')[0] ?? me?.id,
          phone: me?.id?.split('@')[0]?.split(':')[0],
        });
        done = true;
        // Defer socket close so Baileys can finish post-pair registration:
        // it sets `creds.registered = true` and persists the final creds via
        // `creds.update` events that fire AFTER `connection: 'open'`. Closing
        // immediately leaves `registered: false` on disk, and the next socket
        // (the gateway adapter) will be told to re-pair on connect.
        setTimeout(() => sock.end(undefined), 10_000);
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as any)?.output?.statusCode;

        if (code === DisconnectReason.loggedOut) {
          pushEvent({
            type: 'error',
            message: 'Logged out by WhatsApp. Clear credentials and try again.',
          });
          done = true;
        } else {
          reconnectCount++;
          if (reconnectCount > MAX_RECONNECTS) {
            pushEvent({
              type: 'error',
              message: `Failed after ${MAX_RECONNECTS} reconnect attempts`,
            });
            done = true;
          } else {
            pushEvent({
              type: 'status',
              message: `Reconnecting (${reconnectCount}/${MAX_RECONNECTS})...`,
            });
            shouldReconnect = true;
          }
        }
        sock.end(undefined);
      }
    });

    // Yield events as they come in
    while (true) {
      await waitForEvent();

      while (eventQueue.length > 0) {
        const evt = eventQueue.shift()!;
        yield evt;

        if (evt.type === 'paired' || evt.type === 'error') {
          return;
        }
      }

      if (shouldReconnect) break;
    }
  }
}
