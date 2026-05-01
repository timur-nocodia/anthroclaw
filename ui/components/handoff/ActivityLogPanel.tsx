"use client";

/**
 * ActivityLogPanel — Handoff tab → pause-event timeline.
 *
 * v1: backend doesn't yet persist pause events. The endpoint synthesises
 * a one-row-per-pause timeline from the current pause-store state.
 * TODO(stage 4): switch to a real persisted event log.
 */

import { useEffect, useState, useCallback } from "react";
import { Activity, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

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
    <Card
      className="rounded-md"
      style={{ background: "var(--oc-bg0)", borderColor: "var(--oc-border)" }}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-[14px] font-medium">
              <Activity className="h-4 w-4" />
              Activity log
            </CardTitle>
            <CardDescription className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
              Recent pause events. Filter by peer, kind, or reason.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={refresh} disabled={loading} aria-label="refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <input
          aria-label="filter"
          type="text"
          placeholder="Filter (peer, kind, reason)…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-3 h-8 w-full rounded border px-2 text-[12px]"
          style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
        />

        {error && (
          <div
            className="mb-2 flex items-center gap-2 rounded border p-2 text-[12px]"
            style={{ borderColor: "var(--oc-border)", color: "var(--oc-danger)" }}
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        {note && (
          <p className="mb-2 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
            {note}
          </p>
        )}

        {filtered.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
            No events match the current filter.
          </p>
        ) : (
          <ol className="space-y-2">
            {filtered.map((ev, idx) => (
              <li
                key={`${ev.peerKey}-${ev.at}-${idx}`}
                className="rounded border p-2 text-[12px]"
                style={{ borderColor: "var(--oc-border)" }}
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
      </CardContent>
    </Card>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
