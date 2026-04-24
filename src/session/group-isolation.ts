export type GroupSessionMode = 'shared' | 'per_user';

export function buildGroupSessionKey(
  baseKey: string,
  senderId: string,
  mode: GroupSessionMode,
): string {
  if (mode === 'shared') return baseKey;
  return `${baseKey}:user:${senderId}`;
}
