"use client";

/**
 * Container for the External MCP servers panel on an agent's config page.
 *
 *   - Top: managed card view (one `<McpServerCard />` per server, plus the
 *     `+ Add server` button that opens `<AddMcpWizard />`).
 *   - Bottom (collapsed): `<details>` containing one
 *     `<McpServerAdvancedEditor />` per server for raw-fields editing.
 *
 * Phase 7 Task 30 — replaces the inline JSX previously inlined in
 * `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx`.
 *
 * Note: the wizard persists via `/api/mcp/connect/*` routes and the agent
 * config is reloaded on save. The raw-fields editor calls back into the
 * caller's local config state via `onChangeEntry` / `onRemoveEntry`; the
 * caller persists when the user clicks Save on the page.
 */

import { useState } from "react";
import { Plug, Plus } from "lucide-react";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { AddMcpWizard } from "./AddMcpWizard";
import { McpServerCard } from "./McpServerCard";
import {
  McpServerAdvancedEditor,
  type ExternalMcpEntry,
} from "./McpServerAdvancedEditor";

export type { ExternalMcpEntry } from "./McpServerAdvancedEditor";

export interface McpServersSectionProps {
  agentId: string;
  servers: Record<string, ExternalMcpEntry>;
  /**
   * Re-fetch the agent config from the backend. Called after the wizard
   * saves and after a card-level remove succeeds. The page-level config
   * state then re-mounts with the new servers map.
   */
  onReload: () => void | Promise<void>;
  /**
   * Patch a single server entry in the page's draft config (for the
   * advanced editor's raw-field edits).
   */
  onChangeEntry?: (name: string, next: ExternalMcpEntry) => void;
  /**
   * Remove a single server entry from the page's draft config (used by the
   * advanced editor's trash button; the card-level remove goes through the
   * onRemoveServer prop because it persists immediately).
   */
  onRemoveEntry?: (name: string) => void;
  /**
   * Persisting remove from the managed card view. If absent, the section
   * falls back to a best-effort DELETE on `/api/agents/<id>/mcp/<name>`
   * (which may 404 until that route is implemented).
   */
  onRemoveServer?: (name: string) => void | Promise<void>;
}

export function McpServersSection({
  agentId,
  servers,
  onReload,
  onChangeEntry,
  onRemoveEntry,
  onRemoveServer,
}: McpServersSectionProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const entries = Object.entries(servers);
  return (
    <Section
      title="External MCP servers"
      subtitle={`${entries.length} configured`}
      tooltip="SDK-native external MCP servers. Add one with the + Add server wizard, or edit raw fields under Advanced."
      icon={<Plug className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
      action={
        <Button variant="outline" size="sm" onClick={() => setWizardOpen(true)}>
          <Plus className="h-3 w-3" />
          Add server
        </Button>
      }
    >
      {entries.length === 0 ? (
        <div
          className="p-5 text-center text-xs"
          style={{ color: "var(--oc-text-muted)" }}
        >
          No external MCP servers. Click <strong>+ Add server</strong> to connect one.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(([name, entry]) => (
            <McpServerCard
              key={name}
              name={entry.display_name ?? name}
              url={entry.url ?? entry.command ?? ""}
              transport={entry.type ?? "stdio"}
              toolCount={entry.allowed_tools?.length ?? 0}
              status={entry.credential_ref ? "connected" : "disabled"}
              onEditAllowed={() => {
                /* future: dedicated allowed-tools subdialog */
              }}
              onReauth={() => setWizardOpen(true)}
              onRemove={async () => {
                if (typeof window !== "undefined"
                  && !window.confirm(`Remove ${name}?`)) {
                  return;
                }
                if (onRemoveServer) {
                  await onRemoveServer(name);
                } else {
                  try {
                    await fetch(`/api/agents/${agentId}/mcp/${name}`, {
                      method: "DELETE",
                    });
                  } catch {
                    /* swallow — onReload will refresh anyway */
                  }
                }
                await onReload();
              }}
            />
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
            Advanced — manually edit raw fields
          </summary>
          <div className="mt-3 flex flex-col gap-2.5">
            {entries.map(([name, entry]) => (
              <McpServerAdvancedEditor
                key={name}
                name={name}
                entry={entry}
                onChange={(next) => onChangeEntry?.(name, next)}
                onRemove={() => onRemoveEntry?.(name)}
                onPreflight={() => Promise.resolve()}
              />
            ))}
          </div>
        </details>
      )}

      {wizardOpen && (
        <AddMcpWizard
          agentId={agentId}
          onClose={() => setWizardOpen(false)}
          onSaved={() => {
            void onReload();
          }}
        />
      )}
    </Section>
  );
}
