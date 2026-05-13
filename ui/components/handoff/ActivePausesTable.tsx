"use client";

/**
 * ActivePausesTable — Handoff tab → live list of currently-active pauses.
 *
 * Polls `GET /api/agents/[agentId]/pauses` every 10 seconds. Each row has
 * an Unpause button that hits `DELETE /api/agents/[agentId]/pauses/[peerKey]`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Trash2, RefreshCw, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { HandoffEmpty, HandoffError, HandoffIntro } from "./HandoffControls";

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
    <Section
      title="Active pauses"
      subtitle={`refreshes every ${Math.round(refreshIntervalMs / 1000)}s`}
      icon={<Pause className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
      tooltip="Current peer-level pauses for this agent. A paused peer cannot trigger a model run until the pause expires or is manually removed."
      action={
        <Button size="sm" variant="ghost" onClick={fetchPauses} disabled={loading} aria-label="refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      <HandoffIntro>
        These pauses are stored in the live peer pause store. Removing one lets the next inbound
        message for that peer reach the agent again.
      </HandoffIntro>
        {error && <div className="mb-2"><HandoffError message={error} /></div>}

        {pauses.length === 0 ? (
          <HandoffEmpty>No active pauses.</HandoffEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[12px]">
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
          </div>
        )}
    </Section>
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
