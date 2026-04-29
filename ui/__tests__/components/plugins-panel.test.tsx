import React from "react";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PluginsPanel } from "@/components/plugins/PluginsPanel";

/* ------------------------------------------------------------------ */
/*  Sonner mock — verify toast calls without rendering portal          */
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
/*  Fetch mock — pluggable per-test                                    */
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
/*  Fixture data                                                       */
/* ------------------------------------------------------------------ */

const PLUGIN_LCM = {
  name: "lcm",
  version: "0.1.0",
  description: "Lossless Context Memory",
  hasConfigSchema: true,
  hasMcpTools: true,
  hasContextEngine: true,
  toolCount: 2,
};

const PLUGIN_EXAMPLE = {
  name: "example",
  version: "0.0.1",
  description: undefined,
  hasConfigSchema: false,
  hasMcpTools: false,
  hasContextEngine: false,
  toolCount: 0,
};

const LCM_SCHEMA = {
  type: "object",
  properties: {
    enabled: { type: "boolean", description: "Enable LCM" },
    triggers: {
      type: "object",
      properties: {
        threshold: { type: "integer", description: "Token threshold" },
      },
    },
  },
};

const LCM_DEFAULTS = { enabled: false, triggers: { threshold: 40000 } };

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

let fetchMock: ReturnType<typeof installFetchMock>;

