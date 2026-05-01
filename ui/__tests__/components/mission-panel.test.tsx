import React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MissionPanel } from "@/components/mission/MissionPanel";

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<MissionPanel />", () => {
  it("renders create form when no active mission exists", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ active: false, agentId: "alpha" }));

    render(<MissionPanel agentId="alpha" />);

    await waitFor(() => {
      expect(screen.getByTestId("mission-title")).toBeInTheDocument();
    });
    expect(screen.getByTestId("mission-title")).toBeInTheDocument();
    expect(screen.getByTestId("mission-goal")).toBeInTheDocument();
  });

  it("creates a mission from the form", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ active: false, agentId: "alpha" }))
      .mockResolvedValueOnce(jsonResponse({
        active: true,
        agentId: "alpha",
        mission: {
          id: "mission-1",
          title: "Release Mission State",
          goal: "Keep work scoped",
          mode: "lightweight",
          phase: "define",
          status: "active",
          current_state: "Ready",
          next_actions: ["ship"],
          created_at: 1,
          updated_at: 2,
        },
        objectives: [],
        decisions: [],
        recent_handoffs: [],
      }));

    const user = userEvent.setup();
    render(<MissionPanel agentId="alpha" />);
    await waitFor(() => screen.getByTestId("mission-title"));

    await user.type(screen.getByTestId("mission-title"), "Release Mission State");
    await user.type(screen.getByTestId("mission-goal"), "Keep work scoped");
    await user.type(screen.getByTestId("mission-current-state"), "Ready");
    await user.type(screen.getByTestId("mission-next-actions"), "ship");
    await user.click(screen.getByTestId("mission-create"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Release Mission State",
      goal: "Keep work scoped",
      current_state: "Ready",
      next_actions: ["ship"],
    });
    expect(await screen.findByText("Release Mission State")).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith("Mission created");
  });

  it("renders and archives an active mission", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        active: true,
        agentId: "alpha",
        mission: {
          id: "mission-1",
          title: "Active Mission",
          goal: "Stay scoped",
          mode: "lifecycle",
          phase: "build",
          status: "active",
          current_state: "Building",
          next_actions: ["verify"],
          created_at: 1,
          updated_at: 2,
        },
        objectives: [{ id: "objective-1", content: "No scope creep", status: "active" }],
        decisions: [],
        recent_handoffs: [],
      }))
      .mockResolvedValueOnce(jsonResponse({
        active: false,
        agentId: "alpha",
        mission: {
          id: "mission-1",
          title: "Active Mission",
          goal: "Stay scoped",
          mode: "lifecycle",
          phase: "build",
          status: "archived",
          current_state: "Building",
          next_actions: ["verify"],
          created_at: 1,
          updated_at: 3,
          archived_at: 3,
        },
      }))
      .mockResolvedValueOnce(jsonResponse({ active: false, agentId: "alpha" }));

    const user = userEvent.setup();
    render(<MissionPanel agentId="alpha" />);

    await waitFor(() => screen.getByText("Active Mission"));
    await user.type(screen.getByTestId("mission-archive-reason"), "done");
    await user.click(screen.getByTestId("mission-archive"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "done" });
    expect(await screen.findByTestId("mission-title")).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith("Mission archived");
  });
});
