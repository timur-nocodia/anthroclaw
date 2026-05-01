import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  WhereAgentListensSection,
  type BindingRoute,
} from "@/components/binding/WhereAgentListensSection";

const ACCOUNTS = {
  telegram: {
    content_sm: { username: "clowwy_bot" },
  },
  whatsapp: { humanrobot: {} },
};

describe("WhereAgentListensSection", () => {
  it("renders the section title and binding count subtitle", () => {
    const routes: BindingRoute[] = [
      {
        channel: "telegram",
        account: "content_sm",
        scope: "group",
        peers: ["-1003729315809"],
        topics: ["3"],
        mention_only: true,
      },
      {
        channel: "whatsapp",
        account: "humanrobot",
        scope: "dm",
        peers: null,
        topics: null,
      },
    ];
    render(
      <WhereAgentListensSection
        routes={routes}
        accounts={ACCOUNTS}
        pairingMode="open"
      />,
    );
    expect(screen.getByText(/Where this agent listens/i)).toBeInTheDocument();
    expect(screen.getByText(/2 bindings/i)).toBeInTheDocument();
  });

  it("renders one BindingCard per route when routes exist", () => {
    const routes: BindingRoute[] = [
      { channel: "telegram", account: "main", scope: "dm" },
      { channel: "telegram", account: "main", scope: "group", peers: ["-100"] },
    ];
    render(<WhereAgentListensSection routes={routes} accounts={ACCOUNTS} />);
    expect(screen.getByTestId("binding-row-0")).toBeInTheDocument();
    expect(screen.getByTestId("binding-row-1")).toBeInTheDocument();
    expect(screen.getAllByTestId("binding-card")).toHaveLength(2);
  });

  it("renders empty-state hint when no routes", () => {
    render(<WhereAgentListensSection routes={[]} accounts={ACCOUNTS} />);
    expect(screen.getByTestId("binding-empty-state")).toHaveTextContent(
      /No bindings yet/,
    );
  });

  it("uses singular subtitle for exactly 1 binding", () => {
    const routes: BindingRoute[] = [
      { channel: "telegram", account: "main", scope: "dm" },
    ];
    render(<WhereAgentListensSection routes={routes} accounts={ACCOUNTS} />);
    expect(screen.getByText(/^· 1 binding$/)).toBeInTheDocument();
  });

  it("Add binding button opens the wizard", () => {
    render(<WhereAgentListensSection routes={[]} accounts={ACCOUNTS} />);
    expect(screen.getByTestId("binding-add-button")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("binding-add-button"));
    // Wizard step indicator appears once dialog opens.
    expect(
      screen.getByTestId("binding-wizard-step-label"),
    ).toBeInTheDocument();
  });

  it("Edit pre-populates wizard with the route data", () => {
    const routes: BindingRoute[] = [
      {
        channel: "telegram",
        account: "content_sm",
        scope: "group",
        peers: ["-1003729315809"],
        topics: ["3"],
        mention_only: true,
      },
    ];
    render(<WhereAgentListensSection routes={routes} accounts={ACCOUNTS} />);
    fireEvent.click(screen.getByTestId("binding-card-edit"));
    // Wizard jumps to preview with prefilled data.
    expect(screen.getByText(/Edit binding/i)).toBeInTheDocument();
    const preview = screen.getByTestId("binding-step-preview");
    const lines = screen.getByTestId("binding-preview-lines");
    expect(preview).toContainElement(lines);
    expect(lines.textContent).toMatch(/In group: -1003729315809/);
    expect(lines.textContent).toMatch(/In topic: 3/);
    expect(lines.textContent).toMatch(/Responds only when @-mentioned/);
  });

  it("Remove confirms then calls onSaveRoutes without the removed entry", async () => {
    const onSaveRoutes = vi.fn().mockResolvedValue(undefined);
    const routes: BindingRoute[] = [
      { channel: "telegram", account: "main", scope: "dm" },
      { channel: "telegram", account: "content_sm", scope: "group", peers: ["-100"] },
    ];
    render(
      <WhereAgentListensSection
        routes={routes}
        accounts={ACCOUNTS}
        onSaveRoutes={onSaveRoutes}
      />,
    );
    const removes = screen.getAllByTestId("binding-card-remove");
    fireEvent.click(removes[0]);
    fireEvent.click(screen.getByTestId("binding-card-remove-confirm"));
    await waitFor(() => expect(onSaveRoutes).toHaveBeenCalledTimes(1));
    expect(onSaveRoutes).toHaveBeenCalledWith([
      {
        channel: "telegram",
        account: "content_sm",
        scope: "group",
        peers: ["-100"],
      },
    ]);
  });

  it("falls back to fetch PATCH when only agentId is provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const routes: BindingRoute[] = [
        { channel: "telegram", account: "main", scope: "dm" },
      ];
      render(
        <WhereAgentListensSection
          agentId="op"
          routes={routes}
          accounts={ACCOUNTS}
        />,
      );
      fireEvent.click(screen.getByTestId("binding-card-remove"));
      fireEvent.click(screen.getByTestId("binding-card-remove-confirm"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/agents/op/config");
      expect(opts.method).toBe("PATCH");
      expect(JSON.parse(opts.body)).toEqual({ section: "routes", value: [] });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
