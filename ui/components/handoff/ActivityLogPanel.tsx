"use client";

/**
 * ActivityLogPanel — Handoff tab → pause-event timeline.
 *
 * v1: backend doesn't yet persist pause events. The endpoint synthesises
 * a one-row-per-pause timeline from the current pause-store state.
 * TODO(stage 4): switch to a real persisted event log.
 */

import { useEffect, useState, useCallback } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { HandoffEmpty, HandoffError, HandoffIntro } from "./HandoffControls";

interface PauseEvent {
  kind: string;
  agentId: string;
  peerKey: string;
  at: string;
  expiresAt: string | null;
  reason: string;
  source: string;
  extendedCount: number;
}

export interface ActivityLogPanelProps {
  agentId: string;
}

export function ActivityLogPanel({ agentId }: ActivityLogPanelProps) {
  const [events, setEvents] = useState<PauseEvent[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/pause-events`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { events: PauseEvent[]; note?: string };
      setEvents(body.events ?? []);
      setNote(body.note ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = filter
    ? events.filter((e) =>
        `${e.peerKey} ${e.kind} ${e.reason}`.toLowerCase().includes(filter.toLowerCase()),
      )
    : events;

  return (
    <Section
      title="Activity log"
      subtitle="pause timeline"
      icon={<Activity className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
      tooltip="Shows pause activity for this agent. The current backend endpoint derives the list from active pauses until persisted pause history lands."
      action={
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading} aria-label="refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      <HandoffIntro>
        Filter pause events by peer key, event kind, or reason. This view is useful for confirming
        whether a manager takeover actually produced a pause.
      </HandoffIntro>
        <input
          aria-label="filter"
          type="text"
          placeholder="Filter (peer, kind, reason)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-3 h-8 w-full rounded-[5px] border px-2 text-[12px] outline-none"
          style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)", color: "var(--color-foreground)" }}
        />

        {error && <div className="mb-2"><HandoffError message={error} /></div>}

        {note && (
          <p className="mb-2 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
            {note}
          </p>
        )}

        {filtered.length === 0 ? (
          <HandoffEmpty>No events match the current filter.</HandoffEmpty>
        ) : (
          <ol className="space-y-2">
            {filtered.map((ev, idx) => (
              <li
                key={`${ev.peerKey}-${ev.at}-${idx}`}
                className="rounded-[6px] border p-2 text-[12px]"
                style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}
                data-testid={`activity-${idx}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{ev.kind}</span>
                  <span style={{ color: "var(--oc-text-muted)" }}>{formatTime(ev.at)}</span>
                </div>
                <div className="mt-1 font-mono">{ev.peerKey}</div>
                <div className="mt-0.5" style={{ color: "var(--oc-text-muted)" }}>
                  reason: {ev.reason} · source: {ev.source}
                  {ev.expiresAt && ` · expires: ${formatTime(ev.expiresAt)}`}
                </div>
              </li>
            ))}
          </ol>
        )}
    </Section>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
