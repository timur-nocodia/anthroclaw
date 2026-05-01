"use client";

/**
 * ConfigAuditPanel — Handoff tab → recent config-write audit timeline.
 *
 * Shows the last 50 entries from `/api/agents/[id]/config-audit`. Each
 * entry renders as:
 *   - timestamp (relativeTime)
 *   - caller agent + source tag (chat / ui / system)
 *   - section + action
 *   - prev → new diff (raw JSON in <pre> for v1)
 *
 * Optional dropdown narrows to a single section. Empty state displayed
 * when no entries exist.
 */

import { useEffect, useState, useCallback } from "react";
import { History, AlertCircle, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/format-time";
import type { ConfigSection } from "@backend/config/writer.js";

interface AuditEntry {
  ts: string;
  callerAgent: string;
  callerSession?: string;
  targetAgent: string;
  section: ConfigSection;
  action: string;
  prev: unknown;
  new: unknown;
  source: "chat" | "ui" | "system";
}

const SECTIONS: ReadonlyArray<{ value: "" | ConfigSection; label: string }> = [
  { value: "", label: "All sections" },
  { value: "notifications", label: "Notifications" },
  { value: "human_takeover", label: "Human takeover" },
  { value: "operator_console", label: "Operator console" },
];

function sourceLabel(entry: AuditEntry): string {
  if (entry.source === "chat") return `chat (${entry.callerAgent})`;
  if (entry.source === "ui") return "UI";
  return "system";
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export interface ConfigAuditPanelProps {
  agentId: string;
}

export function ConfigAuditPanel({ agentId }: ConfigAuditPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [section, setSection] = useState<"" | ConfigSection>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (section) params.set("section", section);
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/config-audit?${params.toString()}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { entries?: AuditEntry[] };
      setEntries(body.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId, section]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card
      className="rounded-md"
      style={{ background: "var(--oc-bg0)", borderColor: "var(--oc-border)" }}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-[14px] font-medium">
              <History className="h-4 w-4" />
              Config change history
            </CardTitle>
            <CardDescription className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
              Recent writes to this agent&apos;s config — chat tools, UI saves, and
              system updates. Last 50 entries.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            disabled={loading}
            aria-label="refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="mb-3 flex items-center gap-2">
          <label htmlFor="audit-section-filter" className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
            Section:
          </label>
          <select
            id="audit-section-filter"
            aria-label="section-filter"
            value={section}
            onChange={(e) => setSection(e.target.value as "" | ConfigSection)}
            className="h-8 rounded border px-2 text-[12px]"
            style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
          >
            {SECTIONS.map((s) => (
              <option key={s.value || "all"} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <div
            className="mb-2 flex items-center gap-2 rounded border p-2 text-[12px]"
            style={{ borderColor: "var(--oc-border)", color: "var(--oc-danger)" }}
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}

        {entries.length === 0 ? (
          <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
            No config changes yet.
          </p>
        ) : (
          <ol className="space-y-2">
            {entries.map((entry, idx) => (
              <li
                key={`${entry.ts}-${idx}`}
                className="rounded border p-2 text-[12px]"
                style={{ borderColor: "var(--oc-border)" }}
                data-testid={`audit-entry-${idx}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {entry.section} · {entry.action}
                  </span>
                  <span style={{ color: "var(--oc-text-muted)" }}>
                    {relativeTime(entry.ts)}
                  </span>
                </div>
                <div
                  className="mt-1"
                  style={{ color: "var(--oc-text-muted)" }}
                  data-testid={`audit-source-${idx}`}
                >
                  via {sourceLabel(entry)}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <div
                      className="mb-1 text-[11px] uppercase tracking-wide"
                      style={{ color: "var(--oc-text-muted)" }}
                    >
                      prev
                    </div>
                    <pre
                      className="max-h-40 overflow-auto rounded border p-1.5 text-[11px]"
                      style={{
                        borderColor: "var(--oc-border)",
                        background: "var(--oc-bg1)",
                      }}
                      data-testid={`audit-prev-${idx}`}
                    >
                      {safeStringify(entry.prev)}
                    </pre>
                  </div>
                  <div>
                    <div
                      className="mb-1 text-[11px] uppercase tracking-wide"
                      style={{ color: "var(--oc-text-muted)" }}
                    >
                      new
                    </div>
                    <pre
                      className="max-h-40 overflow-auto rounded border p-1.5 text-[11px]"
                      style={{
                        borderColor: "var(--oc-border)",
                        background: "var(--oc-bg1)",
                      }}
                      data-testid={`audit-new-${idx}`}
                    >
                      {safeStringify(entry.new)}
                    </pre>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
