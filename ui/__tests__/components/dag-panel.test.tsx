import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DagPanel } from "@/components/lcm/DagPanel";

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

const EMPTY_DAG = {
  agentId: "alpha",
  session: "s1",
  depth: null,
  totalSessions: 0,
  totalNodes: 0,
  countsByDepth: {},
  nodes: [],
};

function makeNode(opts: {
  node_id: string;
  depth: number;
  summary?: string;
  token_count?: number;
  child_count?: number;
}) {
  return {
    node_id: opts.node_id,
    session_id: "s1",
    depth: opts.depth,
    summary: opts.summary ?? `summary-${opts.node_id}`,
    token_count: opts.token_count ?? 100,
    source_token_count: 1000,
    earliest_at: 1700000000,
    latest_at: 1700000100,
    child_count: opts.child_count ?? 4,
  };
}

const POPULATED_DAG = {
  agentId: "alpha",
  session: "s1",
  depth: null,
  totalSessions: 1,
  totalNodes: 6,
  countsByDepth: { 0: 4, 1: 1, 2: 1 },
  nodes: [
    makeNode({ node_id: "n-d2-1", depth: 2, summary: "top level summary" }),
    makeNode({ node_id: "n-d1-1", depth: 1, summary: "mid level summary" }),
    makeNode({ node_id: "n-d0-1", depth: 0, summary: "leaf one" }),
    makeNode({ node_id: "n-d0-2", depth: 0, summary: "leaf two" }),
    makeNode({ node_id: "n-d0-3", depth: 0, summary: "leaf three" }),
    makeNode({ node_id: "n-d0-4", depth: 0, summary: "leaf four" }),
  ],
};

