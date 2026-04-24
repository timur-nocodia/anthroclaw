export function buildSessionKey(
  agentId: string,
  channel: string,
  chatType: string,
  peerId: string,
  threadId?: string,
): string {
  const parts = [agentId, channel, chatType, peerId];
  if (threadId) parts.push('thread', threadId);
  return parts.join(':');
}
