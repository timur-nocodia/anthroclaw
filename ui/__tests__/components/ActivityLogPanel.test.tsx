import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ActivityLogPanel } from "@/components/handoff/ActivityLogPanel";

interface ActivityEvent {
  kind: string;
  agentId: string;
  peerKey: string;
  at: string;
  expiresAt: string | null;
  reason: string;
  source: string;
  extendedCount: number;
}

function ev(p: Partial<ActivityEvent>): ActivityEvent {
  return {
    kind: "pause_started",
    agentId: "amina",
    peerKey: "whatsapp:business:1",
    at: "2026-05-01T00:00:00Z",
    expiresAt: "2026-05-01T01:00:00Z",
    reason: "manual",
    source: "ui",
    extendedCount: 0,
    ...p,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ActivityLogPanel", () => {
  it("renders 'No events match' when the API returns an empty list", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ events: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivityLogPanel agentId="amina" />);
    await waitFor(() => expect(screen.getByText(/no events match/i)).toBeInTheDocument());
  });

  it("renders events from the API", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          events: [
            ev({ peerKey: "whatsapp:business:1" }),
            ev({ peerKey: "whatsapp:business:2", reason: "manual_indefinite" }),
          ],
          note: "v1 note",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivityLogPanel agentId="amina" />);
    await waitFor(() => expect(screen.getByTestId("activity-0")).toBeInTheDocument());
    expect(screen.getByText(/v1 note/)).toBeInTheDocument();
    expect(screen.getAllByText(/pause_started/i).length).toBeGreaterThanOrEqual(1);
  });

  it("filters events by peerKey substring", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          events: [
            ev({ peerKey: "whatsapp:business:1" }),
            ev({ peerKey: "telegram:main:55" }),
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivityLogPanel agentId="amina" />);
    await waitFor(() => expect(screen.getByTestId("activity-0")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("filter"), { target: { value: "telegram" } });
    expect(screen.queryByText(/whatsapp:business:1/)).not.toBeInTheDocument();
    expect(screen.getByText(/telegram:main:55/)).toBeInTheDocument();
  });

  it("shows an error when the fetch fails", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivityLogPanel agentId="amina" />);
    await waitFor(() => expect(screen.getByText(/HTTP 500/)).toBeInTheDocument());
  });
});
