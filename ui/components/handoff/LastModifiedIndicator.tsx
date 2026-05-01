"use client";

/**
 * LastModifiedIndicator — small inline label rendered in card headers.
 *
 * Fetches `/api/agents/{agentId}/config-audit?section={section}&limit=1`
 * on mount, then renders one of:
 *   - "Last modified 3 hours ago via chat (klavdia)"
 *   - "Last modified 5 min ago via UI"
 *
 * Hides itself when the audit log has no entry for that section.
 */

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import type { ConfigSection } from "@backend/config/writer.js";
import { relativeTime } from "@/lib/format-time";

interface AuditEntry {
  ts: string;
  callerAgent: string;
  source: "chat" | "ui" | "system";
  section: ConfigSection;
}

export interface LastModifiedIndicatorProps {
  agentId: string;
  section: ConfigSection;
}

export function LastModifiedIndicator({ agentId, section }: LastModifiedIndicatorProps) {
  const [entry, setEntry] = useState<AuditEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = `/api/agents/${encodeURIComponent(agentId)}/config-audit?section=${encodeURIComponent(section)}&limit=1`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : { entries: [] }))
      .then((body: { entries?: AuditEntry[] }) => {
        if (cancelled) return;
        const e = body.entries?.[0] ?? null;
        setEntry(e);
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, section]);

  if (!entry) return null;

  const sourceLabel =
    entry.source === "chat"
      ? `via chat (${entry.callerAgent})`
      : entry.source === "ui"
        ? "via UI"
        : "via system";

  return (
    <span
      className="inline-flex items-center gap-1 text-[11px]"
      style={{ color: "var(--oc-text-muted)" }}
      data-testid={`last-modified-${section}`}
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      Last modified {relativeTime(entry.ts)} {sourceLabel}
    </span>
  );
}
