"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Bot,
  Cpu,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { StatusIndicator } from "@/components/status-indicator";
import { ContextPressureChip } from "@/components/lcm/ContextPressureChip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import {
  STATIC_RUNTIME_MODEL_OPTIONS,
  withCurrentRuntimeModelOption,
  type RuntimeModelOption,
} from "@/lib/runtime-models";
import {
  RuntimeModelPicker,
  type RuntimeProviderOption,
} from "@/components/runtime/RuntimeModelPicker";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AgentSummary {
  id: string;
  model?: string;
  description?: string;
  runtime?: {
    headless?: {
      provider?: "claude-agent-sdk" | "pi" | "opencode";
    };
  };
  routes?: Array<{ channel: string }>;
  skills?: string[];
  skillCount?: number;
  queue_mode?: string;
  session_policy?: string;
}

interface RuntimeModelsResponse {
  defaultProvider?: "claude-agent-sdk" | "pi" | "opencode";
  defaultModel?: string;
  options?: RuntimeModelOption[];
}

interface RuntimeProvidersResponse {
  defaultModel?: string;
  pi?: {
    providers?: RuntimeProviderOption[];
    models?: RuntimeModelOption[];
  };
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

export default function AgentsListPage() {
  const params = useParams();
  const router = useRouter();
  const serverId = params.serverId as string;

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [runtimeModels, setRuntimeModels] = useState<RuntimeModelsResponse | null>(null);
  const [runtimeProviders, setRuntimeProviders] = useState<RuntimeProvidersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newId, setNewId] = useState("");
  const [newModel, setNewModel] = useState(STATIC_RUNTIME_MODEL_OPTIONS[0]?.id ?? "anthropic/claude-sonnet-4-6");
  const [newTemplate, setNewTemplate] = useState<"blank" | "example">("blank");
  const [creating, setCreating] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents`);
      if (res.ok) {
        const d = await res.json();
        setAgents(Array.isArray(d) ? d : d.agents ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch agents list:", err);
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    fetch(`/api/fleet/${serverId}/runtime/models`)
      .then((r) => r.json())
      .then((data: RuntimeModelsResponse) => {
        setRuntimeModels(data);
        if (data.defaultModel) setNewModel(data.defaultModel);
      })
      .catch(() => setRuntimeModels(null));
  }, [serverId]);

  useEffect(() => {
    fetch(`/api/fleet/${serverId}/runtime/providers`)
      .then((r) => r.json())
      .then((data: RuntimeProvidersResponse) => {
        setRuntimeProviders(data);
        if (data.defaultModel) setNewModel(data.defaultModel);
      })
      .catch(() => setRuntimeProviders(null));
  }, [serverId]);

  const filtered = agents.filter(
    (a) =>
      a.id.toLowerCase().includes(q.toLowerCase()) ||
      (a.description ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  const totalRoutes = agents.reduce((n, a) => n + (a.routes?.length ?? 0), 0);
  const defaultProvider = runtimeModels?.defaultProvider ?? "pi";
  const modelOptions = withCurrentRuntimeModelOption(
    runtimeProviders?.pi?.models?.length
      ? runtimeProviders.pi.models
      : runtimeModels?.options?.length ? runtimeModels.options : STATIC_RUNTIME_MODEL_OPTIONS,
    newModel,
  );
  const providerOptions = runtimeProviders?.pi?.providers ?? [];

  const handleCreate = async () => {
    if (!newId) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/fleet/${serverId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newId,
          model: newModel,
          template: newTemplate,
        }),
      });
      if (res.ok) {
        setCreateOpen(false);
        setNewId("");
        router.push(`/fleet/${serverId}/agents/${newId}`);
      }
    } catch (err) {
      console.error("Failed to create agent:", err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/fleet/${serverId}/agents/${deleteTarget}`, {
        method: "DELETE",
      });
      setAgents((prev) => prev.filter((a) => a.id !== deleteTarget));
    } catch (err) {
      console.error("Failed to delete agent:", err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Page header */}
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-3"
        style={{ borderColor: "var(--oc-border)" }}
      >
        <div>
          <h1 className="text-[15px] font-semibold" style={{ color: "var(--color-foreground)" }}>
            Agents
          </h1>
          <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
            {loading ? "Loading..." : `${agents.length} agents configured \u00b7 ${totalRoutes} routes`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="flex h-[26px] items-center gap-1.5 rounded-[5px] border px-2"
            style={{
              background: "var(--oc-bg3)",
              borderColor: "var(--oc-border)",
            }}
          >
            <Search className="h-3 w-3" style={{ color: "var(--oc-text-muted)" }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter agents..."
              className="min-w-[180px] border-none bg-transparent text-xs outline-none"
              style={{
                color: "var(--color-foreground)",
              }}
            />
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            New agent
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-5">
        <div
          className="overflow-hidden rounded-md"
          style={{
            background: "var(--oc-bg1)",
            border: "1px solid var(--oc-border)",
          }}
        >
          {/* Table header */}
          <div
            className="grid items-center px-3.5 py-2 text-[10px] uppercase tracking-[0.5px]"
            style={{
              gridTemplateColumns: "1.35fr 170px 96px 120px 80px 110px 110px 96px",
              color: "var(--oc-text-muted)",
              borderBottom: "1px solid var(--oc-border)",
              background: "var(--oc-bg2)",
            }}
          >
            <span>Name</span>
            <span>Model</span>
            <span>Runtime</span>
            <span>Routes</span>
            <span>Skills</span>
            <span>Queue</span>
            <span>Session</span>
            <span />
          </div>

          {/* Rows */}
          {filtered.map((a, i) => {
            const routeCount = typeof a.routes === 'number' ? a.routes : (a.routes?.length ?? 0);
            const tg = Array.isArray(a.routes) ? a.routes.filter((r: any) => r.channel === "telegram").length : 0;
            const wa = Array.isArray(a.routes) ? a.routes.filter((r: any) => r.channel === "whatsapp").length : 0;
            const skillCount = typeof a.skillCount === "number" ? a.skillCount : (a.skills?.length ?? 0);
            return (
              <div
                key={a.id}
                onClick={() => router.push(`/fleet/${serverId}/agents/${a.id}`)}
                className="grid cursor-pointer items-center gap-2 px-3.5 py-3 transition-colors hover:bg-[var(--oc-bg2)]"
                style={{
                  gridTemplateColumns: "1.35fr 170px 96px 120px 80px 110px 110px 96px",
                  borderBottom:
                    i === filtered.length - 1
                      ? "none"
                      : "1px solid var(--oc-border)",
                }}
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <StatusIndicator
                      status={routeCount > 0 ? "connected" : "disconnected"}
                    />
                    <span
                      className="text-[13px] font-medium"
                      style={{
                        color: "var(--color-foreground)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {a.id}
                    </span>
                    <ContextPressureChip agentId={a.id} />
                  </div>
                  {a.description && (
                    <span
                      className="truncate text-[11.5px]"
                      style={{ color: "var(--oc-text-muted)" }}
                    >
                      {a.description}
                    </span>
                  )}
                </div>
                <span
                  className="text-[11.5px]"
                  style={{
                    color: "var(--oc-text-dim)",
                    fontFamily: "var(--oc-mono)",
                  }}
                >
                  {a.model ?? "---"}
                </span>
                <ProviderBadge provider={effectiveProvider(a, defaultProvider)} />
                <div className="flex flex-wrap gap-1">
                  {tg > 0 && (
                    <span
                      className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
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
                      className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
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
                  className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
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
                <span
                  className="inline-flex rounded px-1.5 py-px text-[10px] font-medium"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--oc-border)",
                    color: "var(--oc-text-muted)",
                  }}
                >
                  {a.session_policy ?? "daily"}
                </span>
                <div
                  className="flex justify-end gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
                    style={{ color: "var(--oc-text-dim)" }}
                    title="Test"
                    onClick={() =>
                      router.push(`/fleet/${serverId}/chat/${a.id}`)
                    }
                  >
                    <MessageSquare className="h-3 w-3" />
                  </button>
                  <button
                    className="inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
                    style={{ color: "var(--oc-text-dim)" }}
                    title="Edit"
                    onClick={() =>
                      router.push(`/fleet/${serverId}/agents/${a.id}`)
                    }
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    className="inline-flex h-[22px] w-[22px] items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
                    style={{ color: "var(--oc-text-dim)" }}
                    title="Delete"
                    onClick={() => setDeleteTarget(a.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            );
          })}

          {loading &&
            Array.from({ length: 4 }).map((_, i) => (
              <div
                key={`sk-${i}`}
                className="grid items-center gap-2 px-3.5 py-3"
                style={{
                  gridTemplateColumns: "1.35fr 170px 96px 120px 80px 110px 110px 96px",
                  borderBottom: i === 3 ? "none" : "1px solid var(--oc-border)",
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <div
                    className="h-3 w-28 animate-pulse rounded"
                    style={{ background: "var(--oc-bg3)" }}
                  />
                  <div
                    className="h-2.5 w-40 animate-pulse rounded"
                    style={{ background: "var(--oc-bg3)", opacity: 0.6 }}
                  />
                </div>
                <div
                  className="h-3 w-24 animate-pulse rounded"
                  style={{ background: "var(--oc-bg3)" }}
                />
                <div
                  className="h-3 w-14 animate-pulse rounded"
                  style={{ background: "var(--oc-bg3)" }}
                />
                <div
                  className="h-3 w-14 animate-pulse rounded"
                  style={{ background: "var(--oc-bg3)" }}
                />
                <div
                  className="h-3 w-6 animate-pulse rounded"
                  style={{ background: "var(--oc-bg3)" }}
                />
                <div
                  className="h-3 w-16 animate-pulse rounded"
                  style={{ background: "var(--oc-bg3)" }}
                />
                <div
                  className="h-3 w-14 animate-pulse rounded"
                  style={{ background: "var(--oc-bg3)" }}
                />
                <div />
              </div>
            ))}

          {filtered.length === 0 && !loading && (
            <div
              className="p-10 text-center text-xs"
              style={{ color: "var(--oc-text-muted)" }}
            >
              {q ? `No agents match "${q}".` : "No agents configured."}
            </div>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent
          className="sm:max-w-[440px]"
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border-mid)" }}
        >
          <DialogHeader>
            <DialogTitle>New agent</DialogTitle>
            <DialogDescription>
              Creates a Pi-native Runtime v1 agent at{" "}
              <span style={{ fontFamily: "var(--oc-mono)" }}>
                agents/{newId || "<id>"}/agent.yml
              </span>{" "}
              and gateway hot-reloads.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <label
                className="text-[11px] uppercase tracking-[0.4px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                Agent ID
              </label>
              <input
                value={newId}
                onChange={(e) =>
                  setNewId(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, "-"),
                  )
                }
                placeholder="e.g. finance-bot"
                className="mt-1 h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                style={{
                  background: "var(--oc-bg3)",
                  borderColor: "var(--oc-border)",
                  color: "var(--color-foreground)",
                  fontFamily: "var(--oc-mono)",
                }}
              />
              <p
                className="mt-1 text-[11px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                lowercase, hyphens only. Must be unique.
              </p>
            </div>
            <div>
              <RuntimeModelPicker
                providers={providerOptions}
                models={modelOptions}
                value={newModel}
                onChange={setNewModel}
                onConfigureProvider={(provider) => {
                  setCreateOpen(false);
                  router.push(`/fleet/${serverId}/runtime?provider=${encodeURIComponent(provider)}`);
                }}
              />
              <p className="mt-1 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
                Models come from the Runtime v1 / Pi provider registry. New agents write an explicit Pi runtime override.
              </p>
            </div>
            <div>
              <label
                className="text-[11px] uppercase tracking-[0.4px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                Base template
              </label>
              <div className="mt-1 flex gap-1.5">
                {(["blank", "example"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setNewTemplate(t)}
                    className="flex flex-1 flex-col gap-0.5 rounded-[5px] border p-2.5 text-left text-xs"
                    style={{
                      borderColor:
                        newTemplate === t
                          ? "var(--oc-accent)"
                          : "var(--oc-border)",
                      background:
                        newTemplate === t
                          ? "var(--oc-accent-soft)"
                          : "var(--oc-bg2)",
                      color:
                        newTemplate === t
                          ? "var(--oc-accent)"
                          : "var(--color-foreground)",
                    }}
                  >
                    <span className="font-semibold capitalize">{t}</span>
                    <span
                      className="text-[10.5px]"
                      style={{ color: "var(--oc-text-muted)" }}
                    >
                      {t === "blank"
                        ? "Minimal Pi-native runtime files"
                        : "Copy from example agent"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button disabled={!newId || creating} onClick={handleCreate}>
              {creating ? "Creating..." : "Create agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent
          style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border-mid)" }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Delete agent</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span style={{ fontFamily: "var(--oc-mono)" }}>
                {deleteTarget}
              </span>
              ? This removes the agent directory and all its files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function effectiveProvider(
  agent: AgentSummary,
  defaultProvider: "claude-agent-sdk" | "pi" | "opencode",
): "claude-agent-sdk" | "pi" | "opencode" {
  return agent.runtime?.headless?.provider ?? defaultProvider;
}

function ProviderBadge({ provider }: { provider: "claude-agent-sdk" | "pi" | "opencode" }) {
  const isPi = provider === "pi";
  const isLegacy = provider === "claude-agent-sdk";
  const label = isLegacy ? "legacy fallback" : provider;
  return (
    <span
      className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium"
      style={{
        background: isPi
          ? "rgba(74,222,128,0.13)"
          : isLegacy
            ? "rgba(251,191,36,0.13)"
            : "rgba(255,255,255,0.04)",
        border: "1px solid var(--oc-border)",
        color: isPi
          ? "var(--oc-green)"
          : isLegacy
            ? "var(--oc-yellow)"
            : "var(--oc-text-dim)",
      }}
    >
      <Cpu className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
