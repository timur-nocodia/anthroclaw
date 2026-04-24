"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  Database,
  Key,
  RotateCcw,
  Save,
  Settings,
  Shield,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GatewayInfo {
  uptime?: number;
  agents?: number | string[];
  activeSessions?: number;
  sessions?: number;
}

interface MetricsResponse {
  gauges?: {
    active_sessions?: number;
    memory_store_bytes?: number;
    media_store_bytes?: number;
  };
  tokens_24h?: {
    input?: number;
    output?: number;
    cache_read?: number;
  };
  messages_24h?: number;
  insights_30d?: {
    totalSessions: number;
    totalMessages: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
  };
  events_30d?: {
    tools: Record<string, number>;
    sessions: Record<string, number>;
    subagents: Record<string, number>;
  };
  system?: {
    disk_percent?: number;
    disk_used_bytes?: number;
    disk_total_bytes?: number;
    mem_rss_bytes?: number;
  };
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

function sumRecord(record?: Record<string, number>): number {
  if (!record) return 0;
  return Object.values(record).reduce((acc, value) => acc + value, 0);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export default function SettingsPage() {
  const params = useParams();
  const serverId = params.serverId as string;

  const [section, setSection] = useState("general");

  const sections = [
    { id: "general", label: "General", icon: Settings },
    { id: "access", label: "Access control", icon: Shield },
    { id: "storage", label: "Storage", icon: Database },
    { id: "advanced", label: "Advanced", icon: Terminal },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div
        className="border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <h1 className="text-[15px] font-semibold" style={{ color: "var(--color-foreground)" }}>
          Settings
        </h1>
        <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
          Gateway-wide configuration. These apply to every agent on this instance.
        </p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar nav */}
        <div
          className="flex w-[200px] flex-col gap-0.5 p-2.5"
          style={{
            borderRight: "1px solid var(--oc-border)",
            background: "var(--oc-bg0)",
          }}
        >
          {sections.map((s) => {
            const active = section === s.id;
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className="flex items-center gap-2.5 rounded-[5px] px-2.5 py-1.5 text-left text-xs"
                style={{
                  background: active ? "var(--oc-bg2)" : "transparent",
                  border: "none",
                  color: active ? "var(--color-foreground)" : "var(--oc-text-dim)",
                  cursor: "pointer",
                }}
              >
                <Icon
                  className="h-3.5 w-3.5"
                  style={{ color: active ? "var(--oc-accent)" : "var(--oc-text-muted)" }}
                />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {section === "general" && <GeneralSection serverId={serverId} />}

          {section === "access" && <AccessSection serverId={serverId} />}
          {section === "storage" && <StorageSection serverId={serverId} />}
          {section === "advanced" && <AdvancedSection />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  General Section                                                    */
/* ------------------------------------------------------------------ */

const ENV_OPTIONS = [
  { value: "production", label: "Production" },
  { value: "staging", label: "Staging" },
  { value: "development", label: "Development" },
] as const;

type Environment = (typeof ENV_OPTIONS)[number]["value"];

function GeneralSection({ serverId }: { serverId: string }) {
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [config, setConfig] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [environment, setEnvironment] = useState<Environment>("development");
  const [envSaving, setEnvSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/fleet/${serverId}/gateway/status`)
      .then((r) => r.json())
      .then(setGateway)
      .catch(() => {});

    fetch(`/api/fleet/${serverId}/config`)
      .then((r) => r.json())
      .then((d) => setConfig(d.yaml ?? d.config ?? ""))
      .catch(() => {});

    fetch(`/api/fleet/servers/${serverId}`)
      .then((r) => r.json())
      .then((d) => { if (d.environment) setEnvironment(d.environment); })
      .catch(() => {});
  }, [serverId]);

  const handleEnvChange = async (env: Environment) => {
    setEnvironment(env);
    setEnvSaving(true);
    try {
      await fetch(`/api/fleet/servers/${serverId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: env }),
      });
    } catch {
      // silently fail
    } finally {
      setEnvSaving(false);
    }
  };

  const handleRestart = async () => {
    setRestarting(true);
    try {
      await fetch(`/api/fleet/${serverId}/gateway/restart`, { method: "POST" });
    } catch {
      // silently fail
    } finally {
      setRestarting(false);
      setRestartOpen(false);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      await fetch(`/api/fleet/${serverId}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: config }),
      });
      setEditMode(false);
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const fmtUptime = (s?: number) => {
    if (!s) return "---";
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };
  const agentCount = Array.isArray(gateway?.agents) ? gateway.agents.length : gateway?.agents ?? 0;
  const sessionCount = gateway?.sessions ?? gateway?.activeSessions ?? 0;

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      {/* Gateway status */}
      <SectionHead title="Gateway status" desc="Current operational metrics." />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <MiniCard label="Uptime" value={fmtUptime(gateway?.uptime)} />
        <MiniCard label="Agents" value={String(agentCount)} />
        <MiniCard label="Sessions" value={String(sessionCount)} />
      </div>
      <div>
        <Button variant="destructive" size="sm" onClick={() => setRestartOpen(true)}>
          <RotateCcw className="h-3.5 w-3.5" />
          Restart gateway
        </Button>
      </div>

      <Divider />

      {/* Environment */}
      <SectionHead title="Environment" desc="Controls which fleet filter tab this instance appears under." />
      <FieldRow label="Environment">
        <div className="flex gap-0.5 rounded-[6px] p-0.5" style={{ background: "var(--oc-bg2)", border: "1px solid var(--oc-border)" }}>
          {ENV_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleEnvChange(opt.value)}
              disabled={envSaving}
              className="rounded-[4px] px-2.5 py-1 text-[11.5px] font-medium"
              style={{
                background: environment === opt.value ? "var(--oc-accent)" : "transparent",
                color: environment === opt.value ? "#0b0d12" : "var(--oc-text-dim)",
                border: "none",
                cursor: "pointer",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </FieldRow>

      <Divider />

      {/* Config viewer */}
      <div className="flex items-center justify-between">
        <SectionHead title="Configuration" desc="Masked YAML from config.yml." />
        <div className="flex gap-1.5">
          {editMode ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditMode(false)}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={saving} onClick={handleSaveConfig}>
                <Save className="h-3 w-3" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
              Edit
            </Button>
          )}
        </div>
      </div>
      <textarea
        value={config}
        onChange={(e) => setConfig(e.target.value)}
        readOnly={!editMode}
        spellCheck={false}
        className="h-[300px] w-full resize-none rounded-md border p-3 text-[12.5px] outline-none"
        style={{
          background: editMode ? "var(--oc-bg3)" : "var(--oc-bg2)",
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
          fontFamily: "var(--oc-mono)",
          lineHeight: "20px",
        }}
      />

      {/* Restart confirmation */}
      <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
        <AlertDialogContent
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border-mid)" }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Restart gateway</AlertDialogTitle>
            <AlertDialogDescription>
              This will restart the gateway process. All active sessions will be interrupted.
              Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restarting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRestart}
              disabled={restarting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {restarting ? "Restarting..." : "Restart"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Access Section (includes password change)                          */
/* ------------------------------------------------------------------ */

function AccessSection({ serverId }: { serverId: string }) {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleChangePassword = async () => {
    setError("");
    setSuccess(false);
    if (newPw !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (newPw.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/fleet/${serverId}/auth/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, newPassword: newPw }),
      });
      if (res.ok) {
        setSuccess(true);
        setCurrent("");
        setNewPw("");
        setConfirm("");
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Failed to change password.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <SectionHead title="Admin email" desc="Read-only, configured at deployment." />
      <FieldRow label="Email">
        <div
          className="rounded-[5px] border px-2.5 py-2 text-xs"
          style={{
            background: "var(--oc-bg2)",
            borderColor: "var(--oc-border)",
            color: "var(--oc-text-dim)",
          }}
        >
          Managed by the active auth session and deployment configuration.
        </div>
      </FieldRow>

      <Divider />

      <SectionHead title="Change password" />
      <FieldRow label="Current password">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className="h-8 w-[280px] rounded-[5px] border px-2 text-xs outline-none"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        />
      </FieldRow>
      <FieldRow label="New password">
        <input
          type="password"
          value={newPw}
          onChange={(e) => setNewPw(e.target.value)}
          className="h-8 w-[280px] rounded-[5px] border px-2 text-xs outline-none"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        />
      </FieldRow>
      <FieldRow label="Confirm password">
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-8 w-[280px] rounded-[5px] border px-2 text-xs outline-none"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        />
      </FieldRow>
      {error && (
        <p className="text-[11px]" style={{ color: "var(--oc-red)", fontFamily: "var(--oc-mono)" }}>
          {error}
        </p>
      )}
      {success && (
        <p className="text-[11px]" style={{ color: "var(--oc-green)", fontFamily: "var(--oc-mono)" }}>
          Password changed successfully.
        </p>
      )}
      <div>
        <Button
          size="sm"
          disabled={!current || !newPw || !confirm || saving}
          onClick={handleChangePassword}
        >
          <Key className="h-3 w-3" />
          {saving ? "Saving..." : "Change password"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Storage Section                                                    */
/* ------------------------------------------------------------------ */

function StorageSection({ serverId }: { serverId: string }) {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);

  useEffect(() => {
    fetch(`/api/fleet/${serverId}/metrics`)
      .then((r) => r.json())
      .then(setMetrics)
      .catch(() => {});
  }, [serverId]);

  const tokenTotal = (metrics?.tokens_24h?.input ?? 0) + (metrics?.tokens_24h?.output ?? 0);
  const lifecycleTotal =
    sumRecord(metrics?.events_30d?.tools) +
    sumRecord(metrics?.events_30d?.sessions) +
    sumRecord(metrics?.events_30d?.subagents);

  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <SectionHead
        title="State & sessions"
        desc="Runtime persistence is file-backed. These values are read from live gateway metrics."
      />
      <FieldRow label="Storage backend">
        <div
          className="inline-flex min-h-8 items-center rounded-[5px] border px-2 text-xs"
          style={{
            background: "var(--oc-bg2)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          SQLite files under data/
        </div>
      </FieldRow>
      <FieldRow label="Metrics database">
        <div
          className="inline-flex min-h-8 items-center rounded-[5px] border px-2 text-xs"
          style={{
            background: "var(--oc-bg2)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          data/metrics.sqlite
        </div>
      </FieldRow>
      <FieldRow label="Session store">
        <div
          className="inline-flex min-h-8 items-center rounded-[5px] border px-2 text-xs"
          style={{
            background: "var(--oc-bg2)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          data/sdk-sessions/
        </div>
      </FieldRow>
      <Divider />
      <SectionHead title="Usage" desc="No synthetic counters. Empty values mean the gateway has not emitted that event yet." />
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <MiniCard label="Disk used" value={formatBytes(metrics?.system?.disk_used_bytes)} delta={metrics?.system?.disk_percent !== undefined ? `${metrics.system.disk_percent.toFixed(1)}% full` : undefined} />
        <MiniCard label="Messages 24h" value={formatCompact(metrics?.messages_24h ?? 0)} delta={`${formatCompact(tokenTotal)} tokens`} />
        <MiniCard label="Lifecycle 30d" value={formatCompact(lifecycleTotal)} delta={`${formatCompact(metrics?.insights_30d?.totalSessions ?? 0)} sessions`} />
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <MiniCard label="Memory RSS" value={formatBytes(metrics?.system?.mem_rss_bytes)} />
        <MiniCard label="Memory DB" value={formatBytes(metrics?.gauges?.memory_store_bytes)} />
        <MiniCard label="Media store" value={formatBytes(metrics?.gauges?.media_store_bytes)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Advanced Section                                                   */
/* ------------------------------------------------------------------ */

function AdvancedSection() {
  return (
    <div className="flex max-w-[720px] flex-col gap-4">
      <SectionHead
        title="Runtime contract"
        desc="Read-only guardrails for the strict native Claude Agent SDK architecture."
      />
      <div
        className="flex flex-col gap-2 rounded-md p-3.5"
        style={{
          background: "var(--oc-bg1)",
          border: "1px solid var(--oc-border)",
        }}
      >
        <RuntimeRow label="LLM runtime" value="Claude Agent SDK / Claude Code only" />
        <RuntimeRow label="Retry/fallback" value="Delegated to native SDK behavior" />
        <RuntimeRow label="OpenAI usage" value="Embeddings for memory only" />
        <RuntimeRow label="Agent tools" value="SDK-native MCP servers and tool() definitions" />
      </div>
      <Divider />
      <SectionHead
        title="Removed legacy controls"
        desc="The previous experimental toggles and storage selector were UI-only switches with no backend effect."
      />
      <div className="rounded-md border px-3.5 py-3 text-xs leading-relaxed" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)", color: "var(--oc-text-dim)" }}>
        Runtime-affecting settings now live on each agent under the Claude Agent SDK section. Gateway-wide controls here only expose behavior that is actually wired to backend state.
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared sub-components                                              */
/* ------------------------------------------------------------------ */

function SectionHead({ title, desc }: { title: string; desc?: string }) {
  return (
    <div>
      <div
        className="text-[13.5px] font-semibold"
        style={{ color: "var(--color-foreground)", marginBottom: 2 }}
      >
        {title}
      </div>
      {desc && (
        <div className="text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
          {desc}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-baseline gap-4 pb-1.5" style={{ gridTemplateColumns: "200px 1fr" }}>
      <div>
        <div className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
          {label}
        </div>
        {hint && (
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function MiniCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: string;
}) {
  return (
    <div
      className="rounded-md px-3 py-2.5"
      style={{
        background: "var(--oc-bg1)",
        border: "1px solid var(--oc-border)",
      }}
    >
      <div
        className="mb-1 text-[10.5px] uppercase tracking-[0.5px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
      </div>
      <div className="text-lg font-semibold" style={{ color: "var(--color-foreground)" }}>
        {value}
      </div>
      {delta && (
        <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
          {delta}
        </div>
      )}
    </div>
  );
}

function RuntimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        {label}
      </span>
      <span className="text-right text-xs" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return (
    <div className="h-px w-full" style={{ background: "var(--oc-border)" }} />
  );
}
