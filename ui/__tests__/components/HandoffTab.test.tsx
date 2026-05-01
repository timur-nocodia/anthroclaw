import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { HandoffTab } from "@/components/handoff/HandoffTab";

beforeEach(() => {
  vi.restoreAllMocks();
  // Stub fetch for the live components (ActivePausesTable, ActivityLogPanel).
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/pauses")) {
        return new Response(JSON.stringify({ pauses: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/pause-events")) {
        return new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }),
  );
});

describe("HandoffTab", () => {
  it("renders all four sections", async () => {
    render(<HandoffTab serverId="local" agentId="amina" agent={{}} />);
    expect(screen.getByText(/Auto-pause on human takeover/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Notifications/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Active pauses/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Activity log/i)).toBeInTheDocument();
    // Wait for live components to settle their initial fetches.
    await waitFor(() => expect(screen.getByText(/no active pauses/i)).toBeInTheDocument());
  });

  it("forwards human_takeover and notifications initial configs into the cards", () => {
    render(
      <HandoffTab
        serverId="local"
        agentId="amina"
        agent={{
          human_takeover: { enabled: true, pause_ttl_minutes: 99 },
          notifications: {
            enabled: true,
            routes: { operator: { channel: "telegram", account_id: "main", peer_id: "1" } },
            subscriptions: [],
          },
        }}
      />,
    );
    const ttlInput = screen.getByLabelText(/pause TTL/i) as HTMLInputElement;
    expect(ttlInput.value).toBe("99");
    expect(screen.getByTestId("route-operator")).toBeInTheDocument();
  });
});
