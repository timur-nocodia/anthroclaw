import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AccessResult {
  allowed: boolean;
  pairingType?: 'code' | 'approve';
  reason?: string;
}

interface AgentAccessConfig {
  pairing?: { mode: string; code?: string; approver_chat_id?: string };
  allowlist?: Record<string, string[]>;
}

interface AccessData {
  approved: Record<string, string[]>; // agentId -> senderIds
  pending: Record<string, string[]>;  // agentId -> senderIds
}

export class AccessControl {
  private dataPath: string;
  private data: AccessData;

  constructor(dataDir: string) {
    this.dataPath = path.join(dataDir, 'access.json');
    this.data = this.load();
  }

  private load(): AccessData {
    try {
      const raw = fs.readFileSync(this.dataPath, 'utf-8');
      return JSON.parse(raw) as AccessData;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { approved: {}, pending: {} };
      }
      throw err;
    }
  }

  private save(): void {
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private isApproved(agentId: string, senderId: string): boolean {
    return this.data.approved[agentId]?.includes(senderId) ?? false;
  }

  private approve(agentId: string, senderId: string): void {
    if (!this.data.approved[agentId]) {
      this.data.approved[agentId] = [];
    }
    const alreadyApproved = this.data.approved[agentId].includes(senderId);
    if (!alreadyApproved) {
      this.data.approved[agentId].push(senderId);
    }
    const removedPending = this.removePending(agentId, senderId);
    if (!alreadyApproved || removedPending) {
      this.save();
    }
  }

  private addPending(agentId: string, senderId: string): void {
    if (!this.data.pending[agentId]) {
      this.data.pending[agentId] = [];
    }
    if (!this.data.pending[agentId].includes(senderId)) {
      this.data.pending[agentId].push(senderId);
      this.save();
    }
  }

  private removePending(agentId: string, senderId: string): boolean {
    const list = this.data.pending[agentId];
    if (list) {
      const idx = list.indexOf(senderId);
      if (idx !== -1) { list.splice(idx, 1); return true; }
    }
    return false;
  }

  private isAllowlisted(
    senderId: string,
    channel: string,
    config: AgentAccessConfig,
  ): boolean {
    const list = config.allowlist?.[channel];
    if (!list) return false;
    return list.includes(senderId) || list.includes('*');
  }

  check(
    agentId: string,
    senderId: string,
    channel: string,
    config: AgentAccessConfig,
  ): AccessResult {
    // 0. If neither pairing nor allowlist is configured, treat access as open.
    // The route layer (peers/topics/mention_only) is already gating who can reach
    // this agent — adding implicit deny here makes "drop a bot into a group and
    // @-mention it" silently fail out of the box.
    if (!config.pairing && !config.allowlist) {
      return { allowed: true };
    }

    // 1. Allowlist check
    if (this.isAllowlisted(senderId, channel, config)) {
      return { allowed: true };
    }

    // 2. Already approved
    if (this.isApproved(agentId, senderId)) {
      return { allowed: true };
    }

    // 3. Pairing mode
    const mode = config.pairing?.mode ?? 'off';

    switch (mode) {
      case 'open':
        this.approve(agentId, senderId);
        return { allowed: true };

      case 'code':
        return {
          allowed: false,
          pairingType: 'code',
          reason: 'Pairing code required',
        };

      case 'approve':
        this.addPending(agentId, senderId);
        return {
          allowed: false,
          pairingType: 'approve',
          reason: 'Awaiting manual approval',
        };

      case 'off':
      default:
        return {
          allowed: false,
          reason: 'Access denied',
        };
    }
  }

  tryCode(
    agentId: string,
    senderId: string,
    code: string,
    config: AgentAccessConfig,
  ): boolean {
    const expected = config.pairing?.code;
    if (!expected || code !== expected) return false;
    this.approve(agentId, senderId);
    return true;
  }

  approveManually(agentId: string, senderId: string): boolean {
    const pending = this.data.pending[agentId];
    if (!pending || !pending.includes(senderId)) return false;
    this.approve(agentId, senderId);
    return true;
  }

  forceApprove(agentId: string, senderId: string): void {
    this.approve(agentId, senderId);
  }

  revoke(agentId: string, senderId: string): boolean {
    const list = this.data.approved[agentId];
    if (!list) return false;
    const idx = list.indexOf(senderId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    this.save();
    return true;
  }

  listPending(agentId: string): string[] {
    return this.data.pending[agentId] ?? [];
  }

  listApproved(agentId: string): string[] {
    return this.data.approved[agentId] ?? [];
  }
}
