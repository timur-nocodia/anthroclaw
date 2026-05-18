"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Cpu,
  FileText,
  Gauge,
  KeyRound,
  Layers3,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  TableProperties,
  TerminalSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClaudeAuthPanel } from "@/components/settings/ClaudeAuthPanel";

type TabId = "overview" | "gates" | "expansion" | "legacy";

interface RuntimeStatus {
  harness?: { id?: string };
  defaultProvider?: string;
  legacyProviders?: string[];
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
    uptime?: number | null;
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

interface RuntimeGate {
  id: string;
  title: string;
  summary: string;
  capabilityGroup: string;
  focusedCommand: string;
  aggregateDispatcher: boolean;
  risk: string;
  action: string;
  execution: {
    requiredFlags: string[];
    optionalFlags: string[];
    supportsDryRun: boolean;
    safetyMode: string;
    approval: string;
    exampleArgs: string[];
  };
}

interface RuntimeGateRegistry {
  status?: string;
  gates?: RuntimeGate[];
}

interface RuntimeModelOption {
  id: string;
  label?: string;
  provider?: string;
  runtime?: string;
}

interface RuntimeModelGroup {
  id: string;
  title: string;
  enabled: boolean;
  compatibility?: boolean;
  source?: {
    kind?: string;
    modelsPath?: string | null;
    modelsConfigured?: boolean;
    error?: string | null;
  };
  models: RuntimeModelOption[];
}

interface RuntimeModels {
  defaultProvider?: string;
  defaultModel?: string;
  groups?: RuntimeModelGroup[];
  options?: RuntimeModelOption[];
}

type OpenEvidenceKind = "operatorApproval" | "postExpansionMonitor" | "liveAction" | "automated" | "manual";

interface ExpansionAgent {
  id: string;
  risk: string;
  recommendedRing: string;
  agentsDir: string;
  state: string;
  blockers: string[];
  nextActions: string[];
  packet: {
    present: boolean;
    path?: string;
    status?: string;
    checkedItems: number;
    uncheckedItems: number;
    totalItems: number;
    uncheckedLabels: string[];
    uncheckedByKind: Record<OpenEvidenceKind, number>;
  };
}

interface ExpansionStatus {
  status?: "passed" | "attention";
  agentsDirs?: string[];
  packetsDir?: string;
  summary?: {
    totalAgents: number;
    highOrCriticalAgents: number;
    closedAgents: number;
    openAgents: number;
    packetMissing: number;
    blockedAgents: number;
    closedEvidenceItems: number;
    openEvidenceItems: number;
    totalEvidenceItems: number;
    evidenceProgressPercent: number;
    openEvidenceByKind: Record<OpenEvidenceKind, number>;
  };
  agents?: ExpansionAgent[];
  gaps?: {
    packetCoverageGap: boolean;
    missingPackets: string[];
    auditErrors: Array<{ agentId: string; error: string }>;
    skippedDirectories: Array<{ agentsDir: string; name: string; reason: string }>;
  };
  policy?: {
    failOnOpen: boolean;
    allowExternalOpen: boolean;
    allowedOpenKinds: OpenEvidenceKind[];
    exitCode: 0 | 1;
    passed: boolean;
    reason: string;
    disallowedOpenEvidenceByKind: Record<OpenEvidenceKind, number>;
    violations: Array<{ agentId?: string; kind: string; label: string; path?: string }>;
  };
}

interface RuntimePageData {
  status: RuntimeStatus | null;
  gates: RuntimeGateRegistry | null;
  expansion: ExpansionStatus | null;
  models: RuntimeModels | null;
}

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "gates", label: "Gates", icon: ShieldCheck },
  { id: "expansion", label: "Expansion", icon: TableProperties },
  { id: "legacy", label: "Legacy", icon: KeyRound },
];

const OPEN_KIND_ORDER: OpenEvidenceKind[] = [
  "operatorApproval",
  "postExpansionMonitor",
  "liveAction",
  "automated",
  "manual",
];

