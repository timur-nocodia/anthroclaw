import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import {
  BindingTestPanel,
  type BindingTestRoute,
} from "@/components/binding/BindingTestPanel";

const groupRoute: BindingTestRoute = {
  channel: "telegram",
  account: "content_sm",
  scope: "group",
  peers: ["-1003729315809"],
  topics: ["3"],
  mention_only: true,
};

const dmRoute: BindingTestRoute = {
  channel: "whatsapp",
  account: "humanrobot",
  scope: "dm",
  peers: null,
  topics: null,
};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

describe("BindingTestPanel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not render content when closed", () => {
    render(
      <BindingTestPanel
        open={false}
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={groupRoute}
      />,
    );
    expect(
      screen.queryByTestId("binding-test-panel"),
    ).not.toBeInTheDocument();
  });

  it("pre-populates fields from the route prop", () => {
    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={groupRoute}
      />,
    );

    expect(screen.getByTestId("binding-test-panel")).toBeInTheDocument();
    expect(screen.getByTestId("binding-test-channel")).toHaveTextContent(
      /telegram/i,
    );
    expect(screen.getByTestId("binding-test-account")).toHaveTextContent(
      /content_sm/,
    );
    expect(screen.getByTestId("binding-test-chat-type")).toHaveTextContent(
      /group/i,
    );
    const peer = screen.getByTestId(
      "binding-test-peer-id",
    ) as HTMLInputElement;
    expect(peer.value).toBe("-1003729315809");
    const thread = screen.getByTestId(
      "binding-test-thread-id",
    ) as HTMLInputElement;
    expect(thread.value).toBe("3");
    const mention = screen.getByTestId(
      "binding-test-mention",
    ) as HTMLInputElement;
    expect(mention.checked).toBe(true);
  });

  it("mention checkbox default mirrors route.mention_only=false", () => {
    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={{ ...groupRoute, mention_only: false }}
      />,
    );
    const mention = screen.getByTestId(
      "binding-test-mention",
    ) as HTMLInputElement;
    expect(mention.checked).toBe(false);
  });

  it("requires sender_id before submitting (Run match disabled)", () => {
    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={groupRoute}
      />,
    );
    const button = screen.getByTestId(
      "binding-test-run",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("Run match calls fetch with correct payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        matched: true,
        agent_id: "operator_agent",
        session_key: "operator_agent:telegram:group:-1003729315809:thread:3",
        blockers: [],
      }),
    );

    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={groupRoute}
      />,
    );

    fireEvent.change(screen.getByTestId("binding-test-sender-id"), {
      target: { value: "48705953" },
    });
    fireEvent.change(screen.getByTestId("binding-test-text"), {
      target: { value: "@clowwy_bot show_config" },
    });

    const run = screen.getByTestId("binding-test-run");
    fireEvent.click(run);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/agents/operator_agent/route-test");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body).toEqual({
      channel: "telegram",
      account_id: "content_sm",
      chat_type: "group",
      peer_id: "-1003729315809",
      thread_id: "3",
      sender_id: "48705953",
      text: "@clowwy_bot show_config",
      mentioned_bot: true,
    });
  });

  it("renders matched ✓ when API returns matched: true", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        matched: true,
        agent_id: "operator_agent",
        session_key: "operator_agent:telegram:group:-1003729315809:thread:3",
        blockers: [],
      }),
    );

    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={groupRoute}
      />,
    );

    fireEvent.change(screen.getByTestId("binding-test-sender-id"), {
      target: { value: "48705953" },
    });
    fireEvent.click(screen.getByTestId("binding-test-run"));

    const result = await screen.findByTestId("binding-test-result-matched");
    expect(result).toHaveTextContent(/Routed to/);
    expect(result).toHaveTextContent(/operator_agent/);
    expect(
      screen.getByTestId("binding-test-result-session-key"),
    ).toHaveTextContent(
      "operator_agent:telegram:group:-1003729315809:thread:3",
    );
  });

  it("renders warning when matched agent differs from current agentId", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        matched: false,
        agent_id: "other_agent",
        session_key: null,
        blockers: [
          { stage: "route", reason: 'route is owned by another agent: "other_agent"' },
        ],
      }),
    );

    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={groupRoute}
      />,
    );

    fireEvent.change(screen.getByTestId("binding-test-sender-id"), {
      target: { value: "48705953" },
    });
    fireEvent.click(screen.getByTestId("binding-test-run"));

    const result = await screen.findByTestId("binding-test-result-other-agent");
    expect(result).toHaveTextContent(/different agent/i);
    expect(result).toHaveTextContent(/other_agent/);
  });

  it("renders blocker reasons when API returns matched: false", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        matched: false,
        agent_id: null,
        session_key: null,
        blockers: [
          { stage: "route", reason: "no agent route matches this peer" },
          { stage: "mention", reason: "route requires @-mention but message did not include one" },
        ],
      }),
    );

    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={groupRoute}
      />,
    );

    fireEvent.change(screen.getByTestId("binding-test-sender-id"), {
      target: { value: "48705953" },
    });
    fireEvent.click(screen.getByTestId("binding-test-run"));

    const result = await screen.findByTestId("binding-test-result-not-matched");
    expect(result).toHaveTextContent(/Not matched/i);
    const items = screen.getAllByTestId("binding-test-blocker");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(
      /no agent route matches this peer/,
    );
    expect(items[1]).toHaveTextContent(/@-mention/);
  });

  it("renders generic error when fetch fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={groupRoute}
      />,
    );

    fireEvent.change(screen.getByTestId("binding-test-sender-id"), {
      target: { value: "48705953" },
    });
    fireEvent.click(screen.getByTestId("binding-test-run"));

    const err = await screen.findByTestId("binding-test-result-error");
    expect(err).toHaveTextContent(/Error/);
    expect(err).toHaveTextContent(/network down/);
  });

  it("uses chat_type=group when route.scope is 'any'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        matched: false,
        agent_id: null,
        session_key: null,
        blockers: [],
      }),
    );

    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={{ ...groupRoute, scope: "any" }}
      />,
    );

    fireEvent.change(screen.getByTestId("binding-test-sender-id"), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByTestId("binding-test-run"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_type).toBe("group");
  });

  it("DM route (no peer) lets user enter peer_id manually", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        matched: true,
        agent_id: "operator_agent",
        session_key: "operator_agent:whatsapp:dm:1234@s.whatsapp.net",
        blockers: [],
      }),
    );

    render(
      <BindingTestPanel
        open
        onOpenChange={vi.fn()}
        agentId="operator_agent"
        route={dmRoute}
      />,
    );

    fireEvent.change(screen.getByTestId("binding-test-peer-id"), {
      target: { value: "1234@s.whatsapp.net" },
    });
    fireEvent.change(screen.getByTestId("binding-test-sender-id"), {
      target: { value: "1234@s.whatsapp.net" },
    });
    fireEvent.click(screen.getByTestId("binding-test-run"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      channel: "whatsapp",
      account_id: "humanrobot",
      chat_type: "dm",
      peer_id: "1234@s.whatsapp.net",
      sender_id: "1234@s.whatsapp.net",
    });
  });
});
