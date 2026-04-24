import type { Query } from '@anthropic-ai/claude-agent-sdk';

interface ControlEntry {
  query: Query;
  abortController?: AbortController;
}

export interface InterruptControlResult {
  interrupted: boolean;
  error?: string;
}

export class SdkControlRegistry {
  private readonly handles = new Map<string, ControlEntry>();
  private readonly aliases = new Map<string, string>();

  register(ids: string[], query: Query, abortController?: AbortController): void {
    const canonicalId = ids.find(Boolean);
    if (!canonicalId) return;

    this.unregister(canonicalId);
    this.handles.set(canonicalId, { query, abortController });

    for (const id of ids) {
      if (!id) continue;
      this.aliases.set(id, canonicalId);
    }
  }

  alias(aliasId: string, targetId: string): void {
    if (!aliasId || !targetId) return;
    const canonicalId = this.resolveCanonicalId(targetId);
    if (!canonicalId) return;
    this.aliases.set(aliasId, canonicalId);
  }

  has(id: string): boolean {
    return Boolean(this.resolveCanonicalId(id));
  }

  async interrupt(id: string): Promise<InterruptControlResult> {
    const entry = this.get(id);
    if (!entry) {
      return {
        interrupted: false,
        error: 'No active parent query control handle is available for this session.',
      };
    }

    try {
      await entry.query.interrupt();
    } catch (err) {
      return {
        interrupted: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    entry.abortController?.abort();
    return { interrupted: true };
  }

  unregister(id: string): void {
    const canonicalId = this.resolveCanonicalId(id);
    if (!canonicalId) return;

    const entry = this.handles.get(canonicalId);
    entry?.query.close?.();
    this.handles.delete(canonicalId);

    for (const [alias, target] of [...this.aliases.entries()]) {
      if (alias === id || target === canonicalId) {
        this.aliases.delete(alias);
      }
    }
  }

  clear(): void {
    for (const entry of this.handles.values()) {
      entry.abortController?.abort();
      entry.query.close?.();
    }
    this.handles.clear();
    this.aliases.clear();
  }

  private get(id: string): ControlEntry | null {
    const canonicalId = this.resolveCanonicalId(id);
    return canonicalId ? (this.handles.get(canonicalId) ?? null) : null;
  }

  private resolveCanonicalId(id: string): string | null {
    if (this.handles.has(id)) return id;
    const target = this.aliases.get(id);
    return target && this.handles.has(target) ? target : null;
  }
}
