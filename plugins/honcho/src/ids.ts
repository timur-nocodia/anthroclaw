import { createHash } from 'node:crypto';
import type { HonchoConfig } from './config.js';

export interface DeriveHonchoPeersInput {
  agentId: string;
  channel: 'telegram' | 'whatsapp';
  accountId: string;
  chatType: 'dm' | 'group';
  peerId: string;
  senderId: string;
  groupSessionMode?: 'shared' | 'per_user';
  config: HonchoConfig;
}

export interface HonchoPeerIds {
  agentPeerId: string;
  userPeerId: string;
  groupPeerId?: string;
}

export function hashStableId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

export function buildHonchoSessionId(sessionKey: string): string {
  return `session:${hashStableId(sessionKey)}`;
}

export function deriveHonchoPeers(input: DeriveHonchoPeersInput): HonchoPeerIds {
  const { config } = input;
  const account = input.accountId || 'default';
  const userRaw = `${input.channel}:${account}:${input.senderId}`;
  const groupRaw = `${input.channel}:${account}:${input.peerId}`;
  const userPart = config.peers.hash_ids ? hashStableId(userRaw) : input.senderId;
  const groupPart = config.peers.hash_ids ? hashStableId(groupRaw) : input.peerId;

  return {
    agentPeerId: `${config.peers.agent_peer_prefix}:${input.agentId}`,
    userPeerId: `${config.peers.user_peer_prefix}:${input.channel}:${account}:${userPart}`,
    ...(input.chatType === 'group' && input.groupSessionMode !== 'per_user'
      ? {
          groupPeerId:
            `${config.peers.group_peer_prefix}:${input.channel}:${account}:${groupPart}`,
        }
      : {}),
  };
}
