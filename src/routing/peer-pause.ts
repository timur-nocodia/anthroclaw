import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../logger.js';

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
  /** Synchronously flush in-memory state to disk. Bypasses debounce. No-op for `:memory:`. */
  flush(): Promise<void>;
}

export interface CreatePeerPauseStoreOptions {
  filePath: string; // ':memory:' for tests
  clock?: () => number;
  /** Debounce window for scheduled saves, in ms. Defaults to 250. */
  saveDebounceMs?: number;
}

const DEFAULT_SAVE_DEBOUNCE_MS = 250;

export function createPeerPauseStore(opts: CreatePeerPauseStoreOptions): PeerPauseStore {
  const { filePath, clock = Date.now, saveDebounceMs = DEFAULT_SAVE_DEBOUNCE_MS } = opts;
  const persistent = filePath !== ':memory:';
  const entries = new Map<string, PauseEntry>();
  const key = (agentId: string, peerKey: string) => `${agentId}::${peerKey}`;

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function loadFromDisk(): void {
    if (!persistent) return;
    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf-8');
    } catch {
      return; // missing file → empty store
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn({ err, path: filePath }, 'Malformed peer-pauses file; starting empty');
      return;
    }
    if (!Array.isArray(parsed)) {
      logger.warn({ path: filePath }, 'Unexpected peer-pauses shape; starting empty');
      return;
    }
    for (const item of parsed as PauseEntry[]) {
      if (item && typeof item.agentId === 'string' && typeof item.peerKey === 'string') {
        entries.set(key(item.agentId, item.peerKey), item);
      }
    }
  }

  function writeNow(): void {
    if (!persistent) return;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify([...entries.values()], null, 2), 'utf-8');
    } catch (err) {
      logger.warn({ err, path: filePath }, 'Failed to save peer-pauses');
    }
  }

  function scheduleSave(): void {
    if (!persistent) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      writeNow();
    }, saveDebounceMs);
    // Allow process exit while debounce is pending.
    if (typeof saveTimer === 'object' && saveTimer && 'unref' in saveTimer) {
      (saveTimer as { unref?: () => void }).unref?.();
    }
  }

  loadFromDisk();

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
      scheduleSave();
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
      scheduleSave();
      return updated;
    },
    unpause: (agentId, peerKey, _reason) => {
      void _reason;
      const k = key(agentId, peerKey);
      const existing = entries.get(k);
      if (!existing) return null;
      entries.delete(k);
      scheduleSave();
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
    flush: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      writeNow();
    },
  };
}
