import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { ConfigAuditPanel } from "@/components/handoff/ConfigAuditPanel";

interface AuditEntry {
  ts: string;
  callerAgent: string;
  callerSession?: string;
  targetAgent: string;
  section: "notifications" | "human_takeover" | "operator_console";
  action: string;
  prev: unknown;
  new: unknown;
  source: "chat" | "ui" | "system";
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const SAMPLE_ENTRIES: AuditEntry[] = [
  {
    ts: "2026-05-01T12:00:00.000Z",
    callerAgent: "klavdia",
    callerSession: "telegram:control:dm:1",
    targetAgent: "klavdia",
    section: "notifications",
    action: "notifications.add_route",
    prev: null,
    new: { channel: "telegram", account_id: "main", peer_id: "1" },
    source: "chat",
  },
  {
    ts: "2026-05-01T11:00:00.000Z",
    callerAgent: "ui",
    targetAgent: "klavdia",
    section: "human_takeover",
    action: "ui_save_human_takeover",
    prev: { enabled: false },
    new: { enabled: true },
    source: "ui",
  },
  {
    ts: "2026-05-01T10:00:00.000Z",
    callerAgent: "klavdia",
    targetAgent: "klavdia",
    section: "human_takeover",
    action: "human_takeover.set_enabled",
    prev: { enabled: true },
    new: { enabled: false },
    source: "chat",
  },
];

function fetchMock(allEntries: AuditEntry[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const u = new URL(url, "http://localhost");
    const section = u.searchParams.get("section");
    const filtered = section
      ? allEntries.filter((e) => e.section === section)
      : allEntries.slice();
    // newest-first
    filtered.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    return jsonResponse({ entries: filtered });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("ConfigAuditPanel", () => {
  it("fetches /api/agents/[id]/config-audit?limit=50 on mount", async () => {
    const fm = fetchMock(SAMPLE_ENTRIES);
    vi.stubGlobal("fetch", fm);
    render(<ConfigAuditPanel agentId="klavdia" />);
    await waitFor(() => expect(fm).toHaveBeenCalled());
    const calls = (fm as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const url = String(calls[0][0]);
    expect(url).toContain("/api/agents/klavdia/config-audit");
    expect(url).toContain("limit=50");
  });

  it("renders all entries newest-first", async () => {
    vi.stubGlobal("fetch", fetchMock(SAMPLE_ENTRIES));
    render(<ConfigAuditPanel agentId="klavdia" />);
    await waitFor(() => {
      expect(screen.getByTestId("audit-entry-0")).toBeInTheDocument();
    });
    expect(screen.getByTestId("audit-entry-0").textContent).toContain(
      "notifications.add_route",
    );
    expect(screen.getByTestId("audit-entry-1").textContent).toContain(
      "ui_save_human_takeover",
    );
    expect(screen.getByTestId("audit-entry-2").textContent).toContain(
      "human_takeover.set_enabled",
    );
  });

  it("renders source labels: chat (callerAgent) and UI", async () => {
    vi.stubGlobal("fetch", fetchMock(SAMPLE_ENTRIES));
    render(<ConfigAuditPanel agentId="klavdia" />);
    await waitFor(() =>
      expect(screen.getByTestId("audit-source-0")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("audit-source-0").textContent).toMatch(
      /chat \(klavdia\)/,
    );
    expect(screen.getByTestId("audit-source-1").textContent).toMatch(/UI/);
  });

  it("displays prev and new JSON in dedicated <pre> blocks", async () => {
    vi.stubGlobal("fetch", fetchMock(SAMPLE_ENTRIES));
    render(<ConfigAuditPanel agentId="klavdia" />);
    await waitFor(() =>
      expect(screen.getByTestId("audit-prev-1")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("audit-prev-1").textContent).toContain(
      '"enabled": false',
    );
    expect(screen.getByTestId("audit-new-1").textContent).toContain(
      '"enabled": true',
    );
  });

  it("section filter narrows results", async () => {
    const fm = fetchMock(SAMPLE_ENTRIES);
    vi.stubGlobal("fetch", fm);
    render(<ConfigAuditPanel agentId="klavdia" />);
    await waitFor(() =>
      expect(screen.getByTestId("audit-entry-0")).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/section-filter/i), {
      target: { value: "notifications" },
    });

    await waitFor(() => {
      // Only the one notifications entry should remain.
      expect(screen.queryByTestId("audit-entry-1")).toBeNull();
    });
    expect(screen.getByTestId("audit-entry-0").textContent).toContain(
      "notifications.add_route",
    );

    const calls = (fm as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const lastUrl = String(calls[calls.length - 1][0]);
    expect(lastUrl).toContain("section=notifications");
  });

  it("shows empty-state when no entries", async () => {
    vi.stubGlobal("fetch", fetchMock([]));
    render(<ConfigAuditPanel agentId="klavdia" />);
    await waitFor(() =>
      expect(screen.getByText(/No config changes yet/i)).toBeInTheDocument(),
    );
  });

  it("displays an error when fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad", { status: 500 })),
    );
    render(<ConfigAuditPanel agentId="klavdia" />);
    await waitFor(() => {
      expect(screen.getByText(/HTTP 500/)).toBeInTheDocument();
    });
  });
});
