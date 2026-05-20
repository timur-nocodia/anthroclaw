"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  ChevronRight,
  Cpu,
  KeyRound,
  Layers3,
  Loader2,
  Play,
  RefreshCcw,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TerminalSquare,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClaudeAuthPanel } from "@/components/settings/ClaudeAuthPanel";
import {
  RuntimeModelPicker,
  type RuntimeProviderOption,
} from "@/components/runtime/RuntimeModelPicker";
import {
  STATIC_RUNTIME_MODEL_OPTIONS,
  withCurrentRuntimeModelOption,
  type RuntimeModelOption,
} from "@/lib/runtime-models";

type TabId = "setup" | "providers" | "models" | "test" | "advanced";
type RuntimeMode = "pi" | "claude-agent-sdk" | "opencode";
type RuntimeIcon = React.ComponentType<{ className?: string; style?: React.CSSProperties }>;

interface RuntimeProviderAccount extends RuntimeProviderOption {
  authSource: string | null;
  authLabel: string | null;
  modelCount: number;
  defaultForInstance: boolean;
  supportsApiKey: boolean;
}

interface RuntimeProvidersResponse {
  status?: "ok";
  runtimeMode?: RuntimeMode;
  defaultModel?: string;
  pi?: {
    packageName?: string;
    packageAvailable?: boolean;
    packageVersion?: string | null;
    authPath?: string;
    modelsPath?: string;
    authConfigured?: boolean;
    availableModelCount?: number;
    modelCount?: number;
    providers?: RuntimeProviderAccount[];
    models?: RuntimeModelOption[];
    lastError?: string | null;
  };
  legacy?: {
    visible?: boolean;
    primary?: boolean;
  };
}

interface RuntimeGate {
  id: string;
  title: string;
  summary: string;
  capabilityGroup: string;
  focusedCommand: string;
  risk: string;
  execution: {
    supportsDryRun: boolean;
    approval: string;
    safetyMode: string;
  };
}

interface RuntimeGateRegistry {
  status?: string;
  gates?: RuntimeGate[];
}

interface ExpansionStatus {
  status?: "passed" | "attention";
  summary?: {
    totalAgents: number;
    closedAgents: number;
    openAgents: number;
    evidenceProgressPercent: number;
    openEvidenceItems: number;
    totalEvidenceItems: number;
  };
  policy?: {
    passed: boolean;
    reason: string;
  };
}

interface ProviderTestResult {
  ok: boolean;
  provider: string;
  model: string | null;
  configured: boolean;
  available: boolean;
  message: string;
}

interface RuntimeTurnResult {
  ok: boolean;
  text: string;
  sessionId: string | null;
  model: string;
}

interface RuntimeHealthSummary {
  lastRun: { runId: string; agentId: string; status: string; updatedAt: number; source: string } | null;
  lastFailure: { runId: string; agentId: string; completedAt?: number; error?: string } | null;
  approvalBacklogCount: number;
  cronDueCount: number;
  staleRunningCount: number;
}

interface MetricsResponse {
  runtimeHealth?: RuntimeHealthSummary;
}

const TABS: Array<{ id: TabId; label: string; icon: RuntimeIcon }> = [
  { id: "setup", label: "Setup", icon: SlidersHorizontal },
  { id: "providers", label: "Providers", icon: KeyRound },
  { id: "models", label: "Models", icon: Layers3 },
  { id: "test", label: "Test turn", icon: Play },
  { id: "advanced", label: "Advanced", icon: TerminalSquare },
];

