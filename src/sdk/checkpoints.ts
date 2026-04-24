import type { Query, RewindFilesResult } from '@anthropic-ai/claude-agent-sdk';

export interface RewindRequest {
  sessionId: string;
  userMessageId: string;
  dryRun?: boolean;
}

export interface RewindResponse extends RewindFilesResult {
  sessionId: string;
  userMessageId: string;
}

export interface SdkCheckpointRegistryOptions {
  ttlMs?: number;
  maxHandles?: number;
  now?: () => number;
}

interface HandleEntry {
  query: Query;
  touchedAt: number;
  expiresAt: number;
}

export class SdkCheckpointRegistry {
  private readonly handles = new Map<string, HandleEntry>();
  private readonly aliases = new Map<string, string>();
  private readonly ttlMs: number;
  private readonly maxHandles: number;
  private readonly now: () => number;

  constructor(options: SdkCheckpointRegistryOptions = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.maxHandles = options.maxHandles ?? 100;
    this.now = options.now ?? (() => Date.now());
  }

  register(ids: string[], query: Query): void {
    const canonicalId = ids.find(Boolean);
    if (!canonicalId) return;

    this.sweep();

    const now = this.now();
    this.handles.set(canonicalId, {
      query,
      touchedAt: now,
      expiresAt: now + this.ttlMs,
    });

    for (const id of ids) {
      if (!id) continue;
      this.aliases.set(id, canonicalId);
    }

    this.trim();
  }

  alias(aliasId: string, targetId: string): void {
    if (!aliasId || !targetId) return;
    const canonicalId = this.resolveCanonicalId(targetId);
    if (!canonicalId) return;
    this.aliases.set(aliasId, canonicalId);
    const entry = this.handles.get(canonicalId);
    if (entry) {
      const now = this.now();
      entry.touchedAt = now;
      entry.expiresAt = now + this.ttlMs;
    }
  }

  has(sessionId: string): boolean {
    return Boolean(this.get(sessionId));
  }

  async rewindFiles(request: RewindRequest): Promise<RewindResponse> {
    const query = this.get(request.sessionId);
    if (!query) {
      return {
        sessionId: request.sessionId,
        userMessageId: request.userMessageId,
        canRewind: false,
        error: 'No active checkpoint control handle is available for this session. Run another turn with file checkpointing enabled, then retry.',
      };
    }

    const result = await query.rewindFiles(request.userMessageId, {
      dryRun: request.dryRun,
    });

    return {
      ...result,
      sessionId: request.sessionId,
      userMessageId: request.userMessageId,
    };
  }

  delete(sessionId: string): void {
    const canonicalId = this.resolveCanonicalId(sessionId);
    if (!canonicalId) return;
    const entry = this.handles.get(canonicalId);
    entry?.query.close?.();
    this.handles.delete(canonicalId);
    for (const [alias, target] of [...this.aliases.entries()]) {
      if (alias === sessionId || target === canonicalId) {
        this.aliases.delete(alias);
      }
    }
  }

  private get(sessionId: string): Query | null {
    this.sweep();
    const canonicalId = this.resolveCanonicalId(sessionId);
    if (!canonicalId) return null;

    const entry = this.handles.get(canonicalId);
    if (!entry) return null;

    const now = this.now();
    entry.touchedAt = now;
    entry.expiresAt = now + this.ttlMs;
    return entry.query;
  }

  private resolveCanonicalId(sessionId: string): string | null {
    if (this.handles.has(sessionId)) return sessionId;
    const target = this.aliases.get(sessionId);
    return target && this.handles.has(target) ? target : null;
  }

  private sweep(): void {
    const now = this.now();
    for (const [id, entry] of [...this.handles.entries()]) {
      if (entry.expiresAt > now) continue;
      entry.query.close?.();
      this.handles.delete(id);
    }
    for (const [alias, target] of [...this.aliases.entries()]) {
      if (!this.handles.has(target)) {
        this.aliases.delete(alias);
      }
    }
  }

  private trim(): void {
    if (this.handles.size <= this.maxHandles) return;

    const entries = [...this.handles.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    for (const [id, entry] of entries.slice(0, this.handles.size - this.maxHandles)) {
      entry.query.close?.();
      this.handles.delete(id);
    }

    for (const [alias, target] of [...this.aliases.entries()]) {
      if (!this.handles.has(target)) {
        this.aliases.delete(alias);
      }
    }
  }
}
