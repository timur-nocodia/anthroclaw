import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import {
  WhereAgentListensSection,
  type BindingRoute,
} from "@/components/binding/WhereAgentListensSection";

describe("WhereAgentListensSection", () => {
  it("renders the section title and binding count subtitle", () => {
    const routes: BindingRoute[] = [
      {
        channel: "telegram",
        account: "content_sm",
        scope: "group",
        peers: ["-1003729315809"],
        topics: ["3"],
        mentionOnly: true,
      },
      {
        channel: "whatsapp",
        account: "humanrobot",
        scope: "dm",
        peers: null,
        topics: null,
        mentionOnly: false,
      },
    ];

    render(<WhereAgentListensSection routes={routes} />);
    expect(screen.getByText(/Where this agent listens/i)).toBeInTheDocument();
    expect(screen.getByText(/2 bindings/i)).toBeInTheDocument();
  });

  it("renders one row per route", () => {
    const routes: BindingRoute[] = [
      { channel: "telegram", account: "main", scope: "dm" },
      { channel: "telegram", account: "main", scope: "group", peers: ["-100"] },
      { channel: "whatsapp", account: "x", scope: "any" },
    ];
    render(<WhereAgentListensSection routes={routes} />);
    expect(screen.getByTestId("binding-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("binding-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("binding-row-2")).toBeInTheDocument();
  });

  it("summarizes a Telegram group + topic + mention-only binding", () => {
    const routes: BindingRoute[] = [
      {
        channel: "telegram",
        account: "content_sm",
        scope: "group",
        peers: ["-1003729315809"],
        topics: ["3"],
        mentionOnly: true,
      },
    ];
    render(<WhereAgentListensSection routes={routes} />);
    const row = screen.getByTestId("binding-row-0");
    expect(row).toHaveTextContent("Telegram");
    expect(row).toHaveTextContent("content_sm");
    expect(row).toHaveTextContent("groups");
    expect(row).toHaveTextContent("-1003729315809");
    expect(row).toHaveTextContent("topic 3");
    expect(row).toHaveTextContent(/mention only/i);
  });

  it("renders empty state when there are no routes", () => {
    render(<WhereAgentListensSection routes={[]} />);
    expect(
      screen.getByText(/No bindings yet — add one to start receiving messages\./i),
    ).toBeInTheDocument();
    expect(screen.getByText(/0 bindings/i)).toBeInTheDocument();
  });

  it("renders empty state when routes is undefined", () => {
    render(<WhereAgentListensSection />);
    expect(
      screen.getByText(/No bindings yet — add one to start receiving messages\./i),
    ).toBeInTheDocument();
  });

  it("uses singular subtitle for exactly 1 binding", () => {
    const routes: BindingRoute[] = [
      { channel: "telegram", account: "main", scope: "dm" },
    ];
    render(<WhereAgentListensSection routes={routes} />);
    expect(screen.getByText(/^· 1 binding$/)).toBeInTheDocument();
  });
});
