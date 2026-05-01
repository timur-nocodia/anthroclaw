import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { Section } from "@/components/ui/section";

describe("Section component (Per-chat customization rename + collapse)", () => {
  it("renders the new 'Per-chat customization' title", () => {
    render(
      <Section title="Per-chat customization (optional)">
        <div>inner content</div>
      </Section>,
    );
    expect(screen.getByText(/Per-chat customization/i)).toBeInTheDocument();
  });

  it("does NOT render the legacy 'Channel behavior' title", () => {
    render(
      <Section title="Per-chat customization (optional)">
        <div>inner content</div>
      </Section>,
    );
    expect(screen.queryByText(/^Channel behavior$/i)).toBeNull();
  });

  it("starts collapsed when defaultCollapsed is true (children not visible)", () => {
    render(
      <Section title="Per-chat customization (optional)" defaultCollapsed>
        <div data-testid="section-body">inner content</div>
      </Section>,
    );
    expect(screen.queryByTestId("section-body")).toBeNull();
  });

  it("renders children when defaultCollapsed is not set", () => {
    render(
      <Section title="Always expanded">
        <div data-testid="section-body">inner content</div>
      </Section>,
    );
    expect(screen.getByTestId("section-body")).toBeInTheDocument();
  });

  it("expands when the header is clicked (collapsible mode)", () => {
    render(
      <Section title="Per-chat customization (optional)" defaultCollapsed>
        <div data-testid="section-body">inner content</div>
      </Section>,
    );
    expect(screen.queryByTestId("section-body")).toBeNull();
    const header = screen.getByRole("button", { name: /Per-chat customization/i });
    fireEvent.click(header);
    expect(screen.getByTestId("section-body")).toBeInTheDocument();
  });

  it("toggles back to collapsed when clicked again", () => {
    render(
      <Section title="Per-chat customization (optional)" defaultCollapsed>
        <div data-testid="section-body">inner content</div>
      </Section>,
    );
    const header = screen.getByRole("button", { name: /Per-chat customization/i });
    fireEvent.click(header);
    expect(screen.getByTestId("section-body")).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByTestId("section-body")).toBeNull();
  });

  it("does not make header clickable when defaultCollapsed is undefined", () => {
    render(
      <Section title="Always expanded">
        <div data-testid="section-body">inner content</div>
      </Section>,
    );
    expect(screen.queryByRole("button", { name: /Always expanded/i })).toBeNull();
    expect(screen.getByTestId("section-body")).toBeInTheDocument();
  });
});
