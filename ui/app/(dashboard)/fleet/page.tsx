"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Plus,
  Server,
  Zap,
} from "lucide-react";
import type { FleetStatus, FleetServerStatus } from "@/lib/fleet";
import { StatusIndicator, type ConnectionStatus } from "@/components/status-indicator";
import { ResourceBar } from "@/components/resource-bar";
import { ServerCard } from "@/components/server-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AlertsPanel } from "@/components/alerts-panel";
import { FleetCommandsDialog } from "@/components/fleet-commands";
import { DeployWizard } from "@/components/deploy-wizard";

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

function fmtNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 10_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString("en-US");
}

function fmtUptime(ms: number | null): string {
  if (ms === null || ms <= 0) return "\u2014";
  const seconds = Math.floor(ms / 1000);
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ------------------------------------------------------------------ */
/*  Sorting                                                            */
/* ------------------------------------------------------------------ */

const STATUS_ORDER: Record<string, number> = {
  offline: 0,
  degraded: 1,
  healthy: 2,
};

const ENV_ORDER: Record<string, number> = {
  production: 0,
  staging: 1,
  development: 2,
};

function defaultSort(a: FleetServerStatus, b: FleetServerStatus): number {
  const sa = STATUS_ORDER[a.status] ?? 3;
  const sb = STATUS_ORDER[b.status] ?? 3;
  if (sa !== sb) return sa - sb;
  const ea = ENV_ORDER[a.environment] ?? 3;
  const eb = ENV_ORDER[b.environment] ?? 3;
  if (ea !== eb) return ea - eb;
  return a.name.localeCompare(b.name);
}

/* ------------------------------------------------------------------ */
/*  KPI metric card                                                    */
/* ------------------------------------------------------------------ */

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div
      className="rounded-md px-2.5 py-2"
      style={{
        background: "var(--oc-bg1)",
        border: "1px solid var(--oc-border)",
      }}
    >
      <div
        className="mb-0.5 text-[9.5px] uppercase tracking-[0.5px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
      </div>
      <div
        className="text-[18px] font-semibold leading-tight"
        style={{
          color: accent ? "var(--oc-accent)" : "var(--color-foreground)",
          fontFamily: "var(--oc-mono)",
        }}
      >
        {value}
      </div>
      <div
        className="mt-px text-[10.5px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {sub}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Segmented control                                                  */
/* ------------------------------------------------------------------ */

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
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
              color: active ? "var(--color-foreground)" : "var(--oc-text-dim)",
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
/*  Region coordinates for map                                         */
/* ------------------------------------------------------------------ */

const REGION_COORDS: Record<string, { x: number; y: number }> = {
  "us-east-1": { x: 0.26, y: 0.38 },
  "us-west-1": { x: 0.14, y: 0.38 },
  "us-west-2": { x: 0.12, y: 0.42 },
  "eu-west-1": { x: 0.47, y: 0.30 },
  "eu-north-1": { x: 0.54, y: 0.22 },
  "eu-central-1": { x: 0.52, y: 0.30 },
  "ap-southeast-1": { x: 0.78, y: 0.58 },
  "ap-northeast-1": { x: 0.87, y: 0.35 },
  "ap-south-1": { x: 0.73, y: 0.48 },
  "sa-east-1": { x: 0.33, y: 0.72 },
  local: { x: 0.52, y: 0.24 },
};

/* ------------------------------------------------------------------ */
/*  Fleet Grid view                                                    */
/* ------------------------------------------------------------------ */

function FleetGrid({ servers }: { servers: FleetServerStatus[] }) {
  const sorted = useMemo(() => [...servers].sort(defaultSort), [servers]);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {sorted.map((s) => (
        <ServerCard key={s.id} server={s} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fleet List view                                                    */
/* ------------------------------------------------------------------ */

type SortKey =
  | "status"
  | "name"
  | "environment"
  | "region"
  | "uptime"
  | "agents"
  | "live"
  | "p50"
  | "cpu"
  | "mem"
  | "disk"
  | "version";

function FleetList({ servers }: { servers: FleetServerStatus[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...servers];
    const dir = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "status":
          cmp =
            (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
          break;
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "environment":
          cmp =
            (ENV_ORDER[a.environment] ?? 3) -
            (ENV_ORDER[b.environment] ?? 3);
          break;
        case "region":
          cmp = a.region.localeCompare(b.region);
          break;
        case "uptime":
          cmp = (a.uptime ?? 0) - (b.uptime ?? 0);
          break;
        case "agents":
          cmp = a.agents - b.agents;
          break;
        case "live":
          cmp = a.liveSessions - b.liveSessions;
          break;
        case "p50":
          cmp = (a.p50Ms ?? 0) - (b.p50Ms ?? 0);
          break;
        case "cpu":
          cmp = (a.cpu ?? 0) - (b.cpu ?? 0);
          break;
        case "mem":
          cmp = (a.mem ?? 0) - (b.mem ?? 0);
          break;
        case "disk":
          cmp = (a.disk ?? 0) - (b.disk ?? 0);
          break;
        case "version":
          cmp = (a.version ?? "").localeCompare(b.version ?? "");
          break;
      }
      return cmp * dir;
    });
    return arr;
  }, [servers, sortKey, sortDir]);

  function SortHeader({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col;
    return (
      <button
        onClick={() => toggleSort(col)}
        className="inline-flex cursor-pointer items-center gap-1 text-[10px] uppercase tracking-[0.5px]"
        style={{
          background: "none",
          border: "none",
          color: active ? "var(--color-foreground)" : "var(--oc-text-muted)",
          fontFamily: "inherit",
          padding: 0,
        }}
      >
        {label}
        {active &&
          (sortDir === "asc" ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          ))}
      </button>
    );
  }

  const statusDotMap = (
    s: FleetServerStatus,
  ): ConnectionStatus =>
    s.status === "healthy"
      ? "connected"
      : s.status === "degraded"
        ? "reconnecting"
        : "error";

  return (
    <div
      className="overflow-hidden rounded-md"
      style={{
        background: "var(--oc-bg1)",
        border: "1px solid var(--oc-border)",
      }}
    >
      {/* Header */}
      <div
        className="grid items-center gap-2.5 px-3.5 py-2.5"
        style={{
          gridTemplateColumns:
            "1.6fr 100px 80px 60px 60px 70px 100px 100px 100px 80px",
          background: "var(--oc-bg2)",
          borderBottom: "1px solid var(--oc-border)",
        }}
      >
        <SortHeader label="Gateway" col="name" />
        <SortHeader label="Region" col="region" />
        <SortHeader label="Status" col="status" />
        <SortHeader label="Agents" col="agents" />
        <SortHeader label="Live" col="live" />
        <SortHeader label="P50" col="p50" />
        <SortHeader label="CPU" col="cpu" />
        <SortHeader label="MEM" col="mem" />
        <SortHeader label="DISK" col="disk" />
        <SortHeader label="Version" col="version" />
      </div>

      {/* Rows */}
      {sorted.map((s, i) => (
        <Link
          key={s.id}
          href={`/fleet/${s.id}/`}
          className="grid items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-[var(--oc-bg2)]"
          style={{
            gridTemplateColumns:
              "1.6fr 100px 80px 60px 60px 70px 100px 100px 100px 80px",
            borderBottom:
              i < sorted.length - 1
                ? "1px solid var(--oc-border)"
                : "none",
            opacity: s.status === "offline" ? 0.7 : 1,
          }}
        >
          {/* Name */}
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-[7px]">
              <StatusIndicator status={statusDotMap(s)} className="h-[7px] w-[7px]" />
              <span
                className="truncate text-[12.5px] font-medium"
                style={{
                  color: "var(--color-foreground)",
                  fontFamily: "var(--oc-mono)",
                }}
              >
                {s.name}
              </span>
              {s.primary && (
                <span
                  className="inline-flex items-center rounded px-[5px] py-px text-[10px] font-medium"
                  style={{
                    background: "var(--oc-accent-soft)",
                    color: "var(--oc-accent)",
                    border: "1px solid var(--oc-accent-ring)",
                  }}
                >
                  primary
                </span>
              )}
            </div>
          </div>

          {/* Region */}
          <span
            className="text-[11px]"
            style={{
              color: "var(--oc-text-dim)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {s.region}
          </span>

          {/* Status badge */}
          <span
            className="inline-flex w-fit items-center rounded px-[5px] py-px text-[10px] font-medium border"
            style={{
              background:
                s.status === "healthy"
                  ? "rgba(74,222,128,0.15)"
                  : s.status === "degraded"
                    ? "rgba(251,191,36,0.15)"
                    : "rgba(248,113,113,0.15)",
              color:
                s.status === "healthy"
                  ? "var(--oc-green)"
                  : s.status === "degraded"
                    ? "var(--oc-yellow)"
                    : "var(--oc-red)",
              borderColor:
                s.status === "healthy"
                  ? "rgba(74,222,128,0.35)"
                  : s.status === "degraded"
                    ? "rgba(251,191,36,0.35)"
                    : "rgba(248,113,113,0.35)",
            }}
          >
            {s.status}
          </span>

          {/* Agents */}
          <span
            className="text-[12px]"
            style={{
              color: "var(--color-foreground)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {s.agents}
          </span>

          {/* Live */}
          <span
            className="text-[12px]"
            style={{
              color:
                s.liveSessions > 10
                  ? "var(--oc-accent)"
                  : "var(--oc-text-dim)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {s.liveSessions}
          </span>

          {/* P50 */}
          <span
            className="text-[12px]"
            style={{
              color:
                s.p50Ms && s.p50Ms > 1000
                  ? "var(--oc-yellow)"
                  : "var(--oc-text-dim)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {s.p50Ms ? `${s.p50Ms}ms` : "\u2014"}
          </span>

          {/* CPU */}
          <ResourceBar label="" value={(s.cpu ?? 0) / 100} />

          {/* MEM */}
          <ResourceBar label="" value={(s.mem ?? 0) / 100} />

          {/* DISK */}
          <ResourceBar label="" value={(s.disk ?? 0) / 100} />

          {/* Version */}
          <span
            className="text-[11px]"
            style={{
              color: "var(--oc-text-muted)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {s.version ? `v${s.version}` : "\u2014"}
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fleet Map view                                                     */
/* ------------------------------------------------------------------ */

function FleetMap({ servers }: { servers: FleetServerStatus[] }) {
  return (
    <TooltipProvider>
      <div
        className="relative overflow-hidden rounded-md"
        style={{
          background: "var(--oc-bg1)",
          border: "1px solid var(--oc-border)",
          height: 520,
        }}
      >
        {/* SVG grid background */}
        <svg
          width="100%"
          height="100%"
          className="absolute inset-0"
        >
          <defs>
            <pattern
              id="oc-grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="var(--oc-border)"
                strokeWidth="1"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#oc-grid)" />

          {/* Connection lines to primary */}
          {(() => {
            const primary = servers.find((s) => s.primary);
            if (!primary) return null;
            const pCoords = REGION_COORDS[primary.region];
            if (!pCoords) return null;

            return servers
              .filter((s) => !s.primary && REGION_COORDS[s.region])
              .map((s) => {
                const q = REGION_COORDS[s.region]!;
                const lineColor =
                  s.status === "offline"
                    ? "var(--oc-red)"
                    : s.status === "degraded"
                      ? "var(--oc-yellow)"
                      : "var(--oc-accent)";
                return (
                  <line
                    key={s.id}
                    x1={`${pCoords.x * 100}%`}
                    y1={`${pCoords.y * 100}%`}
                    x2={`${q.x * 100}%`}
                    y2={`${q.y * 100}%`}
                    stroke={lineColor}
                    strokeOpacity="0.3"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                );
              });
          })()}
        </svg>

        {/* Server dots */}
        {servers.map((s) => {
          const coords = REGION_COORDS[s.region];
          if (!coords) return null;

          const dotColor =
            s.status === "healthy"
              ? "var(--oc-green)"
              : s.status === "degraded"
                ? "var(--oc-yellow)"
                : "var(--oc-red)";

          const dotSize = Math.max(10, Math.min(18, 8 + s.agents * 2));

          return (
            <Tooltip key={s.id}>
              <TooltipTrigger asChild>
                <Link
                  href={`/fleet/${s.id}/`}
                  className="absolute flex cursor-pointer flex-col items-center gap-1"
                  style={{
                    left: `${coords.x * 100}%`,
                    top: `${coords.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <div
                    className={cn(
                      "rounded-full",
                      s.status === "degraded" && "animate-pulse",
                    )}
                    style={{
                      width: dotSize,
                      height: dotSize,
                      background: dotColor,
                      boxShadow: `0 0 12px ${dotColor}`,
                      border: "2px solid var(--oc-bg1)",
                    }}
                  />
                  <div
                    className="whitespace-nowrap rounded px-2 py-1 text-[11px]"
                    style={{
                      background: "var(--oc-bg2)",
                      border: "1px solid var(--oc-border)",
                      color: "var(--color-foreground)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    {s.name.split("\u00b7")[0]?.trim() ?? s.name}
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent
                className="border-[var(--oc-border)] text-xs"
                style={{
                  background: "var(--oc-bg2)",
                  fontFamily: "var(--oc-mono)",
                }}
              >
                <div className="flex flex-col gap-1 py-1">
                  <span className="font-semibold" style={{ color: "var(--color-foreground)" }}>
                    {s.name}
                  </span>
                  <span style={{ color: "var(--oc-text-dim)" }}>
                    {s.status} &middot; {s.agents} agents &middot;{" "}
                    {s.liveSessions} live
                  </span>
                  <span style={{ color: "var(--oc-text-muted)" }}>
                    CPU {s.cpu ?? 0}% &middot; MEM {s.mem ?? 0}% &middot;
                    DISK {s.disk ?? 0}%
                  </span>
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Footer label */}
        <div
          className="absolute bottom-4 left-4 text-[10.5px]"
          style={{
            color: "var(--oc-text-muted)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          Abstract world projection &middot; not to scale
        </div>
      </div>
    </TooltipProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function FleetSkeleton() {
  return (
    <div className="flex flex-1 flex-col" style={{ background: "var(--oc-bg0)" }}>
      {/* Header skeleton */}
      <div className="flex items-center justify-between border-b border-[var(--oc-border)] px-5 py-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-32" />
        </div>
      </div>
      {/* KPI row skeleton */}
      <div className="grid grid-cols-6 gap-2.5 border-b border-[var(--oc-border)] px-5 py-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-md" />
        ))}
      </div>
      {/* Toolbar skeleton */}
      <div className="flex items-center gap-2 border-b border-[var(--oc-border)] px-5 py-2.5">
        <Skeleton className="h-6 w-48" />
        <div className="flex-1" />
        <Skeleton className="h-6 w-28" />
      </div>
      {/* Cards skeleton */}
      <div className="grid grid-cols-1 gap-3 p-5 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-64 rounded-md" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-20">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{
          background: "var(--oc-accent-soft)",
          border: "1px solid var(--oc-accent-ring)",
        }}
      >
        <Server className="h-7 w-7" style={{ color: "var(--oc-accent)" }} />
      </div>
      <div className="text-center">
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--color-foreground)" }}
        >
          No gateways in fleet
        </h3>
        <p
          className="mt-1 text-xs"
          style={{ color: "var(--oc-text-muted)" }}
        >
          Deploy your first AnthroClaw gateway.
        </p>
      </div>
      <button
        className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[5px] px-3 text-xs font-medium"
        style={{
          background: "var(--oc-accent)",
          color: "var(--oc-bg0)",
          border: "1px solid var(--oc-accent)",
          fontFamily: "inherit",
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        Deploy gateway
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Fleet page                                                         */
/* ------------------------------------------------------------------ */

type ViewMode = "grid" | "list" | "map";
type EnvFilter = "all" | "production" | "staging" | "development";

export default function FleetPage() {
  const [data, setData] = useState<FleetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [envFilter, setEnvFilter] = useState<EnvFilter>("all");
  const [view, setView] = useState<ViewMode>("grid");
  const [showAlerts, setShowAlerts] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [showDeploy, setShowDeploy] = useState(false);

  /* ---- Fetch fleet status ---- */
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/status");
      if (!res.ok) throw new Error("Failed to fetch fleet status");
      const json = (await res.json()) as FleetStatus;
      setData(json);
    } catch {
      // keep stale data if we already have some
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  /* ---- Loading ---- */
  if (loading && !data) {
    return <FleetSkeleton />;
  }

  /* ---- Empty ---- */
  if (!data || data.servers.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col"
        style={{ background: "var(--oc-bg0)" }}
      >
        <EmptyState />
      </div>
    );
  }

  const { summary, servers: allServers } = data;

  /* ---- Filtered servers ---- */
  const servers =
    envFilter === "all"
      ? allServers
      : allServers.filter((s) => s.environment === envFilter);

  /* ---- Alert count ---- */
  const alertCount = allServers.reduce(
    (n, s) => n + s.alerts.length,
    0,
  );

  /* ---- Env counts ---- */
  const envCounts = {
    all: allServers.length,
    production: allServers.filter((s) => s.environment === "production").length,
    staging: allServers.filter((s) => s.environment === "staging").length,
    development: allServers.filter((s) => s.environment === "development")
      .length,
  };

  /* ---- Status badge color ---- */
  const statusBadgeBg =
    summary.offline > 0
      ? "rgba(248,113,113,0.15)"
      : summary.degraded > 0
        ? "rgba(251,191,36,0.15)"
        : "rgba(74,222,128,0.15)";
  const statusBadgeFg =
    summary.offline > 0
      ? "var(--oc-red)"
      : summary.degraded > 0
        ? "var(--oc-yellow)"
        : "var(--oc-green)";
  const statusBadgeBorder =
    summary.offline > 0
      ? "rgba(248,113,113,0.35)"
      : summary.degraded > 0
        ? "rgba(251,191,36,0.35)"
        : "rgba(74,222,128,0.35)";

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ background: "var(--oc-bg0)" }}
    >
      {/* -------- Page header -------- */}
      <div
        className="flex items-center justify-between border-b px-5 py-3.5"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div className="flex items-center gap-3">
          <h1
            className="text-[15px] font-semibold"
            style={{ color: "var(--color-foreground)" }}
          >
            Fleet
          </h1>

          {/* Status summary badge */}
          <span
            className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium"
            style={{
              background: statusBadgeBg,
              color: statusBadgeFg,
              border: `1px solid ${statusBadgeBorder}`,
            }}
          >
            <span
              className="inline-block h-[6px] w-[6px] rounded-full"
              style={{ background: statusBadgeFg }}
            />
            {summary.healthy} healthy &middot; {summary.degraded} degraded
            &middot; {summary.offline} offline
          </span>

          {/* Alerts badge */}
          {alertCount > 0 && (
            <button
              className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium"
              style={{
                background: "rgba(248,113,113,0.15)",
                color: "var(--oc-red)",
                border: "1px solid rgba(248,113,113,0.35)",
                fontFamily: "inherit",
              }}
              onClick={() => setShowAlerts(true)}
            >
              <AlertTriangle className="h-3 w-3" />
              {alertCount} alert{alertCount !== 1 ? "s" : ""}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium"
            style={{
              background: "rgba(255,255,255,0.03)",
              color: "var(--color-foreground)",
              border: "1px solid var(--oc-border)",
              fontFamily: "inherit",
            }}
            onClick={() => setShowCommands(true)}
          >
            <Zap className="h-3.5 w-3.5" />
            Fleet commands
          </button>
          <button
            className="inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium"
            style={{
              background: "var(--oc-accent)",
              color: "var(--oc-bg0)",
              border: "1px solid var(--oc-accent)",
              fontFamily: "inherit",
            }}
            onClick={() => setShowDeploy(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Deploy gateway
          </button>
        </div>
      </div>

      {/* -------- KPI summary row -------- */}
      <div
        className="grid grid-cols-6 gap-2.5 border-b px-5 py-3"
        style={{
          borderColor: "var(--oc-border)",
          background: "var(--oc-bg0)",
        }}
      >
        <KpiCard
          label="Gateways"
          value={summary.gateways}
          sub={`${summary.healthy} healthy`}
        />
        <KpiCard
          label="Agents"
          value={summary.totalAgents}
          sub="across fleet"
        />
        <KpiCard
          label="Live sessions"
          value={summary.totalSessions}
          sub="now"
        />
        <KpiCard
          label="Msgs / 24h"
          value={fmtNumber(summary.messages24h)}
          sub="inbound"
        />
        <KpiCard
          label="Tokens / 24h"
          value={fmtNumber(summary.tokens24h)}
          sub="input + output"
        />
        <KpiCard
          label="Est. cost / 24h"
          value={`$${summary.estimatedCost24h.toFixed(2)}`}
          sub="at current pricing"
          accent
        />
      </div>

      {/* -------- Toolbar / filter bar -------- */}
      <div
        className="flex items-center justify-between border-b px-5 py-2.5"
        style={{
          borderColor: "var(--oc-border)",
          background: "var(--oc-bg0)",
        }}
      >
        <div className="flex items-center gap-2.5">
          {/* Environment filter */}
          <Segmented
            value={envFilter}
            onChange={setEnvFilter}
            options={[
              { value: "all", label: `All (${envCounts.all})` },
              { value: "production", label: "Prod" },
              { value: "staging", label: "Staging" },
              { value: "development", label: "Dev" },
            ]}
          />

        </div>

        {/* View mode toggle */}
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "grid", label: "Grid" },
            { value: "list", label: "List" },
            { value: "map", label: "Map" },
          ]}
        />
      </div>

      {/* -------- Content area -------- */}
      <div className="flex-1 overflow-auto p-5">
        {servers.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <p
              className="text-xs"
              style={{ color: "var(--oc-text-muted)" }}
            >
              No gateways match the selected filter.
            </p>
          </div>
        ) : (
          <>
            {view === "grid" && <FleetGrid servers={servers} />}
            {view === "list" && <FleetList servers={servers} />}
            {view === "map" && <FleetMap servers={servers} />}
          </>
        )}
      </div>

      {/* -------- Modals / Panels -------- */}
      <AlertsPanel open={showAlerts} onOpenChange={setShowAlerts} />
      <FleetCommandsDialog
        open={showCommands}
        onOpenChange={setShowCommands}
        servers={allServers}
      />
      <DeployWizard open={showDeploy} onOpenChange={setShowDeploy} />
    </div>
  );
}
