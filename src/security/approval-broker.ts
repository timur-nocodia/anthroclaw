import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

interface PendingApproval {
  resolve: (v: PermissionResult) => void;
  timeout: NodeJS.Timeout;
}

export class ApprovalBroker {
  private pending = new Map<string, PendingApproval>();

  request(id: string, timeoutMs: number): Promise<PermissionResult> {
    return new Promise<PermissionResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve({ behavior: 'deny', message: 'User did not respond within timeout' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timeout });
    });
  }

  resolve(id: string, decision: 'allow' | 'deny'): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timeout);
    this.pending.delete(id);
    if (decision === 'allow') {
      entry.resolve({ behavior: 'allow', updatedInput: {} });
    } else {
      entry.resolve({ behavior: 'deny', message: 'User declined the request' });
    }
  }
}
