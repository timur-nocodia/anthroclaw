import type { ChatMessage, ToolCall } from "@/components/chat-message";

export interface StoredSessionEntry {
  type: string;
  uuid: string;
  text?: string;
  message?: unknown;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function extractContentBlocks(message: unknown): ContentBlock[] {
  const record = asRecord(message);
  if (!record) return [];

  const content = record.content;
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (!Array.isArray(content)) return [];

  return content
    .map((block): ContentBlock | null => {
      if (typeof block === "string") return { type: "text", text: block };
      const rec = asRecord(block);
      if (!rec || typeof rec.type !== "string") return null;
      return rec as unknown as ContentBlock;
    })
    .filter((block): block is ContentBlock => block !== null);
}

function stringifyResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        const rec = asRecord(block);
        if (!rec) return "";
        if (typeof rec.text === "string") return rec.text;
        if (typeof rec.content === "string") return rec.content;
        return JSON.stringify(block);
      })
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return JSON.stringify(content);
}

/**
 * Convert persisted SDK session entries into the same ChatMessage shape the live
 * stream produces, so MessageBubble + ToolCallCard render saved history identically.
 *
 * Anthropic content-block conventions:
 * - assistant turns may contain `text` and `tool_use` blocks
 * - the next user turn may contain `tool_result` blocks; we pair them back to the
 *   originating tool_use by `tool_use_id`
 * - user turns whose only content is `tool_result` blocks are not rendered as a
 *   separate user bubble — the result is folded into the agent message above
 */
export function storedEntriesToChatMessages(entries: StoredSessionEntry[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  const pendingToolCalls = new Map<string, ToolCall>();
  const ts = new Date();

  for (const entry of entries) {
    if (entry.type !== "user" && entry.type !== "assistant") continue;

    const blocks = extractContentBlocks(entry.message);
    const fallbackText = (entry.text ?? "").trim();

    if (entry.type === "assistant") {
      const textParts: string[] = [];
      const toolCalls: ToolCall[] = [];

      for (const block of blocks) {
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
          const tc: ToolCall = {
            id: block.id,
            name: block.name,
            input: block.input ?? {},
            status: "done",
          };
          toolCalls.push(tc);
          pendingToolCalls.set(block.id, tc);
        }
      }

      const content = textParts.join("").trim() || (toolCalls.length === 0 ? fallbackText : "");
      if (!content && toolCalls.length === 0) continue;

      result.push({
        id: entry.uuid,
        role: "agent",
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        ts,
        streaming: false,
      });
      continue;
    }

    const textParts: string[] = [];
    for (const block of blocks) {
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const tc = pendingToolCalls.get(block.tool_use_id);
        if (tc) {
          tc.output = stringifyResultContent(block.content);
          pendingToolCalls.delete(block.tool_use_id);
        }
      } else if (block.type === "text" && typeof block.text === "string") {
        textParts.push(block.text);
      }
    }

    const content = textParts.join("\n\n").trim() || fallbackText;
    if (!content) continue;

    result.push({
      id: entry.uuid,
      role: "user",
      content,
      ts,
      streaming: false,
    });
  }

  return result;
}
