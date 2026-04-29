"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Plug,
  RefreshCw,
  RotateCcw,
  Save,
  Wrench,
  Brain,
  FileCode2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { JsonSchemaForm, type ZodIssue } from "./JsonSchemaForm";

/* ------------------------------------------------------------------ */
/*  Types — mirror the API responses                                   */
/* ------------------------------------------------------------------ */

export interface PluginListItem {
  name: string;
  version: string;
  description?: string;
  hasConfigSchema: boolean;
  hasMcpTools: boolean;
  hasContextEngine: boolean;
  toolCount: number;
}

export interface AgentPluginEntry {
  name: string;
  enabled: boolean;
  config: unknown;
}

export interface SchemaResponse {
  name: string;
  jsonSchema: Record<string, unknown> | null;
  defaults: unknown;
}

interface PluginsListResponse {
  plugins: PluginListItem[];
}

interface AgentPluginsResponse {
  agentId: string;
  plugins: AgentPluginEntry[];
}

interface AgentConfigResponse {
  agentId: string;
  pluginName: string;
  config: unknown;
}

interface ConfigState {
  loading: boolean;
  schema: Record<string, unknown> | null;
  defaults: unknown;
  values: Record<string, unknown>;
  saving: boolean;
  fieldErrors: Record<string, string>;
  formError: string | null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface PluginsPanelProps {
  agentId: string;
}

export function PluginsPanel({ agentId }: PluginsPanelProps) {
  const [installed, setInstalled] = useState<PluginListItem[] | null>(null);
  const [agentEntries, setAgentEntries] = useState<AgentPluginEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [configState, setConfigState] = useState<Record<string, ConfigState>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [pluginsRes, agentRes] = await Promise.all([
        fetch("/api/plugins"),
        fetch(`/api/agents/${encodeURIComponent(agentId)}/plugins`),
      ]);
      if (!pluginsRes.ok) {
        throw new Error(`Failed to load plugins (${pluginsRes.status})`);
      }
      if (!agentRes.ok) {
        throw new Error(`Failed to load agent plugin state (${agentRes.status})`);
      }
      const pluginsJson = (await pluginsRes.json()) as PluginsListResponse;
      const agentJson = (await agentRes.json()) as AgentPluginsResponse;
      setInstalled(pluginsJson.plugins ?? []);
      setAgentEntries(agentJson.plugins ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load plugins");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ----- Toggle ---------------------------------------------------- */

  const handleToggle = useCallback(
    async (name: string, nextEnabled: boolean) => {
      // Snapshot for rollback
      const previous = agentEntries;
      // Optimistic update
      setAgentEntries((prev) =>
        prev
          ? prev.map((e) => (e.name === name ? { ...e, enabled: nextEnabled } : e))
          : prev,
      );
      setPendingToggle((p) => ({ ...p, [name]: true }));

      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}/plugins/${encodeURIComponent(name)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: nextEnabled }),
          },
        );
        if (!res.ok) {
          throw new Error(`PUT failed: ${res.status}`);
        }
        toast.success(
          nextEnabled ? `Enabled "${name}" for this agent` : `Disabled "${name}" for this agent`,
        );
      } catch (err) {
        // Roll back
        setAgentEntries(previous);
        toast.error(
          err instanceof Error
            ? `Failed to toggle ${name}: ${err.message}`
            : `Failed to toggle ${name}`,
        );
      } finally {
        setPendingToggle((p) => {
          const { [name]: _omit, ...rest } = p;
          return rest;
        });
      }
    },
    [agentId, agentEntries],
  );

  /* ----- Expand + load schema ------------------------------------- */

  const toggleExpand = useCallback(
    async (name: string) => {
      const isOpen = !!expanded[name];
      setExpanded((prev) => ({ ...prev, [name]: !isOpen }));
      if (isOpen) return;

      // First time we expand, fetch schema + current config.
      const cur = configState[name];
      if (cur?.schema) return; // already loaded

      setConfigState((prev) => ({
        ...prev,
        [name]: {
          loading: true,
          schema: null,
          defaults: undefined,
          values: {},
          saving: false,
          fieldErrors: {},
          formError: null,
        },
      }));

      try {
        const [schemaRes, configRes] = await Promise.all([
          fetch(`/api/plugins/${encodeURIComponent(name)}/config-schema`),
          fetch(
            `/api/agents/${encodeURIComponent(agentId)}/plugins/${encodeURIComponent(name)}/config`,
          ),
        ]);
        if (!schemaRes.ok) {
          throw new Error(`Schema fetch failed (${schemaRes.status})`);
        }
        const schemaJson = (await schemaRes.json()) as SchemaResponse;
        let initialValues: Record<string, unknown> = {};
        if (configRes.ok) {
          const configJson = (await configRes.json()) as AgentConfigResponse;
          initialValues = isPlainObject(configJson.config) ? configJson.config : {};
        }
        // Merge defaults over empty fields when current config is empty
        const defaultValues = isPlainObject(schemaJson.defaults)
          ? (schemaJson.defaults as Record<string, unknown>)
          : {};
        const merged: Record<string, unknown> =
          Object.keys(initialValues).length === 0
            ? { ...defaultValues }
            : { ...defaultValues, ...initialValues };

        setConfigState((prev) => ({
          ...prev,
          [name]: {
            loading: false,
            schema: schemaJson.jsonSchema,
            defaults: schemaJson.defaults,
            values: merged,
            saving: false,
            fieldErrors: {},
            formError: null,
          },
        }));
      } catch (err) {
        setConfigState((prev) => ({
          ...prev,
          [name]: {
            loading: false,
            schema: null,
            defaults: undefined,
            values: {},
            saving: false,
            fieldErrors: {},
            formError: err instanceof Error ? err.message : "Failed to load config",
          },
        }));
      }
    },
    [expanded, configState, agentId],
  );

  /* ----- Save config ---------------------------------------------- */

  const handleSave = useCallback(
    async (name: string) => {
      const cur = configState[name];
      if (!cur) return;
      setConfigState((prev) => ({
        ...prev,
        [name]: { ...cur, saving: true, fieldErrors: {}, formError: null },
      }));

      try {
        const res = await fetch(
          `/api/agents/${encodeURIComponent(agentId)}/plugins/${encodeURIComponent(name)}/config`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ config: cur.values }),
          },
        );

        if (res.ok) {
          toast.success(`Saved "${name}" config`);
          setConfigState((prev) => ({
            ...prev,
            [name]: { ...cur, saving: false, fieldErrors: {}, formError: null },
          }));
          return;
        }

        // Handle 400 with Zod issues
        let body: { error?: string; issues?: ZodIssue[] } = {};
        try {
          body = await res.json();
        } catch {
          // ignore
        }
        const fieldErrors: Record<string, string> = {};
        if (Array.isArray(body.issues)) {
          for (const issue of body.issues) {
            const path = (issue.path ?? []).join(".");
            fieldErrors[path || "_root"] = issue.message ?? "Invalid";
          }
        }
        setConfigState((prev) => ({
          ...prev,
          [name]: {
            ...cur,
            saving: false,
            fieldErrors,
            formError:
              body.error === "invalid_config"
                ? "Validation failed — check the highlighted fields."
                : body.error ?? `Save failed (${res.status})`,
          },
        }));
        toast.error(
          body.error === "invalid_config"
            ? `"${name}" config has validation errors`
            : `Failed to save "${name}"`,
        );
      } catch (err) {
        setConfigState((prev) => ({
          ...prev,
          [name]: {
            ...cur,
            saving: false,
            fieldErrors: {},
            formError: err instanceof Error ? err.message : "Save failed",
          },
        }));
        toast.error(`Failed to save "${name}"`);
      }
    },
    [configState, agentId],
  );

  /* ----- Reset to defaults ---------------------------------------- */

  const handleReset = useCallback(
    (name: string) => {
      const cur = configState[name];
      if (!cur) return;
      const defaults = isPlainObject(cur.defaults)
        ? (cur.defaults as Record<string, unknown>)
        : {};
      setConfigState((prev) => ({
        ...prev,
        [name]: { ...cur, values: { ...defaults }, fieldErrors: {}, formError: null },
      }));
      toast.success(`Reset "${name}" to defaults (not yet saved)`);
    },
    [configState],
  );

  /* ----- Update field --------------------------------------------- */

  const handleValuesChange = useCallback(
    (name: string, next: Record<string, unknown>) => {
      setConfigState((prev) => {
        const cur = prev[name];
        if (!cur) return prev;
        return { ...prev, [name]: { ...cur, values: next } };
      });
    },
    [],
  );

  /* ----- Render ---------------------------------------------------- */

  if (loading && !installed) {
    return (
      <div className="p-6">
        <PluginsHeader onRefresh={refresh} />
        <div className="flex flex-col gap-4">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-24 rounded-lg border"
              style={{
                background: "var(--oc-bg1)",
                borderColor: "var(--oc-border)",
                opacity: 0.6,
              }}
              data-testid="plugin-skeleton"
            />
          ))}
        </div>
      </div>
    );
  }

  if (loadError && !installed) {
    return (
      <div className="p-6">
        <PluginsHeader onRefresh={refresh} />
        <div
          className="rounded-lg border p-4 text-sm"
          style={{
            background: "var(--oc-bg1)",
            borderColor: "rgba(248,113,113,0.35)",
            color: "var(--oc-red, #f87171)",
          }}
          role="alert"
        >
          {loadError}
        </div>
      </div>
    );
  }

  const list = installed ?? [];
  const entryByName = new Map<string, AgentPluginEntry>(
    (agentEntries ?? []).map((e) => [e.name, e]),
  );

  return (
    <div className="p-6">
      <PluginsHeader onRefresh={refresh} />

      {list.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border py-16 text-center"
          style={{
            background: "var(--oc-bg1)",
            borderColor: "var(--oc-border)",
            color: "var(--oc-text-dim)",
          }}
        >
          <Plug className="mb-3 h-6 w-6" />
          <p className="text-sm">No plugins installed</p>
          <p className="mt-1 text-xs" style={{ color: "var(--oc-text-muted)" }}>
            Install a plugin in the gateway plugins/ directory to see it here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {list.map((p) => {
            const entry = entryByName.get(p.name);
            const enabled = entry?.enabled ?? false;
            const cs = configState[p.name];
            const isExpanded = !!expanded[p.name];
            return (
              <PluginCard
                key={p.name}
                plugin={p}
                enabled={enabled}
                togglePending={!!pendingToggle[p.name]}
                onToggle={(next) => handleToggle(p.name, next)}
                expanded={isExpanded}
                onToggleExpand={() => toggleExpand(p.name)}
                configState={cs}
                onValuesChange={(v) => handleValuesChange(p.name, v)}
                onSave={() => handleSave(p.name)}
                onReset={() => handleReset(p.name)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Header                                                             */
/* ------------------------------------------------------------------ */

function PluginsHeader({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <div>
        <h2
          className="text-base font-medium"
          style={{ color: "var(--color-foreground)" }}
        >
          Plugins
        </h2>
        <p className="mt-0.5 text-xs" style={{ color: "var(--oc-text-muted)" }}>
          Enable installed plugins for this agent and configure per-agent settings.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh} data-testid="plugins-refresh">
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        Refresh
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

interface PluginCardProps {
  plugin: PluginListItem;
  enabled: boolean;
  togglePending: boolean;
  onToggle: (next: boolean) => void;
  expanded: boolean;
  onToggleExpand: () => void;
  configState: ConfigState | undefined;
  onValuesChange: (next: Record<string, unknown>) => void;
  onSave: () => void;
  onReset: () => void;
}

function PluginCard(props: PluginCardProps) {
  const {
    plugin,
    enabled,
    togglePending,
    onToggle,
    expanded,
    onToggleExpand,
    configState,
    onValuesChange,
    onSave,
    onReset,
  } = props;

  const showConfigButton = plugin.hasConfigSchema && enabled;

  return (
    <div
      className="rounded-lg border p-4"
      style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}
      data-testid={`plugin-card-${plugin.name}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
            >
              {plugin.name}
            </span>
            <span className="text-xs" style={{ color: "var(--oc-text-muted)" }}>
              v{plugin.version}
            </span>
          </div>
          {plugin.description && (
            <p className="mt-1 text-xs" style={{ color: "var(--oc-text-muted)" }}>
              {plugin.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {plugin.hasMcpTools && (
              <Badge>
                <Wrench className="h-3 w-3" />
                {plugin.toolCount} {plugin.toolCount === 1 ? "tool" : "tools"}
              </Badge>
            )}
            {plugin.hasContextEngine && (
              <Badge>
                <Brain className="h-3 w-3" />
                Context engine
              </Badge>
            )}
            {plugin.hasConfigSchema && (
              <Badge>
                <FileCode2 className="h-3 w-3" />
                Config schema
              </Badge>
            )}
          </div>
        </div>

        <label
          className="flex items-center gap-2 text-xs"
          style={{ color: "var(--oc-text-muted)" }}
        >
          <span>{enabled ? "Enabled" : "Disabled"}</span>
          <input
            type="checkbox"
            role="switch"
            aria-label={`Toggle plugin ${plugin.name}`}
            checked={enabled}
            disabled={togglePending}
            onChange={(e) => onToggle(e.target.checked)}
            style={{ accentColor: "var(--oc-accent)", width: 16, height: 16 }}
            data-testid={`plugin-toggle-${plugin.name}`}
          />
        </label>
      </div>

      {showConfigButton && (
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleExpand}
            data-testid={`plugin-configure-${plugin.name}`}
          >
            {expanded ? (
              <ChevronDown className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="mr-1.5 h-3.5 w-3.5" />
            )}
            {expanded ? "Hide configuration" : "Configure"}
          </Button>
        </div>
      )}

      {expanded && configState && (
        <div
          className="mt-4 rounded-md border p-4"
          style={{ background: "var(--oc-bg2)", borderColor: "var(--oc-border)" }}
        >
          {configState.loading ? (
            <p className="text-xs" style={{ color: "var(--oc-text-muted)" }}>
              Loading schema...
            </p>
          ) : configState.formError && !configState.schema ? (
            <p className="text-xs" style={{ color: "var(--oc-red, #f87171)" }}>
              {configState.formError}
            </p>
          ) : configState.schema ? (
            <>
              <JsonSchemaForm
                schema={configState.schema}
                values={configState.values}
                fieldErrors={configState.fieldErrors}
                onChange={onValuesChange}
              />
              {configState.formError && (
                <p
                  className="mt-3 text-xs"
                  style={{ color: "var(--oc-red, #f87171)" }}
                  data-testid={`plugin-form-error-${plugin.name}`}
                >
                  {configState.formError}
                </p>
              )}
              <div className="mt-4 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onReset}
                  disabled={configState.saving}
                  data-testid={`plugin-reset-${plugin.name}`}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Reset to defaults
                </Button>
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={configState.saving}
                  data-testid={`plugin-save-${plugin.name}`}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" />
                  {configState.saving ? "Saving..." : "Save Config"}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Badge                                                              */
/* ------------------------------------------------------------------ */

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]"
      style={{
        background: "var(--oc-bg2)",
        color: "var(--oc-text-muted)",
        border: "1px solid var(--oc-border)",
      }}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
