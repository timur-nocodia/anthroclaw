import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

interface PendingApproval {
  resolve: (v: PermissionResult) => void;
  timeout: NodeJS.Timeout;
  expectedSenderId: string;
  originalInput: Record<string, unknown>;
}

export class ApprovalBroker {
  private pending = new Map<string, PendingApproval>();

  request(
    id: string,
    timeoutMs: number,
    expectedSenderId: string,
    originalInput: Record<string, unknown> = {},
  ): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve({ behavior: 'deny', message: 'User did not respond within timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timeout, expectedSenderId, originalInput });
    });
  }

  /**
   * Resolve a pending approval only if senderId matches the expected sender.
   * Returns false if the request is not found or the sender doesn't match.
   * Returns true if the request was found and resolved (with the given decision).
   */
  resolveBySender(id: string, senderId: string, decision: 'allow' | 'deny'): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    if (entry.expectedSenderId !== senderId) return false;
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    if (decision === 'allow') {
      entry.resolve({ behavior: 'allow', updatedInput: entry.originalInput });
    } else {
      entry.resolve({ behavior: 'deny', message: 'User declined the request' });
    }
    return true;
  }

  /**
   * @deprecated Use resolveBySender() for authenticated resolution.
   * Kept for backward compatibility — resolves regardless of sender.
   */
  resolve(id: string, decision: 'allow' | 'deny'): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    if (decision === 'allow') {
      entry.resolve({ behavior: 'allow', updatedInput: entry.originalInput });
    } else {
      entry.resolve({ behavior: 'deny', message: 'User declined the request' });
    }
  }
}
