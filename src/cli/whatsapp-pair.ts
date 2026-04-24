#!/usr/bin/env node
import {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  type WASocket,
} from '@whiskeysockets/baileys';
import { createRequire } from 'node:module';
import pino from 'pino';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const require = createRequire(import.meta.url);
const qrTerminal = require('qrcode-terminal') as { generate: (text: string, opts: { small: boolean }) => void };

const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const flags = process.argv.slice(2).filter((a) => a.startsWith('-'));

const authDir = args[0] || './data/whatsapp/default';
const mode = flags.includes('--code') ? 'code' : 'qr';
const fresh = flags.includes('--fresh');

if (fresh && existsSync(authDir)) {
  rmSync(authDir, { recursive: true, force: true });
}
mkdirSync(authDir, { recursive: true });

let phoneNumber: string | undefined;

if (mode === 'code') {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  phoneNumber = await new Promise<string>((resolve) => {
    rl.question('Phone (with country code, e.g. 77017231281): ', (answer) => {
      rl.close();
      resolve(answer.replace(/[^0-9]/g, ''));
    });
  });
  if (!phoneNumber || phoneNumber.length < 10) {
    console.error('Invalid phone number.');
    process.exit(1);
  }
}

console.log(`\nWhatsApp Pairing (${mode} mode)`);
console.log(`   Auth dir: ${authDir}`);
console.log(`   Connecting...\n`);

const { version } = await fetchLatestWaWebVersion();
const silentLogger = pino({ level: 'silent' });

const MAX_RECONNECTS = 5;
let reconnectCount = 0;
let pairingCodeSent = false;

async function createSocket(): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    version,
    browser: ['openclaw-replica', 'cli', '0.1.0'],
    printQRInTerminal: false,
    logger: silentLogger,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  if (sock.ws && typeof (sock.ws as any).on === 'function') {
    (sock.ws as any).on('error', (err: Error) => {
      console.error(`   WebSocket error: ${err.message}`);
    });
  }

  return sock;
}

function onConnected(sock: WASocket) {
  const me = sock.user;
  console.log(`Connected as ${me?.name ?? me?.id ?? 'unknown'}`);
  console.log(`   Credentials saved to ${authDir}\n`);
  sock.end(undefined);
  process.exit(0);
}

async function startSession() {
  const sock = await createSocket();

  if (mode === 'code' && phoneNumber && !pairingCodeSent) {
    const phone = phoneNumber;
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone);
        pairingCodeSent = true;
        console.log(`   Code: ${code}\n`);
        console.log(`   WhatsApp > Linked Devices > Link a Device`);
        console.log(`   Tap "Link with phone number instead"`);
        console.log(`   Enter the code above. Waiting...\n`);
      } catch (err: any) {
        console.error(`   Pairing code failed: ${err.message}\n`);
        process.exit(1);
      }
    }, 4000);
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && mode === 'qr') {
      console.log('Scan in WhatsApp > Linked Devices > Link a Device\n');
      qrTerminal.generate(qr, { small: true });
      console.log('');
    }

    if (connection === 'open') {
      onConnected(sock);
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;

      if (code === DisconnectReason.loggedOut) {
        console.error('Logged out by WhatsApp. Use --fresh to clear credentials.');
        process.exit(1);
      }

      reconnectCount++;
      if (reconnectCount > MAX_RECONNECTS) {
        console.error(`Failed after ${MAX_RECONNECTS} reconnect attempts.`);
        process.exit(1);
      }

      console.log(`   Reconnecting (${reconnectCount}/${MAX_RECONNECTS}, status ${code ?? 'unknown'})...`);
      sock.end(undefined);
      startSession();
    }
  });
}

await startSession();

setInterval(() => {}, 1 << 30);
