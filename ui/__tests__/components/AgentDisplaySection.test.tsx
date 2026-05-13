import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentDisplaySection } from "@/components/AgentDisplaySection";

describe("AgentDisplaySection — resolved-default hint", () => {
  it("shows 'Resolved: off' when safetyProfile=public and toolProgress is unset", () => {
    render(
      <AgentDisplaySection display={undefined} safetyProfile="public" onChange={vi.fn()} />,
    );
    const hint = screen.getByText(/Resolved:/i);
    expect(hint.textContent).toMatch(/off/);
    expect(hint.textContent).toMatch(/public/);
  });

  it("shows 'Resolved: new' when safetyProfile=trusted and toolProgress is unset", () => {
    render(
      <AgentDisplaySection display={undefined} safetyProfile="trusted" onChange={vi.fn()} />,
    );
    const hint = screen.getByText(/Resolved:/i);
    expect(hint.textContent).toMatch(/new/);
  });

  it("shows 'Resolved: new' for private and chat_like_openclaw", () => {
    const { rerender } = render(
      <AgentDisplaySection display={undefined} safetyProfile="private" onChange={vi.fn()} />,
    );
    expect(screen.getByText(/Resolved:/i).textContent).toMatch(/new/);

    rerender(
      <AgentDisplaySection display={undefined} safetyProfile="chat_like_openclaw" onChange={vi.fn()} />,
    );
    expect(screen.getByText(/Resolved:/i).textContent).toMatch(/new/);
  });

  it("hides the hint when toolProgress is explicitly set", () => {
    render(
      <AgentDisplaySection
        display={{ toolProgress: "all" }}
        safetyProfile="public"
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Resolved:/i)).toBeNull();
  });
});

describe("AgentDisplaySection — form behavior", () => {
  it("selecting 'auto' clears toolProgress in the payload", () => {
    const onChange = vi.fn();
    render(
      <AgentDisplaySection
        display={{ toolProgress: "all" }}
        safetyProfile="trusted"
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText(/Tool progress/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "auto" } });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)![0];
    expect(lastCall.toolProgress).toBeUndefined();
  });

  it("changing subagentTools propagates to onChange", () => {
    const onChange = vi.fn();
    render(
      <AgentDisplaySection display={undefined} safetyProfile="trusted" onChange={onChange} />,
    );
    const select = screen.getByLabelText(/Subagent tools/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "all" } });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].subagentTools).toBe("all");
  });

  it("toolPreviewLength input accepts numbers and sends as a number", () => {
    const onChange = vi.fn();
    render(
      <AgentDisplaySection display={undefined} safetyProfile="trusted" onChange={onChange} />,
    );
    const input = screen.getByLabelText(/Tool preview length/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "20" } });
    expect(onChange.mock.calls.at(-1)![0].toolPreviewLength).toBe(20);
  });

  it("toolPreviewLength input clearing yields undefined", () => {
    const onChange = vi.fn();
    render(
      <AgentDisplaySection
        display={{ toolPreviewLength: 50 }}
        safetyProfile="trusted"
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText(/Tool preview length/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(onChange.mock.calls.at(-1)![0].toolPreviewLength).toBeUndefined();
  });
});
