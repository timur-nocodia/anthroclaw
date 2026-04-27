"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Zap } from "lucide-react";
import type { ToolCall } from "./types";

interface ToolCallCardProps {
  tc: ToolCall;
  defaultOpen?: boolean;
}

export function ToolCallCard({ tc, defaultOpen = true }: ToolCallCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className="overflow-hidden rounded-md"
      style={{
        background: "var(--oc-bg1)",
        border: "1px solid var(--oc-border)",
      }}
    >
      <div
        className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5"
        onClick={() => setOpen((o) => !o)}
        style={{
          borderBottom: open ? "1px solid var(--oc-border)" : "none",
        }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" style={{ color: "var(--oc-text-muted)" }} />
        ) : (
          <ChevronRight className="h-3 w-3" style={{ color: "var(--oc-text-muted)" }} />
        )}
        <Zap
          className="h-3.5 w-3.5"
          style={{
            color: tc.status === "running" ? "var(--oc-yellow)" : "var(--oc-accent)",
          }}
        />
        <span
          className="text-xs"
          style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
        >
          {tc.name}
        </span>
        <span
          className="ml-auto flex items-center gap-1.5 text-[10.5px]"
          style={{
            color: tc.status === "running" ? "var(--oc-yellow)" : "var(--oc-green)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          {tc.status === "running" && (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: "var(--oc-yellow)",
                animation: "pulse 1s infinite",
              }}
            />
          )}
          {tc.status}
        </span>
      </div>
      {open && (
        <div className="flex flex-col gap-2 p-2.5">
          <div>
            <div
              className="mb-1 text-[9.5px] uppercase tracking-[0.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Input
            </div>
            <pre
              className="max-h-[140px] overflow-auto rounded border p-2"
              style={{
                margin: 0,
                background: "#07090d",
                borderColor: "var(--oc-border)",
                fontFamily: "var(--oc-mono)",
                fontSize: "11.5px",
                color: "var(--oc-text-dim)",
              }}
            >
              {JSON.stringify(tc.input, null, 2)}
            </pre>
          </div>
          {tc.output && (
            <div>
              <div
                className="mb-1 text-[9.5px] uppercase tracking-[0.5px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                Output
              </div>
              <pre
                className="max-h-[140px] overflow-auto whitespace-pre-wrap rounded border p-2"
                style={{
                  margin: 0,
                  background: "#07090d",
                  borderColor: "var(--oc-border)",
                  fontFamily: "var(--oc-mono)",
                  fontSize: "11.5px",
                  color: "var(--oc-text-dim)",
                }}
              >
                {tc.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
