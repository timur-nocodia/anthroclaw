import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { NotificationsCard } from "@/components/handoff/NotificationsCard";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("NotificationsCard", () => {
  it("renders empty-state copy when no routes/subscriptions exist", () => {
    render(<NotificationsCard agentId="amina" />);
    expect(screen.getByText(/No routes configured/i)).toBeInTheDocument();
    expect(screen.getByText(/No subscriptions yet/i)).toBeInTheDocument();
  });

  it("renders existing routes and subscriptions", () => {
    render(
      <NotificationsCard
        agentId="amina"
        initialConfig={{
          enabled: true,
          routes: {
            operator: { channel: "telegram", account_id: "main", peer_id: "12345" },
          },
          subscriptions: [
            { event: "escalation_needed", route: "operator" },
          ],
        }}
      />,
    );
    expect(screen.getByTestId("route-operator")).toBeInTheDocument();
    expect(screen.getByTestId("subscription-0")).toBeInTheDocument();
  });

  it("adds a new route when 'Add route' is clicked", () => {
    render(<NotificationsCard agentId="amina" />);
    fireEvent.click(screen.getByRole("button", { name: /add route/i }));
    expect(screen.getByTestId("route-operator")).toBeInTheDocument();
  });

  it("disables 'Add subscription' when no routes exist", () => {
    render(<NotificationsCard agentId="amina" />);
    const addSub = screen.getByRole("button", { name: /add subscription/i });
    expect(addSub).toBeDisabled();
  });

  it("removes a route via the trash button", () => {
    render(
      <NotificationsCard
        agentId="amina"
        initialConfig={{
          enabled: true,
          routes: {
            operator: { channel: "telegram", account_id: "main", peer_id: "12345" },
          },
          subscriptions: [],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove-route-operator/i }));
    expect(screen.queryByTestId("route-operator")).not.toBeInTheDocument();
  });

  it("test button POSTs to /api/notifications/test and shows ok mark on success", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      // Audit-log fetch fired by LastModifiedIndicator on mount — return empty.
      if (url.includes("/config-audit")) {
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <NotificationsCard
        agentId="amina"
        initialConfig={{
          enabled: true,
          routes: {
            operator: { channel: "telegram", account_id: "main", peer_id: "12345" },
          },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^test/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
      expect(calls.some((c) => c[1]?.method === "POST")).toBe(true);
    });
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
    const postCall = calls.find((c) => c[1]?.method === "POST");
    expect(postCall).toBeDefined();
    expect(postCall![1]!.body).toContain("amina");
  });

  it("invokes onSave with the new config", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <NotificationsCard
        agentId="amina"
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add route/i }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const arg = onSave.mock.calls[0][0];
    expect(arg.routes).toHaveProperty("operator");
  });
});