const NODE_DETAIL_D2 = {
  node_id: "n-d2-1",
  session_id: "s1",
  depth: 2,
  summary: "Full top-level summary text spanning the whole conversation.",
  token_count: 500,
  source_token_count: 5000,
  source_type: "nodes" as const,
  source_ids: [],
  earliest_at: 1700000000,
  latest_at: 1700000100,
  expand_hint: "Try drilling into the children.",
  children: [
    {
      kind: "node" as const,
      node_id: "n-d1-1",
      depth: 1,
      summary_preview: "child summary preview",
      child_count: 4,
    },
  ],
};

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
  installFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("<DagPanel />", () => {
  it("renders nothing when API returns empty nodes array", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ body: EMPTY_DAG }));

    const { container } = render(<DagPanel agentId="alpha" sessionId="s1" />);

    // Wait for the loading skeleton to disappear, then assert the panel is absent.
    await waitFor(() => {
      expect(screen.queryByTestId("dag-skeleton")).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("dag-panel")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it("renders header with node count + depth count when data exists", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ body: POPULATED_DAG }));

    render(<DagPanel agentId="alpha" sessionId="s1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dag-title")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dag-title")).toHaveTextContent(
      /Compressed history \(LCM\)/,
    );
    expect(screen.getByTestId("dag-count-chip")).toHaveTextContent(
      /6 nodes across 3 depths/,
    );
  });

  it("renders depth sections with correct node counts", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ body: POPULATED_DAG }));

    render(<DagPanel agentId="alpha" sessionId="s1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dag-depth-toggle-2")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dag-depth-toggle-2")).toHaveTextContent(/D2/);
    expect(screen.getByTestId("dag-depth-toggle-2")).toHaveTextContent(/\(1\)/);
    expect(screen.getByTestId("dag-depth-toggle-1")).toHaveTextContent(/\(1\)/);
    expect(screen.getByTestId("dag-depth-toggle-0")).toHaveTextContent(/\(4\)/);
  });

  it("clicking a depth header collapses/expands its node list", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ body: POPULATED_DAG }));

    const user = userEvent.setup();
    render(<DagPanel agentId="alpha" sessionId="s1" />);

    // D2 is open by default (highest depth).
    await waitFor(() => {
      expect(screen.getByTestId("dag-node-n-d2-1")).toBeInTheDocument();
    });

    // D0 is initially collapsed: cards not in DOM.
    expect(screen.queryByTestId("dag-node-n-d0-1")).not.toBeInTheDocument();

    // Expand D0.
    await user.click(screen.getByTestId("dag-depth-toggle-0"));
    await waitFor(() => {
      expect(screen.getByTestId("dag-node-n-d0-1")).toBeInTheDocument();
    });

    // Collapse D0 again.
    await user.click(screen.getByTestId("dag-depth-toggle-0"));
    await waitFor(() => {
      expect(screen.queryByTestId("dag-node-n-d0-1")).not.toBeInTheDocument();
    });
  });

  it("clicking a node card opens the MessageDrillModal (B4) and fetches detail", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ body: POPULATED_DAG }));
    const detailSpy = vi.fn(() => ({ body: NODE_DETAIL_D2 }));
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d2-1$/, detailSpy);

    const user = userEvent.setup();
    render(<DagPanel agentId="alpha" sessionId="s1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dag-node-n-d2-1")).toBeInTheDocument();
    });

    // Modal is not open initially.
    expect(screen.queryByTestId("message-drill-modal")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("dag-node-button-n-d2-1"));

    await waitFor(() => expect(detailSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId("message-drill-modal")).toBeInTheDocument();
    });

    // The drill modal renders the node summary + child node row for D1.
    expect(screen.getByText(/Full top-level summary text/)).toBeInTheDocument();
    expect(screen.getByText(/Try drilling into the children/)).toBeInTheDocument();
    expect(screen.getByTestId("message-drill-child-n-d1-1")).toBeInTheDocument();

    // Inline detail (the old B3 behavior) is gone — no longer rendered in
    // the side panel.
    expect(screen.queryByTestId("dag-node-detail-n-d2-1")).not.toBeInTheDocument();
  });

  it("search submits correctly and shows results", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ body: POPULATED_DAG }));
    const grepSpy = vi.fn(() => ({
      body: {
        agentId: "alpha",
        query: "hello",
        hits: [
          {
            kind: "node",
            node_id: "n-d2-1",
            session_id: "s1",
            depth: 2,
            snippet: "matched <mark>hello</mark> in summary",
            rank: -1.5,
          },
          {
            kind: "message",
            store_id: 42,
            session_id: "s1",
            source: "user",
            role: "user",
            ts: 1700000050,
            snippet: "<mark>hello</mark> world",
            rank: -1.2,
          },
        ],
        totalReturned: 2,
        truncated: false,
      },
    }));
    on("GET", /\/api\/agents\/.+\/lcm\/grep$/, grepSpy);

    const user = userEvent.setup();
    render(<DagPanel agentId="alpha" sessionId="s1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dag-search-input")).toBeInTheDocument();
    });

    await user.type(screen.getByTestId("dag-search-input"), "hello");
    await user.click(screen.getByTestId("dag-search-submit"));

    await waitFor(() => expect(grepSpy).toHaveBeenCalledTimes(1));
    // Verify q + session were both appended to the URL.
    const callUrl = grepSpy.mock.calls[0][0].url;
    expect(callUrl).toContain("q=hello");
    expect(callUrl).toContain("session=s1");
    expect(callUrl).toContain("limit=10");

    await waitFor(() => {
      expect(screen.getByTestId("dag-search-results")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dag-search-hit-n-d2-1")).toBeInTheDocument();
    expect(screen.getByTestId("dag-search-hit-42")).toBeInTheDocument();
  });

  it("empty search input doesn't fire search", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ body: POPULATED_DAG }));
    const grepSpy = vi.fn(() => ({
      body: { agentId: "alpha", query: "", hits: [], totalReturned: 0, truncated: false },
    }));
    on("GET", /\/api\/agents\/.+\/lcm\/grep$/, grepSpy);

    const user = userEvent.setup();
    render(<DagPanel agentId="alpha" sessionId="s1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dag-search-submit")).toBeInTheDocument();
    });

    // Submit with empty input — button should be disabled, click is a no-op.
    const submit = screen.getByTestId("dag-search-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    // Even hitting Enter on the form with empty input should not fire grep.
    await user.click(screen.getByTestId("dag-search-input"));
    await user.keyboard("{Enter}");

    expect(grepSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("dag-search-results")).not.toBeInTheDocument();
  });

  it("search with no hits shows 'No matches' inline", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ body: POPULATED_DAG }));
    on("GET", /\/api\/agents\/.+\/lcm\/grep$/, () => ({
      body: {
        agentId: "alpha",
        query: "missing",
        hits: [],
        totalReturned: 0,
        truncated: false,
      },
    }));

    const user = userEvent.setup();
    render(<DagPanel agentId="alpha" sessionId="s1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dag-search-input")).toBeInTheDocument();
    });

    await user.type(screen.getByTestId("dag-search-input"), "missing");
    await user.click(screen.getByTestId("dag-search-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("dag-search-empty")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dag-search-empty")).toHaveTextContent(/No matches/);
  });

  it("API error on mount shows error inline (don't crash, don't hide silently)", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => ({ status: 500, body: { error: "boom" } }));

    render(<DagPanel agentId="alpha" sessionId="s1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dag-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("dag-error")).toHaveTextContent(/Failed to load DAG/);
  });

  it("loading state shows skeleton", async () => {
    // Hold the response so the skeleton stays visible.
    let resolveFn: (v: MockResponseInit) => void = () => {};
    const pending = new Promise<MockResponseInit>((resolve) => {
      resolveFn = resolve;
    });
    on("GET", /\/api\/agents\/.+\/lcm\/dag$/, () => pending);

    render(<DagPanel agentId="alpha" sessionId="s1" />);

    await waitFor(() => {
      expect(screen.getByTestId("dag-skeleton")).toBeInTheDocument();
    });

    // Resolve and let the component settle so afterEach cleanup is graceful.
    resolveFn({ body: EMPTY_DAG });
    await waitFor(() => {
      expect(screen.queryByTestId("dag-skeleton")).not.toBeInTheDocument();
    });
  });
});
