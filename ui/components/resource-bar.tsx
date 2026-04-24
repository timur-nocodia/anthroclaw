"use client";

import { cn } from "@/lib/utils";

interface ResourceBarProps {
  label: string;
  /** Value as a fraction 0-1 (e.g. 0.52 = 52%) */
  value: number;
  className?: string;
}

export function ResourceBar({ label, value, className }: ResourceBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const color =
    value > 0.8
      ? "bg-[var(--oc-red)]"
      : value > 0.5
        ? "bg-[var(--oc-yellow)]"
        : "bg-[var(--oc-accent)]";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {label && (
        <span
          className="w-9 shrink-0 text-[10px]"
          style={{
            color: "var(--oc-text-muted)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          {label}
        </span>
      )}
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--oc-bg3)]">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className="w-7 shrink-0 text-right text-[10px]"
        style={{
          color: "var(--oc-text-dim)",
          fontFamily: "var(--oc-mono)",
        }}
      >
        {pct}%
      </span>
    </div>
  );
}
