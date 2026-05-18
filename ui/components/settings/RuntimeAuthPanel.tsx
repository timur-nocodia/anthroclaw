"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  KeyRound,
  Loader2,
  RefreshCcw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface RuntimeStatus {
  harness?: { id?: string };
  defaultProvider?: string;
  pi?: {
    packageName?: string;
    packageAvailable?: boolean;
    defaultModel?: string;
    authPath?: string | null;
    authConfigured?: boolean;
    modelsPath?: string | null;
    modelsConfigured?: boolean;
    lastError?: string | null;
  };
  agents?: {
    total?: number;
    byEffectiveProvider?: Record<string, number>;
  };
  gateway?: {
    activeSessions?: number | null;
    lastError?: string | null;
  };
  legacy?: {
    claudeAgentSdk?: {
      present?: boolean;
      primary?: boolean;
    };
  };
}

export function RuntimeAuthPanel({ serverId }: { serverId: string }) {
  const endpoint = useMemo(() => `/api/fleet/${serverId}/runtime/status`, [serverId]);
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadStatus = async () => {
    setError("");
    try {
      const res = await fetch(endpoint);
      const data = await res.json() as RuntimeStatus & { error?: string; message?: string };
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Runtime status is unavailable.");
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Runtime status is unavailable.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  const piReady = Boolean(
    status?.defaultProvider === "pi"
    && status?.pi?.packageAvailable
    && status?.pi?.authConfigured
    && status?.pi?.modelsConfigured,
  );
  const legacyPrimary = status?.legacy?.claudeAgentSdk?.primary === true;
  const agentDistribution = Object.entries(status?.agents?.byEffectiveProvider ?? {})
    .filter(([, count]) => count > 0)
    .map(([provider, count]) => `${provider}: ${count}`)
    .join(", ") || "---";
  const activeSessions = status?.gateway?.activeSessions;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <SectionTitle>Runtime v1 provider readiness</SectionTitle>
            <StatusBadge ready={piReady} loading={loading} legacyPrimary={legacyPrimary} />
          </div>
          <div className="mt-1 max-w-[620px] text-[11.5px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
            Primary runtime status for the selected fleet gateway. Pi readiness is derived from runtime config, package availability, and configured model/auth storage paths.
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadStatus()} disabled={loading}>
          <RefreshCcw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <InfoCell label="Harness" value={status?.harness?.id ?? "runtime-v1"} />
        <InfoCell label="Default provider" value={status?.defaultProvider ?? "---"} warn={legacyPrimary} />
        <InfoCell label="Pi package" value={status?.pi?.packageName ?? "---"} ok={status?.pi?.packageAvailable} />
        <InfoCell label="Pi default model" value={status?.pi?.defaultModel ?? "---"} />
        <InfoCell label="Pi auth path" value={status?.pi?.authPath ?? "---"} ok={status?.pi?.authConfigured} warn={!status?.pi?.authConfigured} wide />
        <InfoCell label="Pi models path" value={status?.pi?.modelsPath ?? "---"} ok={status?.pi?.modelsConfigured} warn={!status?.pi?.modelsConfigured} wide />
        <InfoCell label="Agents by provider" value={agentDistribution} wide />
        <InfoCell label="Active sessions" value={activeSessions === null || activeSessions === undefined ? "---" : String(activeSessions)} />
      </div>

      {legacyPrimary && (
        <Notice tone="warn" text="Default provider is still legacy Claude Agent SDK. Runtime UI remains available, but Pi is not the active default for this gateway." />
      )}
      {status?.pi?.lastError && <Notice tone="error" text={status.pi.lastError} />}
      {status?.gateway?.lastError && <Notice tone="error" text={status.gateway.lastError} />}
      {error && <Notice tone="error" text={error} />}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>
      {children}
    </div>
  );
}

function StatusBadge({ ready, loading, legacyPrimary }: { ready: boolean; loading: boolean; legacyPrimary: boolean }) {
  const icon = loading
    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
    : ready
      ? <CheckCircle2 className="h-3.5 w-3.5" />
      : legacyPrimary
        ? <ShieldCheck className="h-3.5 w-3.5" />
        : <AlertTriangle className="h-3.5 w-3.5" />;
  const text = loading ? "Loading" : ready ? "Pi ready" : legacyPrimary ? "Legacy primary" : "Needs setup";
  const color = loading
    ? "var(--oc-text-muted)"
    : ready
      ? "var(--oc-green)"
      : legacyPrimary
        ? "var(--oc-yellow)"
        : "var(--oc-red)";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ borderColor: color, color }}>
      {icon}
      {text}
    </span>
  );
}

function InfoCell({
  label,
  value,
  ok,
  warn,
  wide,
}: {
  label: string;
  value: string;
  ok?: boolean;
  warn?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={wide ? "rounded-md border px-3 py-2.5 sm:col-span-2" : "rounded-md border px-3 py-2.5"}
      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
    >
      <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide" style={{ color: "var(--oc-text-dim)" }}>
        {ok ? <CheckCircle2 className="h-3 w-3" style={{ color: "var(--oc-green)" }} /> : warn ? <AlertTriangle className="h-3 w-3" style={{ color: "var(--oc-yellow)" }} /> : <Cpu className="h-3 w-3" />}
        {label}
      </div>
      <div className="break-all font-mono text-[12px]" style={{ color: "var(--color-foreground)" }}>
        {value}
      </div>
    </div>
  );
}

function Notice({ tone, text }: { tone: "warn" | "error"; text: string }) {
  const color = tone === "error" ? "var(--oc-red)" : "var(--oc-yellow)";
  return (
    <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-xs" style={{ borderColor: color, color, background: "var(--oc-bg1)" }}>
      {tone === "error" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> : <KeyRound className="mt-0.5 h-3.5 w-3.5" />}
      <span>{text}</span>
    </div>
  );
}
