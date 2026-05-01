import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { HumanTakeoverCard } from "@/components/handoff/HumanTakeoverCard";
import { NotificationsCard } from "@/components/handoff/NotificationsCard";
import { relativeTime } from "@/lib/format-time";

interface AuditEntry {
  ts: string;
  callerAgent: string;
  source: "chat" | "ui" | "system";
  section: "notifications" | "human_takeover" | "operator_console";
  targetAgent: string;
  action: string;
  prev: unknown;
  new: unknown;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function fetchMock(routes: Record<string, AuditEntry[]>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const u = new URL(url, "http://localhost");
    const section = u.searchParams.get("section") ?? "*";
    const entries = routes[section] ?? [];
    return jsonResponse({ entries });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("LastModifiedIndicator on Handoff cards", () => {
  describe("relativeTime helper", () => {
    it('returns "just now" for sub-minute deltas', () => {
      const now = new Date("2026-05-01T10:00:30Z").getTime();
      const ts = "2026-05-01T10:00:00Z";
      expect(relativeTime(ts, now)).toBe("just now");
    });

    it("formats minutes", () => {
      const now = new Date("2026-05-01T10:05:00Z").getTime();
      const ts = "2026-05-01T10:00:00Z";
      expect(relativeTime(ts, now)).toBe("5 min ago");
    });

    it("formats single hour with no plural", () => {
      const now = new Date("2026-05-01T11:00:00Z").getTime();
      const ts = "2026-05-01T10:00:00Z";
      expect(relativeTime(ts, now)).toBe("1 hour ago");
    });

    it("formats multiple hours with plural", () => {
      const now = new Date("2026-05-01T13:00:00Z").getTime();
      const ts = "2026-05-01T10:00:00Z";
      expect(relativeTime(ts, now)).toBe("3 hours ago");
    });

    it("formats days for >24h deltas", () => {
      const now = new Date("2026-05-03T10:00:00Z").getTime();
      const ts = "2026-05-01T10:00:00Z";
      expect(relativeTime(ts, now)).toBe("2 days ago");
    });
  });

  describe("HumanTakeoverCard indicator", () => {
    it("renders 'Last modified ... via chat (klavdia)' when audit has a chat entry", async () => {
      const ts = new Date(Date.now() - 3 * 3600_000).toISOString();
      vi.stubGlobal(
        "fetch",
        fetchMock({
          human_takeover: [
            {
              ts,
              callerAgent: "klavdia",
              source: "chat",
              section: "human_takeover",
              targetAgent: "klavdia",
              action: "human_takeover.set_enabled",
              prev: { enabled: false },
              new: { enabled: true },
            },
          ],
        }),
      );
      render(<HumanTakeoverCard agentId="klavdia" />);
      await waitFor(() => {
        expect(screen.getByTestId("last-modified-human_takeover")).toBeInTheDocument();
      });
      const indicator = screen.getByTestId("last-modified-human_takeover");
      expect(indicator.textContent).toMatch(/Last modified/);
      expect(indicator.textContent).toMatch(/via chat \(klavdia\)/);
    });

    it("renders 'via UI' when source is ui", async () => {
      const ts = new Date(Date.now() - 5 * 60_000).toISOString();
      vi.stubGlobal(
        "fetch",
        fetchMock({
          human_takeover: [
            {
              ts,
              callerAgent: "ui",
              source: "ui",
              section: "human_takeover",
              targetAgent: "klavdia",
              action: "ui_save_human_takeover",
              prev: null,
              new: null,
            },
          ],
        }),
      );
      render(<HumanTakeoverCard agentId="klavdia" />);
      await waitFor(() => {
        const el = screen.getByTestId("last-modified-human_takeover");
        expect(el.textContent).toMatch(/via UI/);
        expect(el.textContent).not.toMatch(/via chat/);
      });
    });

    it("hides indicator when no audit entries exist", async () => {
      vi.stubGlobal("fetch", fetchMock({ human_takeover: [] }));
      render(<HumanTakeoverCard agentId="klavdia" />);
      // Wait a tick for fetch to resolve
      await new Promise((r) => setTimeout(r, 10));
      expect(screen.queryByTestId("last-modified-human_takeover")).toBeNull();
    });

    it("queries the human_takeover section, not notifications", async () => {
      const fm = fetchMock({});
      vi.stubGlobal("fetch", fm);
      render(<HumanTakeoverCard agentId="klavdia" />);
      await waitFor(() => expect(fm).toHaveBeenCalled());
      const calls = (fm as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const url = String(calls[0][0]);
      expect(url).toContain("section=human_takeover");
      expect(url).toContain("limit=1");
    });
  });

  describe("NotificationsCard indicator", () => {
    it("renders 'Last modified ... via chat (klavdia)' when audit has a chat entry", async () => {
      const ts = new Date(Date.now() - 2 * 3600_000).toISOString();
      vi.stubGlobal(
        "fetch",
        fetchMock({
          notifications: [
            {
              ts,
              callerAgent: "klavdia",
              source: "chat",
              section: "notifications",
              targetAgent: "klavdia",
              action: "notifications.add_route",
              prev: null,
              new: null,
            },
          ],
        }),
      );
      render(<NotificationsCard agentId="klavdia" />);
      await waitFor(() => {
        const el = screen.getByTestId("last-modified-notifications");
        expect(el.textContent).toMatch(/via chat \(klavdia\)/);
      });
    });

    it("hides indicator when no audit entries exist", async () => {
      vi.stubGlobal("fetch", fetchMock({ notifications: [] }));
      render(<NotificationsCard agentId="klavdia" />);
      await new Promise((r) => setTimeout(r, 10));
      expect(screen.queryByTestId("last-modified-notifications")).toBeNull();
    });

    it("queries the notifications section, not human_takeover", async () => {
      const fm = fetchMock({});
      vi.stubGlobal("fetch", fm);
      render(<NotificationsCard agentId="klavdia" />);
      await waitFor(() => expect(fm).toHaveBeenCalled());
      const calls = (fm as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const url = String(calls[0][0]);
      expect(url).toContain("section=notifications");
      expect(url).toContain("limit=1");
    });
  });
});
