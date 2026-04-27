import { storedEntriesToChatMessages, type StoredSessionEntry } from "@/lib/normalize-session";

export interface FormatSessionMarkdownOptions {
  sessionId: string;
  title?: string;
  lastModified?: number;
}

function escapeFencedContent(value: string, fence: string): string {
  const breaker = fence.replace(/`/g, "ʼ");
  return value.replace(/```/g, breaker);
}

function pickLongestFence(values: string[]): string {
  let longest = 2;
  for (const v of values) {
    const matches = v.match(/`{3,}/g);
    if (matches) {
      for (const m of matches) longest = Math.max(longest, m.length);
    }
  }
  return "`".repeat(longest + 1);
}

export function formatSessionMarkdown(
  entries: StoredSessionEntry[],
  options: FormatSessionMarkdownOptions,
): string {
  const { sessionId, title, lastModified } = options;
  const messages = storedEntriesToChatMessages(entries);

  const lines: string[] = [];
  const headerTitle = title?.trim() || sessionId;
  lines.push(`# Session: ${headerTitle}`);
  if (title?.trim() && title.trim() !== sessionId) {
    lines.push("");
    lines.push(`> Session ID: \`${sessionId}\``);
  }
  if (typeof lastModified === "number") {
    lines.push(`> Last modified: ${new Date(lastModified).toISOString()}`);
  }
  lines.push("");
  lines.push("---");
  lines.push("");

  if (messages.length === 0) {
    lines.push("_No messages_");
    return lines.join("\n");
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      lines.push("## User");
      lines.push("");
      lines.push(msg.content);
      lines.push("");
      continue;
    }

    lines.push("## Assistant");
    lines.push("");
    if (msg.content) {
      lines.push(msg.content);
      lines.push("");
    }

    for (const tc of msg.toolCalls ?? []) {
      lines.push(`### Tool call: \`${tc.name}\``);
      lines.push("");
      const inputText = JSON.stringify(tc.input ?? null, null, 2);
      const inputFence = pickLongestFence([inputText]);
      lines.push(`${inputFence}json`);
      lines.push(escapeFencedContent(inputText, inputFence));
      lines.push(inputFence);
      lines.push("");
      if (typeof tc.output === "string" && tc.output.length > 0) {
        lines.push("Result:");
        lines.push("");
        const outputFence = pickLongestFence([tc.output]);
        lines.push(outputFence);
        lines.push(escapeFencedContent(tc.output, outputFence));
        lines.push(outputFence);
        lines.push("");
      }
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}
