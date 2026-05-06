import { parseBareDecisionReply, parseDecisionTextCommand } from './events.js';
import { DecisionStore } from './store.js';
import type {
  DecisionEvent,
  DecisionRecord,
  DecisionResolution,
  DecisionStatus,
} from './types.js';

export interface DecisionCenterPolicy {
  isAdminEvent?: (decision: DecisionRecord, event: DecisionEvent) => boolean;
}

export class DecisionCenter {
  private store: DecisionStore;
  private policy: DecisionCenterPolicy;

  constructor(params: { store: DecisionStore } & DecisionCenterPolicy) {
    this.store = params.store;
    this.policy = {
      isAdminEvent: params.isAdminEvent,
    };
  }

  resolveEvent(event: DecisionEvent): DecisionResolution {
    const decision = event.decisionId
      ? this.store.getDecision(event.decisionId)
      : event.shortCode
        ? this.store.getDecisionByShortCode(event.shortCode)
        : null;
    if (!decision) return { handled: false, reason: 'not_found' };

    const expired = expireIfNeeded(this.store, decision);
    if (expired) {
      return { handled: true, status: 'expired', reason: 'expired', decision: expired };
    }

    if (decision.status !== 'pending') {
      return {
        handled: true,
        status: decision.status,
        reason: 'already_decided',
        decision,
      };
    }

    if (!this.isAuthorized(decision, event)) {
      return {
        handled: true,
        status: decision.status,
        reason: 'unauthorized',
        decision,
      };
    }

    const nextStatus = selectedToStatus(event.selected);
    if (!nextStatus) {
      return {
        handled: true,
        status: decision.status,
        reason: 'unsupported_selection',
        decision,
      };
    }

    const updated = this.store.updateDecisionStatus(decision.id, nextStatus, {
      decidedBy: event.senderId,
      actorSenderId: event.senderId,
      channel: event.channel,
      reason: event.selected,
      metadata: {
        messageId: event.messageId,
        callbackQueryId: event.callbackQueryId,
        rawText: event.rawText,
      },
    });
    return {
      handled: true,
      status: updated?.status,
      decision: updated ?? decision,
    };
  }

  resolveTextReply(input: {
    rawText: string;
    channel: DecisionEvent['channel'];
    accountId: string;
    peerId: string;
    senderId: string;
    threadId?: string;
    messageId?: string;
  }): DecisionResolution {
    const command = parseDecisionTextCommand(input.rawText);
    if (command) {
      return this.resolveEvent({
        ...input,
        shortCode: command.shortCode,
        selected: command.selected,
      });
    }

    const selected = parseBareDecisionReply(input.rawText);
    if (!selected) return { handled: false, reason: 'not_decision_reply' };

    const matches = this.store.listPendingForOrigin({
      channel: input.channel,
      accountId: input.accountId,
      peerId: input.peerId,
      senderId: input.senderId,
      threadId: input.threadId,
      limit: 2,
    });
    if (matches.length === 0) return { handled: false, reason: 'not_found' };
    if (matches.length > 1) {
      return {
        handled: true,
        status: 'pending',
        reason: 'ambiguous',
      };
    }

    return this.resolveEvent({
      ...input,
      decisionId: matches[0].id,
      selected,
      rawText: input.rawText,
    });
  }

  private isAuthorized(decision: DecisionRecord, event: DecisionEvent): boolean {
    if (decision.actor === 'originating_user') {
      return isOriginatingUserAuthorized(decision, event);
    }
    if (decision.actor === 'admin') {
      return this.policy.isAdminEvent?.(decision, event) === true;
    }
    return false;
  }
}

function selectedToStatus(selected: DecisionEvent['selected']): DecisionStatus | null {
  switch (selected) {
    case 'approve':
      return 'approved';
    case 'reject':
      return 'rejected';
    case 'edit':
      return 'edit_requested';
    case 'undo':
      return null;
  }
}

function expireIfNeeded(store: DecisionStore, decision: DecisionRecord): DecisionRecord | null {
  if (decision.status !== 'pending') return null;
  if (!decision.expiresAt || decision.expiresAt > Date.now()) return null;
  return store.updateDecisionStatus(decision.id, 'expired', { reason: 'expired' });
}

function isOriginatingUserAuthorized(decision: DecisionRecord, event: DecisionEvent): boolean {
  if (decision.scope !== 'user') return false;
  if (decision.originChannel !== event.channel) return false;
  if (decision.originAccountId !== event.accountId) return false;
  if (decision.originPeerId !== event.peerId) return false;
  if (decision.originSenderId !== event.senderId) return false;
  if (decision.originThreadId && decision.originThreadId !== event.threadId) return false;
  return true;
}
