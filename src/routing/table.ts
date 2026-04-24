import type { AgentYml } from '../config/schema.js';

export interface RouteEntry {
  agentId: string;
  channel: string;
  accountId: string;
  scope: string;
  peers: string[] | null;
  topics: string[] | null;
  mentionOnly: boolean;
  priority: number;
}

export class RouteTable {
  private entries: RouteEntry[];

  private constructor(entries: RouteEntry[]) {
    this.entries = entries;
  }

  /**
   * Build a RouteTable from an array of agents.
   * Validates no conflicts and sorts entries by priority descending.
   */
  static build(agents: Array<{ id: string; config: AgentYml }>): RouteTable {
    const entries: RouteEntry[] = [];

    for (const { id, config } of agents) {
      for (const route of config.routes) {
        let priority = 0;
        if (route.topics && route.topics.length > 0) priority += 8;
        if (route.peers && route.peers.length > 0) priority += 4;
        if (route.scope === 'dm' || route.scope === 'group') priority += 2;
        if (route.account) priority += 1;

        entries.push({
          agentId: id,
          channel: route.channel,
          accountId: route.account ?? 'default',
          scope: route.scope ?? 'any',
          peers: route.peers ?? null,
          topics: route.topics ?? null,
          mentionOnly: route.mention_only ?? false,
          priority,
        });
      }
    }

    // Sort by priority descending (highest priority first)
    entries.sort((a, b) => b.priority - a.priority);

    // Detect conflicts: two entries claiming the same {channel, accountId, scope, peerId}
    RouteTable.detectConflicts(entries);

    return new RouteTable(entries);
  }

  /**
   * Detect conflicting route entries.
   * Conflict = two agents claiming the same {channel, accountId, scope, peerId, topicId}.
   */
  private static detectConflicts(entries: RouteEntry[]): void {
    const claims = new Map<string, string>();

    for (const entry of entries) {
      const scopes = entry.scope === 'any' ? ['dm', 'group'] : [entry.scope];
      const peerList = entry.peers ?? ['*'];
      const topicList = entry.topics ?? ['*'];

      for (const scope of scopes) {
        for (const peer of peerList) {
          for (const topic of topicList) {
            const key = `${entry.channel}:${entry.accountId}:${scope}:${peer}:${topic}`;
            const existing = claims.get(key);
            if (existing && existing !== entry.agentId) {
              throw new Error(
                `Route conflict: agents "${existing}" and "${entry.agentId}" both claim {channel: ${entry.channel}, account: ${entry.accountId}, scope: ${scope}, peer: ${peer}, topic: ${topic}}`,
              );
            }
            claims.set(key, entry.agentId);
          }
        }
      }
    }
  }

  /**
   * Resolve the first matching route entry for the given parameters.
   * Entries are already sorted by priority descending, so first match wins.
   */
  resolve(
    channel: string,
    accountId: string,
    chatType: 'dm' | 'group',
    peerId: string,
    threadId?: string,
  ): RouteEntry | null {
    for (const entry of this.entries) {
      // Channel must match
      if (entry.channel !== channel) continue;

      // Account must match (entry's default matches any accountId of 'default')
      if (entry.accountId !== 'default' && entry.accountId !== accountId) continue;

      // Scope must match: 'any' matches both dm and group
      if (entry.scope !== 'any' && entry.scope !== chatType) continue;

      // Peers filter: null means all peers match
      if (entry.peers !== null && !entry.peers.includes(peerId)) continue;

      // Topics filter: null means all topics match; if entry specifies topics, threadId must be in the list
      if (entry.topics !== null && (!threadId || !entry.topics.includes(threadId))) continue;

      return entry;
    }

    return null;
  }
}
