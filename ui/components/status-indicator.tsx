"use client";

import { cn } from "@/lib/utils";

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "error"
  | "reconnecting"
  | "warning";

interface StatusIndicatorProps {
  status: ConnectionStatus;
  className?: string;
}

const statusColors: Record<ConnectionStatus, string> = {
  connected: "bg-[#4ade80] shadow-[0_0_6px_rgba(74,222,128,0.6)]",
  disconnected: "bg-[var(--oc-text-muted)]",
  error: "bg-[#f87171] shadow-[0_0_6px_rgba(248,113,113,0.6)]",
  reconnecting: "bg-[#fbbf24] animate-pulse shadow-[0_0_6px_rgba(251,191,36,0.6)]",
  warning: "bg-[#fbbf24] shadow-[0_0_6px_rgba(251,191,36,0.6)]",
};

export function StatusIndicator({ status, className }: StatusIndicatorProps) {
  return (
    <span
      className={cn(
        "inline-block h-[7px] w-[7px] shrink-0 rounded-full",
        statusColors[status],
        className,
      )}
    />
  );
}
