import { describe, expect, it } from "vitest";
import { formatSessionMarkdown } from "@/lib/export-session";
import type { StoredSessionEntry } from "@/lib/normalize-session";

function entry(overrides: Partial<StoredSessionEntry> & Pick<StoredSessionEntry, "type" | "uuid">): StoredSessionEntry {
  return { text: "", message: undefined, ...overrides };
}

describe("formatSessionMarkdown", () => {
  it("returns a header even when transcript is empty", () => {
    const out = formatSessionMarkdown([], { sessionId: "s1" });
    expect(out).toContain("# Session: s1");
    expect(out).toContain("_No messages_");
  });

  it("includes lastModified and title in the header when provided", () => {
    const out = formatSessionMarkdown([], {
      sessionId: "s1",
      title: "My Important Session",
      lastModified: new Date("2026-04-20T10:00:00Z").getTime(),
    });
    expect(out).toContain("My Important Session");
    expect(out).toContain("2026-04-20");
  });

  it("renders user and assistant text in role-labelled sections", () => {
    const md = formatSessionMarkdown(
      [
        entry({
          type: "user",
          uuid: "u1",
          message: { role: "user", content: [{ type: "text", text: "hello" }] },
        }),
        entry({
          type: "assistant",
          uuid: "a1",
          message: { role: "assistant", content: [{ type: "text", text: "hi there" }] },
        }),
      ],
      { sessionId: "s1" },
    );
    expect(md).toContain("## User");
    expect(md).toContain("hello");
    expect(md).toContain("## Assistant");
    expect(md).toContain("hi there");
    expect(md.indexOf("## User")).toBeLessThan(md.indexOf("## Assistant"));
  });

  it("renders tool_use as a fenced JSON code block under the assistant message", () => {
    const md = formatSessionMarkdown(
      [
        entry({
          type: "assistant",
          uuid: "a1",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Searching the memory store..." },
              { type: "tool_use", id: "tu_1", name: "memory_search", input: { query: "logs" } },
            ],
          },
        }),
      ],
      { sessionId: "s1" },
    );
    expect(md).toContain("Searching the memory store...");
    expect(md).toMatch(/### Tool call: `memory_search`/);
    expect(md).toContain("```json");
    expect(md).toContain('"query": "logs"');
  });

  it("pairs tool_result with originating tool_use as a fenced output block", () => {
    const md = formatSessionMarkdown(
      [
        entry({
          type: "assistant",
          uuid: "a1",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "tu_1", name: "x", input: {} }],
          },
        }),
        entry({
          type: "user",
          uuid: "u2",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tu_1", content: "found 7 entries" }],
          },
        }),
      ],
      { sessionId: "s1" },
    );
    expect(md).toContain("Result");
    expect(md).toContain("found 7 entries");
  });

  it("does not duplicate a user section when the user turn is only tool_results", () => {
    const md = formatSessionMarkdown(
      [
        entry({
          type: "assistant",
          uuid: "a1",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "tu_1", name: "x", input: {} }],
          },
        }),
        entry({
          type: "user",
          uuid: "u2",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "tu_1", content: "ok" }],
          },
        }),
      ],
      { sessionId: "s1" },
    );
    expect((md.match(/## User/g) ?? []).length).toBe(0);
    expect((md.match(/## Assistant/g) ?? []).length).toBe(1);
  });

  it("escapes triple backticks inside output to avoid breaking the fence", () => {
    const md = formatSessionMarkdown(
      [
        entry({
          type: "assistant",
          uuid: "a1",
          message: {
            role: "assistant",
            content: [{ type: "tool_use", id: "tu_1", name: "x", input: {} }],
          },
        }),
        entry({
          type: "user",
          uuid: "u2",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "tu_1", content: "Use ```js\nconsole.log()\n```" },
            ],
          },
        }),
      ],
      { sessionId: "s1" },
    );
    // Original triple-backtick prefix from the user content must not survive verbatim
    expect(md).not.toContain("Use ```js");
    expect(md).toContain("console.log()");
    // Outer fence must be longer than any backtick run inside the content
    const outerFenceMatch = md.match(/\n(`{4,})\n/);
    expect(outerFenceMatch).not.toBeNull();
  });

  it("preserves order of mixed turns", () => {
    const md = formatSessionMarkdown(
      [
        entry({
          type: "user",
          uuid: "u1",
          message: { role: "user", content: [{ type: "text", text: "Q1" }] },
        }),
        entry({
          type: "assistant",
          uuid: "a1",
          message: { role: "assistant", content: [{ type: "text", text: "A1" }] },
        }),
        entry({
          type: "user",
          uuid: "u2",
          message: { role: "user", content: [{ type: "text", text: "Q2" }] },
        }),
      ],
      { sessionId: "s1" },
    );
    expect(md.indexOf("Q1")).toBeLessThan(md.indexOf("A1"));
    expect(md.indexOf("A1")).toBeLessThan(md.indexOf("Q2"));
  });
});
