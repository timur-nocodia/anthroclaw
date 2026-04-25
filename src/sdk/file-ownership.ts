import { normalize } from 'node:path';

export type FileOwnershipMode = 'read' | 'write';
export type FileOwnershipConflictMode = 'soft' | 'strict';

export interface FileOwnershipClaim {
  claimId: string;
  sessionKey: string;
  runId: string;
  subagentId: string;
  path: string;
  mode: FileOwnershipMode;
  claimedAt: number;
  expiresAt: number;
}

export interface FileOwnershipConflict {
  conflictId: string;
  sessionKey: string;
  path: string;
  requested: FileOwnershipClaim;
  existing: FileOwnershipClaim;
  action: 'allow' | 'deny';
  reason: string;
  createdAt: number;
}

export interface FileOwnershipClaimRequest {
  sessionKey: string;
  runId: string;
  subagentId: string;
  path: string;
  mode: FileOwnershipMode;
  ttlMs?: number;
}

export interface FileOwnershipDecision {
  allowed: boolean;
  claim?: FileOwnershipClaim;
  conflicts: FileOwnershipConflict[];
}

const DEFAULT_CLAIM_TTL_MS = 30 * 60 * 1000;

export class FileOwnershipRegistry {
  private claims = new Map<string, FileOwnershipClaim>();
  private conflicts = new Map<string, FileOwnershipConflict>();

  claim(
    request: FileOwnershipClaimRequest,
    conflictMode: FileOwnershipConflictMode = 'soft',
    now = Date.now(),
  ): FileOwnershipDecision {
    this.purgeExpired(now);

    const requested = this.createClaim(request, now);
    const conflicts = this.findConflicts(requested)
      .map((existing) => this.createConflict(requested, existing, conflictMode, now));

    for (const conflict of conflicts) {
      this.conflicts.set(conflict.conflictId, conflict);
    }

    if (conflictMode === 'strict' && conflicts.length > 0) {
      return { allowed: false, conflicts };
    }

    this.replaceExistingOwnerClaim(requested);
    this.claims.set(requested.claimId, requested);
    return { allowed: true, claim: { ...requested }, conflicts };
  }

  listClaims(params: {
    sessionKey?: string;
    runId?: string;
    subagentId?: string;
    path?: string;
  } = {}, now = Date.now()): FileOwnershipClaim[] {
    this.purgeExpired(now);
    const path = params.path ? normalizeClaimPath(params.path) : undefined;
    return [...this.claims.values()]
      .filter((claim) => {
        if (params.sessionKey && claim.sessionKey !== params.sessionKey) return false;
        if (params.runId && claim.runId !== params.runId) return false;
        if (params.subagentId && claim.subagentId !== params.subagentId) return false;
        if (path && claim.path !== path) return false;
        return true;
      })
      .map((claim) => ({ ...claim }))
      .sort((a, b) => a.claimedAt - b.claimedAt || a.claimId.localeCompare(b.claimId));
  }

  listConflicts(params: {
    sessionKey?: string;
    runId?: string;
    subagentId?: string;
    path?: string;
    action?: FileOwnershipConflict['action'];
  } = {}): FileOwnershipConflict[] {
    const path = params.path ? normalizeClaimPath(params.path) : undefined;
    return [...this.conflicts.values()]
      .filter((conflict) => {
        if (params.sessionKey && conflict.sessionKey !== params.sessionKey) return false;
        if (params.runId && conflict.requested.runId !== params.runId && conflict.existing.runId !== params.runId) return false;
        if (params.subagentId && conflict.requested.subagentId !== params.subagentId && conflict.existing.subagentId !== params.subagentId) return false;
        if (path && conflict.path !== path) return false;
        if (params.action && conflict.action !== params.action) return false;
        return true;
      })
      .map((conflict) => cloneConflict(conflict))
      .sort((a, b) => a.createdAt - b.createdAt || a.conflictId.localeCompare(b.conflictId));
  }

  releaseClaim(claimId: string): boolean {
    return this.claims.delete(claimId);
  }

  releaseRun(runId: string): number {
    return this.deleteClaims((claim) => claim.runId === runId);
  }

  releaseSession(sessionKey: string): number {
    return this.deleteClaims((claim) => claim.sessionKey === sessionKey);
  }

  overrideClaim(claimId: string): boolean {
    return this.releaseClaim(claimId);
  }

  clear(): void {
    this.claims.clear();
    this.conflicts.clear();
  }

  private createClaim(request: FileOwnershipClaimRequest, now: number): FileOwnershipClaim {
    const path = normalizeClaimPath(request.path);
    return {
      claimId: `${request.sessionKey}:${request.runId}:${request.subagentId}:${path}:${request.mode}`,
      sessionKey: request.sessionKey,
      runId: request.runId,
      subagentId: request.subagentId,
      path,
      mode: request.mode,
      claimedAt: now,
      expiresAt: now + (request.ttlMs ?? DEFAULT_CLAIM_TTL_MS),
    };
  }

  private findConflicts(requested: FileOwnershipClaim): FileOwnershipClaim[] {
    return [...this.claims.values()].filter((existing) => {
      if (existing.sessionKey !== requested.sessionKey) return false;
      if (existing.path !== requested.path) return false;
      if (existing.runId === requested.runId && existing.subagentId === requested.subagentId) return false;
      return existing.mode === 'write' || requested.mode === 'write';
    });
  }

  private createConflict(
    requested: FileOwnershipClaim,
    existing: FileOwnershipClaim,
    conflictMode: FileOwnershipConflictMode,
    now: number,
  ): FileOwnershipConflict {
    const action = conflictMode === 'strict' ? 'deny' : 'allow';
    return {
      conflictId: `${requested.claimId}:conflicts:${existing.claimId}:${now}`,
      sessionKey: requested.sessionKey,
      path: requested.path,
      requested: { ...requested },
      existing: { ...existing },
      action,
      reason: action === 'deny'
        ? 'strict file ownership blocks conflicting subagent write'
        : 'soft file ownership records conflict and allows the claim',
      createdAt: now,
    };
  }

  private replaceExistingOwnerClaim(next: FileOwnershipClaim): void {
    for (const claim of this.claims.values()) {
      if (
        claim.sessionKey === next.sessionKey
        && claim.runId === next.runId
        && claim.subagentId === next.subagentId
        && claim.path === next.path
        && claim.mode === next.mode
      ) {
        this.claims.delete(claim.claimId);
      }
    }
  }

  private purgeExpired(now: number): void {
    this.deleteClaims((claim) => claim.expiresAt <= now);
  }

  private deleteClaims(predicate: (claim: FileOwnershipClaim) => boolean): number {
    let count = 0;
    for (const claim of this.claims.values()) {
      if (predicate(claim)) {
        this.claims.delete(claim.claimId);
        count += 1;
      }
    }
    return count;
  }
}

function normalizeClaimPath(path: string): string {
  return normalize(path).replaceAll('\\', '/');
}

function cloneConflict(conflict: FileOwnershipConflict): FileOwnershipConflict {
  return {
    ...conflict,
    requested: { ...conflict.requested },
    existing: { ...conflict.existing },
  };
}
