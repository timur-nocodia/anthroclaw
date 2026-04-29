"use client";

/**
 * Plan 3 Task C2 — Compact LCM context-pressure chip.
 *
 * Fetches /api/agents/[agentId]/lcm/status once on mount and renders a small
 * colored pill (green/yellow/orange/red) keyed off `pressureRatio`.
 *
 * Renders nothing when LCM has no data for the agent (totalMessages === 0 &&
 * totalSessions === 0) — we don't want a "0% pressure" pill cluttering the
 * agents list when the plugin isn't enabled or hasn't run yet.
 */

import { useEffect, useState } from "react";

interface LcmStatus {
  agentId: string;
  session: string | null;
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  countsByDepth: Record<number, number>;
  contextPressure: "green" | "yellow" | "orange" | "red";
  threshold: number;
  pressureRatio: number;
  earliestTs: number | null;
  latestTs: number | null;
}

export interface ContextPressureChipProps {
  agentId: string;
}

interface PressureStyle {
  bg: string;
  fg: string;
  border: string;
  label: string;
}

function styleFor(p: LcmStatus["contextPressure"]): PressureStyle {
  switch (p) {
    case "green":
      return {
        bg: "rgba(16,185,129,0.15)",
        fg: "rgb(110,231,183)",
        border: "rgba(16,185,129,0.35)",
        label: "OK",
      };
    case "yellow":
      return {
        bg: "rgba(245,158,11,0.15)",
        fg: "rgb(252,211,77)",
        border: "rgba(245,158,11,0.35)",
        label: "WARM",
      };
    case "orange":
      return {
        bg: "rgba(249,115,22,0.18)",
        fg: "rgb(253,186,116)",
        border: "rgba(249,115,22,0.4)",
        label: "HIGH",
      };
    case "red":
      return {
        bg: "rgba(239,68,68,0.2)",
        fg: "rgb(252,165,165)",
        border: "rgba(239,68,68,0.45)",
        label: "FULL",
      };
  }
}

export function ContextPressureChip({ agentId }: ContextPressureChipProps) {
  const [data, setData] = useState<LcmStatus | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErrored(false);
    (async () => {
      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}/lcm/status`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as LcmStatus;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setErrored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // Hide the chip entirely while loading, on error, or when LCM is dormant.
  if (errored || !data) return null;
  if (data.totalMessages === 0 && data.totalSessions === 0) return null;

  const style = styleFor(data.contextPressure);
  const pct = Math.round(data.pressureRatio * 100);
  const tooltip =
    `${data.totalMessages} messages · ${data.totalTokens} tokens / ` +
    `${data.threshold} threshold (${pct}%)`;

  return (
    <span
      data-testid="context-pressure-chip"
      data-pressure={data.contextPressure}
      title={tooltip}
      className="inline-flex h-[18px] flex-shrink-0 items-center gap-1 rounded-full border px-1.5 text-[9.5px] font-medium uppercase tracking-[0.4px]"
      style={{
        background: style.bg,
        color: style.fg,
        borderColor: style.border,
        fontFamily: "var(--oc-mono)",
      }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: style.fg }}
      />
      {pct}%
    </span>
  );
}
