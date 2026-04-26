"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Bot,
  ChevronRight,
  Clock,
  ExternalLink,
  GitBranch,
  MessageSquare,
  RefreshCw,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import { StatusIndicator } from "@/components/status-indicator";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString("en-US");
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "---";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[unit]}`;
}

function formatMs(ms?: number): string {
  if (!ms || ms <= 0) return "0";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return String(Math.round(ms));
}

function sumRecord(record?: Record<string, number>): number {
  if (!record) return 0;
  return Object.values(record).reduce((acc, value) => acc + value, 0);
}

/* ------------------------------------------------------------------ */
/*  MetricCard                                                         */
/* ------------------------------------------------------------------ */

function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  tone = "accent",
  delta,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tone?: "accent" | "green" | "yellow";
  delta?: string;
}) {
  const toneColor =
    tone === "green"
      ? "var(--oc-green)"
      : tone === "yellow"
        ? "var(--oc-yellow)"
        : "var(--oc-accent)";
  return (
    <div
      className="flex min-w-0 flex-col gap-2 rounded-md p-3"
      style={{
        background: "var(--oc-bg1)",
        border: "1px solid var(--oc-border)",
      }}
    >
      <div
        className="flex items-center gap-2 text-[11px] uppercase tracking-[0.5px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        <Icon className="h-[13px] w-[13px]" />
        <span>{label}</span>
        {delta && (
          <span
            className="ml-auto"
            style={{
              color: delta.startsWith("+") ? "var(--oc-green)" : "var(--oc-red)",
              fontFamily: "var(--oc-mono)",
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {delta}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between gap-2.5">
        <div className="flex min-w-0 items-baseline gap-1">
          <span
            className="text-[22px] font-semibold"
            style={{
              color: "var(--color-foreground)",
              fontFamily: "var(--oc-mono)",
              letterSpacing: "-0.5px",
            }}
          >
            {value}
          </span>
          {unit && (
            <span
              className="text-[11px]"
              style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
            >
              {unit}
            </span>
          )}
        </div>
        <div className="h-1.5 w-12 rounded-full" style={{ background: toneColor, opacity: 0.45 }} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

function Card({
  title,
  actions,
  pad = true,
  className = "",
  children,
}: {
  title?: string;
  actions?: React.ReactNode;
  pad?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-fit min-w-0 flex-col rounded-md ${className}`}
      style={{
        background: "var(--oc-bg1)",
        border: "1px solid var(--oc-border)",
      }}
    >
      {title && (
        <div
          className="flex items-center justify-between gap-2 px-3 py-2.5"
          style={{ borderBottom: "1px solid var(--oc-border)" }}
        >
          <span className="text-xs font-semibold" style={{ color: "var(--color-foreground)", letterSpacing: "0.2px" }}>
            {title}
          </span>
          {actions}
        </div>
      )}
      <div style={{ padding: pad ? 12 : 0 }}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KV                                                                 */
