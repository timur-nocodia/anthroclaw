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
  unpause(agentId: string, peerKey: string, reason: string): PauseEntry | null;
  isPaused(
    agentId: string,
    peerKey: string,
  ): { paused: boolean; entry?: PauseEntry; expired?: boolean };
  list(agentId?: string): PauseEntry[];
}

export interface CreatePeerPauseStoreOptions {
  filePath: string; // ':memory:' for tests
}

export function createPeerPauseStore(opts: CreatePeerPauseStoreOptions): PeerPauseStore {
  void opts;
  const entries = new Map<string, PauseEntry>();
  const key = (agentId: string, peerKey: string) => `${agentId}::${peerKey}`;
  return {
    pause() {
      throw new Error('not implemented');
    },
    extend() {
      throw new Error('not implemented');
    },
    unpause() {
      throw new Error('not implemented');
    },
    isPaused: (agentId, peerKey) => {
      const entry = entries.get(key(agentId, peerKey));
      if (!entry) return { paused: false };
      return { paused: true, entry };
    },
    list: (agentId) => [...entries.values()].filter((e) => !agentId || e.agentId === agentId),
  };
}
