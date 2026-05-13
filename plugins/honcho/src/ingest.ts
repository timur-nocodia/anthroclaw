import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { HonchoConfig } from './config.js';
import { buildHonchoSessionId, deriveHonchoPeers } from './ids.js';
import { sanitizeMessageText } from './sanitize.js';

export interface HonchoPeerLike {
  id: string;
  message(text: string): unknown;
}

export interface HonchoSessionLike {
  addPeers(peers: HonchoPeerLike[]): Promise<unknown>;
  addMessages(messages: unknown[]): Promise<unknown>;
}

export interface HonchoIngestSdk {
  peer(id: string, options?: unknown): Promise<HonchoPeerLike>;
  session(id: string, options?: unknown): Promise<HonchoSessionLike>;
}

export interface ObserveHonchoTurnInput {
  sdk: HonchoIngestSdk;
  config: HonchoConfig;
  agentId: string;
  sessionKey: string;
  payload: Record<string, unknown>;
  groupSessionMode?: 'shared' | 'per_user';
  offlineQueuePath?: string;
  replayQueued?: boolean;
}

interface HookMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function observeHonchoTurn(input: ObserveHonchoTurnInput): Promise<void> {
  if (!input.config.enabled || input.config.mode === 'off') return;
  if (!input.config.observe.include_user_messages && !input.config.observe.include_assistant_messages) {
    return;
  }

  const context = readPayloadContext(input.payload);
  if (!context) return;

  const messages = readHookMessages(input.payload)
    .filter((message) => (
      message.role === 'user'
        ? input.config.observe.include_user_messages
        : input.config.observe.include_assistant_messages
    ))
    .map((message) => ({
      ...message,
      content: sanitizeMessageText(message.content, input.config),
    }))
    .filter((message) => message.content.length > 0);
  if (messages.length === 0) return;

  try {
    await writeHonchoTurn(input, context, messages);
    if (input.replayQueued !== false && input.offlineQueuePath) {
      await replayOfflineQueue(input);
    }
  } catch (err) {
    if (input.config.observe.queue_on_failure && input.offlineQueuePath) {
      appendOfflineQueue(input.offlineQueuePath, {
        agentId: input.agentId,
        sessionKey: input.sessionKey,
        payload: input.payload,
        error: redactSecrets(err instanceof Error ? err.message : String(err)),
        queuedAt: Date.now(),
      });
    }
  }
}

async function writeHonchoTurn(
  input: ObserveHonchoTurnInput,
  context: NonNullable<ReturnType<typeof readPayloadContext>>,
  messages: HookMessage[],
): Promise<void> {
  const peerIds = deriveHonchoPeers({
    agentId: input.agentId,
    channel: context.channel,
    accountId: context.accountId,
    chatType: context.chatType,
    peerId: context.peerId,
    senderId: context.senderId,
    groupSessionMode: input.groupSessionMode,
    config: input.config,
  });
  const userPeer = await input.sdk.peer(peerIds.userPeerId, {
    metadata: buildPeerMetadata(input, context, 'user'),
  });
  const agentPeer = await input.sdk.peer(peerIds.agentPeerId, {
    metadata: buildPeerMetadata(input, context, 'agent'),
  });
  const groupPeer = peerIds.groupPeerId
    ? await input.sdk.peer(peerIds.groupPeerId, {
      metadata: buildPeerMetadata(input, context, 'group'),
    })
    : undefined;

  const session = await input.sdk.session(buildHonchoSessionId(input.sessionKey), {
    metadata: {
      source: 'anthroclaw',
      agent_id: input.agentId,
      channel: context.channel,
      chat_type: context.chatType,
      session_key_hash: buildHonchoSessionId(input.sessionKey).replace(/^session_/, ''),
    },
  });
  await session.addPeers(groupPeer ? [groupPeer, userPeer, agentPeer] : [userPeer, agentPeer]);
  await session.addMessages(messages.map((message) => {
    const peer = message.role === 'assistant' ? agentPeer : userPeer;
    return peer.message(message.content);
  }));
}

async function replayOfflineQueue(input: ObserveHonchoTurnInput): Promise<void> {
  if (!input.offlineQueuePath || !existsSync(input.offlineQueuePath)) return;
  const rows = readFileSync(input.offlineQueuePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line): Array<Record<string, unknown>> => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
  if (rows.length === 0) return;

  const remaining: Record<string, unknown>[] = [];
  for (const row of rows.slice(0, 25)) {
    const agentId = typeof row.agentId === 'string' ? row.agentId : input.agentId;
    const sessionKey = typeof row.sessionKey === 'string' ? row.sessionKey : undefined;
    const payload = row.payload && typeof row.payload === 'object'
      ? row.payload as Record<string, unknown>
      : undefined;
    if (!sessionKey || !payload) continue;

    const context = readPayloadContext(payload);
    const hookMessages = readHookMessages(payload)
      .filter((message) => (
        message.role === 'user'
          ? input.config.observe.include_user_messages
          : input.config.observe.include_assistant_messages
      ));
    if (!context || hookMessages.length === 0) {
      continue;
    }
    try {
      const sanitized = hookMessages
        .map((message) => ({ ...message, content: sanitizeMessageText(message.content, input.config) }))
        .filter((message) => message.content.length > 0);
      await writeHonchoTurn({ ...input, agentId, sessionKey, payload, replayQueued: false }, context, sanitized);
    } catch (err) {
      remaining.push({
        ...row,
        error: redactSecrets(err instanceof Error ? err.message : String(err)),
        lastAttemptAt: Date.now(),
      });
    }
  }
  remaining.push(...rows.slice(25));
  writeFileSync(
    input.offlineQueuePath,
    remaining.length > 0 ? `${remaining.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
    'utf8',
  );
}

function readHookMessages(payload: Record<string, unknown>): HookMessage[] {
  const raw = payload.newMessages;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): HookMessage[] => {
    if (!entry || typeof entry !== 'object') return [];
    const message = entry as { role?: unknown; content?: unknown };
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') {
      return [];
    }
    return [{ role: message.role, content: message.content }];
  });
}

function readPayloadContext(payload: Record<string, unknown>): {
  channel: 'telegram' | 'whatsapp';
  accountId: string;
  peerId: string;
  senderId: string;
  chatType: 'dm' | 'group';
} | null {
  const channel = payload.channel;
  const chatType = payload.chatType;
  if (channel !== 'telegram' && channel !== 'whatsapp') return null;
  if (chatType !== 'dm' && chatType !== 'group') return null;
  if (typeof payload.accountId !== 'string') return null;
  if (typeof payload.peerId !== 'string') return null;
  if (typeof payload.senderId !== 'string') return null;
  return {
    channel,
    chatType,
    accountId: payload.accountId,
    peerId: payload.peerId,
    senderId: payload.senderId,
  };
}

function buildPeerMetadata(
  input: ObserveHonchoTurnInput,
  context: NonNullable<ReturnType<typeof readPayloadContext>>,
  kind: 'agent' | 'user' | 'group',
): Record<string, unknown> {
  return {
    source: 'anthroclaw',
    kind,
    agent_id: input.agentId,
    channel: context.channel,
    account_id: context.accountId,
    chat_type: context.chatType,
  };
}

function appendOfflineQueue(path: string, row: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`, 'utf8');
}

function redactSecrets(text: string): string {
  return text.replace(
    /(?:api[_-]?key|token|secret|password)["':\s=]+([a-zA-Z0-9_-]{20,})/gi,
    (full, value: string) => {
      const prefix = full.slice(0, full.length - value.length);
      return `${prefix}${value.slice(0, 6)}****${value.slice(-4)}`;
    },
  );
}
