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

/**
 * `/api/agents/[agentId]` returns `{ raw: string; parsed: AgentConfig }` —
 * NOT the bare parsed config. McpTab needs the inner `parsed` object.
 */
interface AgentConfigEnvelope {
  raw?: string;
  parsed?: AgentConfigShape;
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
      const envelope = (await res.json()) as AgentConfigEnvelope;
      const parsed = envelope.parsed ?? {};
      setConfig(parsed);
      setDraft(parsed.external_mcp_servers ?? {});
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
      <div
        className="flex h-full items-center justify-center text-xs"
        style={{ color: "var(--oc-text-muted)" }}
      >
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading agent config…
      </div>
    );
  }

  if (error && !config) {
    return (
      <div
        className="p-5 text-xs"
        style={{ color: "var(--oc-red, var(--oc-accent))" }}
      >
        Couldn&apos;t load agent config: {error}
      </div>
    );
  }

  return (
    <div className="flex max-w-[1100px] flex-col gap-3.5 p-5">
      {/* Header bar matching ConfigTab: dirty pill + Discard/Save actions */}
      {dirty && (
        <div className="flex items-center justify-end gap-2.5">
          <span
            className="flex items-center gap-1.5 text-[11.5px]"
            style={{ color: "var(--oc-yellow)" }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--oc-yellow)" }}
            />
            Unsaved advanced edits
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(config?.external_mcp_servers ?? {});
              setDirty(false);
            }}
            disabled={saving}
          >
            Discard
          </Button>
          <Button
            size="sm"
            onClick={() => void persist(draft)}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}

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

      {error && config && (
        <p
          className="text-[11.5px]"
          role="alert"
          style={{ color: "var(--oc-red, var(--oc-accent))" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
