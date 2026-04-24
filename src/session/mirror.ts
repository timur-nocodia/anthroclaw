const MAX_RECORDS = 50;

export interface MirrorRecord {
  source: string;
  text: string;
  timestamp: number;
}

export class SessionMirror {
  private records = new Map<string, MirrorRecord[]>();

  record(sessionKey: string, source: string, text: string): void {
    let list = this.records.get(sessionKey);
    if (!list) {
      list = [];
      this.records.set(sessionKey, list);
    }
    list.push({ source, text, timestamp: Date.now() });
    if (list.length > MAX_RECORDS) {
      list.splice(0, list.length - MAX_RECORDS);
    }
  }

  consume(sessionKey: string): MirrorRecord[] | null {
    const list = this.records.get(sessionKey);
    if (!list || list.length === 0) return null;
    this.records.delete(sessionKey);
    return list;
  }

  formatForContext(records: MirrorRecord[]): string {
    let out = '[Mirror] Messages sent to this chat while you were away:\n';
    for (const r of records) {
      out += `- [${r.source}] ${r.text}\n`;
    }
    return out;
  }
}