export default function RuntimePage() {
  const params = useParams();
  const serverId = (params?.serverId as string) || "local";
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [data, setData] = useState<RuntimePageData>({
    status: null,
    gates: null,
    expansion: null,
    models: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const base = useMemo(() => `/api/fleet/${serverId}/runtime`, [serverId]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [status, gates, expansion, models] = await Promise.all([
        fetchJson<RuntimeStatus>(`${base}/status`),
        fetchJson<RuntimeGateRegistry>(`${base}/gates`),
        fetchJson<ExpansionStatus>(`${base}/expansion-status`),
        fetchJson<RuntimeModels>(`${base}/models`),
      ]);
      setData({ status, gates, expansion, models });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Runtime data is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const piReady = isPiReady(data.status);
  const legacyPrimary = data.status?.legacy?.claudeAgentSdk?.primary === true;

  return (
    <main className="flex min-h-full flex-col" style={{ background: "var(--oc-bg0)" }}>
      <header
        className="flex flex-col gap-3 border-b px-4 py-4 md:flex-row md:items-center md:justify-between"
        style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[18px] font-semibold" style={{ color: "var(--color-foreground)" }}>
              Runtime
            </h1>
            <StatusPill
              tone={piReady ? "ok" : legacyPrimary ? "warn" : "error"}
              icon={piReady ? CheckCircle2 : legacyPrimary ? ShieldCheck : AlertTriangle}
            >
              {loading ? "loading" : piReady ? "pi ready" : legacyPrimary ? "legacy primary" : "needs setup"}
            </StatusPill>
          </div>
          <p className="mt-1 max-w-[820px] text-[12px] leading-5" style={{ color: "var(--oc-text-dim)" }}>
            Runtime v1 control plane for provider readiness, side-effect gates, expansion evidence, and legacy compatibility.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </header>

      <section className="border-b px-4 pt-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
        <div className="flex flex-wrap gap-1">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="flex h-8 items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-[12px] font-medium"
                style={{
                  borderColor: active ? "var(--oc-border)" : "transparent",
                  background: active ? "var(--oc-bg1)" : "transparent",
                  color: active ? "var(--color-foreground)" : "var(--oc-text-muted)",
                }}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex-1 px-4 py-4">
        {error && <Notice tone="error" text={error} />}
        {activeTab === "overview" && <OverviewTab data={data} loading={loading} />}
        {activeTab === "gates" && <GatesTab gates={data.gates?.gates ?? []} loading={loading} />}
        {activeTab === "expansion" && <ExpansionTab expansion={data.expansion} loading={loading} />}
        {activeTab === "legacy" && (
          <Panel title="Claude Agent SDK compatibility" icon={KeyRound}>
            <ClaudeAuthPanel serverId={serverId} />
          </Panel>
        )}
      </section>
    </main>
  );
}

function OverviewTab({ data, loading }: { data: RuntimePageData; loading: boolean }) {
  const status = data.status;
  const models = data.models;
  const providerCounts = Object.entries(status?.agents?.byEffectiveProvider ?? {});
  const maxProviderCount = Math.max(1, ...providerCounts.map(([, count]) => count));
  const modelGroups = models?.groups ?? [];

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
      <div className="grid min-w-0 gap-3">
        <div className="grid gap-3 md:grid-cols-3">
          <Metric label="Harness" value={status?.harness?.id ?? "runtime-v1"} icon={Cpu} loading={loading} />
          <Metric label="Provider" value={status?.defaultProvider ?? "---"} icon={Layers3} loading={loading} warn={status?.defaultProvider !== "pi"} />
          <Metric label="Agents" value={String(status?.agents?.total ?? 0)} icon={Gauge} loading={loading} />
        </div>
        <Panel title="Pi readiness" icon={CheckCircle2}>
          <div className="grid gap-2 md:grid-cols-2">
            <InfoRow label="Package" value={status?.pi?.packageName ?? "---"} state={status?.pi?.packageAvailable ? "ok" : "warn"} />
            <InfoRow label="Default model" value={status?.pi?.defaultModel ?? "---"} />
            <InfoRow label="Auth path" value={status?.pi?.authPath ?? "---"} state={status?.pi?.authConfigured ? "ok" : "warn"} wide />
            <InfoRow label="Models path" value={status?.pi?.modelsPath ?? "---"} state={status?.pi?.modelsConfigured ? "ok" : "warn"} wide />
          </div>
          {status?.pi?.lastError && <Notice tone="error" text={status.pi.lastError} compact />}
          {status?.gateway?.lastError && <Notice tone="error" text={status.gateway.lastError} compact />}
        </Panel>
        <Panel title="Agent provider distribution" icon={Layers3}>
          {providerCounts.length === 0 ? (
            <Empty text="No agent provider data yet." />
          ) : (
            <div className="grid gap-2">
              {providerCounts.map(([provider, count]) => (
                <BarRow key={provider} label={provider} value={count} max={maxProviderCount} />
              ))}
            </div>
          )}
        </Panel>
      </div>
      <Panel title="Runtime model registry" icon={TerminalSquare}>
        <div className="mb-3 grid gap-2">
          <InfoRow label="Default model" value={models?.defaultModel ?? "---"} />
          <InfoRow label="Default provider" value={models?.defaultProvider ?? "---"} state={models?.defaultProvider === "pi" ? "ok" : "warn"} />
        </div>
        <div className="grid gap-2">
          {modelGroups.length === 0 ? (
            <Empty text="No model registry data loaded." />
          ) : (
            modelGroups.map((group) => (
              <div key={group.id} className="rounded-md border px-3 py-2.5" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                      {group.title}
                    </div>
                    <div className="mt-0.5 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
                      {group.source?.kind ?? "runtime"} source · {group.models.length} model(s)
                    </div>
                  </div>
                  <StatusPill tone={group.compatibility ? "warn" : group.enabled ? "ok" : "neutral"}>
                    {group.compatibility ? "legacy" : group.enabled ? "enabled" : "available"}
                  </StatusPill>
                </div>
                {group.source?.error && <Notice tone="error" text={group.source.error} compact />}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {group.models.slice(0, 6).map((model) => (
                    <span
                      key={model.id}
                      className="rounded-[4px] border px-2 py-1 text-[11px]"
                      style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}
                    >
                      {model.id}
                    </span>
                  ))}
                  {group.models.length > 6 && (
                    <span className="px-2 py-1 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
                      +{group.models.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function GatesTab({ gates, loading }: { gates: RuntimeGate[]; loading: boolean }) {
  const [selectedId, setSelectedId] = useState("");
  const selectedGate = useMemo(() => {
    if (gates.length === 0) return null;
    return gates.find((gate) => gate.id === selectedId) ?? gates[0] ?? null;
  }, [gates, selectedId]);

  useEffect(() => {
    if (!selectedId && gates[0]) setSelectedId(gates[0].id);
  }, [gates, selectedId]);

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <Panel title="Side-effect gate registry" icon={ShieldCheck} pad={false}>
        {loading && gates.length === 0 ? (
          <LoadingRows />
        ) : gates.length === 0 ? (
          <div className="p-3"><Empty text="No side-effect gates registered." /></div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead>
                <tr style={{ color: "var(--oc-text-muted)", borderBottom: "1px solid var(--oc-border)" }}>
                  <Th>Gate</Th>
                  <Th>Capability</Th>
                  <Th>Risk</Th>
                  <Th>Approval</Th>
                  <Th>Dry run</Th>
                </tr>
              </thead>
              <tbody>
                {gates.map((gate) => {
                  const active = selectedGate?.id === gate.id;
                  return (
                    <tr
                      key={gate.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(gate.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") setSelectedId(gate.id);
                      }}
                      style={{
                        borderBottom: "1px solid var(--oc-border)",
                        background: active ? "var(--oc-accent-soft)" : undefined,
                      }}
                    >
                      <Td>
                        <div className="font-semibold" style={{ color: active ? "var(--oc-accent)" : "var(--color-foreground)" }}>
                          {gate.title}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
                          {gate.id}
                        </div>
                      </Td>
                      <Td>{gate.capabilityGroup}</Td>
                      <Td><RiskBadge risk={gate.risk} /></Td>
                      <Td>{gate.execution.approval}</Td>
                      <Td>{gate.execution.supportsDryRun ? "supported" : "not supported"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Plan detail" icon={TerminalSquare}>
        {selectedGate ? (
          <div className="grid gap-3">
            <div>
              <div className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                {selectedGate.title}
              </div>
              <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--oc-text-dim)" }}>
                {selectedGate.summary}
              </p>
            </div>
            <div className="grid gap-2">
              <InfoRow label="Focused command" value={selectedGate.focusedCommand} />
              <InfoRow label="Action" value={selectedGate.action} />
              <InfoRow label="Safety mode" value={selectedGate.execution.safetyMode} state="ok" />
              <InfoRow label="Approval" value={selectedGate.execution.approval} state="warn" />
            </div>
            <FlagList title="Required flags" flags={selectedGate.execution.requiredFlags} />
            <FlagList title="Optional flags" flags={selectedGate.execution.optionalFlags} />
            <FlagList title="Example args" flags={selectedGate.execution.exampleArgs} />
            <Notice tone="warn" text="This UI view is plan-only. Live gate execution stays disabled until a separate approval flow is implemented." compact />
          </div>
        ) : (
          <Empty text="Select a gate to inspect its dry-run plan metadata." />
        )}
      </Panel>
    </div>
  );
}

function ExpansionTab({ expansion, loading }: { expansion: ExpansionStatus | null; loading: boolean }) {
  const summary = expansion?.summary;
  const agents = expansion?.agents ?? [];
  const progress = summary?.evidenceProgressPercent ?? 0;

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="grid gap-3">
        <Panel title="Expansion progress" icon={Gauge}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-[28px] font-semibold" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
                {loading && !summary ? "---" : `${progress}%`}
              </div>
              <div className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
                {summary ? `${summary.closedEvidenceItems}/${summary.totalEvidenceItems} evidence items closed` : "Evidence status is loading."}
              </div>
            </div>
            <StatusPill tone={expansion?.status === "passed" ? "ok" : "warn"}>
              {expansion?.status ?? "loading"}
            </StatusPill>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "var(--oc-bg3)" }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: "var(--oc-accent)" }} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <InfoRow label="Open agents" value={String(summary?.openAgents ?? 0)} state={(summary?.openAgents ?? 0) === 0 ? "ok" : "warn"} />
            <InfoRow label="Missing packets" value={String(summary?.packetMissing ?? 0)} state={(summary?.packetMissing ?? 0) === 0 ? "ok" : "warn"} />
            <InfoRow label="Packets dir" value={expansion?.packetsDir ?? "---"} wide />
            <InfoRow label="Agents dirs" value={(expansion?.agentsDirs ?? []).join(", ") || "---"} wide />
          </div>
        </Panel>
        <Panel title="Policy state" icon={ShieldCheck}>
          <div className="grid gap-2">
            <InfoRow label="Policy passed" value={expansion?.policy?.passed ? "yes" : "no"} state={expansion?.policy?.passed ? "ok" : "warn"} />
            <InfoRow label="Exit code" value={String(expansion?.policy?.exitCode ?? "---")} />
            <InfoRow label="Allowed open kinds" value={(expansion?.policy?.allowedOpenKinds ?? []).join(", ") || "---"} wide />
            <InfoRow label="Reason" value={expansion?.policy?.reason ?? "---"} wide />
          </div>
          {(expansion?.policy?.violations ?? []).length > 0 && (
            <div className="mt-3 grid gap-1.5">
              {expansion?.policy?.violations.slice(0, 6).map((violation, index) => (
                <Notice key={`${violation.kind}-${index}`} tone="warn" text={`${violation.kind}: ${violation.label}`} compact />
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Open evidence by kind" icon={FileText}>
          <div className="grid gap-2">
            {OPEN_KIND_ORDER.map((kind) => (
              <BarRow
                key={kind}
                label={kind}
                value={summary?.openEvidenceByKind?.[kind] ?? 0}
                max={Math.max(1, summary?.openEvidenceItems ?? 0)}
              />
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Packet evidence queue" icon={TableProperties} pad={false}>
        {loading && agents.length === 0 ? (
          <LoadingRows />
        ) : agents.length === 0 ? (
          <div className="p-3"><Empty text="No expansion evidence queue items." /></div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full min-w-[860px] text-left text-[12px]">
              <thead>
                <tr style={{ color: "var(--oc-text-muted)", borderBottom: "1px solid var(--oc-border)" }}>
                  <Th>Agent</Th>
                  <Th>State</Th>
                  <Th>Risk</Th>
                  <Th>Evidence</Th>
                  <Th>Packet</Th>
                  <Th>Next action</Th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={`${agent.agentsDir}-${agent.id}`} style={{ borderBottom: "1px solid var(--oc-border)" }}>
                    <Td>
                      <div className="font-semibold" style={{ color: "var(--color-foreground)" }}>{agent.id}</div>
                      <div className="mt-0.5 font-mono text-[11px]" style={{ color: "var(--oc-text-muted)" }}>{agent.recommendedRing}</div>
                    </Td>
                    <Td>{agent.state}</Td>
                    <Td><RiskBadge risk={agent.risk} /></Td>
                    <Td>{agent.packet.checkedItems}/{agent.packet.totalItems}</Td>
                    <Td>
                      <span className="block max-w-[220px] truncate font-mono text-[11px]" title={agent.packet.path ?? "missing"}>
                        {agent.packet.path ?? "missing"}
                      </span>
                    </Td>
                    <Td>
                      <span className="block max-w-[320px] truncate" title={agent.nextActions[0] ?? ""}>
                        {agent.nextActions[0] ?? "---"}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const record = typeof data === "object" && data !== null ? data as Record<string, unknown> : {};
    throw new Error(String(record.message ?? record.error ?? `Request failed: ${url}`));
  }
  return data as T;
}

function isPiReady(status: RuntimeStatus | null): boolean {
  return Boolean(
    status?.defaultProvider === "pi"
    && status?.pi?.packageAvailable
    && status?.pi?.authConfigured
    && status?.pi?.modelsConfigured,
  );
}

function Panel({
  title,
  icon: Icon,
  pad = true,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  pad?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-md border" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}>
      <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--oc-border)" }}>
        <Icon className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />
        <h2 className="text-[12.5px] font-semibold" style={{ color: "var(--color-foreground)" }}>{title}</h2>
      </div>
      <div className={pad ? "p-3" : ""}>{children}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  loading,
  warn,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  loading: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 truncate text-[20px] font-semibold" style={{ color: warn ? "var(--oc-yellow)" : "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
          {loading ? "---" : value}
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  state = "neutral",
  wide,
}: {
  label: string;
  value: string;
  state?: "ok" | "warn" | "neutral";
  wide?: boolean;
}) {
  const Icon = state === "ok" ? CheckCircle2 : state === "warn" ? AlertTriangle : ChevronRight;
  const color = state === "ok" ? "var(--oc-green)" : state === "warn" ? "var(--oc-yellow)" : "var(--oc-text-muted)";
  return (
    <div className={wide ? "rounded-md border px-3 py-2 sm:col-span-2" : "rounded-md border px-3 py-2"} style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
      <div className="mb-1 flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        <Icon className="h-3 w-3" style={{ color }} />
        {label}
      </div>
      <div className="break-all font-mono text-[12px]" style={{ color: "var(--color-foreground)" }}>{value}</div>
    </div>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="grid items-center gap-2" style={{ gridTemplateColumns: "minmax(0,1fr) 54px" }}>
      <div className="min-w-0">
        <div className="truncate text-[11.5px]" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>{label}</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--oc-bg3)" }}>
          <div className="h-full rounded-full" style={{ width: `${Math.max(value > 0 ? 4 : 0, pct)}%`, background: "var(--oc-accent)" }} />
        </div>
      </div>
      <div className="text-right text-[11.5px]" style={{ color: "var(--oc-text-dim)", fontFamily: "var(--oc-mono)" }}>{value}</div>
    </div>
  );
}

function RiskBadge({ risk }: { risk: string }) {
  const high = risk === "high" || risk === "critical";
  const medium = risk === "medium";
  return (
    <StatusPill tone={high ? "error" : medium ? "warn" : "neutral"}>
      {risk}
    </StatusPill>
  );
}

function StatusPill({
  tone,
  icon: Icon,
  children,
}: {
  tone: "ok" | "warn" | "error" | "neutral";
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const color = tone === "ok"
    ? "var(--oc-green)"
    : tone === "warn"
      ? "var(--oc-yellow)"
      : tone === "error"
        ? "var(--oc-red)"
        : "var(--oc-text-muted)";
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ borderColor: color, color }}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

function FlagList({ title, flags }: { title: string; flags: string[] }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>{title}</div>
      {flags.length === 0 ? (
        <div className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>---</div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((flag) => (
            <span key={flag} className="rounded-[4px] border px-2 py-1 font-mono text-[11px]" style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-dim)" }}>
              {flag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Notice({ tone, text, compact }: { tone: "warn" | "error"; text: string; compact?: boolean }) {
  const color = tone === "error" ? "var(--oc-red)" : "var(--oc-yellow)";
  return (
    <div className={`flex items-start gap-2 rounded-md border ${compact ? "mt-2 px-2.5 py-2 text-[11.5px]" : "mb-3 px-3 py-2 text-xs"}`} style={{ borderColor: color, color, background: "var(--oc-bg1)" }}>
      {tone === "error" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5" /> : <ShieldCheck className="mt-0.5 h-3.5 w-3.5" />}
      <span>{text}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-md px-3 py-5 text-center text-[12px]" style={{ color: "var(--oc-text-muted)", background: "var(--oc-bg2)" }}>
      {text}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="grid gap-2 p-3">
      {[0, 1, 2].map((item) => (
        <div key={item} className="h-10 animate-pulse rounded-md" style={{ background: "var(--oc-bg2)" }} />
      ))}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.4px]">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 align-top" style={{ color: "var(--oc-text-dim)" }}>{children}</td>;
}
