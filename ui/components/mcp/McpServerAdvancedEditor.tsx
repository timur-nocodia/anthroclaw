"use client";

/**
 * Standalone "advanced" editor for a single configured external MCP server.
 *
 * Extracted from the inline JSX block in
 * `ui/app/(dashboard)/fleet/[serverId]/agents/[agentId]/page.tsx` so that the
 * new `<McpServersSection />` container can render a wizard-driven managed
 * view + this raw-field editor under a `<details>` advanced toggle.
 *
 * Phase 7 Task 29 — initial extraction, no behaviour change.
 * Phase 7 Task 30 — the page swaps the inline section for `<McpServersSection />`
 * which composes this editor.
 */

import { Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ExternalMcpEntry {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  allowed_tools?: string[];
  display_name?: string;
  credential_ref?: string;
}

export interface ExternalMcpPreflightServerSummary {
  serverName: string;
  approvalStatus: "approved" | "review_required" | "blocked";
  networkRisk: "low" | "medium" | "high";
  filesystemRisk: "low" | "medium" | "high";
  packageSource: string;
  reasons: string[];
}

export interface ExternalMcpPreflightStateSummary {
  loading?: boolean;
  error?: string;
  server?: ExternalMcpPreflightServerSummary;
}

export interface McpServerAdvancedEditorProps {
  name: string;
  entry: ExternalMcpEntry;
  onChange: (next: ExternalMcpEntry) => void;
  onRemove: () => void;
  onPreflight: () => Promise<void> | void;
  preflight?: ExternalMcpPreflightStateSummary;
}

function csvToArray(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function arrayToCsv(value?: string[]): string {
  return value?.join(", ") ?? "";
}

function mapToEnvText(value?: Record<string, string>): string {
  return Object.entries(value ?? {}).map(([key, entry]) => `${key}=${entry}`).join("\n");
}

function envTextToMap(value: string): Record<string, string> | undefined {
  const entries = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf("=");
      return index === -1
        ? [line, ""] as const
        : [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
    })
    .filter(([key]) => key.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">{children}</div>;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        className="flex items-center text-[11px] font-medium uppercase tracking-[0.4px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function PreflightResult({ state }: { state: ExternalMcpPreflightStateSummary }) {
  if (state.loading) {
    return (
      <div
        className="mt-3 rounded-[5px] border px-3 py-2 text-[11.5px]"
        style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)", color: "var(--oc-text-muted)" }}
      >
        Checking MCP command, env, tools, and transport risk...
      </div>
    );
  }
  if (state.error) {
    return (
      <div
        className="mt-3 rounded-[5px] border px-3 py-2 text-[11.5px]"
        style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.08)", color: "var(--oc-red)" }}
      >
        {state.error}
      </div>
    );
  }
  const server = state.server;
  if (!server) return null;
  const approvalColor = server.approvalStatus === "approved"
    ? "var(--oc-green)"
    : server.approvalStatus === "blocked"
      ? "var(--oc-red)"
      : "var(--oc-yellow)";
  return (
    <div className="mt-3 rounded-[5px] border px-3 py-2.5" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.4px]"
          style={{ color: approvalColor, background: "var(--oc-bg2)" }}
        >
          {server.approvalStatus.replace("_", " ")}
        </span>
        <span className="text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
          network:{server.networkRisk} / fs:{server.filesystemRisk} / {server.packageSource}
        </span>
      </div>
      {server.reasons.length > 0 && (
        <div className="mt-2 space-y-1">
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

export function McpServerAdvancedEditor({
  name,
  entry,
  onChange,
  onRemove,
  onPreflight,
  preflight,
}: McpServerAdvancedEditorProps) {
  const type = entry.type ?? "stdio";
  const patch = (next: Partial<ExternalMcpEntry>) => {
    onChange({ ...entry, ...next });
  };
  return (
    <div
      className="rounded-[5px] border p-3"
      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
            {name}
          </div>
          <div
            className="mt-0.5 text-[11px]"
            style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
          >
            {type} / {(entry.allowed_tools ?? []).length} allowed tools
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onPreflight()}
            disabled={preflight?.loading}
            className="h-7 px-2"
          >
            <Shield className="h-3.5 w-3.5" />
            {preflight?.loading ? "Checking" : "Preflight"}
          </Button>
          <button
            onClick={onRemove}
            className="inline-flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--oc-bg3)]"
            style={{ color: "var(--oc-text-dim)" }}
            title="Remove external MCP server"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[120px_minmax(0,1fr)]">
        <Field label="Transport">
          <select
            value={type}
            onChange={(e) => patch({ type: e.target.value as ExternalMcpEntry["type"] })}
            className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
            style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
          >
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </Field>
        {type === "stdio" ? (
          <Field label="Command">
            <input
              value={entry.command ?? ""}
              onChange={(e) => patch({ command: e.target.value })}
              placeholder="npx"
              className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
            />
          </Field>
        ) : (
          <Field label="URL">
            <input
              value={entry.url ?? ""}
              onChange={(e) => patch({ url: e.target.value })}
              placeholder="https://mcp.example.com"
              className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
            />
          </Field>
        )}
      </div>
      <FormGrid>
        {type === "stdio" ? (
          <>
            <Field label="Args">
              <input
                value={arrayToCsv(entry.args)}
                onChange={(e) => patch({ args: csvToArray(e.target.value) })}
                placeholder="server-cli"
                className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
                style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
              />
            </Field>
            <Field label="Env">
              <textarea
                value={mapToEnvText(entry.env)}
                onChange={(e) => patch({ env: envTextToMap(e.target.value) })}
                rows={3}
                placeholder="KEY=value"
                className="min-h-[76px] w-full resize-y rounded-[5px] border px-2 py-1.5 text-xs outline-none"
                style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
              />
            </Field>
          </>
        ) : (
          <Field label="Headers">
            <textarea
              value={mapToEnvText(entry.headers)}
              onChange={(e) => patch({ headers: envTextToMap(e.target.value) })}
              rows={3}
              placeholder="Authorization=Bearer ..."
              className="min-h-[76px] w-full resize-y rounded-[5px] border px-2 py-1.5 text-xs outline-none"
              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
            />
          </Field>
        )}
        <Field label="Allowed tools">
          <input
            value={arrayToCsv(entry.allowed_tools)}
            onChange={(e) => patch({ allowed_tools: csvToArray(e.target.value) })}
            placeholder="tool_a, tool_b"
            className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
            style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
          />
        </Field>
      </FormGrid>
      {preflight && <PreflightResult state={preflight} />}
    </div>
  );
}
