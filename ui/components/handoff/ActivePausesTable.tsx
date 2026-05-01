"use client";

/**
 * ActivePausesTable — Handoff tab → live list of currently-active pauses.
 *
 * Polls `GET /api/agents/[agentId]/pauses` every 10 seconds. Each row has
 * an Unpause button that hits `DELETE /api/agents/[agentId]/pauses/[peerKey]`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, RefreshCw, Pause, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PauseEntry {
  agentId: string;
  peerKey: string;
  pausedAt: string;
  expiresAt: string | null;
  reason: string;
  source: string;
  extendedCount: number;
  lastOperatorMessageAt: string | null;
}

const REFRESH_INTERVAL_MS = 10_000;

export interface ActivePausesTableProps {
  agentId: string;
  /** Optional override for the polling interval (tests pass 0 to disable). */
  refreshIntervalMs?: number;
}

export function ActivePausesTable({
  agentId,
  refreshIntervalMs = REFRESH_INTERVAL_MS,
}: ActivePausesTableProps) {
  const [pauses, setPauses] = useState<PauseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const fetchPauses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/pauses`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { pauses: PauseEntry[] };
      if (!mounted.current) return;
      setPauses(body.pauses ?? []);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    mounted.current = true;
    void fetchPauses();
    if (refreshIntervalMs > 0) {
      const t = setInterval(fetchPauses, refreshIntervalMs);
      return () => {
        mounted.current = false;
        clearInterval(t);
      };
    }
    return () => {
      mounted.current = false;
    };
  }, [fetchPauses, refreshIntervalMs]);

  const handleUnpause = async (peerKey: string) => {
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/pauses/${encodeURIComponent(peerKey)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchPauses();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Card
      className="rounded-md"
      style={{ background: "var(--oc-bg0)", borderColor: "var(--oc-border)" }}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-[14px] font-medium">
              <Pause className="h-4 w-4" />
              Active pauses
            </CardTitle>
            <CardDescription className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
              Peers currently paused for this agent. Refreshes every {Math.round(refreshIntervalMs / 1000)}s.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" onClick={fetchPauses} disabled={loading} aria-label="refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <div
            className="mb-2 flex items-center gap-2 rounded border p-2 text-[12px]"
            style={{ borderColor: "var(--oc-border)", color: "var(--oc-danger)" }}
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        {pauses.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
            No active pauses.
          </p>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: "var(--oc-text-muted)" }}>
                <th className="px-2 py-1 text-left">Peer</th>
                <th className="px-2 py-1 text-left">Channel</th>
                <th className="px-2 py-1 text-left">Started</th>
                <th className="px-2 py-1 text-left">Expires</th>
                <th className="px-2 py-1 text-left">Source</th>
                <th className="px-2 py-1 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pauses.map((p) => {
                const [channel] = p.peerKey.split(":");
                return (
                  <tr
                    key={p.peerKey}
                    className="border-t"
                    style={{ borderColor: "var(--oc-border)" }}
                    data-testid={`pause-row-${p.peerKey}`}
                  >
                    <td className="px-2 py-1 font-mono">{p.peerKey}</td>
                    <td className="px-2 py-1">{channel}</td>
                    <td className="px-2 py-1">{formatTime(p.pausedAt)}</td>
                    <td className="px-2 py-1">
                      {p.expiresAt ? formatTime(p.expiresAt) : "indefinite"}
                    </td>
                    <td className="px-2 py-1" style={{ color: "var(--oc-text-muted)" }}>
                      {p.source}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleUnpause(p.peerKey)}
                        aria-label={`unpause-${p.peerKey}`}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Unpause
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
