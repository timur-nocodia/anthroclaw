"use client";

import { Bot } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { ToolCallCard } from "./ToolCallCard";
import type { ChatMessage } from "./types";

interface MessageBubbleProps {
  m: ChatMessage;
  toolCallDefaultOpen?: boolean;
}

export function MessageBubble({ m, toolCallDefaultOpen = true }: MessageBubbleProps) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[70%] whitespace-pre-wrap rounded-[10px] rounded-br-sm px-3.5 py-2.5 text-[13px] leading-relaxed"
          style={{
            background: "var(--oc-accent-soft)",
            border: "1px solid var(--oc-accent-ring)",
            color: "var(--color-foreground)",
          }}
        >
          {m.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[85%] gap-2.5">
      <div
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full"
        style={{
          background: "linear-gradient(135deg, var(--oc-accent), #c084fc)",
        }}
      >
        <Bot className="h-[13px] w-[13px]" style={{ color: "#0b0d12" }} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {m.taskProgress && (
          <div
            className="flex w-fit max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]"
            style={{
              background: "var(--oc-bg1)",
              borderColor: "var(--oc-border)",
              color: "var(--oc-text-muted)",
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: m.streaming ? "var(--oc-yellow)" : "var(--oc-accent)",
                animation: m.streaming ? "pulse 1s infinite" : undefined,
              }}
            />
            <span className="truncate">{m.taskProgress}</span>
          </div>
        )}
        {(m.toolCalls ?? []).map((tc) => (
          <ToolCallCard key={tc.id} tc={tc} defaultOpen={toolCallDefaultOpen} />
        ))}
        {m.content && (
          <div className="text-[13px] leading-relaxed" style={{ color: "var(--color-foreground)" }}>
            <ReactMarkdown
              rehypePlugins={[rehypeHighlight]}
              components={{
                code({ className, children, ...props }) {
                  const isInline = !className;
                  if (isInline) {
                    return (
                      <code
                        className="rounded border px-1 py-px text-xs"
                        style={{
                          background: "var(--oc-bg3)",
                          borderColor: "var(--oc-border)",
                          color: "var(--oc-accent)",
                          fontFamily: "var(--oc-mono)",
                        }}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                pre({ children }) {
                  return (
                    <pre
                      className="my-1.5 overflow-auto rounded border p-2.5"
                      style={{
                        background: "#07090d",
                        borderColor: "var(--oc-border)",
                        fontFamily: "var(--oc-mono)",
                        fontSize: "12px",
                      }}
                    >
                      {children}
                    </pre>
                  );
                },
              }}
            >
              {m.content}
            </ReactMarkdown>
            {m.streaming && (
              <span
                className="ml-0.5 inline-block h-3.5 w-[7px] align-text-bottom"
                style={{
                  background: "var(--oc-accent)",
                  animation: "pulse 1s infinite",
                }}
              />
            )}
          </div>
        )}
        {!m.streaming && m.content && (
          <span
            className="text-[10.5px]"
            style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
          >
            {m.ts.toLocaleTimeString()} &middot; ~{Math.ceil(m.content.length / 4)} tok
          </span>
        )}
      </div>
    </div>
  );
}