beforeEach(() => {
  toastSuccess.mockReset();
  toastError.mockReset();
  fetchMock = installFetchMock();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("<PluginsPanel />", () => {
  it("renders empty state when no plugins are installed", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: { agentId: "alpha", plugins: [] },
    }));

    render(<PluginsPanel agentId="alpha" />);

    await waitFor(() => {
      expect(screen.getByText(/No plugins installed/i)).toBeInTheDocument();
    });
  });

  it("renders one card per installed plugin with name + version + description", async () => {
    on("GET", /\/api\/plugins$/, () => ({
      body: { plugins: [PLUGIN_LCM, PLUGIN_EXAMPLE] },
    }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [
          { name: "lcm", enabled: false, config: {} },
          { name: "example", enabled: false, config: {} },
        ],
      },
    }));

    render(<PluginsPanel agentId="alpha" />);

    await waitFor(() => {
      expect(screen.getByTestId("plugin-card-lcm")).toBeInTheDocument();
    });
    const lcmCard = screen.getByTestId("plugin-card-lcm");
    expect(within(lcmCard).getByText("lcm")).toBeInTheDocument();
    expect(within(lcmCard).getByText(/v0\.1\.0/)).toBeInTheDocument();
    expect(within(lcmCard).getByText(/Lossless Context Memory/)).toBeInTheDocument();
    expect(within(lcmCard).getByText(/2 tools/)).toBeInTheDocument();
    expect(within(lcmCard).getByText(/Context engine/)).toBeInTheDocument();
    expect(within(lcmCard).getByText(/Config schema/)).toBeInTheDocument();

    const exampleCard = screen.getByTestId("plugin-card-example");
    expect(within(exampleCard).getByText("example")).toBeInTheDocument();
    expect(within(exampleCard).getByText(/v0\.0\.1/)).toBeInTheDocument();
  });

  it("renders enabled/disabled state correctly per agent", async () => {
    on("GET", /\/api\/plugins$/, () => ({
      body: { plugins: [PLUGIN_LCM, PLUGIN_EXAMPLE] },
    }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [
          { name: "lcm", enabled: true, config: {} },
          { name: "example", enabled: false, config: {} },
        ],
      },
    }));

    render(<PluginsPanel agentId="alpha" />);

    await waitFor(() => {
      expect(screen.getByTestId("plugin-toggle-lcm")).toBeInTheDocument();
    });
    const lcmToggle = screen.getByTestId("plugin-toggle-lcm") as HTMLInputElement;
    const exampleToggle = screen.getByTestId("plugin-toggle-example") as HTMLInputElement;
    expect(lcmToggle.checked).toBe(true);
    expect(exampleToggle.checked).toBe(false);
  });

  it("toggling switch fires PUT and updates state on success", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_LCM] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "lcm", enabled: false, config: {} }],
      },
    }));
    const putSpy = vi.fn(() => ({ body: { ok: true, enabled: true } }));
    on("PUT", /\/api\/agents\/.+\/plugins\/lcm$/, putSpy);

    const user = userEvent.setup();
    render(<PluginsPanel agentId="alpha" />);
    await waitFor(() => screen.getByTestId("plugin-toggle-lcm"));

    const toggle = screen.getByTestId("plugin-toggle-lcm") as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    await user.click(toggle);

    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(toggle.checked).toBe(true);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("toggling switch with API error rolls back + shows error toast", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_LCM] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "lcm", enabled: false, config: {} }],
      },
    }));
    on("PUT", /\/api\/agents\/.+\/plugins\/lcm$/, () => ({
      status: 500,
      body: { error: "boom" },
    }));

    const user = userEvent.setup();
    render(<PluginsPanel agentId="alpha" />);
    await waitFor(() => screen.getByTestId("plugin-toggle-lcm"));

    const toggle = screen.getByTestId("plugin-toggle-lcm") as HTMLInputElement;
    await user.click(toggle);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toggle.checked).toBe(false); // rolled back
  });

  it("expanding configure form fetches schema + current config and shows defaults", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_LCM] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "lcm", enabled: true, config: {} }],
      },
    }));
    on("GET", /\/api\/plugins\/lcm\/config-schema$/, () => ({
      body: { name: "lcm", jsonSchema: LCM_SCHEMA, defaults: LCM_DEFAULTS },
    }));
    const configSpy = vi.fn(() => ({
      body: { agentId: "alpha", pluginName: "lcm", config: { triggers: { threshold: 50000 } } },
    }));
    on("GET", /\/api\/agents\/.+\/plugins\/lcm\/config$/, configSpy);

    const user = userEvent.setup();
    render(<PluginsPanel agentId="alpha" />);
    await waitFor(() => screen.getByTestId("plugin-configure-lcm"));

    await user.click(screen.getByTestId("plugin-configure-lcm"));

    await waitFor(() => expect(configSpy).toHaveBeenCalled());
    // Threshold input from server config (50000) should be populated
    await waitFor(() => {
      const numInputs = document.querySelectorAll('input[type="number"]');
      const values = Array.from(numInputs).map((n) => (n as HTMLInputElement).value);
      expect(values).toContain("50000");
    });
  });

  it("saving config fires PUT and shows success toast", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_LCM] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "lcm", enabled: true, config: {} }],
      },
    }));
    on("GET", /\/api\/plugins\/lcm\/config-schema$/, () => ({
      body: { name: "lcm", jsonSchema: LCM_SCHEMA, defaults: LCM_DEFAULTS },
    }));
    on("GET", /\/api\/agents\/.+\/plugins\/lcm\/config$/, () => ({
      body: { agentId: "alpha", pluginName: "lcm", config: {} },
    }));
    const putSpy = vi.fn(async (req: Request) => {
      const body = await req.json();
      expect(body).toHaveProperty("config");
      return { body: { ok: true } };
    });
    on("PUT", /\/api\/agents\/.+\/plugins\/lcm\/config$/, putSpy);

    const user = userEvent.setup();
    render(<PluginsPanel agentId="alpha" />);
    await waitFor(() => screen.getByTestId("plugin-configure-lcm"));
    await user.click(screen.getByTestId("plugin-configure-lcm"));

    await waitFor(() => screen.getByTestId("plugin-save-lcm"));
    await user.click(screen.getByTestId("plugin-save-lcm"));

    await waitFor(() => expect(putSpy).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("saving with invalid Zod config shows per-field errors from response", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_LCM] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "lcm", enabled: true, config: {} }],
      },
    }));
    on("GET", /\/api\/plugins\/lcm\/config-schema$/, () => ({
      body: { name: "lcm", jsonSchema: LCM_SCHEMA, defaults: LCM_DEFAULTS },
    }));
    on("GET", /\/api\/agents\/.+\/plugins\/lcm\/config$/, () => ({
      body: { agentId: "alpha", pluginName: "lcm", config: {} },
    }));
    on("PUT", /\/api\/agents\/.+\/plugins\/lcm\/config$/, () => ({
      status: 400,
      body: {
        error: "invalid_config",
        issues: [
          { path: ["triggers", "threshold"], message: "Expected number, got string" },
        ],
      },
    }));

    const user = userEvent.setup();
    render(<PluginsPanel agentId="alpha" />);
    await waitFor(() => screen.getByTestId("plugin-configure-lcm"));
    await user.click(screen.getByTestId("plugin-configure-lcm"));
    await waitFor(() => screen.getByTestId("plugin-save-lcm"));
    await user.click(screen.getByTestId("plugin-save-lcm"));

    await waitFor(() => {
      expect(screen.getByTestId("field-error-triggers.threshold")).toHaveTextContent(
        /Expected number/i,
      );
    });
    expect(toastError).toHaveBeenCalled();
  });

  it("does not show Configure button when plugin has no config schema", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_EXAMPLE] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "example", enabled: true, config: {} }],
      },
    }));

    render(<PluginsPanel agentId="alpha" />);

    await waitFor(() => screen.getByTestId("plugin-card-example"));
    expect(screen.queryByTestId("plugin-configure-example")).not.toBeInTheDocument();
  });

  it("does not show Configure button when plugin has schema but is disabled", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_LCM] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "lcm", enabled: false, config: {} }],
      },
    }));

    render(<PluginsPanel agentId="alpha" />);

    await waitFor(() => screen.getByTestId("plugin-card-lcm"));
    expect(screen.queryByTestId("plugin-configure-lcm")).not.toBeInTheDocument();
  });

  it("handles partial fetch failure on mount: list ok but per-agent state errors", async () => {
    on("GET", /\/api\/plugins$/, () => ({
      body: { plugins: [PLUGIN_LCM] },
    }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      status: 500,
      body: { error: "server_error" },
    }));

    render(<PluginsPanel agentId="alpha" />);

    // Should NOT remain in loading skeleton forever — partial failure exits loading
    await waitFor(() => {
      expect(screen.queryByTestId("plugin-skeleton")).not.toBeInTheDocument();
    });

    // Failure surfaces via error toast
    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });

    // Plugin list still rendered (since /api/plugins succeeded)
    expect(screen.getByTestId("plugin-card-lcm")).toBeInTheDocument();
  });

  it("concurrent toggles: failing toggle on plugin B does not clobber successful toggle on plugin A", async () => {
    on("GET", /\/api\/plugins$/, () => ({
      body: { plugins: [PLUGIN_LCM, PLUGIN_EXAMPLE] },
    }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [
          { name: "lcm", enabled: false, config: {} },
          { name: "example", enabled: false, config: {} },
        ],
      },
    }));

    // Plugin A (lcm) PUT: delayed success, so it's still in flight when B fires
    let resolveA: (v: Response) => void = () => {};
    on("PUT", /\/api\/agents\/.+\/plugins\/lcm$/, () => {
      return new Promise<Response>((resolve) => {
        resolveA = resolve;
      });
    });
    // Plugin B (example) PUT: immediate failure
    on("PUT", /\/api\/agents\/.+\/plugins\/example$/, () => ({
      status: 500,
      body: { error: "boom" },
    }));

    const user = userEvent.setup();
    render(<PluginsPanel agentId="alpha" />);

    await waitFor(() => screen.getByTestId("plugin-toggle-lcm"));
    const toggleA = screen.getByTestId("plugin-toggle-lcm") as HTMLInputElement;
    const toggleB = screen.getByTestId("plugin-toggle-example") as HTMLInputElement;

    // Click A first → optimistic enabled=true, PUT in flight
    await user.click(toggleA);
    expect(toggleA.checked).toBe(true);

    // Now click B before A's PUT resolves → optimistic enabled=true, PUT will fail
    await user.click(toggleB);

    // Wait for B's failure to roll back B
    await waitFor(() => expect(toggleB.checked).toBe(false));

    // Critical assertion: A's optimistic state must NOT have been clobbered
    // by B's rollback (the bug was that B captured pre-A snapshot and restored it)
    expect(toggleA.checked).toBe(true);

    // Now resolve A's PUT successfully
    resolveA(jsonResponse({ ok: true, enabled: true }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toggleA.checked).toBe(true);
  });

  it("after successful save, re-fetches canonical config and updates local values", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_LCM] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "lcm", enabled: true, config: {} }],
      },
    }));
    on("GET", /\/api\/plugins\/lcm\/config-schema$/, () => ({
      body: { name: "lcm", jsonSchema: LCM_SCHEMA, defaults: LCM_DEFAULTS },
    }));

    // Track GET /config calls — first call returns user value, second (refetch) returns canonical
    let getConfigCalls = 0;
    on("GET", /\/api\/agents\/.+\/plugins\/lcm\/config$/, () => {
      getConfigCalls++;
      if (getConfigCalls === 1) {
        // initial load — user-supplied value
        return {
          body: {
            agentId: "alpha",
            pluginName: "lcm",
            config: { triggers: { threshold: 12345 } },
          },
        };
      }
      // refetch after save — server normalized to canonical value
      return {
        body: {
          agentId: "alpha",
          pluginName: "lcm",
          config: { triggers: { threshold: 77777 } },
        },
      };
    });
    on("PUT", /\/api\/agents\/.+\/plugins\/lcm\/config$/, () => ({
      body: { ok: true },
    }));

    const user = userEvent.setup();
    render(<PluginsPanel agentId="alpha" />);
    await waitFor(() => screen.getByTestId("plugin-configure-lcm"));
    await user.click(screen.getByTestId("plugin-configure-lcm"));
    await waitFor(() => screen.getByTestId("plugin-save-lcm"));

    // Initially, threshold = 12345 from first GET
    await waitFor(() => {
      const numInputs = document.querySelectorAll('input[type="number"]');
      const vals = Array.from(numInputs).map((n) => (n as HTMLInputElement).value);
      expect(vals).toContain("12345");
    });

    await user.click(screen.getByTestId("plugin-save-lcm"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    // After save, the refetch should populate canonical 77777 into the form
    await waitFor(() => {
      const numInputs = document.querySelectorAll('input[type="number"]');
      const vals = Array.from(numInputs).map((n) => (n as HTMLInputElement).value);
      expect(vals).toContain("77777");
      expect(vals).not.toContain("12345");
    });

    // Sanity: GET /config was called twice (initial load + post-save refetch)
    expect(getConfigCalls).toBe(2);
  });

  it("Reset button restores defaults from schema", async () => {
    on("GET", /\/api\/plugins$/, () => ({ body: { plugins: [PLUGIN_LCM] } }));
    on("GET", /\/api\/agents\/.+\/plugins$/, () => ({
      body: {
        agentId: "alpha",
        plugins: [{ name: "lcm", enabled: true, config: {} }],
      },
    }));
    on("GET", /\/api\/plugins\/lcm\/config-schema$/, () => ({
      body: { name: "lcm", jsonSchema: LCM_SCHEMA, defaults: LCM_DEFAULTS },
    }));
    on("GET", /\/api\/agents\/.+\/plugins\/lcm\/config$/, () => ({
      body: { agentId: "alpha", pluginName: "lcm", config: { triggers: { threshold: 99999 } } },
    }));

    const user = userEvent.setup();
    render(<PluginsPanel agentId="alpha" />);
    await waitFor(() => screen.getByTestId("plugin-configure-lcm"));
    await user.click(screen.getByTestId("plugin-configure-lcm"));

    // Wait for the form to render
    await waitFor(() => screen.getByTestId("plugin-reset-lcm"));
    // Initially threshold should be 99999 (from server config)
    await waitFor(() => {
      const numInputs = document.querySelectorAll('input[type="number"]');
      const vals = Array.from(numInputs).map((n) => (n as HTMLInputElement).value);
      expect(vals).toContain("99999");
    });

    await user.click(screen.getByTestId("plugin-reset-lcm"));

    // After reset, threshold should be 40000 (the default)
    await waitFor(() => {
      const numInputs = document.querySelectorAll('input[type="number"]');
      const vals = Array.from(numInputs).map((n) => (n as HTMLInputElement).value);
      expect(vals).toContain("40000");
      expect(vals).not.toContain("99999");
    });
    expect(toastSuccess).toHaveBeenCalled();
  });
});
