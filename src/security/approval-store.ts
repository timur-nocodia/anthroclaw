import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired';
export type ApprovalDecision = 'allow' | 'deny';

export interface ApprovalRecord {
  id: string;
  status: ApprovalStatus;
  expectedSenderId: string;
  originalInput: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  decision: ApprovalDecision | null;
}

export class ApprovalStore {
  private records = new Map<string, ApprovalRecord>();

  constructor(private readonly filePath?: string) {
    this.load();
  }

  create(record: ApprovalRecord): ApprovalRecord {
    this.records.set(record.id, { ...record });
    this.save();
    return { ...record };
  }

  get(id: string): ApprovalRecord | null {
    const record = this.records.get(id);
    return record ? { ...record, originalInput: { ...record.originalInput } } : null;
  }

  listPending(now = Date.now()): ApprovalRecord[] {
    this.expireDue(now);
    return [...this.records.values()]
      .filter((record) => record.status === 'pending')
      .map((record) => ({ ...record, originalInput: { ...record.originalInput } }));
  }

  resolve(id: string, decision: ApprovalDecision, resolvedBy: string, now = Date.now()): ApprovalRecord | null {
    const record = this.records.get(id);
    if (!record || record.status !== 'pending') return null;
    const updated: ApprovalRecord = {
      ...record,
      status: decision === 'allow' ? 'allowed' : 'denied',
      resolvedAt: now,
      resolvedBy,
      decision,
    };
    this.records.set(id, updated);
    this.save();
    return { ...updated, originalInput: { ...updated.originalInput } };
  }

  expireDue(now = Date.now()): ApprovalRecord[] {
    const expired: ApprovalRecord[] = [];
    let changed = false;
    for (const record of this.records.values()) {
      if (record.status !== 'pending' || record.expiresAt > now) continue;
      const updated: ApprovalRecord = {
        ...record,
        status: 'expired',
        resolvedAt: now,
        resolvedBy: null,
        decision: null,
      };
      this.records.set(record.id, updated);
      expired.push({ ...updated, originalInput: { ...updated.originalInput } });
      changed = true;
    }
    if (changed) this.save();
    return expired;
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf-8'));
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        const record = normalizeApprovalRecord(item);
        if (record) this.records.set(record.id, record);
      }
    } catch {
      this.records.clear();
    }
  }

  private save(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const records = [...this.records.values()].sort((a, b) => a.createdAt - b.createdAt);
    const tmp = `${this.filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(records, null, 2), 'utf-8');
    renameSync(tmp, this.filePath);
  }
}

function normalizeApprovalRecord(raw: unknown): ApprovalRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = stringValue(source.id);
  const expectedSenderId = stringValue(source.expectedSenderId);
  const createdAt = numberValue(source.createdAt);
  const expiresAt = numberValue(source.expiresAt);
  if (!id || !expectedSenderId || createdAt === null || expiresAt === null) return null;
  const status = approvalStatus(source.status);
  const originalInput = recordValue(source.originalInput);
  return {
    id,
    status,
    expectedSenderId,
    originalInput,
    createdAt,
    expiresAt,
    resolvedAt: numberValue(source.resolvedAt),
    resolvedBy: stringValue(source.resolvedBy) ?? null,
    decision: approvalDecision(source.decision),
  };
}

function approvalStatus(value: unknown): ApprovalStatus {
  return value === 'allowed' || value === 'denied' || value === 'expired' ? value : 'pending';
}

function approvalDecision(value: unknown): ApprovalDecision | null {
  return value === 'allow' || value === 'deny' ? value : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
