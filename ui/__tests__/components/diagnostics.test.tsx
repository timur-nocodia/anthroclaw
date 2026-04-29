import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ContextPressureChip } from "@/components/lcm/ContextPressureChip";
import { DoctorPanel } from "@/components/lcm/DoctorPanel";

/* ------------------------------------------------------------------ */
/*  Sonner mock                                                        */
/* ------------------------------------------------------------------ */

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

/* ------------------------------------------------------------------ */
/*  Fetch mock                                                         */
/* ------------------------------------------------------------------ */

interface MockResponseInit {
  status?: number;
  body?: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface RouteHandler {
  (req: Request): MockResponseInit | Response | Promise<MockResponseInit | Response>;
}

interface RouteSpec {
  method: string;
  matcher: RegExp;
  handler: RouteHandler;
}

let routes: RouteSpec[] = [];

function installFetchMock() {
  routes = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const absUrl = rawUrl.startsWith("http") ? rawUrl : `http://localhost${rawUrl}`;
    const url = new URL(absUrl);
    const method = (init?.method ?? "GET").toUpperCase();
    const req = new Request(absUrl, init);
    for (const r of routes) {
      if (r.method === method && r.matcher.test(url.pathname)) {
        const result = await r.handler(req);
        if (result instanceof Response) return result;
        return jsonResponse(result.body ?? {}, result.status ?? 200);
      }
    }
    throw new Error(`Unhandled fetch: ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function on(method: string, matcher: RegExp, handler: RouteHandler) {
  routes.push({ method, matcher, handler });
}

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

interface StatusFixtureOpts {
  pressure?: "green" | "yellow" | "orange" | "red";
  ratio?: number;
  totalMessages?: number;
  totalSessions?: number;
  totalTokens?: number;
  threshold?: number;
}

function statusFixture(opts: StatusFixtureOpts = {}) {
  return {
    agentId: "alpha",
    session: null,
    totalSessions: opts.totalSessions ?? 1,
    totalMessages: opts.totalMessages ?? 42,
    totalTokens: opts.totalTokens ?? 12000,
    countsByDepth: {},
    contextPressure: opts.pressure ?? "green",
    threshold: opts.threshold ?? 40000,
    pressureRatio: opts.ratio ?? 0.3,
    earliestTs: null,
    latestTs: null,
  };
}

const EMPTY_STATUS = statusFixture({
  pressure: "green",
  ratio: 0,
  totalMessages: 0,
  totalSessions: 0,
  totalTokens: 0,
});

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  installFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ================================================================== */
/*  ContextPressureChip                                                */
/* ================================================================== */

describe("<ContextPressureChip />", () => {
  it("renders nothing when LCM has no data", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/status$/, () => ({ body: EMPTY_STATUS }));
    const { container } = render(<ContextPressureChip agentId="alpha" />);
    // Wait a microtask for the promise chain to settle.
    await waitFor(() => {
      expect(screen.queryByTestId("context-pressure-chip")).not.toBeInTheDocument();
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders a green chip when pressure < 50%", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/status$/, () => ({
      body: statusFixture({ pressure: "green", ratio: 0.3 }),
    }));
    render(<ContextPressureChip agentId="alpha" />);
    const chip = await screen.findByTestId("context-pressure-chip");
    expect(chip).toHaveAttribute("data-pressure", "green");
    expect(chip).toHaveTextContent(/30%/);
  });

  it("renders a yellow chip in the 50-79% range", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/status$/, () => ({
      body: statusFixture({ pressure: "yellow", ratio: 0.65 }),
    }));
    render(<ContextPressureChip agentId="alpha" />);
    const chip = await screen.findByTestId("context-pressure-chip");
    expect(chip).toHaveAttribute("data-pressure", "yellow");
    expect(chip).toHaveTextContent(/65%/);
  });

  it("renders an orange chip in the 80-94% range", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/status$/, () => ({
      body: statusFixture({ pressure: "orange", ratio: 0.88 }),
    }));
    render(<ContextPressureChip agentId="alpha" />);
    const chip = await screen.findByTestId("context-pressure-chip");
    expect(chip).toHaveAttribute("data-pressure", "orange");
    expect(chip).toHaveTextContent(/88%/);
  });

  it("renders a red chip when pressure >= 95%", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/status$/, () => ({
      body: statusFixture({ pressure: "red", ratio: 1.05 }),
    }));
    render(<ContextPressureChip agentId="alpha" />);
    const chip = await screen.findByTestId("context-pressure-chip");
    expect(chip).toHaveAttribute("data-pressure", "red");
    expect(chip).toHaveTextContent(/105%/);
  });

  it("tooltip text shows messages / tokens / threshold / ratio", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/status$/, () => ({
      body: statusFixture({
        pressure: "yellow",
        ratio: 0.6,
        totalMessages: 100,
        totalTokens: 24000,
        threshold: 40000,
      }),
    }));
    render(<ContextPressureChip agentId="alpha" />);
    const chip = await screen.findByTestId("context-pressure-chip");
    const title = chip.getAttribute("title") ?? "";
    expect(title).toContain("100 messages");
    expect(title).toContain("24000 tokens");
    expect(title).toContain("40000 threshold");
    expect(title).toContain("60%");
  });
});

/* ================================================================== */
/*  DoctorPanel                                                        */
/* ================================================================== */

const REPORT_HEALTHY = {
  agentId: "alpha",
  health: "green",
  issues: [],
};

const REPORT_WITH_ISSUES = {
  agentId: "alpha",
  health: "yellow",
  issues: [
    {
      severity: "warning",
      code: "fts_out_of_sync",
      message: "FTS shadow tables out of sync",
    },
    {
      severity: "warning",
      code: "orphan_nodes",
      message: "3 DAG node references point to non-existent ids",
      count: 3,
    },
  ],
};

const REPORT_AFTER_CLEANUP = {
  agentId: "alpha",
  health: "yellow",
  issues: REPORT_WITH_ISSUES.issues,
  cleanup: {
    backupPath: "/srv/data/lcm-db/backups/alpha-2026-04-28T12-00-00-000Z.sqlite",
    actions: [
      "delete_orphans: removed 3 row(s)",
      "rebuild_fts: messages_fts + nodes_fts",
    ],
  },
};

describe("<DoctorPanel />", () => {
  it("initial state — no health check yet, run button visible", () => {
    render(<DoctorPanel agentId="alpha" />);
    expect(screen.getByTestId("doctor-run-check")).toBeInTheDocument();
    expect(screen.getByTestId("doctor-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("doctor-report")).not.toBeInTheDocument();
  });

  it("clicking run fires POST { apply: false } and renders the health badge", async () => {
    const calls: Array<{ apply: unknown; confirm?: unknown }> = [];
    on("POST", /\/api\/agents\/.+\/lcm\/doctor$/, async (req) => {
      const body = (await req.json()) as { apply: unknown; confirm?: unknown };
      calls.push(body);
      return { body: REPORT_HEALTHY };
    });

    const user = userEvent.setup();
    render(<DoctorPanel agentId="alpha" />);
    await user.click(screen.getByTestId("doctor-run-check"));

    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toEqual({ apply: false });

    await waitFor(() => {
      expect(screen.getByTestId("doctor-health-badge")).toBeInTheDocument();
    });
    expect(screen.getByTestId("doctor-health-badge")).toHaveAttribute(
      "data-health",
      "green",
    );
  });

  it("hides cleanup CTA when there are no fixable issues", async () => {
    on("POST", /\/api\/agents\/.+\/lcm\/doctor$/, () => ({ body: REPORT_HEALTHY }));
    const user = userEvent.setup();
    render(<DoctorPanel agentId="alpha" />);
    await user.click(screen.getByTestId("doctor-run-check"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-no-issues")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("doctor-cleanup-cta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("doctor-cleanup-button")).not.toBeInTheDocument();
  });

  it("shows cleanup CTA + opens confirm dialog when there are fixable issues", async () => {
    on("POST", /\/api\/agents\/.+\/lcm\/doctor$/, () => ({ body: REPORT_WITH_ISSUES }));
    const user = userEvent.setup();
    render(<DoctorPanel agentId="alpha" />);
    await user.click(screen.getByTestId("doctor-run-check"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-cleanup-cta")).toBeInTheDocument();
    });

    // Dialog is initially closed.
    expect(screen.queryByTestId("doctor-confirm-dialog")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("doctor-cleanup-button"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-confirm-dialog")).toBeInTheDocument();
    });
  });

  it("cancelling the confirm dialog does not fire a mutating POST", async () => {
    const calls: Array<{ apply: unknown; confirm?: unknown }> = [];
    on("POST", /\/api\/agents\/.+\/lcm\/doctor$/, async (req) => {
      const body = (await req.json()) as { apply: unknown; confirm?: unknown };
      calls.push(body);
      return { body: REPORT_WITH_ISSUES };
    });
    const user = userEvent.setup();
    render(<DoctorPanel agentId="alpha" />);
    await user.click(screen.getByTestId("doctor-run-check"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-cleanup-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("doctor-cleanup-button"));
    await waitFor(() => {
      expect(screen.getByTestId("doctor-confirm-dialog")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("doctor-confirm-cancel"));

    await waitFor(() => {
      expect(screen.queryByTestId("doctor-confirm-dialog")).not.toBeInTheDocument();
    });

    // Only the read-only check should have been called — never apply: true.
    expect(calls.length).toBe(1);
    expect(calls[0]).toEqual({ apply: false });
  });

  it("confirming cleanup fires POST { apply: true, confirm: true } and shows backup + actions", async () => {
    const calls: Array<{ apply: unknown; confirm?: unknown }> = [];
    on("POST", /\/api\/agents\/.+\/lcm\/doctor$/, async (req) => {
      const body = (await req.json()) as { apply: unknown; confirm?: unknown };
      calls.push(body);
      if (body.apply === true && body.confirm === true) {
        return { body: REPORT_AFTER_CLEANUP };
      }
      return { body: REPORT_WITH_ISSUES };
    });

    const user = userEvent.setup();
    render(<DoctorPanel agentId="alpha" />);
    await user.click(screen.getByTestId("doctor-run-check"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-cleanup-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("doctor-cleanup-button"));
    await waitFor(() => {
      expect(screen.getByTestId("doctor-confirm-proceed")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("doctor-confirm-proceed"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-cleanup-result")).toBeInTheDocument();
    });

    // Two POSTs: read-only then apply.
    expect(calls).toEqual([
      { apply: false },
      { apply: true, confirm: true },
    ]);

    expect(screen.getByTestId("doctor-cleanup-backup")).toHaveTextContent(
      /alpha-2026-04-28T12-00-00-000Z\.sqlite/,
    );
    expect(screen.getByTestId("doctor-cleanup-actions")).toHaveTextContent(
      /delete_orphans/,
    );
    expect(screen.getByTestId("doctor-cleanup-actions")).toHaveTextContent(
      /rebuild_fts/,
    );
  });

  it("toast.success fires after cleanup", async () => {
    on("POST", /\/api\/agents\/.+\/lcm\/doctor$/, async (req) => {
      const body = (await req.json()) as { apply: unknown; confirm?: unknown };
      if (body.apply === true && body.confirm === true) {
        return { body: REPORT_AFTER_CLEANUP };
      }
      return { body: REPORT_WITH_ISSUES };
    });

    const user = userEvent.setup();
    render(<DoctorPanel agentId="alpha" />);
    await user.click(screen.getByTestId("doctor-run-check"));
    await waitFor(() => {
      expect(screen.getByTestId("doctor-cleanup-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("doctor-cleanup-button"));
    await waitFor(() => {
      expect(screen.getByTestId("doctor-confirm-proceed")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("doctor-confirm-proceed"));

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
    expect(toastSuccess.mock.calls[0][0]).toMatch(/cleanup/i);
  });

  it("renders inline error + retry button on initial check failure", async () => {
    let attempts = 0;
    on("POST", /\/api\/agents\/.+\/lcm\/doctor$/, () => {
      attempts += 1;
      if (attempts === 1) return { status: 500, body: { error: "boom" } };
      return { body: REPORT_HEALTHY };
    });

    const user = userEvent.setup();
    render(<DoctorPanel agentId="alpha" />);
    await user.click(screen.getByTestId("doctor-run-check"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("doctor-retry")).toBeInTheDocument();

    await user.click(screen.getByTestId("doctor-retry"));

    await waitFor(() => {
      expect(screen.getByTestId("doctor-health-badge")).toBeInTheDocument();
    });
  });
});
