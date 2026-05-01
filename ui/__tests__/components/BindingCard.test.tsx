import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { BindingCard } from "@/components/binding/BindingCard";
import type { BindingRouteInput } from "@/components/binding/binding-language";

const sampleRoute: BindingRouteInput = {
  channel: "telegram",
  account: "content_sm",
  scope: "group",
  peers: ["-1003729315809"],
  topics: ["3"],
  mention_only: true,
};

describe("BindingCard", () => {
  it("renders title and description lines from describeBinding", () => {
    render(
      <BindingCard
        route={sampleRoute}
        context={{
          telegramAccounts: { content_sm: { username: "clowwy_bot" } },
        }}
      />,
    );
    expect(
      screen.getByText("Telegram (clowwy_bot · content_sm)"),
    ).toBeInTheDocument();
    expect(screen.getByText("In group: -1003729315809")).toBeInTheDocument();
    expect(screen.getByText("In topic: 3")).toBeInTheDocument();
    expect(
      screen.getByText("Behavior: Responds only when @-mentioned"),
    ).toBeInTheDocument();
  });

  it("Edit button calls onEdit with the route", () => {
    const onEdit = vi.fn();
    render(<BindingCard route={sampleRoute} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId("binding-card-edit"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(sampleRoute);
  });

  it("Remove button shows confirm dialog before calling onRemove", () => {
    const onRemove = vi.fn();
    render(<BindingCard route={sampleRoute} onRemove={onRemove} />);

    fireEvent.click(screen.getByTestId("binding-card-remove"));
    expect(screen.getByText(/Remove this binding/i)).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("binding-card-remove-confirm"));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(sampleRoute);
  });

  it("Cancel on confirm dialog does not call onRemove", () => {
    const onRemove = vi.fn();
    render(<BindingCard route={sampleRoute} onRemove={onRemove} />);

    fireEvent.click(screen.getByTestId("binding-card-remove"));
    fireEvent.click(screen.getByTestId("binding-card-remove-cancel"));
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("Test button calls onTest with the route", () => {
    const onTest = vi.fn();
    render(<BindingCard route={sampleRoute} onTest={onTest} />);
    fireEvent.click(screen.getByTestId("binding-card-test"));
    expect(onTest).toHaveBeenCalledTimes(1);
    expect(onTest).toHaveBeenCalledWith(sampleRoute);
  });

  it("hides the Test button when onTest is not provided", () => {
    render(<BindingCard route={sampleRoute} onEdit={vi.fn()} />);
    expect(screen.queryByTestId("binding-card-test")).not.toBeInTheDocument();
  });

  it("hides the Edit button when onEdit is not provided", () => {
    render(<BindingCard route={sampleRoute} onRemove={vi.fn()} />);
    expect(screen.queryByTestId("binding-card-edit")).not.toBeInTheDocument();
  });
});
