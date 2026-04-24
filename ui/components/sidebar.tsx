"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useParams } from "next/navigation";
import {
  LayoutGrid,
  LayoutDashboard,
  Bot,
  MessageSquare,
  Radio,
  AlignLeft,
  Server,
  Settings,
  User,
} from "lucide-react";
import { StatusIndicator, type ConnectionStatus } from "./status-indicator";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Absolute path (Fleet) or relative suffix appended after /fleet/{serverId} */
  path: string;
  /** If true, path is absolute and does not get prefixed with serverId */
  absolute?: boolean;
}

interface ChannelStatus {
  label: string;
  status: ConnectionStatus;
}

/* ------------------------------------------------------------------ */
/*  Navigation items                                                   */
/* ------------------------------------------------------------------ */

const NAV_ITEMS: NavItem[] = [
  { id: "fleet", label: "Fleet", icon: LayoutGrid, path: "/fleet", absolute: true },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, path: "" },
  { id: "agents", label: "Agents", icon: Bot, path: "/agents" },
  { id: "chat", label: "Chat", icon: MessageSquare, path: "/chat" },
  { id: "channels", label: "Channels", icon: Radio, path: "/channels" },
  { id: "logs", label: "Logs", icon: AlignLeft, path: "/logs" },
  { id: "settings", label: "Settings", icon: Settings, path: "/settings" },
];

/* ------------------------------------------------------------------ */
/*  Logo                                                               */
/* ------------------------------------------------------------------ */

