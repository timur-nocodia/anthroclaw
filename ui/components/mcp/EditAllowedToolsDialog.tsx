"use client";

/**
 * "Edit allowed tools" dialog for an already-attached MCP server.
 *
 * Mounted by `<McpServersSection />` when the operator clicks the
 * Pencil action on `<McpServerCard />`. Fetches the full discovered
 * tool list from the server via the stored credential, lets the
 * operator toggle which tools the agent may call, and persists the
 * result by PUT-ing the agent config back with an updated
 * `external_mcp_servers.<name>.allowed_tools` field.
 *
 * Discovery uses the new `POST /api/agents/<id>/mcp/<name>/tools`
 * endpoint, which runs the same Streamable HTTP handshake that
 * `attachApiKey` does (initialize → notifications/initialized →
 * tools/list). If discovery fails (token revoked, server unreachable),
 * we fall back to showing the currently-allowed tools so the operator
 * can still trim the list — but disable the "(re)check" path with an
 * actionable message.
 */

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

export interface EditAllowedToolsDialogProps {
  agentId: string;
  serverName: string;
  currentAllowed: string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

interface DiscoveredTool {
  name: string;
  description?: string;
}

export function EditAllowedToolsDialog({
  agentId,
  serverName,
  currentAllowed,
  onClose,
  onSaved,
}: EditAllowedToolsDialogProps) {
  const [tools, setTools] = useState<DiscoveredTool[] | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<Set<string>>(() => new Set(currentAllowed));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const discover = async () => {
    setLoading(true);
    setDiscoveryError(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/mcp/${encodeURIComponent(serverName)}/tools`,
        { method: "POST" },
      );
      const body = await res.json();
      if (!res.ok || !Array.isArray(body.tools)) {
        const reason: string = body?.error ?? `discovery_failed_${res.status}`;
        setDiscoveryError(
          reason === "not_attached"
            ? "Credential missing — re-attach the server first."
            : "Couldn't reach the MCP server. Try Re-auth.",
        );
        // Fall back to showing the currently-allowed tools so the
        // operator can still trim the list.
        setTools(currentAllowed.map((name) => ({ name })));
      } else {
        setTools(body.tools as DiscoveredTool[]);
      }
    } catch {
      setDiscoveryError("Network error talking to the MCP server.");
      setTools(currentAllowed.map((name) => ({ name })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void discover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (name: string) => {
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => {
    if (!tools) return;
    setAllowed(new Set(tools.map((t) => t.name)));
  };
  const clearAll = () => setAllowed(new Set());

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Read current config, patch only the allowed_tools for this
      // server, then PUT. Mirrors how AddMcpWizard.tsx's finalize step
      // touches agent.yml end-to-end so we keep one persistence path.
      const cfgRes = await fetch(`/api/agents/${encodeURIComponent(agentId)}`);
      if (!cfgRes.ok) throw new Error(`load_config_${cfgRes.status}`);
      const cfg = await cfgRes.json();
      const config = cfg.config ?? cfg;
      const servers = (config.external_mcp_servers ?? {}) as Record<string, Record<string, unknown>>;
      const entry = servers[serverName];
      if (!entry) throw new Error("server_not_in_config");
      servers[serverName] = { ...entry, allowed_tools: Array.from(allowed) };
      config.external_mcp_servers = servers;

      const putRes = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!putRes.ok) {
        const errBody = await putRes.json().catch(() => ({}));
        throw new Error(errBody.message ?? `save_failed_${putRes.status}`);
      }
      await onSaved();
      onClose();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit allowed tools — {serverName}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between text-xs" style={{ color: "var(--oc-text-muted)" }}>
          <div>
            {tools ? `${allowed.size} of ${tools.length} selected` : "Loading..."}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAll}
              disabled={!tools || loading}
              className="hover:underline disabled:opacity-50"
            >
              Select all
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={clearAll}
              disabled={loading}
              className="hover:underline disabled:opacity-50"
            >
              Clear
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => void discover()}
              disabled={loading}
              className="flex items-center gap-1 hover:underline disabled:opacity-50"
              title="Re-discover tools from the MCP server"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </div>

        {discoveryError && (
          <div
            className="rounded-[5px] border px-3 py-2 text-[11.5px]"
            style={{
              borderColor: "rgba(248,113,113,0.35)",
              background: "rgba(248,113,113,0.08)",
              color: "var(--oc-red)",
            }}
          >
            {discoveryError}
          </div>
        )}

        <ul className="max-h-72 space-y-1 overflow-auto rounded-md border bg-muted/40 p-3">
          {loading && (
            <li className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Discovering tools…
            </li>
          )}
          {!loading && tools?.length === 0 && (
            <li className="text-sm text-muted-foreground">
              No tools discovered.
            </li>
          )}
          {!loading
            && tools?.map((t) => (
              <li key={t.name}>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                    checked={allowed.has(t.name)}
                    onChange={() => toggle(t.name)}
                  />
                  <span className="min-w-0">
                    <span className="font-mono">{t.name}</span>
                    {t.description && (
                      <span
                        className="block text-[11px] leading-snug"
                        style={{ color: "var(--oc-text-muted)" }}
                      >
                        {t.description.slice(0, 120)}
                        {t.description.length > 120 ? "…" : ""}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
        </ul>

        {saveError && (
          <div className="text-xs" style={{ color: "var(--oc-red)" }}>
            {saveError}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || loading}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
