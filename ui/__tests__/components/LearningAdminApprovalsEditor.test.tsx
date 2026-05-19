import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { LearningAdminApprovalsEditor, type LearningAdminApprovalsConfig } from "@/components/learning/LearningAdminApprovalsEditor";

describe("LearningAdminApprovalsEditor", () => {
  it("edits admin routes, sender allowlists, and notified decision kinds", () => {
    const onChange = vi.fn();
    render(
      <EditorHarness
        onChange={onChange}
        initial={{
          notify: true,
          routes: [
            { channel: "telegram", account_id: "main", peer_id: "123456789", thread_id: "10" },
          ],
          senders: {
            telegram: {
              main: ["123456789", "111"],
            },
          },
          notify_admin_for: ["learning_skill"],
        }}
      />,
    );

    expect(screen.getByText("Admin approval delivery")).toBeInTheDocument();
    expect(screen.getByLabelText("Peer id")).toHaveValue("123456789");
    expect(screen.getByLabelText("Sender ids")).toHaveValue("123456789, 111");

    fireEvent.change(screen.getByLabelText("Peer id"), { target: { value: "999" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      routes: [expect.objectContaining({ peer_id: "999" })],
    }));

    fireEvent.click(screen.getByRole("button", { name: /add route/i }));
    expect(screen.getAllByLabelText("Peer id")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /add sender/i }));
    expect(screen.getAllByLabelText("Sender ids")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Curator actions"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      notify_admin_for: ["learning_skill", "curator_action"],
    }));
  });
});

function EditorHarness({
  initial,
  onChange,
}: {
  initial: LearningAdminApprovalsConfig;
  onChange: (value: LearningAdminApprovalsConfig) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <LearningAdminApprovalsEditor
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}
