"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

interface HelpHintProps {
  label: string;
  hint: string;
}

interface TooltipPosition {
  left: number;
  top: number;
}

export function HelpHint({ label, hint }: HelpHintProps) {
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  function showTooltip(target: HTMLElement) {
    const rect = target.getBoundingClientRect();
    const width = 280;
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    setPosition({ left, top: rect.bottom + 6 });
  }

  return (
    <span
      aria-label={`What does ${label} mean?`}
      data-hint={hint}
      onBlur={() => setPosition(null)}
      onFocus={(event) => showTooltip(event.currentTarget)}
      onMouseEnter={(event) => showTooltip(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      tabIndex={0}
      className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border text-[10px] leading-none outline-none focus:ring-1 focus:ring-[var(--oc-blue)]"
      style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-muted)", background: "var(--oc-bg1)" }}
    >
      ?
      {position && typeof document !== "undefined"
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[10000] w-max max-w-[280px] rounded-md border px-2.5 py-1.5 text-left text-[11px] font-normal normal-case tracking-normal shadow-lg"
              style={{
                left: position.left,
                top: position.top,
                background: "var(--oc-bg3)",
                borderColor: "var(--oc-border)",
                color: "var(--color-foreground)",
                lineHeight: 1.45,
                boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
              }}
            >
              {hint}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
