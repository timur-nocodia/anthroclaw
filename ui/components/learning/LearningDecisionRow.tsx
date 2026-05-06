"use client";

import type React from "react";
import { CheckCircle2, Clock, Send, XCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LearningDecisionKind } from "@/components/learning/LearningAdminApprovalsEditor";

export type LearningDecisionStatus = "pending" | "approved" | "rejected" | "edit_requested" | "expired" | "applied" | "failed";

export interface LearningDecisionDelivery {
  id?: string;
  decisionId?: string;
  channel: string;
  accountId?: string;
  peerId?: string;
  messageId?: string;
  status: "queued" | "sent" | "failed" | string;
  error?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface LearningDecisionAuditEvent {
  id: string;
  decisionId: string;
  fromStatus?: LearningDecisionStatus;
  toStatus: LearningDecisionStatus;
  actorSenderId?: string;
  channel?: string;
  reason?: string;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface LearningDecisionRecord {
  id: string;
  shortCode: string;
  kind: LearningDecisionKind;
  scope: "user" | "agent" | "system";
  actor: "originating_user" | "admin" | "operator";
  status: LearningDecisionStatus;
  agentId: string;
  learningActionId?: string;
  reviewId?: string;
  subject: string;
  body: string;
  risk: "low" | "medium" | "high";
  payload: Record<string, unknown>;
  originChannel?: string;
  originAccountId?: string;
  originPeerId?: string;
  originSenderId?: string;
  originThreadId?: string;
  delivery?: LearningDecisionDelivery[];
  auditEvents?: LearningDecisionAuditEvent[];
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
  decidedBy?: string;
  appliedAt?: number;
  error?: string;
}

export function LearningDecisionRow({
  decision,
  onApprove,
  onReject,
  onApply,
  onResend,
}: {
  decision: LearningDecisionRecord;
  onApprove: () => void;
  onReject: () => void;
  onApply: () => void;
  onResend?: () => void;
}) {
  const deliveries = decision.delivery ?? [];
  const auditEvents = decision.auditEvents ?? [];

  return (
    <div className="border-b px-3.5 py-3 last:border-b-0" style={{ borderColor: "var(--oc-border)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[12.5px] font-medium" style={{ color: "var(--color-foreground)" }}>{decision.subject || learningDecisionKindLabel(decision.kind)}</span>
            <span className="rounded px-1.5 py-px text-[10px]" style={learningDecisionStatusStyle(decision.status)}>{decision.status}</span>
            <span className="rounded px-1.5 py-px text-[10px]" style={{ background: "var(--oc-bg3)", color: "var(--oc-text-muted)" }}>{learningDecisionKindLabel(decision.kind)}</span>
            <span className="rounded px-1.5 py-px text-[10px]" style={{ background: "var(--oc-bg3)", color: "var(--oc-text-muted)" }}>{decision.actor}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
            <span>{decision.shortCode}</span>
            <span>{shortRuntimeId(decision.id, 10)}</span>
            {decision.learningActionId && <span>action {shortRuntimeId(decision.learningActionId, 10)}</span>}
            <span>{formatRuntimeTime(decision.createdAt)}</span>
            {decision.decidedBy && <span>by {decision.decidedBy}</span>}
          </div>
          {decision.body && (
            <div className="mt-1 truncate text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
              {decision.body}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" onClick={onApprove} disabled={decision.status !== "pending"}><CheckCircle2 className="h-3.5 w-3.5" />Approve</Button>
          <Button variant="outline" size="sm" onClick={onReject} disabled={decision.status !== "pending"}><XCircle className="h-3.5 w-3.5" />Reject</Button>
          <Button variant="outline" size="sm" onClick={onApply} disabled={decision.status !== "approved"}><Zap className="h-3.5 w-3.5" />Apply</Button>
          {onResend && (
            <Button variant="outline" size="sm" onClick={onResend} disabled={decision.status !== "pending"}>
              <Send className="h-3.5 w-3.5" />
              Notify again
            </Button>
          )}
        </div>
      </div>

      {(deliveries.length > 0 || auditEvents.length > 0) && (
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          {deliveries.length > 0 && (
            <div className="rounded-[5px] border px-2.5 py-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
                <Send className="h-3 w-3" />
                Delivery
              </div>
              <div className="space-y-1">
                {deliveries.map((delivery, index) => (
                  <div key={delivery.id ?? `${delivery.channel}:${delivery.peerId ?? ""}:${index}`} className="flex flex-wrap gap-x-2 gap-y-1 text-[10.5px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
                    <span style={{ color: delivery.status === "failed" ? "var(--oc-red)" : "var(--color-foreground)" }}>
                      {delivery.status} {formatDeliveryTarget(delivery)}
                    </span>
                    {delivery.messageId && <span>message {delivery.messageId}</span>}
                    {delivery.error && <span style={{ color: "var(--oc-red)" }}>{delivery.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {auditEvents.length > 0 && (
            <div className="rounded-[5px] border px-2.5 py-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
                <Clock className="h-3 w-3" />
                Audit
              </div>
              <div className="space-y-1">
                {auditEvents.map((event) => (
                  <div key={event.id} className="flex flex-wrap gap-x-2 gap-y-1 text-[10.5px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
                    <span style={{ color: "var(--color-foreground)" }}>{formatAuditTransition(event)}</span>
                    {event.reason && <span>{event.reason}</span>}
                    {event.actorSenderId && <span>{event.actorSenderId}</span>}
                    {event.channel && <span>via {event.channel}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function learningDecisionKindLabel(type: LearningDecisionKind): string {
  switch (type) {
    case "learning_memory":
      return "memory decision";
    case "learning_skill":
      return "skill decision";
    case "curator_action":
      return "curator";
    case "tool_approval":
      return "tool approval";
  }
}

function learningDecisionStatusStyle(status: LearningDecisionStatus): React.CSSProperties {
  if (status === "approved" || status === "applied") {
    return { background: "rgba(74,222,128,0.13)", border: "1px solid rgba(74,222,128,0.32)", color: "var(--oc-green)" };
  }
  if (status === "rejected" || status === "failed" || status === "expired") {
    return { background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.32)", color: "var(--oc-red)" };
  }
  if (status === "edit_requested") {
    return { background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.32)", color: "var(--oc-accent)" };
  }
  return { background: "rgba(250,204,21,0.12)", border: "1px solid rgba(250,204,21,0.32)", color: "var(--oc-yellow)" };
}

function shortRuntimeId(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(1, max - 3))}...`;
}

function formatRuntimeTime(value: number): string {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDeliveryTarget(delivery: LearningDecisionDelivery): string {
  return [
    delivery.channel,
    delivery.accountId,
    delivery.peerId,
  ].filter(Boolean).join("/");
}

function formatAuditTransition(event: LearningDecisionAuditEvent): string {
  return `${event.fromStatus ?? "created"} -> ${event.toStatus}`;
}
