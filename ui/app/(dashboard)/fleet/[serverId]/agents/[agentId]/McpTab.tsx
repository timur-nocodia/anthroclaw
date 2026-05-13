"use client";

/**
 * Dedicated agent-page tab for MCP server management.
 *
 * Refactored out of ConfigTab in the 2026-05-13 UI cleanup pass — the
 * config tab had grown too dense, and external MCP servers warrant a
 * top-level surface of their own.
 *
 * Persistence model:
 *   - The Add server wizard already persists via `/api/mcp/connect/finalize`.
 *   - Card-level "Remove" mutates a draft `external_mcp_servers` map and
 *     PUTs the full agent config back via `PUT /api/agents/<id>` (the same
 *     endpoint the ConfigTab uses, with `{config: ...}`).
 *   - Advanced raw-field edits also feed the draft map; a tab-level
 *     "Save changes" button persists them. Wizard adds and card removes
 *     persist immediately (no Save needed).
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  McpServersSection,
  type ExternalMcpEntry,
} from "@/components/mcp/McpServersSection";

interface AgentConfigShape {
  external_mcp_servers?: Record<string, ExternalMcpEntry>;
  [key: string]: unknown;
}

export interface McpTabProps {
  agentId: string;
}

export function McpTab({ agentId }: McpTabProps) {
  const [config, setConfig] = useState<AgentConfigShape | null>(null);
  const [draft, setDraft] = useState<Record<string, ExternalMcpEntry>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const body = (await res.json()) as AgentConfigShape;
      setConfig(body);
      setDraft(body.external_mcp_servers ?? {});
      setDirty(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchAgent();
  }, [fetchAgent]);

  async function persist(nextDraft: Record<string, ExternalMcpEntry>) {
    if (!config) return;
    setSaving(true);
    setError(null);
    try {
      const nextConfig: AgentConfigShape = {
        ...config,
        external_mcp_servers: nextDraft,
      };
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `save failed (${res.status})`);
      }
      await fetchAgent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading agent config…
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="p-6 text-sm text-destructive">
        Couldn&apos;t load agent config: {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <McpServersSection
        agentId={agentId}
        servers={draft}
        onReload={fetchAgent}
        onChangeEntry={(name, next) => {
          setDraft((prev) => ({ ...prev, [name]: next }));
          setDirty(true);
        }}
        onRemoveEntry={(name) => {
          setDraft((prev) => {
            const next = { ...prev };
            delete next[name];
            return next;
          });
          setDirty(true);
        }}
        onRemoveServer={async (name) => {
          const next = { ...draft };
          delete next[name];
          await persist(next);
        }}
      />

      {dirty && (
        <div
          className="sticky bottom-4 mx-auto flex w-full max-w-2xl items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2 shadow-lg"
          role="region"
          aria-label="Unsaved MCP changes"
        >
          <p className="text-sm text-muted-foreground">
            Unsaved advanced edits. The wizard-driven changes already saved.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(config?.external_mcp_servers ?? {});
                setDirty(false);
              }}
              disabled={saving}
            >
              Revert
            </Button>
            <Button
              size="sm"
              onClick={() => void persist(draft)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      )}

      {error && config && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
