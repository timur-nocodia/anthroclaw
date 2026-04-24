"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Info,
  Settings,
  X,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FleetAlert {
  id: string;
  serverId: string;
  serverName: string;
  type: string;
  severity: "critical" | "warning" | "info";
  message: string;
  triggeredAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

/* ------------------------------------------------------------------ */
/*  Mock data (used when API not available)                            */
/* ------------------------------------------------------------------ */

const MOCK_ALERTS: FleetAlert[] = [
  {
    id: "a1",
    serverId: "gw-edge-br",
    serverName: "gw-edge-br",
    type: "server_offline",
    severity: "critical",
    message: "Server offline > 14m",
    triggeredAt: new Date(Date.now() - 14 * 60 * 1000).toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
  },
  {
    id: "a2",
    serverId: "gw-prod-eu",
    serverName: "gw-prod-eu",
    type: "ssl_expiring",
    severity: "warning",
    message: "SSL certificate expires in 5 days",
    triggeredAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
  },
  {
    id: "a3",
    serverId: "gw-prod-sg",
    serverName: "gw-prod-sg",
    type: "high_disk",
    severity: "warning",
    message: "Disk usage > 90%",
    triggeredAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    acknowledgedAt: null,
    resolvedAt: null,
  },
  {
    id: "a4",
    serverId: "gw-staging-eu",
    serverName: "gw-staging-eu",
    type: "high_cpu",
    severity: "warning",
    message: "CPU > 80% for 5 minutes",
    triggeredAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    acknowledgedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    resolvedAt: null,
  },
  {
    id: "a5",
    serverId: "gw-prod-us",
    serverName: "gw-prod-us",
    type: "high_latency",
    severity: "warning",
    message: "P50 latency > 1000ms for 5 minutes",
    triggeredAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    acknowledgedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    resolvedAt: null,
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type FilterTab = "open" | "acknowledged" | "all";

/* ------------------------------------------------------------------ */
/*  Segmented                                                          */
/* ------------------------------------------------------------------ */

function Segmented({
  value,
  onChange,
  options,
}: {
  value: FilterTab;
  onChange: (v: FilterTab) => void;
  options: { value: FilterTab; label: string }[];
}) {
  return (
    <div
      className="inline-flex gap-px rounded-[5px] p-0.5"
      style={{
        background: "var(--oc-bg2)",
        border: "1px solid var(--oc-border)",
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="inline-flex h-6 cursor-pointer items-center rounded px-2.5 text-[11px] font-medium"
            style={{
              background: active ? "#232a3b" : "transparent",
              color: active
                ? "var(--color-foreground)"
                : "var(--oc-text-dim)",
              border: "none",
              fontFamily: "inherit",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AlertsPanel                                                        */
/* ------------------------------------------------------------------ */

interface AlertsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AlertsPanel({ open, onOpenChange }: AlertsPanelProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterTab>("open");
  const [alerts, setAlerts] = useState<FleetAlert[]>(MOCK_ALERTS);
  const [loading, setLoading] = useState(false);

  /* ---- Fetch alerts ---- */
  const fetchAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/fleet/alerts?status=all");
      if (res.ok) {
        const data = (await res.json()) as { alerts: FleetAlert[] };
        if (data.alerts && data.alerts.length > 0) {
          setAlerts(data.alerts);
        }
      }
    } catch {
      // keep mock/stale data
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) fetchAlerts();
  }, [open, fetchAlerts]);

  /* ---- Acknowledge alert ---- */
  const handleAck = async (alertId: string) => {
    // Optimistic update
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === alertId
          ? { ...a, acknowledgedAt: new Date().toISOString() }
          : a,
      ),
    );
    try {
      await fetch(`/api/fleet/alerts/${alertId}/ack`, { method: "PUT" });
    } catch {
      // revert would go here in production
    }
  };

  /* ---- Filter alerts ---- */
  const filtered = alerts.filter((a) => {
    if (filter === "open") return !a.acknowledgedAt;
    if (filter === "acknowledged") return !!a.acknowledgedAt && !a.resolvedAt;
    return true;
  });

  const openCount = alerts.filter((a) => !a.acknowledgedAt).length;
  const ackCount = alerts.filter(
    (a) => !!a.acknowledgedAt && !a.resolvedAt,
  ).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[480px] max-w-full flex-col gap-0 p-0 sm:max-w-[480px]"
        style={{
          background: "var(--oc-bg1)",
          borderColor: "var(--oc-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3.5"
          style={{
            background: "var(--oc-bg0)",
            borderColor: "var(--oc-border)",
          }}
        >
          <div>
            <SheetTitle
              className="text-[14px] font-semibold"
              style={{ color: "var(--color-foreground)" }}
            >
              Alerts
            </SheetTitle>
            <SheetDescription
              className="mt-0.5 text-[11.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              {openCount} open &middot; {ackCount} acknowledged
            </SheetDescription>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--oc-text-muted)",
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filters + rules button */}
        <div
          className="flex items-center gap-2 border-b px-4 py-2.5"
          style={{ borderColor: "var(--oc-border)" }}
        >
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "Open" },
              { value: "acknowledged", label: "Acknowledged" },
              { value: "all", label: "All" },
            ]}
          />
          <div className="flex-1" />
          <button
            className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-[5px] px-[7px] text-[11px] font-medium"
            style={{
              background: "transparent",
              color: "var(--oc-text-dim)",
              border: "1px solid transparent",
              fontFamily: "inherit",
            }}
          >
            <Settings className="h-3 w-3" />
            Alert rules
          </button>
        </div>

        {/* Alert list */}
        <div className="flex flex-1 flex-col gap-2.5 overflow-auto p-4">
          {loading && filtered.length === 0 && (
            <div
              className="py-10 text-center text-[12px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Loading alerts...
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10">
              <Check
                className="h-6 w-6"
                style={{ color: "var(--oc-green)" }}
              />
              <span
                className="text-[12px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                No alerts in this view.
              </span>
            </div>
          )}
          {filtered.map((a) => {
            const isAcked = !!a.acknowledgedAt;
            const colors =
              a.severity === "critical"
                ? {
                    bg: "rgba(248,113,113,0.08)",
                    bd: "rgba(248,113,113,0.3)",
                    fg: "var(--oc-red)",
                    badgeBg: "rgba(248,113,113,0.15)",
                    badgeBorder: "rgba(248,113,113,0.35)",
                  }
                : a.severity === "warning"
                  ? {
                      bg: "rgba(251,191,36,0.08)",
                      bd: "rgba(251,191,36,0.3)",
                      fg: "var(--oc-yellow)",
                      badgeBg: "rgba(251,191,36,0.15)",
                      badgeBorder: "rgba(251,191,36,0.35)",
                    }
                  : {
                      bg: "var(--oc-bg2)",
                      bd: "var(--oc-border)",
                      fg: "var(--oc-accent)",
                      badgeBg: "rgba(124,156,255,0.12)",
                      badgeBorder: "var(--oc-accent-ring)",
                    };

            return (
              <div
                key={a.id}
                className="flex items-start gap-2.5 rounded-md p-3"
                style={{
                  background: isAcked ? "var(--oc-bg0)" : colors.bg,
                  border: `1px solid ${isAcked ? "var(--oc-border)" : colors.bd}`,
                  borderLeft: `4px solid ${colors.fg}`,
                  opacity: isAcked ? 0.65 : 1,
                }}
              >
                <AlertTriangle
                  className="mt-0.5 h-[14px] w-[14px] shrink-0"
                  style={{ color: colors.fg }}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-flex items-center rounded px-[5px] py-px text-[10px] font-medium"
                      style={{
                        background: colors.badgeBg,
                        color: colors.fg,
                        border: `1px solid ${colors.badgeBorder}`,
                      }}
                    >
                      {a.severity}
                    </span>
                    <span
                      className="text-[12.5px] font-medium"
                      style={{ color: "var(--color-foreground)" }}
                    >
                      {a.message}
                    </span>
                  </div>
                  <div
                    className="text-[11px]"
                    style={{
                      color: "var(--oc-text-muted)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    {a.serverName} &middot;{" "}
                    {formatRelativeTime(a.triggeredAt)}
                    {isAcked && " \u00b7 acknowledged"}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!isAcked && (
                    <button
                      onClick={() => handleAck(a.id)}
                      className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        color: "var(--color-foreground)",
                        border: "1px solid var(--oc-border)",
                        fontFamily: "inherit",
                      }}
                    >
                      Ack
                    </button>
                  )}
                  <button
                    onClick={() => {
                      onOpenChange(false);
                      router.push(`/fleet/${a.serverId}/`);
                    }}
                    className="inline-flex h-[22px] cursor-pointer items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium"
                    style={{
                      background: "transparent",
                      color: "var(--oc-text-dim)",
                      border: "1px solid transparent",
                      fontFamily: "inherit",
                    }}
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}
