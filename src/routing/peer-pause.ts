export interface PauseEntry {
  agentId: string;
  peerKey: string;
  pausedAt: string;
  expiresAt: string | null;
  reason: 'operator_takeover' | 'manual' | 'manual_indefinite';
  source: string;
  extendedCount: number;
  lastOperatorMessageAt: string | null;
}

export interface PeerPauseStore {
  pause(
    agentId: string,
    peerKey: string,
    opts: { ttlMinutes?: number; reason: PauseEntry['reason']; source: string },
  ): PauseEntry;
  extend(agentId: string, peerKey: string): PauseEntry | null;
  /** `reason` is freeform audit text (e.g., `'ttl_expired'`, `'manual'`); not constrained to PauseEntry['reason']. */
  unpause(agentId: string, peerKey: string, reason: string): PauseEntry | null;
  isPaused(
    agentId: string,
    peerKey: string,
  ): { paused: boolean; entry?: PauseEntry; expired?: boolean };
  list(agentId?: string): PauseEntry[];
}

export interface CreatePeerPauseStoreOptions {
  filePath: string; // ':memory:' for tests
  clock?: () => number;
}

export function createPeerPauseStore(opts: CreatePeerPauseStoreOptions): PeerPauseStore {
  const { filePath: _filePath, clock = Date.now } = opts;
  void _filePath;
  const entries = new Map<string, PauseEntry>();
  const key = (agentId: string, peerKey: string) => `${agentId}::${peerKey}`;
  return {
    pause: (agentId, peerKey, options) => {
      const nowMs = clock();
      const pausedAt = new Date(nowMs).toISOString();
      const expiresAt =
        options.ttlMinutes === undefined
          ? null
          : new Date(nowMs + options.ttlMinutes * 60_000).toISOString();
      const entry: PauseEntry = {
        agentId,
        peerKey,
        pausedAt,
        expiresAt,
        reason: options.reason,
        source: options.source,
        extendedCount: 0,
        lastOperatorMessageAt: pausedAt,
      };
      entries.set(key(agentId, peerKey), entry);
      return entry;
    },
    extend: (agentId, peerKey) => {
      const existing = entries.get(key(agentId, peerKey));
      if (!existing) return null;
      const nowMs = clock();
      const nowIso = new Date(nowMs).toISOString();
      let nextExpiresAt: string | null = null;
      if (existing.expiresAt !== null && existing.lastOperatorMessageAt !== null) {
        const ttlMs = Date.parse(existing.expiresAt) - Date.parse(existing.lastOperatorMessageAt);
        nextExpiresAt = new Date(nowMs + ttlMs).toISOString();
      }
      const updated: PauseEntry = {
        ...existing,
        expiresAt: nextExpiresAt,
        extendedCount: existing.extendedCount + 1,
        lastOperatorMessageAt: nowIso,
      };
      entries.set(key(agentId, peerKey), updated);
      return updated;
    },
    unpause: (agentId, peerKey, _reason) => {
      void _reason;
      const k = key(agentId, peerKey);
      const existing = entries.get(k);
      if (!existing) return null;
      entries.delete(k);
      return existing;
    },
    isPaused: (agentId, peerKey) => {
      const entry = entries.get(key(agentId, peerKey));
      if (!entry) return { paused: false };
      if (entry.expiresAt === null) return { paused: true, entry, expired: false };
      const expired = clock() > Date.parse(entry.expiresAt);
      return { paused: true, entry, expired };
    },
    list: (agentId) =>
      [...entries.values()]
        .filter((e) => !agentId || e.agentId === agentId)
        .sort((a, b) => a.pausedAt.localeCompare(b.pausedAt)),
  };
}
