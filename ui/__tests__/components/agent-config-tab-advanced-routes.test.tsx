import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { Section } from "@/components/ui/section";

describe("Advanced (raw routes table) section", () => {
  it("renders 'Advanced (raw routes table)' title collapsed by default", () => {
    render(
      <Section title="Advanced (raw routes table)" defaultCollapsed>
        <div data-testid="raw-routes-body">flat-row routes editor</div>
      </Section>,
    );
    expect(
      screen.getByText(/Advanced \(raw routes table\)/i),
    ).toBeInTheDocument();
    // Body should not render until expanded.
    expect(screen.queryByTestId("raw-routes-body")).toBeNull();
  });

  it("expands to reveal the flat-row routes editor when clicked", () => {
    render(
      <Section title="Advanced (raw routes table)" defaultCollapsed>
        <div data-testid="raw-routes-body">flat-row routes editor</div>
      </Section>,
    );
    const header = screen.getByRole("button", {
      name: /Advanced \(raw routes table\)/i,
    });
    fireEvent.click(header);
    expect(screen.getByTestId("raw-routes-body")).toBeInTheDocument();
    expect(
      screen.getByText(/flat-row routes editor/i),
    ).toBeInTheDocument();
  });

  it("collapses again on second click (regression: editor still mountable)", () => {
    render(
      <Section title="Advanced (raw routes table)" defaultCollapsed>
        <div data-testid="raw-routes-body">flat-row routes editor</div>
      </Section>,
    );
    const header = screen.getByRole("button", {
      name: /Advanced \(raw routes table\)/i,
    });
    fireEvent.click(header);
    expect(screen.getByTestId("raw-routes-body")).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByTestId("raw-routes-body")).toBeNull();
  });
});