function Logo() {
  return (
    <Image
      src="/anthroClaw-logo.svg"
      alt="anthroClaw"
      width={24}
      height={24}
      className="shrink-0 rounded-[6px]"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

export function Sidebar() {
  const pathname = usePathname();
  const params = useParams();

  const serverId = (params?.serverId as string) || "local";
  const isInsideServer = pathname.startsWith(`/fleet/${serverId}`) && !!params?.serverId;

  const [serverInfo, setServerInfo] = useState<{
    name: string;
    environment: string;
  } | null>(null);

  useEffect(() => {
    if (!isInsideServer) { setServerInfo(null); return; }
    fetch(`/api/fleet/servers/${serverId}`)
      .then((r) => r.json())
      .then((d) => setServerInfo({ name: d.name ?? serverId, environment: d.environment ?? "development" }))
      .catch(() => setServerInfo({ name: serverId, environment: "development" }));
  }, [serverId, isInsideServer]);

  /* ---- Resolve active nav item ---- */
  function getActiveId(): string | null {
    if (pathname === "/fleet" || pathname === "/fleet/") return "fleet";
    // Match /fleet/{serverId}/... patterns
    const prefix = `/fleet/${serverId}`;
    if (pathname.startsWith(prefix)) {
      const rest = pathname.slice(prefix.length);
      if (!rest || rest === "/") return "dashboard";
      if (rest.startsWith("/agents")) return "agents";
      if (rest.startsWith("/chat")) return "chat";
      if (rest.startsWith("/channels")) return "channels";
      if (rest.startsWith("/logs")) return "logs";
      if (rest.startsWith("/settings")) return "settings";
    }
    return null;
  }

  const activeId = getActiveId();
  const fleetStatusPrewarmed = useRef(false);

  /* ---- Build link href ---- */
  function hrefFor(item: NavItem): string {
    if (item.absolute) return item.path;
    return `/fleet/${serverId}${item.path}`;
  }

  /* ---- Connection status polling ---- */
  const [channels, setChannels] = useState<ChannelStatus[]>([]);

  const prewarmFleetStatus = useCallback(() => {
    if (fleetStatusPrewarmed.current) return;
    fleetStatusPrewarmed.current = true;
    fetch("/api/fleet/status").catch(() => {
      fleetStatusPrewarmed.current = false;
    });
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/fleet/status");
      if (!res.ok) return;
      const data = await res.json();

      const lines: ChannelStatus[] = [];
      // Gateway overall status
      const healthy = data.summary?.healthy ?? 0;
      const total = data.summary?.gateways ?? 0;
      lines.push({
        label: "Gateway",
        status: healthy === total && total > 0 ? "connected" : total === 0 ? "disconnected" : "warning",
      });

      // Extract channels from servers
      if (data.servers && Array.isArray(data.servers)) {
        for (const server of data.servers) {
          const tg = server.channels?.telegram ?? 0;
          const wa = server.channels?.whatsapp ?? 0;
          if (tg > 0) {
            lines.push({
              label: `TG @${server.name}`,
              status: server.status === "healthy" ? "connected" : server.status === "degraded" ? "reconnecting" : "disconnected",
            });
          }
          if (wa > 0) {
            lines.push({
              label: `WA +${server.name}`,
              status: server.status === "healthy" ? "connected" : server.status === "degraded" ? "reconnecting" : "disconnected",
            });
          }
        }
      }

      setChannels(lines);
    } catch {
      // Silently fail - connection indicators will be empty
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const connectedCount = channels.filter((c) => c.status === "connected").length;

  return (
    <aside
      className="flex w-[216px] shrink-0 flex-col border-r border-[var(--oc-border)]"
      style={{ background: "var(--oc-bg1)", fontSize: 12 }}
    >
      {/* ---- Brand ---- */}
      <div className="flex items-center gap-2.5 border-b border-[var(--oc-border)] px-3.5 py-3.5">
        <Logo />
        <div className="flex flex-col gap-px">
          <span
            className="text-[12.5px] font-semibold tracking-[0.2px]"
            style={{ color: "var(--color-foreground)" }}
          >
            anthroClaw
          </span>
          <span
            className="text-[10px] uppercase tracking-[0.6px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            Control
          </span>
        </div>
      </div>

      {/* ---- Server context ---- */}
      {isInsideServer && serverInfo && (
        <div
          className="flex items-center gap-2 border-b px-3.5 py-2.5"
          style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}
        >
          <Server className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--oc-accent)" }} />
          <span
            className="flex-1 truncate text-[11.5px] font-medium"
            style={{ color: "var(--color-foreground)" }}
          >
            {serverInfo.name}
          </span>
          <span
            className="rounded-[3px] px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.4px] font-semibold"
            style={{
              background:
                serverInfo.environment === "production"
                  ? "rgba(248,113,113,0.15)"
                  : serverInfo.environment === "staging"
                    ? "rgba(251,191,36,0.15)"
                    : "rgba(96,165,250,0.15)",
              color:
                serverInfo.environment === "production"
                  ? "#f87171"
                  : serverInfo.environment === "staging"
                    ? "#fbbf24"
                    : "#60a5fa",
            }}
          >
            {serverInfo.environment === "production"
              ? "prod"
              : serverInfo.environment === "staging"
                ? "stage"
                : "dev"}
          </span>
        </div>
      )}

      {/* ---- Navigation ---- */}
      <nav className="flex flex-1 flex-col gap-px overflow-auto px-2 py-1.5">
        {NAV_ITEMS.map((item) => {
          const active = item.id === activeId;
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={hrefFor(item)}
              onFocus={item.id === "fleet" ? prewarmFleetStatus : undefined}
              onMouseEnter={item.id === "fleet" ? prewarmFleetStatus : undefined}
              className={cn(
                "flex h-7 items-center gap-2.5 rounded-[5px] px-2 text-[12.5px] transition-colors",
                active
                  ? "font-medium"
                  : "font-normal hover:bg-[var(--oc-bg2)]",
              )}
              style={{
                background: active ? "var(--oc-accent-soft)" : undefined,
                color: active ? "var(--oc-accent)" : "var(--oc-text-dim)",
                letterSpacing: "0.1px",
              }}
            >
              <Icon className="h-[15px] w-[15px]" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ---- Connections footer ---- */}
      {channels.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--oc-border)] px-3 py-2.5">
          <div className="mb-0.5 flex items-center justify-between">
            <span
              className="text-[10px] uppercase tracking-[0.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              Connections
            </span>
            <span
              className="text-[10px]"
              style={{
                color: "var(--oc-text-muted)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              {connectedCount}/{channels.length}
            </span>
          </div>
          {channels.map((ch, i) => (
            <div key={i} className="flex items-center gap-2 text-[11px]">
              <StatusIndicator status={ch.status} />
              <span
                className="flex-1 truncate"
                style={{
                  color: "var(--oc-text-dim)",
                  fontFamily: "var(--oc-mono)",
                }}
              >
                {ch.label}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---- User section ---- */}
      <div className="border-t border-[var(--oc-border)]">
        <Link
          href="/account"
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--oc-bg2)]"
          style={{
            textDecoration: "none",
            color: "var(--color-foreground)",
          }}
        >
          <div
            className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
            style={{
              background: "linear-gradient(135deg, #9aa4b2, #d4d8de)",
              color: "#0b0d12",
            }}
          >
            A
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className="text-[11.5px]"
              style={{ color: "var(--color-foreground)" }}
            >
              Admin
            </span>
            <span
              className="truncate text-[10px]"
              style={{
                color: "var(--oc-text-muted)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              local admin session
            </span>
          </div>
          <User
            className="h-3 w-3"
            style={{ color: "var(--oc-text-muted)" }}
          />
        </Link>
      </div>
    </aside>
  );
}
