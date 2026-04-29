import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageDrillModal } from "@/components/lcm/MessageDrillModal";

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

const D0_DETAIL = {
  node_id: "n-d0-1",
  session_id: "s1",
  depth: 0,
  summary: "Leaf node summary covering two messages.",
  token_count: 80,
  source_token_count: 200,
  source_type: "messages" as const,
  source_ids: [101, 102],
  earliest_at: 1700000000,
  latest_at: 1700000050,
  children: [
    {
      kind: "message" as const,
      store_id: 101,
      role: "user",
      content: "What's the weather?",
      ts: 1700000000,
      source: "telegram",
    },
    {
      kind: "message" as const,
      store_id: 102,
      role: "assistant",
      content: "Sunny and 72F.",
      ts: 1700000050,
      source: "telegram",
    },
  ],
};

const D1_DETAIL = {
  node_id: "n-d1-1",
  session_id: "s1",
  depth: 1,
  summary: "Mid-level summary spanning two D0 nodes.",
  token_count: 200,
  source_token_count: 800,
  source_type: "nodes" as const,
  source_ids: [],
  earliest_at: 1700000000,
  latest_at: 1700000200,
  expand_hint: "Drill down into D0.",
  children: [
    {
      kind: "node" as const,
      node_id: "n-d0-1",
      depth: 0,
      summary_preview: "preview of leaf one",
      child_count: 2,
    },
    {
      kind: "node" as const,
      node_id: "n-d0-2",
      depth: 0,
      summary_preview: "preview of leaf two",
      child_count: 3,
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

describe("<MessageDrillModal />", () => {
  it("renders nothing when open=false", () => {
    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d0-1"
        open={false}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("message-drill-modal")).not.toBeInTheDocument();
  });

  it("when open: fetches the root node detail and shows the header", async () => {
    const detailSpy = vi.fn(() => ({ body: D0_DETAIL }));
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d0-1$/, detailSpy);

    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d0-1"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => expect(detailSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId("message-drill-modal")).toBeInTheDocument();
    });
    expect(screen.getByTestId("message-drill-header")).toHaveTextContent(
      /Source messages/i,
    );
  });

  it("D0 node: renders raw messages from children", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d0-1$/, () => ({ body: D0_DETAIL }));

    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d0-1"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-drill-list")).toBeInTheDocument();
    });
    const list = screen.getByTestId("message-drill-list");
    expect(within(list).getByText(/What's the weather/)).toBeInTheDocument();
    expect(within(list).getByText(/Sunny and 72F/)).toBeInTheDocument();
  });

  it("D0 node: shows 'Lossless verified' chip with correct count", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d0-1$/, () => ({ body: D0_DETAIL }));

    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d0-1"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-drill-lossless-chip")).toBeInTheDocument();
    });
    expect(screen.getByTestId("message-drill-lossless-chip")).toHaveTextContent(
      /2 messages recovered/,
    );
  });

  it("D1+ node: shows children list (clickable rows), not raw messages", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d1-1$/, () => ({ body: D1_DETAIL }));

    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d1-1"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-drill-children")).toBeInTheDocument();
    });
    const children = screen.getByTestId("message-drill-children");
    expect(within(children).getByTestId("message-drill-child-n-d0-1")).toBeInTheDocument();
    expect(within(children).getByTestId("message-drill-child-n-d0-2")).toBeInTheDocument();
    // Should NOT show the raw message list section.
    expect(screen.queryByTestId("message-drill-list")).not.toBeInTheDocument();
    // Lossless chip should NOT be present for D1+.
    expect(screen.queryByTestId("message-drill-lossless-chip")).not.toBeInTheDocument();
  });

  it("clicking a child row drills into that node and replaces content", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d1-1$/, () => ({ body: D1_DETAIL }));
    const childSpy = vi.fn(() => ({ body: D0_DETAIL }));
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d0-1$/, childSpy);

    const user = userEvent.setup();
    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d1-1"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-drill-child-n-d0-1")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("message-drill-child-n-d0-1"));

    await waitFor(() => expect(childSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.getByTestId("message-drill-list")).toBeInTheDocument();
    });
    expect(screen.getByText(/What's the weather/)).toBeInTheDocument();
  });

  it("back button: pops stack, returns to previous level", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d1-1$/, () => ({ body: D1_DETAIL }));
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d0-1$/, () => ({ body: D0_DETAIL }));

    const user = userEvent.setup();
    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d1-1"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    // Wait for the D1 view.
    await waitFor(() => {
      expect(screen.getByTestId("message-drill-child-n-d0-1")).toBeInTheDocument();
    });
    // No back button on the root level.
    expect(screen.queryByTestId("message-drill-back")).not.toBeInTheDocument();

    // Drill down.
    await user.click(screen.getByTestId("message-drill-child-n-d0-1"));
    await waitFor(() => {
      expect(screen.getByTestId("message-drill-list")).toBeInTheDocument();
    });

    // Back button now visible.
    expect(screen.getByTestId("message-drill-back")).toBeInTheDocument();

    // Pop.
    await user.click(screen.getByTestId("message-drill-back"));
    await waitFor(() => {
      expect(screen.getByTestId("message-drill-children")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("message-drill-list")).not.toBeInTheDocument();
  });

  it("loading state: shows spinner while fetching", async () => {
    let resolveFn: (v: MockResponseInit) => void = () => {};
    const pending = new Promise<MockResponseInit>((resolve) => {
      resolveFn = resolve;
    });
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d0-1$/, () => pending);

    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d0-1"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-drill-loading")).toBeInTheDocument();
    });

    resolveFn({ body: D0_DETAIL });
    await waitFor(() => {
      expect(screen.queryByTestId("message-drill-loading")).not.toBeInTheDocument();
    });
  });

  it("API error: shows error inline + retry button", async () => {
    let attempt = 0;
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d0-1$/, () => {
      attempt += 1;
      if (attempt === 1) {
        return { status: 500, body: { error: "boom" } };
      }
      return { body: D0_DETAIL };
    });

    const user = userEvent.setup();
    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d0-1"
        open={true}
        onOpenChange={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-drill-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("message-drill-error")).toHaveTextContent(/Failed to load/);

    // Retry.
    await user.click(screen.getByTestId("message-drill-retry"));
    await waitFor(() => {
      expect(screen.getByTestId("message-drill-list")).toBeInTheDocument();
    });
  });

  it("close button: fires onOpenChange(false)", async () => {
    on("GET", /\/api\/agents\/.+\/lcm\/nodes\/n-d0-1$/, () => ({ body: D0_DETAIL }));
    const onOpenChange = vi.fn();

    const user = userEvent.setup();
    render(
      <MessageDrillModal
        agentId="alpha"
        rootNodeId="n-d0-1"
        open={true}
        onOpenChange={onOpenChange}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-drill-close")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("message-drill-close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
