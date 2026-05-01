import { describe, it, expect } from "vitest";

import {
  describeBinding,
  type BindingRouteInput,
} from "@/components/binding/binding-language";

describe("describeBinding", () => {
  it("describes Telegram group + topic + mention-only", () => {
    const route: BindingRouteInput = {
      channel: "telegram",
      account: "content_sm",
      scope: "group",
      peers: ["-1003729315809"],
      topics: ["3"],
      mention_only: true,
    };
    expect(
      describeBinding(route, {
        telegramAccounts: { content_sm: { username: "clowwy_bot" } },
      }),
    ).toEqual({
      icon: "telegram",
      title: "Telegram (clowwy_bot · content_sm)",
      lines: [
        "In group: -1003729315809",
        "In topic: 3",
        "Behavior: Responds only when @-mentioned",
      ],
    });
  });

  it("describes Telegram DM with allowlist", () => {
    const route: BindingRouteInput = {
      channel: "telegram",
      account: "main",
      scope: "dm",
      peers: null,
      topics: null,
    };
    const desc = describeBinding(route, {
      telegramAccounts: { main: { username: "clowwy_personal_bot" } },
      allowlist: ["48705953"],
    });
    expect(desc.icon).toBe("telegram");
    expect(desc.title).toBe("Telegram (clowwy_personal_bot · main)");
    expect(desc.lines[0]).toBe("In: All direct messages");
    expect(desc.lines[1]).toBe("Behavior: Allowlisted users only (1)");
  });

  it("describes Telegram DM with open pairing", () => {
    const route: BindingRouteInput = {
      channel: "telegram",
      account: "main",
      scope: "dm",
    };
    const desc = describeBinding(route, {
      telegramAccounts: { main: { username: "clowwy_bot" } },
      pairingMode: "open",
    });
    expect(desc.lines).toContain("Behavior: Open pairing (anyone can DM)");
  });

  it("describes WhatsApp DM with open pairing", () => {
    const route: BindingRouteInput = {
      channel: "whatsapp",
      account: "humanrobot",
      scope: "dm",
    };
    const desc = describeBinding(route, { pairingMode: "open" });
    expect(desc.icon).toBe("whatsapp");
    expect(desc.title).toBe("WhatsApp (humanrobot)");
    expect(desc.lines[0]).toBe("In: All direct messages");
    expect(desc.lines[1]).toBe("Behavior: Open pairing (anyone can DM)");
  });

  it("describes Telegram any-scope respond-to-all", () => {
    const route: BindingRouteInput = {
      channel: "telegram",
      account: "main",
      scope: "any",
      mention_only: false,
    };
    const desc = describeBinding(route, {
      telegramAccounts: { main: { username: "clowwy_bot" } },
    });
    expect(desc.lines).toEqual([
      "In: Any chat (DMs and groups)",
      "Behavior: Responds to every message in this scope",
    ]);
  });

  it("falls back to account_id when no known username", () => {
    const route: BindingRouteInput = {
      channel: "telegram",
      account: "mystery",
      scope: "group",
      peers: ["-100"],
      mention_only: true,
    };
    const desc = describeBinding(route, {});
    expect(desc.title).toBe("Telegram (mystery)");
  });

  it("supports the legacy mentionOnly camelCase field", () => {
    const route: BindingRouteInput = {
      channel: "telegram",
      account: "main",
      scope: "group",
      peers: ["-100"],
      mentionOnly: true,
    };
    const desc = describeBinding(route, {});
    expect(desc.lines).toContain("Behavior: Responds only when @-mentioned");
  });

  it("describes incoming_reply_only behavior for group", () => {
    const route: BindingRouteInput = {
      channel: "telegram",
      account: "main",
      scope: "group",
      peers: ["-100"],
      reply_to_mode: "incoming_reply_only",
    };
    const desc = describeBinding(route, {});
    expect(desc.lines).toContain(
      "Behavior: Responds only when someone replies to its messages",
    );
  });
});
