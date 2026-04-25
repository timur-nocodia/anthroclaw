"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  Key,
  Plug,
  RotateCcw,
  Save,
  Settings,
  Shield,
  ShieldCheck,
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
  sdkActiveInput?: SdkActiveInputStatus;
}

interface SdkActiveInputStatus {
  streamInputAvailable: boolean;
  unstableSessionApiAvailable: boolean;
  featureFlagEnabled: boolean;
  nativeSteerEnabled: boolean;
  fallbackMode: "interrupt_and_restart";
  steerDeliveryState?: "accepted_native" | "queued_for_tool_boundary" | "fallback_interrupt_restart" | "unsupported";
  uiDeliveryStates?: Array<"accepted_native" | "queued_for_tool_boundary" | "fallback_interrupt_restart" | "unsupported">;
  reason: string;
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

type CapabilityStatus = "available" | "missing_config" | "disabled" | "error";
type CapabilityRisk = "low" | "medium" | "high";
type McpApprovalStatus = "approved" | "review_required" | "blocked";

interface IntegrationCapability {
  id: string;
  kind: "mcp_tool" | "stt_provider";
  provider: string;
  toolNames: string[];
  status: CapabilityStatus;
  risk: CapabilityRisk;
  costModel?: string;
  requiredConfig?: string[];
  permissionDefaults?: {
    defaultBehavior: "allow" | "deny";
    allowMcp?: boolean;
    allowWeb?: boolean;
    allowBash?: boolean;
    allowedMcpTools?: string[];
    notes: string[];
  };
  enabledForAgents: string[];
  selected?: boolean;
  configSnippet?: string;
  reviewRequired?: boolean;
  reason?: string;
}

interface CapabilityMatrix {
  generatedAt: number;
  capabilities: IntegrationCapability[];
}

interface McpPreflightServer {
  serverName: string;
  ownerAgentId?: string;
  source: "agent_local" | "subagent_portable" | "external";
  transport: "in_process" | "stdio" | "unknown";
  toolNames: string[];
  command?: string;
  args: string[];
  envVarNames: string[];
  networkRisk: CapabilityRisk;
  filesystemRisk: CapabilityRisk;
  packageSource: string;
  approvalStatus: McpApprovalStatus;
  reasons: string[];
}

interface McpPreflightResponse {
  generatedAt: number;
  servers: McpPreflightServer[];
}

interface IntegrationAuditEvent {
  id?: number;
  timestamp?: number;
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  sdkSessionId?: string;
  toolName: string;
  provider: string;
  capabilityId: string;
  status: "started" | "completed" | "failed";
  reason?: string;
}

interface IntegrationAuditResponse {
  events: IntegrationAuditEvent[];
}

interface DirectWebhookDelivery {
  id?: number;
  timestamp?: number;
  webhook: string;
  status: "delivered" | "not_found" | "disabled" | "unauthorized" | "bad_payload" | "channel_unavailable" | "delivery_failed";
  delivered: boolean;
  channel?: string;
  accountId?: string;
  peerId?: string;
  threadId?: string;
  messageId?: string;
  error?: string;
}

interface DirectWebhookDeliveryResponse {
  deliveries: DirectWebhookDelivery[];
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
    { id: "integrations", label: "Integrations", icon: Plug },
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
          {section === "integrations" && <IntegrationsSection serverId={serverId} />}
          {section === "advanced" && <AdvancedSection serverId={serverId} />}
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
/*  Integrations Section                                               */
/* ------------------------------------------------------------------ */

function IntegrationsSection({ serverId }: { serverId: string }) {
  const [capabilities, setCapabilities] = useState<CapabilityMatrix | null>(null);
  const [preflight, setPreflight] = useState<McpPreflightResponse | null>(null);
  const [audit, setAudit] = useState<IntegrationAuditResponse | null>(null);
  const [webhookDeliveries, setWebhookDeliveries] = useState<DirectWebhookDeliveryResponse | null>(null);
  const [auditProviderFilter, setAuditProviderFilter] = useState("all");
  const [auditCapabilityFilter, setAuditCapabilityFilter] = useState("all");
  const [auditStatusFilter, setAuditStatusFilter] = useState<"all" | "started" | "completed" | "failed">("all");
  const [auditRunFilter, setAuditRunFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const auditParams = new URLSearchParams({ limit: "12" });
        if (auditProviderFilter !== "all") auditParams.set("provider", auditProviderFilter);
        if (auditCapabilityFilter !== "all") auditParams.set("capabilityId", auditCapabilityFilter);
        if (auditStatusFilter !== "all") auditParams.set("status", auditStatusFilter);
        if (auditRunFilter.trim()) auditParams.set("runId", auditRunFilter.trim());

        const [capabilityRes, preflightRes, auditRes, webhookRes] = await Promise.all([
          fetch(`/api/fleet/${serverId}/integrations/capabilities`),
          fetch(`/api/fleet/${serverId}/integrations/mcp-preflight`),
          fetch(`/api/fleet/${serverId}/integrations/audit?${auditParams.toString()}`),
          fetch(`/api/fleet/${serverId}/webhooks?limit=12`),
        ]);
        if (!capabilityRes.ok || !preflightRes.ok || !auditRes.ok || !webhookRes.ok) {
          throw new Error("integration_status_unavailable");
        }
        const [capabilityData, preflightData, auditData, webhookData] = await Promise.all([
          capabilityRes.json(),
          preflightRes.json(),
          auditRes.json(),
          webhookRes.json(),
        ]);
        if (!cancelled) {
          setCapabilities(capabilityData);
          setPreflight(preflightData);
          setAudit(auditData);
          setWebhookDeliveries(webhookData);
        }
      } catch {
        if (!cancelled) setError("Integration status is unavailable for this gateway.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [serverId, auditProviderFilter, auditCapabilityFilter, auditStatusFilter, auditRunFilter]);

  const caps = capabilities?.capabilities ?? [];
  const servers = preflight?.servers ?? [];
  const auditEvents = audit?.events ?? [];
  const deliveries = webhookDeliveries?.deliveries ?? [];
  const available = caps.filter((capability) => capability.status === "available").length;
  const missing = caps.filter((capability) => capability.status === "missing_config").length;
  const review = servers.filter((server) => server.approvalStatus !== "approved").length;
  const deliveryFailures = deliveries.filter((delivery) => !delivery.delivered).length;
  const providerOptions = uniqueSorted(caps.map((capability) => capability.provider));
  const capabilityOptions = uniqueSorted(caps.map((capability) => capability.id));

  return (
    <div className="flex max-w-[1040px] flex-col gap-5">
      <SectionHead
        title="Integration status"
        desc="Runtime-derived capability matrix and MCP security preflight. No UI-only toggles."
      />

      {loading && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <SkeletonMetric />
          <SkeletonMetric />
          <SkeletonMetric />
        </div>
      )}

      {!loading && error && (
        <div
          className="flex items-center gap-2 rounded-md border px-3.5 py-3 text-xs"
          style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.08)", color: "var(--oc-red)" }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <MiniCard label="Available" value={formatCompact(available)} delta={`${formatCompact(caps.length)} total capabilities`} />
            <MiniCard label="Missing config" value={formatCompact(missing)} delta="Requires env or config" />
            <MiniCard label="MCP review" value={formatCompact(review)} delta={`${formatCompact(servers.length)} servers inspected`} />
            <MiniCard label="Audit events" value={formatCompact(auditEvents.length)} delta="Recent integration tool calls" />
            <MiniCard label="Webhook deliveries" value={formatCompact(deliveries.length)} delta={`${formatCompact(deliveryFailures)} failed recent deliveries`} />
          </div>

          <Divider />

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)]">
            <div className="min-w-0">
              <SectionHead title="Capabilities" desc="Tools and STT providers visible to this gateway." />
              <div className="mt-3 overflow-hidden rounded-md border" style={{ borderColor: "var(--oc-border)" }}>
                {caps.length === 0 ? (
                  <EmptyPanel text="No integration capabilities reported." />
                ) : (
                  <div className="divide-y" style={{ borderColor: "var(--oc-border)" }}>
                    {caps.map((capability) => (
                      <CapabilityRow key={capability.id} capability={capability} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0">
              <SectionHead title="MCP preflight" desc="Approved servers and risk signals before SDK exposure." />
              <div className="mt-3 flex flex-col overflow-hidden rounded-md border" style={{ borderColor: "var(--oc-border)" }}>
                {servers.length === 0 ? (
                  <EmptyPanel text="No MCP servers reported." />
                ) : (
                  servers.map((server) => (
                    <McpServerPanel key={`${server.ownerAgentId ?? "global"}:${server.serverName}`} server={server} />
                  ))
                )}
              </div>
            </div>
          </div>

          <Divider />

          <div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <SectionHead title="Recent audit" desc="SDK hook events for integration and MCP tool calls." />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <AuditSelect
                  label="Provider"
                  value={auditProviderFilter}
                  onChange={setAuditProviderFilter}
                  options={providerOptions}
                />
                <AuditSelect
                  label="Capability"
                  value={auditCapabilityFilter}
                  onChange={setAuditCapabilityFilter}
                  options={capabilityOptions}
                />
                <AuditSelect
                  label="Status"
                  value={auditStatusFilter}
                  onChange={(value) => setAuditStatusFilter(value as typeof auditStatusFilter)}
                  options={["started", "completed", "failed"]}
                />
                <AuditTextFilter
                  label="Run"
                  value={auditRunFilter}
                  onChange={setAuditRunFilter}
                  placeholder="run id"
                />
              </div>
            </div>
            <div className="mt-3 overflow-hidden rounded-md border" style={{ borderColor: "var(--oc-border)" }}>
              {auditEvents.length === 0 ? (
                <EmptyPanel text="No integration tool calls recorded yet." />
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--oc-border)" }}>
                  {auditEvents.map((event, index) => (
                    <AuditEventRow key={`${event.id ?? index}:${event.toolName}:${event.status}`} event={event} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <SectionHead title="Direct webhook deliveries" desc="Recent zero-LLM delivery attempts routed directly to channels." />
            <div className="mt-3 overflow-hidden rounded-md border" style={{ borderColor: "var(--oc-border)" }}>
              {deliveries.length === 0 ? (
                <EmptyPanel text="No direct webhook deliveries recorded yet." />
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--oc-border)" }}>
                  {deliveries.map((delivery, index) => (
                    <DirectWebhookDeliveryRow key={`${delivery.id ?? index}:${delivery.webhook}:${delivery.status}`} delivery={delivery} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function AuditSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="min-w-[130px] text-[10px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-8 w-full rounded-md border px-2 text-[11px] outline-none"
        style={{
          background: "var(--oc-bg1)",
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
          fontFamily: "var(--oc-mono)",
        }}
      >
        <option value="all">all</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function AuditTextFilter({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="min-w-[130px] text-[10px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 h-8 w-full rounded-md border px-2 text-[11px] outline-none"
        style={{
          background: "var(--oc-bg1)",
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
          fontFamily: "var(--oc-mono)",
        }}
      />
    </label>
  );
}

function DirectWebhookDeliveryRow({ delivery }: { delivery: DirectWebhookDelivery }) {
  const status = delivery.delivered ? "available" : "error";
  return (
    <div className="grid gap-3 px-3.5 py-3 md:grid-cols-[150px_minmax(180px,1fr)_minmax(210px,1fr)_110px]" style={{ background: "var(--oc-bg1)" }}>
      <div>
        <StatusPill status={status} />
        <div className="mt-2 text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
          {delivery.timestamp ? new Date(delivery.timestamp).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "no timestamp"}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
          {delivery.webhook}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
          {delivery.channel ?? "channel:unknown"} / {delivery.messageId ? `msg:${delivery.messageId}` : "no message"}
        </div>
      </div>
      <div className="min-w-0">
        <MetaLabel>Target</MetaLabel>
        <TokenList values={[
          delivery.accountId ? `account:${delivery.accountId}` : "account:default",
          delivery.peerId ? `peer:${delivery.peerId}` : "peer:unknown",
          delivery.threadId ? `thread:${delivery.threadId}` : "thread:none",
        ]} />
        {delivery.error && (
          <div className="mt-2 line-clamp-2 text-[11px] leading-relaxed" style={{ color: "var(--oc-red)" }}>
            {delivery.error}
          </div>
        )}
      </div>
      <div className="text-right text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: delivery.delivered ? "var(--oc-green)" : "var(--oc-red)" }}>
        {delivery.status.replace("_", " ")}
      </div>
    </div>
  );
}

function AuditEventRow({ event }: { event: IntegrationAuditEvent }) {
  return (
    <div className="grid gap-3 px-3.5 py-3 md:grid-cols-[150px_minmax(180px,1fr)_minmax(210px,1fr)_110px]" style={{ background: "var(--oc-bg1)" }}>
      <div>
        <StatusPill status={event.status === "failed" ? "error" : event.status === "completed" ? "available" : "disabled"} />
        <div className="mt-2 text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
          {event.timestamp ? new Date(event.timestamp).toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "no timestamp"}
        </div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
          {event.toolName}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
          {event.provider} / {event.capabilityId}
        </div>
      </div>
      <div className="min-w-0">
        <MetaLabel>Scope</MetaLabel>
        <TokenList values={[
          event.agentId ? `agent:${event.agentId}` : "agent:unknown",
          event.runId ? `run:${event.runId}` : "run:unknown",
          event.sdkSessionId ? `sdk:${event.sdkSessionId}` : "sdk:unknown",
        ]} />
      </div>
      <div className="text-right text-[11px] font-semibold uppercase tracking-[0.4px]" style={{ color: event.status === "failed" ? "var(--oc-red)" : event.status === "completed" ? "var(--oc-green)" : "var(--oc-text-muted)" }}>
        {event.status}
      </div>
    </div>
  );
}

function CapabilityRow({ capability }: { capability: IntegrationCapability }) {
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const copyConfigSnippet = async () => {
    if (!capability.configSnippet) return;
    await navigator.clipboard.writeText(capability.configSnippet);
    setCopiedSnippet(true);
    window.setTimeout(() => setCopiedSnippet(false), 1200);
  };

  return (
    <div className="grid gap-3 px-3.5 py-3 md:grid-cols-[minmax(190px,0.9fr)_minmax(180px,1fr)_minmax(210px,1fr)]" style={{ background: "var(--oc-bg1)" }}>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusPill status={capability.status} />
          <RiskPill risk={capability.risk} />
          {capability.selected && <StatusPill status="available" label="selected" />}
          {capability.reviewRequired && <StatusPill status="missing_config" label="review gated" />}
        </div>
        <div className="mt-2 truncate text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
          {capability.id}
        </div>
        <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
          {capability.provider} / {capability.kind.replace("_", " ")}
        </div>
      </div>
      <div className="min-w-0">
        <MetaLabel>Tools</MetaLabel>
        <TokenList values={capability.toolNames.length ? capability.toolNames : ["pre-sdk"]} />
        <div className="mt-2">
          <MetaLabel>Agents</MetaLabel>
          <TokenList values={capability.enabledForAgents.length ? capability.enabledForAgents : ["none"]} muted={capability.enabledForAgents.length === 0} />
        </div>
      </div>
      <div className="min-w-0">
        <MetaLabel>Recommended policy</MetaLabel>
        <div className="text-[11.5px] leading-relaxed" style={{ color: "var(--oc-text-dim)" }}>
          default: <MonoText>{capability.permissionDefaults?.defaultBehavior ?? "deny"}</MonoText>
          {capability.permissionDefaults?.allowedMcpTools !== undefined && (
            <>
              <br />
              allow MCP: <MonoText>{capability.permissionDefaults.allowedMcpTools.length ? capability.permissionDefaults.allowedMcpTools.join(", ") : "operator review"}</MonoText>
            </>
          )}
        </div>
        {(capability.reason || capability.requiredConfig?.length) && (
          <div className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
            {capability.reason ?? `Requires ${capability.requiredConfig?.join(", ")}`}
          </div>
        )}
        {capability.configSnippet && (
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <MetaLabel>Config snippet</MetaLabel>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyConfigSnippet()}
                className="h-6 px-2 text-[10px]"
              >
                {copiedSnippet ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copiedSnippet ? "Copied" : "Copy"}
              </Button>
            </div>
            <pre
              className="max-h-[120px] overflow-auto rounded border p-2 text-[10.5px] leading-relaxed"
              style={{
                background: "var(--oc-bg2)",
                borderColor: "var(--oc-border)",
                color: "var(--oc-text-dim)",
                fontFamily: "var(--oc-mono)",
              }}
            >
              {capability.configSnippet}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

function McpServerPanel({ server }: { server: McpPreflightServer }) {
  return (
    <div className="border-b px-3.5 py-3 last:border-b-0" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
            {server.serverName}
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
            {server.transport} / {server.packageSource}
          </div>
        </div>
        <ApprovalPill status={server.approvalStatus} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <RiskCell label="Network" risk={server.networkRisk} />
        <RiskCell label="Filesystem" risk={server.filesystemRisk} />
      </div>

      <div className="mt-3">
        <MetaLabel>Env vars</MetaLabel>
        <TokenList values={server.envVarNames.length ? server.envVarNames : ["none"]} muted={server.envVarNames.length === 0} />
      </div>

      <div className="mt-2">
        <MetaLabel>Tools</MetaLabel>
        <TokenList values={server.toolNames.length ? server.toolNames : ["unknown"]} muted={server.toolNames.length === 0} />
      </div>

      {server.reasons.length > 0 && (
        <div className="mt-3 space-y-1">
          {server.reasons.slice(0, 3).map((reason) => (
            <div key={reason} className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
              {reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status, label }: { status: CapabilityStatus; label?: string }) {
  const color = status === "available"
    ? "var(--oc-green)"
    : status === "missing_config"
      ? "var(--oc-yellow)"
      : status === "error"
        ? "var(--oc-red)"
        : "var(--oc-text-muted)";
  const Icon = status === "available" ? CheckCircle2 : AlertTriangle;
  return (
    <span className="inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.4px]" style={{ borderColor: "var(--oc-border-mid)", color, background: "var(--oc-bg2)" }}>
      <Icon className="h-3 w-3" />
      {(label ?? status).replace("_", " ")}
    </span>
  );
}

function RiskPill({ risk }: { risk: CapabilityRisk }) {
  const color = risk === "low" ? "var(--oc-green)" : risk === "medium" ? "var(--oc-yellow)" : "var(--oc-red)";
  return (
    <span className="inline-flex rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.4px]" style={{ color, background: "var(--oc-bg2)" }}>
      {risk} risk
    </span>
  );
}

function ApprovalPill({ status }: { status: McpApprovalStatus }) {
  const color = status === "approved" ? "var(--oc-green)" : status === "blocked" ? "var(--oc-red)" : "var(--oc-yellow)";
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.4px]" style={{ borderColor: "var(--oc-border-mid)", color, background: "var(--oc-bg2)" }}>
      <ShieldCheck className="h-3 w-3" />
      {status.replace("_", " ")}
    </span>
  );
}

function RiskCell({ label, risk }: { label: string; risk: CapabilityRisk }) {
  return (
    <div className="rounded-[5px] border px-2 py-1.5" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
      <div className="text-[10px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>{label}</div>
      <div className="mt-0.5 text-xs font-semibold" style={{ color: risk === "low" ? "var(--oc-green)" : risk === "medium" ? "var(--oc-yellow)" : "var(--oc-red)" }}>
        {risk}
      </div>
    </div>
  );
}

function TokenList({ values, muted = false }: { values: string[]; muted?: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {values.slice(0, 8).map((value) => (
        <span key={value} className="max-w-full truncate rounded-[4px] border px-1.5 py-0.5 text-[10.5px]" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)", color: muted ? "var(--oc-text-muted)" : "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}>
          {value}
        </span>
      ))}
      {values.length > 8 && (
        <span className="rounded-[4px] px-1.5 py-0.5 text-[10.5px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
          +{values.length - 8}
        </span>
      )}
    </div>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.45px]" style={{ color: "var(--oc-text-muted)" }}>
      {children}
    </div>
  );
}

function MonoText({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>{children}</span>;
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="px-3.5 py-8 text-center text-xs" style={{ color: "var(--oc-text-muted)", background: "var(--oc-bg1)" }}>
      {text}
    </div>
  );
}

function SkeletonMetric() {
  return (
    <div className="rounded-md border px-3 py-2.5" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
      <div className="h-3 w-20 animate-pulse rounded bg-[var(--oc-bg3)]" />
      <div className="mt-3 h-6 w-14 animate-pulse rounded bg-[var(--oc-bg3)]" />
      <div className="mt-2 h-3 w-28 animate-pulse rounded bg-[var(--oc-bg3)]" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Advanced Section                                                   */
/* ------------------------------------------------------------------ */

function AdvancedSection({ serverId }: { serverId: string }) {
  const diagnosticsUrl = `/api/fleet/${serverId}/diagnostics/export?includeLogs=true&runLimit=50&routeDecisionLimit=50&diagnosticEventLimit=200`;
  const [activeInput, setActiveInput] = useState<SdkActiveInputStatus | null>(null);

  useEffect(() => {
    fetch(`/api/fleet/${serverId}/gateway/status`)
      .then((r) => r.json())
      .then((data: GatewayInfo) => setActiveInput(data.sdkActiveInput ?? null))
      .catch(() => setActiveInput(null));
  }, [serverId]);

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
        title="Active input"
        desc="Current SDK-native steer decision for active runs."
      />
      <div
        className="flex flex-col gap-2 rounded-md border px-3.5 py-3"
        style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
      >
        <RuntimeRow
          label="Native steer"
          value={activeInput?.nativeSteerEnabled ? "enabled" : "disabled"}
        />
        <RuntimeRow
          label="SDK stream input"
          value={activeInput?.streamInputAvailable ? "available" : "unavailable"}
        />
        <RuntimeRow
          label="Feature flag"
          value={activeInput?.featureFlagEnabled ? "features.sdk_active_input=true" : "features.sdk_active_input=false"}
        />
        <RuntimeRow
          label="Fallback mode"
          value={activeInput?.fallbackMode ?? "interrupt_and_restart"}
        />
        <RuntimeRow
          label="Steer delivery"
          value={activeInput?.steerDeliveryState ?? "fallback_interrupt_restart"}
        />
        <RuntimeRow
          label="UI states"
          value={(activeInput?.uiDeliveryStates ?? ["fallback_interrupt_restart", "unsupported"]).join(", ")}
        />
        <div className="pt-1 text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          {activeInput?.reason ?? "Active input status is unavailable from this gateway."}
        </div>
      </div>
      <Divider />
      <SectionHead
        title="Diagnostics"
        desc="Download a redacted support bundle for failed runs, route decisions, logs, metrics, and environment metadata."
      />
      <div
        className="flex items-center justify-between gap-3 rounded-md border px-3.5 py-3"
        style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
      >
        <div className="min-w-0">
          <div className="text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
            Support bundle
          </div>
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
            JSON export with secrets redacted. Transcript content is excluded by backend defaults.
          </div>
        </div>
        <a href={diagnosticsUrl} download={`anthroclaw-${serverId}-diagnostics.json`}>
          <Button variant="outline" size="sm">
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
        </a>
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
