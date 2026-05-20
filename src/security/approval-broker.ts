import type { PermissionResult } from '@anthroclaw/legacy-claude-agent-sdk';
import { ApprovalStore, type ApprovalDecision } from './approval-store.js';

interface PendingApproval {
  resolve: (v: PermissionResult) => void;
  timeout: NodeJS.Timeout;
}

export class ApprovalBroker {
  private pending = new Map<string, PendingApproval>();

  constructor(private readonly store = new ApprovalStore()) {}

  request(
    id: string,
    timeoutMs: number,
    expectedSenderId: string,
    originalInput: Record<string, unknown> = {},
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const now = Date.now();
      this.store.expireDue(now);
      this.store.create({
        id,
        status: 'pending',
        expectedSenderId,
        originalInput,
        createdAt: now,
        expiresAt: now + timeoutMs,
        resolvedAt: null,
        resolvedBy: null,
        decision: null,
      });
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        this.store.expireDue(Date.now());
        resolve({ behavior: 'deny', message: 'User did not respond within timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timeout });
    });
  }

  /**
   * Resolve a pending approval only if senderId matches the expected sender.
   * Returns false if the request is not found or the sender doesn't match.
   * Returns true if the request was found and resolved (with the given decision).
   */
  resolveBySender(id: string, senderId: string, decision: 'allow' | 'deny'): boolean {
    this.store.expireDue(Date.now());
    const record = this.store.get(id);
    if (!record || record.status !== 'pending') return false;
    if (record.expectedSenderId !== senderId) return false;
    const updated = this.store.resolve(id, decision, senderId);
    if (!updated) return false;
    const entry = this.pending.get(id);
    if (entry) {
      clearTimeout(entry.timeout);
      this.resolvePending(id, decision, updated.originalInput, entry);
    }
    return true;
  }

  listPending() {
    return this.store.listPending();
  }

  get(id: string) {
    return this.store.get(id);
  }

  private resolvePending(
    id: string,
    decision: ApprovalDecision,
    originalInput: Record<string, unknown>,
    entry: PendingApproval,
  ): void {
    this.pending.delete(id);
    if (decision === 'allow') {
      entry.resolve({ behavior: 'allow', updatedInput: originalInput });
    } else {
      entry.resolve({ behavior: 'deny', message: 'User declined the request' });
    }
  }

  /**
   * @deprecated Use resolveBySender() for authenticated resolution.
   * Kept for backward compatibility — resolves regardless of sender.
   */
  resolve(id: string, decision: 'allow' | 'deny'): void {
    const record = this.store.get(id);
    if (!record || record.status !== 'pending') return;
    const updated = this.store.resolve(id, decision, record.expectedSenderId);
    if (!updated) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.resolvePending(id, decision, updated.originalInput, entry);
  }
}
