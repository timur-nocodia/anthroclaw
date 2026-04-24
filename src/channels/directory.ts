export interface ChannelEntry {
  platform: string;          // 'telegram' | 'whatsapp'
  peerId: string;
  name: string;
  type: 'dm' | 'group';
  accountId: string;
}

export class ChannelDirectory {
  private entries: ChannelEntry[] = [];
  private lastRefresh = 0;

  update(entries: ChannelEntry[]): void {
    this.entries = entries;
    this.lastRefresh = Date.now();
  }

  lookup(query: string, platform?: string): ChannelEntry[] {
    const lower = query.toLowerCase();
    let results = this.entries.filter((e) => e.name.toLowerCase().includes(lower));
    if (platform) {
      results = results.filter((e) => e.platform === platform);
    }
    return results;
  }

  list(platform?: string): ChannelEntry[] {
    if (platform) {
      return this.entries.filter((e) => e.platform === platform);
    }
    return [...this.entries];
  }

  resolve(nameOrId: string, platform?: string): ChannelEntry | undefined {
    // Try exact peerId match first
    const match = this.entries.find(
      (e) => e.peerId === nameOrId && (!platform || e.platform === platform),
    );
    if (match) return match;

    // Fall back to name lookup (first result)
    const byName = this.lookup(nameOrId, platform);
    return byName[0];
  }

  get staleMs(): number {
    return Date.now() - this.lastRefresh;
  }
}
