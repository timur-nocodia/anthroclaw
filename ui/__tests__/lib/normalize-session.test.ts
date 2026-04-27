import { describe, expect, it } from "vitest";
import { storedEntriesToChatMessages, type StoredSessionEntry } from "@/lib/normalize-session";

function entry(overrides: Partial<StoredSessionEntry> & Pick<StoredSessionEntry, "type" | "uuid">): StoredSessionEntry {
  return { text: "", message: undefined, ...overrides };
}

describe("storedEntriesToChatMessages", () => {
  it("returns [] for empty input", () => {
    expect(storedEntriesToChatMessages([])).toEqual([]);
  });

  it("skips system/non-conversational entries", () => {
    const out = storedEntriesToChatMessages([
      entry({ type: "system", uuid: "s1", text: "boot" }),
      entry({ type: "summary", uuid: "s2", text: "compaction" }),
    ]);
    expect(out).toEqual([]);
  });

  it("renders a plain user text message", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "user",
        uuid: "u1",
        message: { role: "user", content: [{ type: "text", text: "hello" }] },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "u1", role: "user", content: "hello" });
    expect(out[0].toolCalls).toBeUndefined();
  });

  it("falls back to entry.text when message is missing", () => {
    const out = storedEntriesToChatMessages([
      entry({ type: "user", uuid: "u1", text: "fallback hi" }),
    ]);
    expect(out[0].content).toBe("fallback hi");
  });

  it("handles plain-string content (not an array)", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "user",
        uuid: "u1",
        message: { role: "user", content: "plain string" },
      }),
    ]);
    expect(out[0].content).toBe("plain string");
  });

  it("renders a plain assistant text message", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "assistant",
        uuid: "a1",
        message: { role: "assistant", content: [{ type: "text", text: "hi there" }] },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a1", role: "agent", content: "hi there" });
    expect(out[0].toolCalls).toBeUndefined();
  });

  it("captures tool_use blocks on assistant message with status=done", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Searching..." },
            { type: "tool_use", id: "tu_1", name: "memory_search", input: { q: "logs" } },
          ],
        },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe("Searching...");
    expect(out[0].toolCalls).toEqual([
      { id: "tu_1", name: "memory_search", input: { q: "logs" }, status: "done" },
    ]);
  });

  it("pairs tool_result from following user entry with tool_use by id", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu_1", name: "memory_search", input: {} }],
        },
      }),
      entry({
        type: "user",
        uuid: "u2",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu_1", content: "found 3 entries" },
          ],
        },
      }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].toolCalls?.[0].output).toBe("found 3 entries");
  });

  it("does not emit a user message that contains only tool_result blocks", () => {
    const out = storedEntriesToChatMessages([
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
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("agent");
  });

  it("emits a user message when tool_result is mixed with text", () => {
    const out = storedEntriesToChatMessages([
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
            { type: "tool_result", tool_use_id: "tu_1", content: "ok" },
            { type: "text", text: "follow-up question" },
          ],
        },
      }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].toolCalls?.[0].output).toBe("ok");
    expect(out[1]).toMatchObject({ role: "user", content: "follow-up question" });
  });

  it("pairs multiple tool_results with multiple tool_uses regardless of order", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu_1", name: "a", input: { v: 1 } },
            { type: "tool_use", id: "tu_2", name: "b", input: { v: 2 } },
          ],
        },
      }),
      entry({
        type: "user",
        uuid: "u2",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tu_2", content: "B output" },
            { type: "tool_result", tool_use_id: "tu_1", content: "A output" },
          ],
        },
      }),
    ]);
    expect(out[0].toolCalls).toHaveLength(2);
    expect(out[0].toolCalls?.find((tc) => tc.id === "tu_1")?.output).toBe("A output");
    expect(out[0].toolCalls?.find((tc) => tc.id === "tu_2")?.output).toBe("B output");
  });

  it("leaves orphaned tool_use without output when no result follows", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tu_1", name: "x", input: {} }],
        },
      }),
    ]);
    expect(out[0].toolCalls?.[0].output).toBeUndefined();
    expect(out[0].toolCalls?.[0].status).toBe("done");
  });

  it("ignores orphaned tool_result without a matching tool_use", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "user",
        uuid: "u1",
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "missing", content: "x" }],
        },
      }),
    ]);
    expect(out).toEqual([]);
  });

  it("stringifies tool_result content that is an array of blocks", () => {
    const out = storedEntriesToChatMessages([
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
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [
                { type: "text", text: "line A" },
                { type: "text", text: "line B" },
              ],
            },
          ],
        },
      }),
    ]);
    expect(out[0].toolCalls?.[0].output).toBe("line A\nline B");
  });

  it("ignores unknown block types but does not crash", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "assistant",
        uuid: "a1",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "internal" },
            { type: "text", text: "visible" },
          ],
        },
      }),
    ]);
    expect(out[0].content).toBe("visible");
  });

  it("preserves order across mixed user/assistant turns", () => {
    const out = storedEntriesToChatMessages([
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
    ]);
    expect(out.map((m) => [m.role, m.content])).toEqual([
      ["user", "Q1"],
      ["agent", "A1"],
      ["user", "Q2"],
    ]);
  });

  it("drops empty agent entries that have neither text nor tool calls", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "assistant",
        uuid: "a1",
        message: { role: "assistant", content: [] },
      }),
    ]);
    expect(out).toEqual([]);
  });

  it("uses entry.uuid as the ChatMessage id and sets streaming=false", () => {
    const out = storedEntriesToChatMessages([
      entry({
        type: "assistant",
        uuid: "abc-123",
        message: { role: "assistant", content: [{ type: "text", text: "x" }] },
      }),
    ]);
    expect(out[0].id).toBe("abc-123");
    expect(out[0].streaming).toBe(false);
  });
});
