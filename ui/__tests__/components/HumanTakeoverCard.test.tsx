import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { HumanTakeoverCard } from "@/components/handoff/HumanTakeoverCard";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("HumanTakeoverCard", () => {
  it("renders with defaults when initialConfig is omitted", () => {
    render(<HumanTakeoverCard agentId="amina" />);
    expect(screen.getByText(/auto-pause on human takeover/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/enabled/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pause TTL/i)).toHaveValue(30);
    expect(screen.getByLabelText(/notification throttle/i)).toHaveValue(5);
  });

  it("renders provided initialConfig values", () => {
    render(
      <HumanTakeoverCard
        agentId="amina"
        initialConfig={{
          enabled: true,
          pause_ttl_minutes: 60,
          notification_throttle_minutes: 10,
          channels: ["whatsapp"],
          ignore: ["reactions"],
        }}
      />,
    );
    expect(screen.getByLabelText(/pause TTL/i)).toHaveValue(60);
    expect(screen.getByLabelText(/notification throttle/i)).toHaveValue(10);
    const enabled = screen.getByLabelText(/enabled/i) as HTMLInputElement;
    expect(enabled.checked).toBe(true);
  });

  it("toggling enabled marks the form dirty (Save becomes enabled)", () => {
    render(<HumanTakeoverCard agentId="amina" />);
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/enabled/i));
    expect(save).not.toBeDisabled();
  });

  it("invokes onSave with the new config", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HumanTakeoverCard agentId="amina" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText(/enabled/i));
    fireEvent.change(screen.getByLabelText(/pause TTL/i), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    const arg = onSave.mock.calls[0][0];
    expect(arg.enabled).toBe(true);
    expect(arg.pause_ttl_minutes).toBe(45);
  });

  it("PATCHes /api/agents/[id]/config when onSave is not provided", async () => {
    let patchCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      // The LastModifiedIndicator on mount issues a GET to /config-audit;
      // ignore that and only assert on the save PATCH.
      if (url.includes("/config-audit") && method === "GET") {
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      expect(method).toBe("PATCH");
      expect(url).toContain("/api/agents/amina/config");
      const body = JSON.parse(init!.body as string) as { section: string; value: Record<string, unknown> };
      expect(body.section).toBe("human_takeover");
      expect(body.value).toMatchObject({ enabled: true });
      patchCalls++;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<HumanTakeoverCard agentId="amina" />);
    fireEvent.click(screen.getByLabelText(/enabled/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(patchCalls).toBe(1));
  });

  it("shows an error when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("nope"));
    render(<HumanTakeoverCard agentId="amina" onSave={onSave} />);
    fireEvent.click(screen.getByLabelText(/enabled/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(screen.getByText(/nope/)).toBeInTheDocument());
  });

  it("toggles a channel badge on click", () => {
    render(
      <HumanTakeoverCard
        agentId="amina"
        initialConfig={{ enabled: true, channels: ["whatsapp"] }}
      />,
    );
    const wa = screen.getByText("whatsapp");
    expect(wa.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(wa);
    expect(wa.getAttribute("aria-pressed")).toBe("false");
  });
});
