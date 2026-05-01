import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ActivePausesTable } from "@/components/handoff/ActivePausesTable";

interface PauseEntry {
  agentId: string;
  peerKey: string;
  pausedAt: string;
  expiresAt: string | null;
  reason: string;
  source: string;
  extendedCount: number;
  lastOperatorMessageAt: string | null;
}

function entry(p: Partial<PauseEntry>): PauseEntry {
  return {
    agentId: "amina",
    peerKey: "whatsapp:business:1",
    pausedAt: "2026-05-01T00:00:00Z",
    expiresAt: "2026-05-01T01:00:00Z",
    reason: "manual",
    source: "ui:operator",
    extendedCount: 0,
    lastOperatorMessageAt: null,
    ...p,
  };
}

let routes: Array<{ method: string; matcher: RegExp; handler: () => Response }> = [];

function installFetchMock() {
  routes = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input.toString();
    const url = new URL(raw, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    for (const r of routes) {
      if (r.method === method && r.matcher.test(url.pathname)) {
        return r.handler();
      }
    }
    throw new Error(`unhandled fetch ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function on(method: string, matcher: RegExp, body: unknown, status = 200) {
  routes.push({
    method,
    matcher,
    handler: () =>
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ActivePausesTable", () => {
  it("renders empty state when there are no pauses", async () => {
    installFetchMock();
    on("GET", /\/api\/agents\/amina\/pauses$/, { pauses: [] });
    render(<ActivePausesTable agentId="amina" refreshIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText(/no active pauses/i)).toBeInTheDocument());
  });

  it("renders rows for each pause", async () => {
    installFetchMock();
    on("GET", /\/api\/agents\/amina\/pauses$/, {
      pauses: [
        entry({ peerKey: "whatsapp:business:1" }),
        entry({ peerKey: "whatsapp:business:2", expiresAt: null }),
      ],
    });
    render(<ActivePausesTable agentId="amina" refreshIntervalMs={0} />);
    await waitFor(() => expect(screen.getByTestId("pause-row-whatsapp:business:1")).toBeInTheDocument());
    expect(screen.getByTestId("pause-row-whatsapp:business:2")).toBeInTheDocument();
    expect(screen.getByText("indefinite")).toBeInTheDocument();
  });

  it("clicking Unpause sends DELETE and re-fetches", async () => {
    const fetchMock = installFetchMock();
    let listCount = 0;
    routes.push({
      method: "GET",
      matcher: /\/api\/agents\/amina\/pauses$/,
      handler: () => {
        listCount += 1;
        const body = listCount === 1 ? { pauses: [entry({ peerKey: "whatsapp:business:1" })] } : { pauses: [] };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    on("DELETE", /\/api\/agents\/amina\/pauses\/.+$/, { ok: true, was_paused: true });

    render(<ActivePausesTable agentId="amina" refreshIntervalMs={0} />);
    await waitFor(() =>
      expect(screen.getByTestId("pause-row-whatsapp:business:1")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /unpause-whatsapp:business:1/i }));
    await waitFor(() => expect(screen.getByText(/no active pauses/i)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial GET, DELETE, refetch GET
  });

  it("shows an error when fetch fails", async () => {
    const fetchMock = vi.fn(async () => new Response("oops", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ActivePausesTable agentId="amina" refreshIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText(/HTTP 500/i)).toBeInTheDocument());
  });

  it("Refresh button triggers a re-fetch", async () => {
    const fetchMock = installFetchMock();
    on("GET", /\/api\/agents\/amina\/pauses$/, { pauses: [] });
    render(<ActivePausesTable agentId="amina" refreshIntervalMs={0} />);
    await waitFor(() => expect(screen.getByText(/no active pauses/i)).toBeInTheDocument());
    const initialCalls = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls));
  });
});
