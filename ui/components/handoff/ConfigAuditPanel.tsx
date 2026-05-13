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
import { History, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { relativeTime } from "@/lib/format-time";
import type { ConfigSection } from "@backend/config/writer.js";
import { HandoffEmpty, HandoffError, HandoffField, HandoffIntro } from "./HandoffControls";

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
    <Section
      title="Config change history"
      subtitle="last 50 writes"
      icon={<History className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
      tooltip="Audit trail for saves made through this UI, chat self-config tools, and system processes."
      action={
        <Button
          size="sm"
          variant="ghost"
          onClick={refresh}
          disabled={loading}
          aria-label="refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      }
    >
      <HandoffIntro>
        Use this to see what changed, who changed it, and whether the write came from the UI,
        a chat tool, or a system process.
      </HandoffIntro>

      <div className="mb-3 max-w-[320px]">
        <HandoffField
          label="Section filter"
          htmlFor="audit-section-filter"
          tooltip="Limits the audit list to one config section. Use All sections when comparing related saves."
        >
          <select
            id="audit-section-filter"
            aria-label="section-filter"
            value={section}
            onChange={(e) => setSection(e.target.value as "" | ConfigSection)}
            className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-[12px]"
            style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)", color: "var(--color-foreground)" }}
          >
            {SECTIONS.map((s) => (
              <option key={s.value || "all"} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </HandoffField>
      </div>

        {error && <div className="mb-2"><HandoffError message={error} /></div>}

        {entries.length === 0 ? (
          <HandoffEmpty>No config changes yet.</HandoffEmpty>
        ) : (
          <ol className="space-y-2">
            {entries.map((entry, idx) => (
              <li
                key={`${entry.ts}-${idx}`}
                className="rounded-[6px] border p-2 text-[12px]"
                style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}
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
                        background: "var(--oc-bg3)",
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
                        background: "var(--oc-bg3)",
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
    </Section>
  );
}
