import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import {
  LearningDecisionFilters,
  type LearningDecisionFilterValue,
} from "@/components/learning/LearningDecisionFilters";

describe("LearningDecisionFilters", () => {
  it("edits status, kind, and actor filters", () => {
    const onChange = vi.fn();
    render(
      <LearningDecisionFilters
        value={{ status: "pending", kind: "learning_skill", actor: "admin" }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("Decision status"), { target: { value: "approved" } });
    expect(onChange).toHaveBeenLastCalledWith({
      status: "approved",
      kind: "learning_skill",
      actor: "admin",
    } satisfies LearningDecisionFilterValue);

    fireEvent.change(screen.getByLabelText("Decision kind"), { target: { value: "learning_memory" } });
    expect(onChange).toHaveBeenLastCalledWith({
      status: "pending",
      kind: "learning_memory",
      actor: "admin",
    } satisfies LearningDecisionFilterValue);

    fireEvent.change(screen.getByLabelText("Decision actor"), { target: { value: "originating_user" } });
    expect(onChange).toHaveBeenLastCalledWith({
      status: "pending",
      kind: "learning_skill",
      actor: "originating_user",
    } satisfies LearningDecisionFilterValue);
  });
});