/* ------------------------------------------------------------------ */

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span
        className="text-[11px] uppercase tracking-[0.4px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
      </span>
      <span className="text-xs" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
        {children}
      </span>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  return (
    <div className="grid items-center gap-2 py-1.5" style={{ gridTemplateColumns: "minmax(0,1fr) 54px" }}>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11.5px]" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
            {label}
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--oc-bg3)" }}>
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${pct}%`, background: "var(--oc-accent)" }}
          />
        </div>
      </div>
      <span className="text-right text-[11.5px]" style={{ color: "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}>
        {formatCompact(value)}
      </span>
    </div>
  );
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="rounded-[5px] px-3 py-5 text-center text-[11px]" style={{ color: "var(--oc-text-muted)", background: "var(--oc-bg2)" }}>
      {text}
    </div>
  );
}

function AgentsEmptyState({ serverId }: { serverId: string }) {
  return (
    <div className="px-4 py-5">
      <div
        className="relative overflow-hidden rounded-[7px] border px-4 py-5"
        style={{
          borderColor: "var(--oc-border)",
          background:
            "radial-gradient(circle at 16% 0%, rgba(124,156,255,0.11), transparent 34%), var(--oc-bg2)",
        }}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[7px]"
              style={{
                background: "rgba(124,156,255,0.10)",
                border: "1px solid rgba(124,156,255,0.22)",
                color: "var(--oc-accent)",
              }}
            >
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                No agents on this gateway
              </div>
              <p className="mt-1 max-w-[52ch] text-[12px] leading-5" style={{ color: "var(--oc-text-dim)" }}>
                Add an agent before pairing channels or testing chat. Runtime metrics will start filling after the first session.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Link
              href={`/fleet/${serverId}/agents`}
              className="inline-flex h-[28px] items-center gap-1.5 rounded-[5px] px-2.5 text-[11px] font-semibold transition-transform active:scale-[0.98]"
              style={{
                background: "var(--oc-accent)",
                color: "var(--oc-bg0)",
              }}
            >
              Create agent
              <ArrowRight className="h-3 w-3" />
            </Link>
            <Link
              href={`/fleet/${serverId}/channels/whatsapp/pair`}
              className="inline-flex h-[28px] items-center rounded-[5px] border px-2.5 text-[11px] font-medium transition-colors hover:bg-[var(--oc-bg3)] active:scale-[0.98]"
              style={{
                borderColor: "var(--oc-border)",
                color: "var(--oc-text-dim)",
              }}
            >
              Pair channel
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentsLoadingState() {
  return (
    <div className="space-y-2 px-3 py-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[42px] animate-pulse rounded-[5px]"
          style={{
            background:
              "linear-gradient(90deg, var(--oc-bg2), var(--oc-bg3), var(--oc-bg2))",
            opacity: 0.75 - i * 0.12,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

interface GatewayStatus {
  uptime?: number;
  sessions?: number;
  activeSessions?: number;
  nodeVersion?: string;
  platform?: string;
  channels?: {
    telegram?: Array<{ accountId: string; botUsername: string; status: string }>;
    whatsapp?: Array<{ accountId: string; phone: string; status: string }>;
  };
}

interface AgentSummary {
  id: string;
  model?: string;
  description?: string;
  routes?: number | Array<{ channel: string }>;
  skillCount?: number;
  skills?: string[];
  queue_mode?: string;
}

interface MetricsResponse {
  counters?: Record<string, number>;
  gauges?: {
    active_sessions?: number;
    agents_loaded?: number;
    queued_messages?: number;
    memory_store_bytes?: number;
    media_store_bytes?: number;
  };
  histograms?: {
    query_duration_ms?: { p50?: number; p95?: number; p99?: number; avg?: number; count?: number };
  };
  tokens_24h?: {
    input?: number;
    output?: number;
    cache_read?: number;
    byModel?: Record<string, { input: number; output: number; cache_read?: number }>;
  };
  messages_24h?: number;
  insights_30d?: {
    totalSessions: number;
    totalMessages: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    topTools: Array<{ name: string; count: number }>;
    topModels: Array<{ model: string; sessions: number }>;
    periodDays: number;
  };
  events_30d?: {
    tools: Record<string, number>;
    sessions: Record<string, number>;
    subagents: Record<string, number>;
  };
  system?: {
    cpu_percent?: number;
    mem_percent?: number;
    mem_rss_bytes?: number;
    disk_percent?: number;
    disk_used_bytes?: number;
    disk_total_bytes?: number;
    node_version?: string;
    platform?: string;
    git_version?: string;
    git_dirty?: boolean;
  };
}

export default function ServerDashboard() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;

  const [gateway, setGateway] = useState<GatewayStatus | null>(null);
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowMs, setNowMs] = useState(Date.now());
  const gatewayFetchedAt = useRef<number | null>(null);

  // Tick for uptime counter
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [gwRes, agentsRes, metricsRes] = await Promise.all([
        fetch(`/api/fleet/${serverId}/gateway/status`),
        fetch(`/api/fleet/${serverId}/agents`),
        fetch(`/api/fleet/${serverId}/metrics`),
      ]);
      if (gwRes.ok) {
        const d = await gwRes.json();
        gatewayFetchedAt.current = Date.now();
        setGateway(d);
      }
      if (agentsRes.ok) {
        const d = await agentsRes.json();
        setAgents(Array.isArray(d) ? d : d.agents ?? []);
      }
      if (metricsRes.ok) {
        setMetrics(await metricsRes.json());
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 10_000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Compute metrics. gateway.uptime is reported in milliseconds by getStatus().
  const uptimeOffsetSec =
    gatewayFetchedAt.current !== null
      ? Math.max(0, Math.floor((nowMs - gatewayFetchedAt.current) / 1000))
      : 0;
  const uptimeSec = gateway ? Math.floor((gateway.uptime ?? 0) / 1000) + uptimeOffsetSec : 0;
  const sessionCount = gateway?.sessions ?? gateway?.activeSessions ?? metrics?.gauges?.active_sessions ?? 0;
  const tokenInput = metrics?.tokens_24h?.input ?? 0;
  const tokenOutput = metrics?.tokens_24h?.output ?? 0;
  const tokenCache = metrics?.tokens_24h?.cache_read ?? 0;
  const tokenTotal = tokenInput + tokenOutput;
  const queryHistogram = metrics?.histograms?.query_duration_ms;
  const events30d = metrics?.events_30d;
  const topTools = metrics?.insights_30d?.topTools ?? [];
  const topModels = metrics?.insights_30d?.topModels ?? [];
  const maxToolCount = Math.max(1, ...topTools.map((tool) => tool.count));
  const maxModelCount = Math.max(1, ...topModels.map((model) => model.sessions));
  const lifecycleTotal = sumRecord(events30d?.sessions) + sumRecord(events30d?.subagents) + sumRecord(events30d?.tools);
  const now = new Date(nowMs);
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const timeStr = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const tgChannels = gateway?.channels?.telegram ?? [];
  const waChannels = gateway?.channels?.whatsapp ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-auto p-5">
      {/* Greeting strip */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div
            className="text-xs tracking-[0.3px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            {dateStr} &middot; {timeStr}
          </div>
          <div className="mt-0.5 text-[15px]" style={{ color: "var(--color-foreground)" }}>
            Runtime telemetry is persisted.{" "}
            <span style={{ color: "var(--oc-text-dim)" }}>
              {lifecycleTotal > 0
                ? `${formatCompact(lifecycleTotal)} lifecycle events captured over 30 days.`
                : "Waiting for the first persisted lifecycle event."}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={fetchData}
            className="inline-flex h-[26px] items-center gap-1.5 rounded-[5px] border px-2.5 text-xs font-medium"
            style={{
              background: "rgba(255,255,255,0.03)",
              color: "var(--color-foreground)",
              borderColor: "var(--oc-border)",
            }}
          >
            <RefreshCw className="h-3 w-3" />
            Refresh
          </button>
        </div>
      </div>

      {/* Metric row */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Gateway uptime"
          value={formatUptime(uptimeSec)}
          icon={Clock}
          tone="accent"
        />
        <MetricCard
          label="Active sessions"
          value={sessionCount}
          unit="live"
          icon={Users}
          tone="accent"
        />
        <MetricCard
          label="Messages / 24h"
          value={formatCompact(metrics?.messages_24h ?? 0)}
          icon={Activity}
          tone="green"
        />
        <MetricCard
          label="Tokens / 24h"
          value={formatCompact(tokenTotal)}
          unit={tokenCache > 0 ? `${formatCompact(tokenCache)} cache` : undefined}
          icon={Zap}
          tone="yellow"
        />
      </div>

      {/* Runtime overview */}
      <div className="flex flex-col gap-3">
        {/* Agents table */}
        <Card
          title="Agents"
          actions={
            <Link
              href={`/fleet/${serverId}/agents`}
              className="inline-flex items-center gap-1 text-[11px] font-medium"
              style={{ color: "var(--oc-text-dim)" }}
            >
              View all ({agents.length})
              <ChevronRight className="h-3 w-3" />
            </Link>
          }
          pad={false}
        >
          {loading ? (
            <AgentsLoadingState />
          ) : agents.length > 0 ? (
            <>
              {/* Header */}
              <div
                className="grid items-center px-3 py-1.5 text-[10px] uppercase tracking-[0.5px]"
                style={{
                  gridTemplateColumns: "1fr 110px 90px 70px 90px 80px",
                  color: "var(--oc-text-muted)",
                  borderBottom: "1px solid var(--oc-border)",
                }}
              >
                <span>Agent</span>
                <span>Model</span>
                <span>Routes</span>
                <span>Skills</span>
                <span>Queue</span>
                <span />
              </div>
              {agents.map((a, i) => {
                const routeCount = typeof a.routes === 'number' ? a.routes : (a.routes?.length ?? 0);
                const tg = Array.isArray(a.routes) ? a.routes.filter((r: any) => r.channel === "telegram").length : 0;
                const wa = Array.isArray(a.routes) ? a.routes.filter((r: any) => r.channel === "whatsapp").length : 0;
                const skillCount = typeof a.skillCount === 'number' ? a.skillCount : (a.skills?.length ?? 0);
                return (
                  <Link
                    key={a.id}
                    href={`/fleet/${serverId}/agents/${a.id}`}
                    className="grid items-center gap-2 px-3 py-2.5 transition-colors hover:bg-[var(--oc-bg2)]"
                    style={{
                      gridTemplateColumns: "1fr 110px 90px 70px 90px 80px",
                      borderBottom:
                        i === agents.length - 1
                          ? "none"
                          : "1px solid var(--oc-border)",
                      cursor: "pointer",
                    }}
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <StatusIndicator
                          status={routeCount > 0 ? "connected" : "disconnected"}
                        />
                        <span
                          className="text-[12.5px] font-medium"
                          style={{
                            color: "var(--color-foreground)",
                            fontFamily: "var(--oc-mono)",
                          }}
                        >
                          {a.id}
                        </span>
                      </div>
                      {a.description && (
                        <span
                          className="truncate text-[11px]"
                          style={{ color: "var(--oc-text-muted)" }}
                        >
                          {a.description}
                        </span>
                      )}
                    </div>
                    <span
                      className="text-[11px]"
                      style={{
                        color: "var(--oc-text-dim)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {a.model ?? "---"}
                    </span>
                    <div className="flex gap-1">
                      {tg > 0 && (
                        <span
                          className="inline-flex items-center rounded px-1 py-px text-[10px] font-medium"
                          style={{
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid var(--oc-border)",
                            color: "var(--oc-text-dim)",
                          }}
                        >
                          {tg} TG
                        </span>
                      )}
                      {wa > 0 && (
                        <span
                          className="inline-flex items-center rounded px-1 py-px text-[10px] font-medium"
                          style={{
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid var(--oc-border)",
                            color: "var(--oc-text-dim)",
                          }}
                        >
                          {wa} WA
                        </span>
                      )}
                      {routeCount === 0 && (
                        <span className="text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
                          ---
                        </span>
                      )}
                    </div>
                    <span
                      className="text-xs"
                      style={{
                        color: "var(--oc-text-dim)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {skillCount}
                    </span>
                    <span
                      className="inline-flex items-center rounded px-1 py-px text-[10px] font-medium"
                      style={{
                        background:
                          a.queue_mode === "interrupt"
                            ? "rgba(251,191,36,0.15)"
                            : "rgba(255,255,255,0.04)",
                        border: `1px solid ${a.queue_mode === "interrupt" ? "rgba(251,191,36,0.35)" : "var(--oc-border)"}`,
                        color:
                          a.queue_mode === "interrupt"
                            ? "var(--oc-yellow)"
                            : "var(--oc-text-dim)",
                      }}
                    >
                      {a.queue_mode ?? "collect"}
                    </span>
                    <div className="flex justify-end gap-1">
                      <button
                        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded"
                        style={{ color: "var(--oc-text-dim)" }}
                        title="Test in chat"
                        onClick={(e) => {
                          e.preventDefault();
                          router.push(`/fleet/${serverId}/chat/${a.id}`);
                        }}
                      >
                        <MessageSquare className="h-3 w-3" />
                      </button>
                    </div>
                  </Link>
                );
              })}
            </>
          ) : (
            <AgentsEmptyState serverId={serverId} />
          )}
        </Card>

        <Card
          title="Runtime lifecycle"
          actions={
            <div className="flex items-center gap-2">
              <span
                className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.5px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{
                    background: "var(--oc-green)",
                    animation: "pulse 1.5s ease-out infinite",
                  }}
                />
                Persisted
              </span>
              <Link
                href={`/fleet/${serverId}/chat`}
                className="inline-flex items-center gap-1 text-[11px] font-medium"
                style={{ color: "var(--oc-text-dim)" }}
              >
                Open chat
                <ExternalLink className="h-2.5 w-2.5" />
              </Link>
            </div>
          }
          pad={false}
        >
          <div className="grid grid-cols-1 gap-px md:grid-cols-3" style={{ background: "var(--oc-border)" }}>
            {[
              { title: "Sessions", icon: GitBranch, values: events30d?.sessions ?? {} },
              { title: "Subagents", icon: Bot, values: events30d?.subagents ?? {} },
              { title: "Tools", icon: Wrench, values: events30d?.tools ?? {} },
            ].map(({ title, icon: Icon, values }) => {
              const entries = Object.entries(values).sort((a, b) => b[1] - a[1]);
              const max = Math.max(1, ...entries.map(([, value]) => value));
              return (
                <div key={title} className="p-3" style={{ background: "var(--oc-bg1)" }}>
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.5px]" style={{ color: "var(--oc-text-muted)" }}>
                    <Icon className="h-3.5 w-3.5" />
                    {title}
                  </div>
                  {entries.length > 0 ? (
                    entries.map(([label, value]) => (
                      <BarRow key={label} label={label} value={value} max={max} />
                    ))
                  ) : (
                    <EmptyMini text={`No ${title.toLowerCase()} events yet.`} />
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Usage intelligence" pad={false}>
          <div className="grid grid-cols-1 gap-px md:grid-cols-2" style={{ background: "var(--oc-border)" }}>
            <div className="p-3" style={{ background: "var(--oc-bg1)" }}>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.5px]" style={{ color: "var(--oc-text-muted)" }}>
                <Bot className="h-3 w-3" />
                Top models
              </div>
              {topModels.length > 0 ? (
                topModels.slice(0, 5).map((model) => (
                  <BarRow key={model.model} label={model.model} value={model.sessions} max={maxModelCount} />
                ))
              ) : (
                <EmptyMini text="No model usage recorded yet." />
              )}
            </div>
            <div className="p-3" style={{ background: "var(--oc-bg1)" }}>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.5px]" style={{ color: "var(--oc-text-muted)" }}>
                <Wrench className="h-3 w-3" />
                Top tools
              </div>
              {topTools.length > 0 ? (
                topTools.slice(0, 5).map((tool) => (
                  <BarRow key={tool.name} label={tool.name} value={tool.count} max={maxToolCount} />
                ))
              ) : (
                <EmptyMini text="No tool calls recorded yet." />
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-px text-center sm:grid-cols-3" style={{ background: "var(--oc-border)" }}>
            {[
              ["30d sessions", metrics?.insights_30d?.totalSessions ?? 0],
              ["30d messages", metrics?.insights_30d?.totalMessages ?? 0],
              ["30d tokens", (metrics?.insights_30d?.totalInputTokens ?? 0) + (metrics?.insights_30d?.totalOutputTokens ?? 0)],
            ].map(([label, value]) => (
              <div key={String(label)} className="px-2 py-2.5" style={{ background: "var(--oc-bg2)" }}>
                <div className="text-[10px] uppercase tracking-[0.5px]" style={{ color: "var(--oc-text-muted)" }}>
                  {label}
                </div>
                <div className="mt-0.5 text-[13px] font-semibold" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
                  {formatCompact(Number(value))}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Channels"
          actions={
            <Link
              href={`/fleet/${serverId}/channels/whatsapp/pair`}
              className="inline-flex items-center gap-1 text-[11px] font-medium"
              style={{ color: "var(--oc-text-dim)" }}
            >
              Pair WhatsApp
            </Link>
          }
          pad={false}
        >
          {/* Telegram */}
          {tgChannels.length > 0 && (
            <>
              <div
                className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.5px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                Telegram
              </div>
              {tgChannels.map((c) => (
                <div
                  key={c.accountId}
                  className="flex items-center gap-2.5 px-3 py-2"
                  style={{
                    borderBottom: "1px solid var(--oc-border)",
                  }}
                >
                  <StatusIndicator
                    status={
                      c.status === "connected"
                        ? "connected"
                        : c.status === "reconnecting"
                          ? "reconnecting"
                          : "disconnected"
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span
                      className="text-xs"
                      style={{
                        color: "var(--color-foreground)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {c.botUsername}
                    </span>
                    <span
                      className="text-[10.5px]"
                      style={{
                        color: "var(--oc-text-muted)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {c.accountId}
                    </span>
                  </div>
                  <ChevronRight
                    className="h-3.5 w-3.5"
                    style={{ color: "var(--oc-text-muted)" }}
                  />
                </div>
              ))}
            </>
          )}
          {/* WhatsApp */}
          {waChannels.length > 0 && (
            <>
              <div
                className="flex items-center gap-1.5 px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.5px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                WhatsApp
              </div>
              {waChannels.map((c, i) => (
                <div
                  key={c.accountId}
                  className="flex items-center gap-2.5 px-3 py-2"
                  style={{
                    borderBottom:
                      i === waChannels.length - 1
                        ? "none"
                        : "1px solid var(--oc-border)",
                  }}
                >
                  <StatusIndicator
                    status={
                      c.status === "connected"
                        ? "connected"
                        : c.status === "reconnecting"
                          ? "reconnecting"
                          : "disconnected"
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-px">
                    <span
                      className="text-xs"
                      style={{
                        color: "var(--color-foreground)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {c.phone}
                    </span>
                    <span
                      className="text-[10.5px]"
                      style={{
                        color: "var(--oc-text-muted)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {c.accountId}
                    </span>
                  </div>
                  <ChevronRight
                    className="h-3.5 w-3.5"
                    style={{ color: "var(--oc-text-muted)" }}
                  />
                </div>
              ))}
            </>
          )}
          {tgChannels.length === 0 && waChannels.length === 0 && (
            <div className="px-3 py-4 text-center text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
              No channels configured.
            </div>
          )}
        </Card>

        <Card title="System" pad={false}>
          <div className="px-3 py-1.5">
            <KV label="CPU">
              <span style={{ color: "var(--oc-text-dim)" }}>
                {metrics?.system?.cpu_percent !== undefined ? `${metrics.system.cpu_percent.toFixed(1)}%` : "---"}
              </span>
            </KV>
            <KV label="Memory">
              <span style={{ color: "var(--oc-text-dim)" }}>
                {metrics?.system?.mem_percent !== undefined ? `${metrics.system.mem_percent.toFixed(1)}%` : "---"}
              </span>
            </KV>
            <KV label="Disk">
              <span style={{ color: "var(--oc-text-dim)" }}>
                {metrics?.system?.disk_percent !== undefined
                  ? `${metrics.system.disk_percent.toFixed(1)}% · ${formatBytes(metrics.system.disk_used_bytes)}`
                  : "---"}
              </span>
            </KV>
            <KV label="Query p50">
              <span style={{ color: "var(--oc-text-dim)" }}>
                {formatMs(queryHistogram?.p50)}{queryHistogram?.p50 ? " ms" : ""}
              </span>
            </KV>
            <KV label="Node">
              <span style={{ color: "var(--oc-text-dim)" }}>
                {gateway?.nodeVersion ?? metrics?.system?.node_version ?? "---"}
              </span>
            </KV>
            <KV label="Platform">
              <span style={{ color: "var(--oc-text-dim)" }}>
                {gateway?.platform ?? metrics?.system?.platform ?? "---"}
              </span>
            </KV>
            <KV label="Git">
              <span style={{ color: metrics?.system?.git_dirty ? "var(--oc-yellow)" : "var(--oc-text-dim)" }}>
                {metrics?.system?.git_version ?? "---"}{metrics?.system?.git_dirty ? " dirty" : ""}
              </span>
            </KV>
          </div>
        </Card>
      </div>
    </div>
  );
}
