"use client";

import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { FleetServerStatus } from "@/lib/fleet";
import { StatusIndicator } from "@/components/status-indicator";
import { ResourceBar } from "@/components/resource-bar";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "\u2014";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ------------------------------------------------------------------ */
/*  StatCell                                                           */
/* ------------------------------------------------------------------ */

function StatCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: "accent" | "yellow";
}) {
  const valueColor =
    highlight === "accent"
      ? "var(--oc-accent)"
      : highlight === "yellow"
        ? "var(--oc-yellow)"
        : "var(--color-foreground)";
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[9.5px] uppercase tracking-[0.5px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
      </span>
      <span
        className="text-[14px] font-medium"
        style={{ color: valueColor, fontFamily: "var(--oc-mono)" }}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ServerCard                                                         */
/* ------------------------------------------------------------------ */

interface ServerCardProps {
  server: FleetServerStatus;
}

export function ServerCard({ server: s }: ServerCardProps) {
  const statusDot =
    s.status === "healthy"
      ? "connected"
      : s.status === "degraded"
        ? "reconnecting"
        : "error";

  const borderColor =
    s.status === "offline"
      ? "rgba(248,113,113,0.3)"
      : "var(--oc-border)";

  const topBarColor =
    s.status === "healthy"
      ? "var(--oc-green)"
      : s.status === "degraded"
        ? "var(--oc-yellow)"
        : "var(--oc-red)";

  const envBadgeClass =
    s.environment === "production"
      ? "bg-[rgba(74,222,128,0.15)] text-[var(--oc-green)] border-[rgba(74,222,128,0.35)]"
      : s.environment === "staging"
        ? "bg-[rgba(251,191,36,0.15)] text-[var(--oc-yellow)] border-[rgba(251,191,36,0.35)]"
        : "bg-[rgba(124,156,255,0.12)] text-[var(--oc-accent)] border-[var(--oc-accent-ring)]";

  const alertMessage =
    s.status === "offline" && s.alerts.length === 0
      ? "Server offline"
      : s.alerts.join(" \u00b7 ");

  return (
    <Link
      href={`/fleet/${s.id}/`}
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-md p-3.5 transition-colors",
        s.status === "offline" && "opacity-85",
      )}
      style={{
        background: "var(--oc-bg1)",
        border: `1px solid ${borderColor}`,
        cursor: "pointer",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = "#323a50";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = borderColor;
      }}
    >
      {/* Top color bar */}
      <div
        className="absolute inset-x-0 top-0 h-[2px]"
        style={{
          background: topBarColor,
          opacity: s.status === "healthy" ? 0.4 : 1,
        }}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-[7px]">
            <StatusIndicator
              status={statusDot}
              className="h-2 w-2"
            />
            <span
              className="text-[13.5px] font-semibold"
              style={{
                color: "var(--color-foreground)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              {s.name}
              {s.city ? ` \u00b7 ${s.city}` : ""}
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
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "inline-flex items-center rounded px-[5px] py-px text-[10px] font-medium border",
              envBadgeClass,
            )}
          >
            {s.environment}
          </span>
          <span
            className="text-[10.5px]"
            style={{
              color: "var(--oc-text-muted)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {s.region}
          </span>
        </div>
      </div>

      {/* Alert banner */}
      {(s.status === "offline" || s.status === "degraded") && alertMessage && (
        <div
          className="flex items-center gap-2 rounded-[5px] px-2.5 py-2"
          style={{
            background:
              s.status === "offline"
                ? "rgba(248,113,113,0.15)"
                : "rgba(251,191,36,0.15)",
            border: `1px solid ${
              s.status === "offline"
                ? "rgba(248,113,113,0.3)"
                : "rgba(251,191,36,0.3)"
            }`,
          }}
        >
          <AlertTriangle
            className="h-[13px] w-[13px] shrink-0"
            style={{
              color:
                s.status === "offline"
                  ? "var(--oc-red)"
                  : "var(--oc-yellow)",
            }}
          />
          <span
            className="text-[11.5px]"
            style={{
              color:
                s.status === "offline"
                  ? "var(--oc-red)"
                  : "var(--oc-yellow)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {alertMessage}
          </span>
        </div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-2">
        <StatCell
          label="uptime"
          value={s.status === "offline" ? "\u2014" : formatUptime(s.uptime)}
        />
        <StatCell label="agents" value={s.agents} />
        <StatCell
          label="live"
          value={s.liveSessions}
          highlight={s.liveSessions > 10 ? "accent" : undefined}
        />
        <StatCell
          label="p50"
          value={s.p50Ms ? `${s.p50Ms}ms` : "\u2014"}
          highlight={s.p50Ms && s.p50Ms > 1000 ? "yellow" : undefined}
        />
      </div>

      {/* Resource bars */}
      <div className="flex flex-col gap-1.5">
        <ResourceBar label="CPU" value={(s.cpu ?? 0) / 100} />
        <ResourceBar label="MEM" value={(s.mem ?? 0) / 100} />
        <ResourceBar label="DISK" value={(s.disk ?? 0) / 100} />
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between gap-2 border-t pt-2.5"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div className="flex gap-[5px]">
          {s.channels.telegram > 0 && (
            <span
              className="inline-flex items-center rounded px-[5px] py-px text-[10px] font-medium"
              style={{
                background: "rgba(255,255,255,0.04)",
                color: "var(--oc-text-dim)",
                border: "1px solid var(--oc-border)",
              }}
            >
              {s.channels.telegram} TG
            </span>
          )}
          {s.channels.whatsapp > 0 && (
            <span
              className="inline-flex items-center rounded px-[5px] py-px text-[10px] font-medium"
              style={{
                background: "rgba(255,255,255,0.04)",
                color: "var(--oc-text-dim)",
                border: "1px solid var(--oc-border)",
              }}
            >
              {s.channels.whatsapp} WA
            </span>
          )}
          {s.sslExpiryDays !== null && s.sslExpiryDays < 14 && (
            <span
              className="inline-flex items-center rounded px-[5px] py-px text-[10px] font-medium"
              style={{
                background: "rgba(248,113,113,0.15)",
                color: "var(--oc-red)",
                border: "1px solid rgba(248,113,113,0.35)",
              }}
            >
              SSL {s.sslExpiryDays}d
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className="text-[10.5px]"
            style={{
              color: "var(--oc-text-muted)",
              fontFamily: "var(--oc-mono)",
            }}
          >
            {s.version ? `v${s.version}` : "\u2014"}
          </span>
          {s.dirty && (
            <span
              className="text-[10px]"
              style={{
                color: "var(--oc-yellow)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              dirty
            </span>
          )}
          <ChevronRight
            className="h-[13px] w-[13px]"
            style={{ color: "var(--oc-text-muted)" }}
          />
        </div>
      </div>
    </Link>
  );
}
