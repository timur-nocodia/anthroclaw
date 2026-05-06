import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LearningDecisionRow, type LearningDecisionRecord } from "@/components/learning/LearningDecisionRow";

describe("LearningDecisionRow", () => {
  it("renders decision delivery attempts and audit timeline", () => {
    render(
      <LearningDecisionRow
        decision={decisionFixture()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onApply={vi.fn()}
        onResend={vi.fn()}
      />,
    );

    expect(screen.getByText("Create publishing skill")).toBeInTheDocument();
    expect(screen.getByText(/sent telegram\/main\/48705953/)).toBeInTheDocument();
    expect(screen.getByText(/message tg-msg-1/)).toBeInTheDocument();
    expect(screen.getByText(/failed whatsapp\/main\/15551212/)).toBeInTheDocument();
    expect(screen.getByText(/timeout/)).toBeInTheDocument();
    expect(screen.getByText(/created -> pending/)).toBeInTheDocument();
    expect(screen.getByText(/pending -> approved/)).toBeInTheDocument();
    expect(screen.getByText(/admin_approved/)).toBeInTheDocument();
    expect(screen.getByText(/operator-1/)).toBeInTheDocument();
  });

  it("lets operators notify a pending decision again", () => {
    const onResend = vi.fn();
    render(
      <LearningDecisionRow
        decision={{ ...decisionFixture(), status: "pending", decidedAt: undefined, decidedBy: undefined }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onApply={vi.fn()}
        onResend={onResend}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /notify again/i }));

    expect(onResend).toHaveBeenCalledOnce();
  });
});

function decisionFixture(): LearningDecisionRecord {
  return {
    id: "decision-1",
    shortCode: "ABC123",
    kind: "learning_skill",
    scope: "agent",
    actor: "admin",
    status: "approved",
    agentId: "agent-a",
    learningActionId: "action-1",
    reviewId: "review-1",
    subject: "Create publishing skill",
    body: "Reusable workflow.",
    risk: "medium",
    payload: {},
    delivery: [
      {
        id: "delivery-1",
        decisionId: "decision-1",
        channel: "telegram",
        accountId: "main",
        peerId: "48705953",
        messageId: "tg-msg-1",
        status: "sent",
        createdAt: 2100,
        updatedAt: 2100,
      },
      {
        id: "delivery-2",
        decisionId: "decision-1",
        channel: "whatsapp",
        accountId: "main",
        peerId: "15551212",
        status: "failed",
        error: "timeout",
        createdAt: 2150,
        updatedAt: 2150,
      },
    ],
    auditEvents: [
      {
        id: "audit-1",
        decisionId: "decision-1",
        toStatus: "pending",
        reason: "created",
        createdAt: 2000,
        metadata: {},
      },
      {
        id: "audit-2",
        decisionId: "decision-1",
        fromStatus: "pending",
        toStatus: "approved",
        actorSenderId: "operator-1",
        channel: "telegram",
        reason: "admin_approved",
        createdAt: 2200,
        metadata: {},
      },
    ],
    createdAt: 2000,
    updatedAt: 2200,
    decidedAt: 2200,
    decidedBy: "admin",
  };
}