export default function RuntimePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const serverId = (params?.serverId as string) || "local";
  const providerFromQuery = searchParams.get("provider");

  const [activeTab, setActiveTab] = useState<TabId>(providerFromQuery ? "providers" : "setup");
  const [runtime, setRuntime] = useState<RuntimeProvidersResponse | null>(null);
  const [gates, setGates] = useState<RuntimeGateRegistry | null>(null);
  const [expansion, setExpansion] = useState<ExpansionStatus | null>(null);
  const [health, setHealth] = useState<RuntimeHealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("pi");
  const [defaultModel, setDefaultModel] = useState("anthropic/claude-sonnet-4-6");
  const [savingConfig, setSavingConfig] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const base = useMemo(() => `/api/fleet/${serverId}/runtime`, [serverId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [providersRes, gatesRes, expansionRes, metricsRes] = await Promise.all([
        fetchJson<RuntimeProvidersResponse>(`${base}/providers`),
        fetchJson<RuntimeGateRegistry>(`${base}/gates`).catch(() => null),
        fetchJson<ExpansionStatus>(`${base}/expansion-status`).catch(() => null),
        fetchJson<MetricsResponse>('/api/metrics').catch(() => null),
      ]);
      setRuntime(providersRes);
      setGates(gatesRes);
      setExpansion(expansionRes);
      setHealth(metricsRes?.runtimeHealth ?? null);
      setRuntimeMode(providersRes.runtimeMode ?? "pi");
      setDefaultModel(providersRes.defaultModel ?? "anthropic/claude-sonnet-4-6");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Runtime setup is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (providerFromQuery) setActiveTab("providers");
  }, [providerFromQuery]);

  const providers = runtime?.pi?.providers ?? [];
  const models = withCurrentRuntimeModelOption(
    runtime?.pi?.models?.length ? runtime.pi.models : STATIC_RUNTIME_MODEL_OPTIONS.filter((m) => m.runtime === "pi"),
    defaultModel,
  );
  const piReady = Boolean(
    runtime?.runtimeMode === "pi" &&
    runtime?.pi?.packageAvailable &&
    runtime?.pi?.authConfigured &&
    (runtime?.pi?.availableModelCount ?? 0) > 0,
  );
  const legacyMode = runtime?.runtimeMode === "claude-agent-sdk";

  const saveRuntimeConfig = async () => {
    setSavingConfig(true);
    setError("");
    try {
      await requestJson(`${base}/config`, {
        method: "PATCH",
        body: JSON.stringify({
          runtimeMode,
          defaultModel,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save runtime config.");
    } finally {
      setSavingConfig(false);
    }
  };

  const restartGateway = async () => {
    setRestarting(true);
    setError("");
    try {
      await requestJson(`/api/fleet/${serverId}/gateway/restart`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart gateway.");
    } finally {
      setRestarting(false);
    }
  };

  return (
    <main
      data-testid="runtime-page-shell"
      className="h-full overflow-auto"
      style={{ background: "var(--oc-bg0)", scrollbarGutter: "stable" }}
    >
      <header
        className="flex flex-col gap-3 border-b px-4 py-4 md:flex-row md:items-start md:justify-between"
        style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[18px] font-semibold" style={{ color: "var(--color-foreground)" }}>
              Runtime setup
            </h1>
            <StatusPill
              tone={piReady ? "ok" : legacyMode ? "warn" : "error"}
              icon={piReady ? CheckCircle2 : legacyMode ? ShieldCheck : AlertTriangle}
            >
              {loading ? "loading" : piReady ? "Pi ready" : legacyMode ? "Legacy fallback mode" : "Needs setup"}
            </StatusPill>
          </div>
          <p className="mt-1 max-w-[760px] text-[12px] leading-5" style={{ color: "var(--oc-text-dim)" }}>
            Configure the runtime harness for this instance. In Pi mode, provider keys, model choice, and test turns live here.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={restartGateway} disabled={restarting}>
            {restarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Restart gateway
          </Button>
        </div>
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

      <section data-testid="runtime-page-content" className="px-4 py-4">
        {error && <Notice tone="error" text={error} />}
        {activeTab === "setup" && (
          <SetupTab
            runtime={runtime}
            providers={providers}
            models={models}
            runtimeMode={runtimeMode}
            defaultModel={defaultModel}
            setRuntimeMode={setRuntimeMode}
            setDefaultModel={setDefaultModel}
            saveRuntimeConfig={saveRuntimeConfig}
            savingConfig={savingConfig}
            piReady={piReady}
            health={health}
            openProviders={() => setActiveTab("providers")}
            openAdvanced={() => setActiveTab("advanced")}
          />
        )}
        {activeTab === "providers" && (
          <ProvidersTab
            base={base}
            providers={providers}
            selectedProvider={providerFromQuery}
            defaultModel={defaultModel}
            reload={load}
          />
        )}
        {activeTab === "models" && (
          <ModelsTab
            providers={providers}
            models={models}
            value={defaultModel}
            onChange={setDefaultModel}
            save={saveRuntimeConfig}
            saving={savingConfig}
            openProviders={() => setActiveTab("providers")}
          />
        )}
        {activeTab === "test" && (
          <TestTurnTab base={base} providers={providers} models={models} defaultModel={defaultModel} />
        )}
        {activeTab === "advanced" && (
          <AdvancedTab
            serverId={serverId}
            runtime={runtime}
            gates={gates}
            expansion={expansion}
            goToSettings={() => router.push(`/fleet/${serverId}/settings`)}
          />
        )}
      </section>
    </main>
  );
}

function SetupTab({
  runtime,
  providers,
  models,
  runtimeMode,
  defaultModel,
  setRuntimeMode,
  setDefaultModel,
  saveRuntimeConfig,
  savingConfig,
  piReady,
  health,
  openProviders,
  openAdvanced,
}: {
  runtime: RuntimeProvidersResponse | null;
  providers: RuntimeProviderAccount[];
  models: RuntimeModelOption[];
  runtimeMode: RuntimeMode;
  defaultModel: string;
  setRuntimeMode: (mode: RuntimeMode) => void;
  setDefaultModel: (model: string) => void;
  saveRuntimeConfig: () => void;
  savingConfig: boolean;
  piReady: boolean;
  health: RuntimeHealthSummary | null;
  openProviders: () => void;
  openAdvanced: () => void;
}) {
  const configuredProviders = providers.filter((p) => p.configured);
  const modeIsPi = runtimeMode === "pi";

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
      <div className="grid min-w-0 gap-3">
        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Runtime mode" value={runtime?.runtimeMode ?? "---"} icon={Cpu} tone={modeIsPi ? "ok" : "warn"} />
          <Metric label="Pi package" value={runtime?.pi?.packageVersion ?? (runtime?.pi?.packageAvailable ? "installed" : "missing")} icon={Settings2} tone={runtime?.pi?.packageAvailable ? "ok" : "error"} />
          <Metric label="Providers" value={`${configuredProviders.length}/${providers.length}`} icon={KeyRound} tone={configuredProviders.length > 0 ? "ok" : "warn"} />
          <Metric label="Models" value={String(runtime?.pi?.availableModelCount ?? 0)} icon={Layers3} tone={(runtime?.pi?.availableModelCount ?? 0) > 0 ? "ok" : "warn"} />
        </div>

        <Panel title="Instance runtime" icon={SlidersHorizontal}>
          <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.65fr)_minmax(320px,1fr)]">
            <div>
              <FieldLabel label="Runtime mode" />
              <div className="mt-1 grid gap-1.5">
                <ModeButton
                  active={runtimeMode === "pi"}
                  title="Pi"
                  desc="Use Pi as the primary agentic harness for this instance."
                  onClick={() => setRuntimeMode("pi")}
                />
                <ModeButton
                  active={runtimeMode === "claude-agent-sdk"}
                  title="Legacy fallback"
                  desc="Compatibility rollback provider. Use only when Pi is unavailable."
                  onClick={() => setRuntimeMode("claude-agent-sdk")}
                />
              </div>
            </div>
            <div>
              <RuntimeModelPicker
                providers={providers}
                models={models}
                value={defaultModel}
                onChange={setDefaultModel}
                label="Default model"
                onConfigureProvider={openProviders}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={saveRuntimeConfig} disabled={savingConfig}>
                  {savingConfig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save runtime
                </Button>
                <Button variant="outline" size="sm" onClick={openProviders}>
                  <KeyRound className="h-3.5 w-3.5" />
                  Configure providers
                </Button>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Setup checklist" icon={CheckCircle2}>
          <ChecklistItem ok={runtime?.runtimeMode === "pi"} label="Instance default runtime is Pi" />
          <ChecklistItem ok={Boolean(runtime?.pi?.packageAvailable)} label={`${runtime?.pi?.packageName ?? "Pi package"} is installed and importable`} />
          <ChecklistItem ok={Boolean(runtime?.pi?.authConfigured)} label="At least one Pi provider has credentials" />
          <ChecklistItem ok={(runtime?.pi?.availableModelCount ?? 0) > 0} label="Authenticated providers expose available models" />
          <ChecklistItem ok={piReady} label="Instance is ready for Pi LLM turns" />
        </Panel>

        <Panel title="Runtime health" icon={Activity}>
          <div className="grid gap-2 md:grid-cols-4">
            <Metric label="Last run" value={health?.lastRun?.status ?? "none"} icon={Play} tone={health?.lastRun?.status === "failed" ? "error" : "ok"} />
            <Metric label="Approvals" value={String(health?.approvalBacklogCount ?? 0)} icon={ShieldCheck} tone={(health?.approvalBacklogCount ?? 0) > 0 ? "warn" : "ok"} />
            <Metric label="Cron jobs" value={String(health?.cronDueCount ?? 0)} icon={RefreshCcw} tone="ok" />
            <Metric label="Stale runs" value={String(health?.staleRunningCount ?? 0)} icon={AlertTriangle} tone={(health?.staleRunningCount ?? 0) > 0 ? "error" : "ok"} />
          </div>
          {health?.lastFailure && (
            <div className="mt-2">
              <Notice tone="error" compact text={`Last failure: ${health.lastFailure.agentId}/${health.lastFailure.runId}${health.lastFailure.error ? ` - ${health.lastFailure.error}` : ""}`} />
            </div>
          )}
        </Panel>
      </div>

      <div className="grid gap-3">
        <Panel title="What this controls" icon={Zap}>
          <div className="space-y-2 text-[12px] leading-5" style={{ color: "var(--oc-text-dim)" }}>
            <p>
              Runtime mode is instance-wide. Agents inherit it unless their own config overrides the provider.
            </p>
            <p>
              Pi provider keys are stored in Pi auth storage, not in this repository. The YAML config stores only runtime mode and model defaults.
            </p>
          </div>
        </Panel>

        {modeIsPi ? (
          <Panel title="Pi storage" icon={KeyRound}>
            <InfoRow label="Auth storage" value={runtime?.pi?.authPath ?? "---"} />
            <InfoRow label="Models file" value={runtime?.pi?.modelsPath ?? "---"} />
            {runtime?.pi?.lastError && <Notice tone="error" text={runtime.pi.lastError} compact />}
          </Panel>
        ) : (
          <Panel title="Compatibility mode" icon={ShieldCheck}>
            <Notice
              tone="warn"
              text="This instance is not in Pi mode. Legacy fallback controls are available only in Advanced."
              compact
            />
            <Button variant="outline" size="sm" onClick={openAdvanced}>
              Open Advanced
            </Button>
          </Panel>
        )}
      </div>
    </div>
  );
}

function ProvidersTab({
  base,
  providers,
  selectedProvider,
  defaultModel,
  reload,
}: {
  base: string;
  providers: RuntimeProviderAccount[];
  selectedProvider: string | null;
  defaultModel: string;
  reload: () => Promise<void>;
}) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<Record<string, ProviderTestResult | string>>({});

  const saveKey = async (provider: string) => {
    setBusy((prev) => ({ ...prev, [provider]: true }));
    setResult((prev) => ({ ...prev, [provider]: "" }));
    try {
      await requestJson(`${base}/providers/${encodeURIComponent(provider)}/credentials`, {
        method: "POST",
        body: JSON.stringify({ apiKey: keys[provider] ?? "" }),
      });
      setKeys((prev) => ({ ...prev, [provider]: "" }));
      await reload();
      setResult((prev) => ({
        ...prev,
        [provider]: {
          ok: true,
          provider,
          model: null,
          configured: true,
          available: true,
          message: "Provider key saved.",
        },
      }));
    } catch (err) {
      setResult((prev) => ({ ...prev, [provider]: err instanceof Error ? err.message : "Failed to save provider key." }));
    } finally {
      setBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const deleteKey = async (provider: string) => {
    setBusy((prev) => ({ ...prev, [provider]: true }));
    try {
      await requestJson(`${base}/providers/${encodeURIComponent(provider)}/credentials`, { method: "DELETE" });
      await reload();
      setResult((prev) => ({ ...prev, [provider]: "Provider credentials removed." }));
    } catch (err) {
      setResult((prev) => ({ ...prev, [provider]: err instanceof Error ? err.message : "Failed to remove provider credentials." }));
    } finally {
      setBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const testProvider = async (provider: string) => {
    setBusy((prev) => ({ ...prev, [provider]: true }));
    try {
      const data = await requestJson<ProviderTestResult>(`${base}/providers/${encodeURIComponent(provider)}/test`, {
        method: "POST",
        body: JSON.stringify({ model: defaultModel }),
      });
      setResult((prev) => ({ ...prev, [provider]: data }));
    } catch (err) {
      setResult((prev) => ({ ...prev, [provider]: err instanceof Error ? err.message : "Provider test failed." }));
    } finally {
      setBusy((prev) => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <div className="grid gap-3">
      <SectionIntro
        title="Pi provider accounts"
        text="Add provider credentials once, then use those providers anywhere a Pi model is selected."
      />
      <div className="grid gap-3 xl:grid-cols-2">
        {providers.map((provider) => (
          <ProviderPanel
            key={provider.id}
            provider={provider}
            highlighted={provider.id === selectedProvider}
            apiKey={keys[provider.id] ?? ""}
            setApiKey={(value) => setKeys((prev) => ({ ...prev, [provider.id]: value }))}
            busy={Boolean(busy[provider.id])}
            result={result[provider.id]}
            save={() => void saveKey(provider.id)}
            remove={() => void deleteKey(provider.id)}
            test={() => void testProvider(provider.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ModelsTab({
  providers,
  models,
  value,
  onChange,
  save,
  saving,
  openProviders,
}: {
  providers: RuntimeProviderAccount[];
  models: RuntimeModelOption[];
  value: string;
  onChange: (model: string) => void;
  save: () => void;
  saving: boolean;
  openProviders: () => void;
}) {
  const grouped = groupModels(models);
  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(360px,1fr)]">
      <Panel title="Default model" icon={Layers3}>
        <RuntimeModelPicker
          providers={providers}
          models={models}
          value={value}
          onChange={onChange}
          label="Instance default model"
          onConfigureProvider={openProviders}
        />
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save default
          </Button>
          <Button variant="outline" size="sm" onClick={openProviders}>
            <KeyRound className="h-3.5 w-3.5" />
            Provider keys
          </Button>
        </div>
      </Panel>
      <Panel title="Available Pi models" icon={Cpu}>
        <div className="grid max-h-[520px] gap-2 overflow-auto pr-1">
          {grouped.map(([provider, providerModels]) => (
            <div key={provider} className="rounded-md border p-2.5" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold" style={{ color: "var(--color-foreground)" }}>
                  {providers.find((p) => p.id === provider)?.label ?? provider}
                </span>
                <span className="text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
                  {providerModels.length} models
                </span>
              </div>
              <div className="grid gap-1">
                {providerModels.slice(0, 18).map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => onChange(model.id)}
                    className="flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-[11.5px]"
                    style={{
                      background: value === model.id ? "var(--oc-accent-soft)" : "transparent",
                      color: value === model.id ? "var(--oc-accent)" : "var(--oc-text-dim)",
                    }}
                  >
                    <span className="truncate">{model.label ?? model.id}</span>
                    {value === model.id && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function TestTurnTab({
  base,
  providers,
  models,
  defaultModel,
}: {
  base: string;
  providers: RuntimeProviderAccount[];
  models: RuntimeModelOption[];
  defaultModel: string;
}) {
  const [model, setModel] = useState(defaultModel);
  const [prompt, setPrompt] = useState("Reply exactly: ANTHROCLAW_PI_RUNTIME_TEST_OK");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RuntimeTurnResult | string | null>(null);

  useEffect(() => setModel(defaultModel), [defaultModel]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      setResult(await requestJson<RuntimeTurnResult>(`${base}/test`, {
        method: "POST",
        body: JSON.stringify({ model, prompt, timeoutMs: 120000 }),
      }));
    } catch (err) {
      setResult(err instanceof Error ? err.message : "Runtime test failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(360px,1fr)]">
      <Panel title="Run a Pi test turn" icon={Play}>
        <RuntimeModelPicker providers={providers} models={models} value={model} onChange={setModel} />
        <div className="mt-3">
          <FieldLabel label="Prompt" />
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="mt-1 h-28 w-full resize-none rounded-md border p-2 text-xs outline-none"
            style={{
              background: "var(--oc-bg3)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
              fontFamily: "var(--oc-mono)",
            }}
          />
        </div>
        <div className="mt-3">
          <Button size="sm" onClick={run} disabled={running || !model || !prompt.trim()}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run test turn
          </Button>
        </div>
      </Panel>
      <Panel title="Result" icon={TerminalSquare}>
        {!result && (
          <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
            The test uses the same configured Pi runtime path as the gateway. Tools are disabled for this check.
          </p>
        )}
        {typeof result === "string" && <Notice tone="error" text={result} compact />}
        {result && typeof result !== "string" && (
          <div className="grid gap-2">
            <InfoRow label="Model" value={result.model} />
            <InfoRow label="Session" value={result.sessionId ?? "---"} />
            <pre
              className="max-h-[360px] overflow-auto rounded-md border p-3 text-[12px]"
              style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)", color: "var(--color-foreground)" }}
            >
              {result.text}
            </pre>
          </div>
        )}
      </Panel>
    </div>
  );
}

function AdvancedTab({
  serverId,
  runtime,
  gates,
  expansion,
  goToSettings,
}: {
  serverId: string;
  runtime: RuntimeProvidersResponse | null;
  gates: RuntimeGateRegistry | null;
  expansion: ExpansionStatus | null;
  goToSettings: () => void;
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <Panel title="Legacy fallback diagnostics" icon={ShieldCheck}>
        {runtime?.runtimeMode === "pi" && (
          <Notice
            tone="warn"
            text="This instance is in Pi mode. Legacy fallback controls are shown only here for rollback and compatibility work."
            compact
          />
        )}
        <div className="mt-3">
          <ClaudeAuthPanel serverId={serverId} />
        </div>
      </Panel>
      <Panel title="Raw configuration" icon={Settings2}>
        <p className="text-[12px] leading-5" style={{ color: "var(--oc-text-dim)" }}>
          Raw YAML remains available for low-level instance settings. Runtime mode, Pi providers, and model defaults should be changed through this Runtime setup page.
        </p>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={goToSettings}>
            Open Settings YAML
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </Panel>
      <Panel title="Side-effect gates" icon={ShieldCheck}>
        <div className="grid max-h-[360px] gap-2 overflow-auto pr-1">
          {(gates?.gates ?? []).slice(0, 14).map((gate) => (
            <div key={gate.id} className="rounded-md border p-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11.5px]" style={{ color: "var(--color-foreground)" }}>{gate.id}</span>
                <span className="text-[10.5px]" style={{ color: "var(--oc-text-muted)" }}>{gate.risk}</span>
              </div>
              <p className="mt-1 text-[11.5px] leading-4" style={{ color: "var(--oc-text-muted)" }}>{gate.summary}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Expansion evidence" icon={Layers3}>
        <div className="grid gap-2">
          <InfoRow label="Status" value={expansion?.status ?? "---"} />
          <InfoRow label="Evidence progress" value={expansion?.summary ? `${expansion.summary.evidenceProgressPercent}%` : "---"} />
          <InfoRow label="Policy" value={expansion?.policy?.reason ?? "---"} />
        </div>
      </Panel>
    </div>
  );
}

function ProviderPanel({
  provider,
  highlighted,
  apiKey,
  setApiKey,
  busy,
  result,
  save,
  remove,
  test,
}: {
  provider: RuntimeProviderAccount;
  highlighted: boolean;
  apiKey: string;
  setApiKey: (value: string) => void;
  busy: boolean;
  result: ProviderTestResult | string | undefined;
  save: () => void;
  remove: () => void;
  test: () => void;
}) {
  const ok = provider.configured && provider.availableModelCount > 0;
  return (
    <section
      className="rounded-md border p-3"
      style={{
        borderColor: highlighted ? "var(--oc-accent)" : "var(--oc-border)",
        background: highlighted ? "var(--oc-accent-soft)" : "var(--oc-bg1)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
              {provider.label}
            </h2>
            <StatusPill tone={ok ? "ok" : provider.configured ? "warn" : "error"} icon={ok ? CheckCircle2 : AlertTriangle}>
              {ok ? "ready" : provider.configured ? "credentials saved" : "missing key"}
            </StatusPill>
          </div>
          <p className="mt-1 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
            {provider.availableModelCount}/{provider.modelCount} models available
            {provider.authSource ? ` via ${provider.authSource}` : ""}
          </p>
        </div>
        {provider.defaultForInstance && (
          <span className="rounded px-1.5 py-px text-[10px] font-medium" style={{ border: "1px solid var(--oc-border)", color: "var(--oc-accent)" }}>
            default
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-2">
        <div>
          <FieldLabel label="API key" />
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider.configured ? "Paste a new key to replace existing credentials" : "Paste provider API key"}
            className="mt-1 h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
            style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={busy || !apiKey.trim()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save key
          </Button>
          <Button variant="outline" size="sm" onClick={test} disabled={busy}>
            <Play className="h-3.5 w-3.5" />
            Test
          </Button>
          {provider.configured && (
            <Button variant="outline" size="sm" onClick={remove} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
        {result && (
          typeof result === "string"
            ? <Notice tone={result.toLowerCase().includes("failed") ? "error" : "warn"} text={result} compact />
            : <Notice tone={result.ok ? "ok" : "warn"} text={result.message} compact />
        )}
      </div>
    </section>
  );
}

function ModeButton({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border p-2.5 text-left transition-colors"
      style={{
        borderColor: active ? "var(--oc-accent)" : "var(--oc-border)",
        background: active ? "var(--oc-accent-soft)" : "var(--oc-bg2)",
      }}
    >
      <div className="flex items-center gap-2">
        {active ? <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} /> : <Cpu className="h-3.5 w-3.5" style={{ color: "var(--oc-text-muted)" }} />}
        <span className="text-[12px] font-semibold" style={{ color: active ? "var(--oc-accent)" : "var(--color-foreground)" }}>
          {title}
        </span>
      </div>
      <p className="mt-1 text-[11.5px] leading-4" style={{ color: "var(--oc-text-muted)" }}>
        {desc}
      </p>
    </button>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: RuntimeIcon;
  tone?: "ok" | "warn" | "error" | "neutral";
}) {
  const color = tone === "ok" ? "var(--oc-green)" : tone === "warn" ? "var(--oc-yellow)" : tone === "error" ? "var(--oc-red)" : "var(--oc-text-muted)";
  return (
    <div className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}>
      <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
        <Icon className="h-3.5 w-3.5" style={{ color }} />
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-[15px] font-semibold" style={{ color: "var(--color-foreground)" }}>
        {value}
      </div>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: RuntimeIcon;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}>
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4" style={{ color: "var(--oc-accent)" }} />
        <h2 className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 border-b py-2 last:border-b-0" style={{ borderColor: "var(--oc-border)" }}>
      {ok ? <CheckCircle2 className="h-4 w-4" style={{ color: "var(--oc-green)" }} /> : <AlertTriangle className="h-4 w-4" style={{ color: "var(--oc-yellow)" }} />}
      <span className="text-[12px]" style={{ color: "var(--color-foreground)" }}>{label}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}>
      <div className="text-[10.5px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>{label}</div>
      <div className="mt-1 break-all font-mono text-[11.5px]" style={{ color: "var(--color-foreground)" }}>{value}</div>
    </div>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <label className="text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
      {label}
    </label>
  );
}

function StatusPill({
  tone,
  icon: Icon,
  children,
}: {
  tone: "ok" | "warn" | "error";
  icon: RuntimeIcon;
  children: React.ReactNode;
}) {
  const color = tone === "ok" ? "var(--oc-green)" : tone === "warn" ? "var(--oc-yellow)" : "var(--oc-red)";
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[10.5px] font-medium" style={{ border: `1px solid ${color}`, color }}>
      <Icon className="h-3 w-3" />
      {children}
    </span>
  );
}

function SectionIntro({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold" style={{ color: "var(--color-foreground)" }}>{title}</h2>
      <p className="mt-1 text-[12px]" style={{ color: "var(--oc-text-muted)" }}>{text}</p>
    </div>
  );
}

function Notice({ tone, text, compact }: { tone: "ok" | "warn" | "error"; text: string; compact?: boolean }) {
  const color = tone === "ok" ? "var(--oc-green)" : tone === "error" ? "var(--oc-red)" : "var(--oc-yellow)";
  const Icon = tone === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 ${compact ? "py-2" : "mb-3 py-2.5"} text-xs`} style={{ borderColor: color, color, background: "var(--oc-bg1)" }}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

function groupModels(models: RuntimeModelOption[]): Array<[string, RuntimeModelOption[]]> {
  const byProvider = new Map<string, RuntimeModelOption[]>();
  for (const model of models) {
    const provider = providerFromModel(model.id) || model.provider || "other";
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), model]);
  }
  return Array.from(byProvider.entries()).sort(([a], [b]) => a.localeCompare(b));
}

function providerFromModel(model: string): string {
  const slash = model.indexOf("/");
  if (slash > 0) return model.slice(0, slash);
  if (model.startsWith("claude-")) return "anthropic";
  return "";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null) as { message?: string; error?: string } | T | null;
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body
      ? body.message
      : body && typeof body === "object" && "error" in body ? body.error : `Request failed (${res.status})`;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

async function requestJson<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { ...init, headers });
  const body = await res.json().catch(() => null) as { message?: string; error?: string } | T | null;
  if (!res.ok) {
    const message = body && typeof body === "object" && "message" in body
      ? body.message
      : body && typeof body === "object" && "error" in body ? body.error : `Request failed (${res.status})`;
    throw new Error(message ?? `Request failed (${res.status})`);
  }
  return body as T;
}
