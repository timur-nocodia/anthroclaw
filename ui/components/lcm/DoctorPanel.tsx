"use client";

/**
 * Plan 3 Task C2 — LCM doctor panel.
 *
 * Operator-facing diagnostic + cleanup UI for an agent's LCM SQLite store.
 *
 * Two-phase flow:
 *   1. Run health check → POST { apply: false } → returns { health, issues }.
 *   2. If fixable issues exist, the operator may opt into cleanup, which is
 *      double-gated:
 *        a. AlertDialog confirm (ack: backup will be created, mutation is real).
 *        b. POST { apply: true, confirm: true } — only fired post-confirm.
 *
 * The cleanup branch returns { cleanup: { backupPath, actions } } which we
 * surface inline plus a sonner toast. No periodic polling — operator-driven.
 */

import { useCallback, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

/* ------------------------------------------------------------------ */
/*  API shapes                                                         */
/* ------------------------------------------------------------------ */

type Severity = "info" | "warning" | "error";
type Health = "green" | "yellow" | "red";

interface Issue {
  severity: Severity;
  code: string;
  message: string;
  count?: number;
}

interface DoctorReport {
  agentId: string;
  health: Health;
  issues: Issue[];
  cleanup?: {
    backupPath: string;
    actions: string[];
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isFixable(issue: Issue): boolean {
  // Only the warnings the API knows how to mutate are exposed via cleanup.
  // integrity_check_failed (error) is informational — backup-then-rebuild-FTS
  // covers what the API does, so we still treat it as fixable.
  return (
    issue.code === "fts_out_of_sync" ||
    issue.code === "orphan_nodes" ||
    issue.code === "source_lineage_broken" ||
    issue.code === "integrity_check_failed"
  );
}

function healthStyle(health: Health) {
  switch (health) {
    case "green":
      return {
        bg: "rgba(16,185,129,0.15)",
        border: "rgba(16,185,129,0.4)",
        fg: "rgb(110,231,183)",
        Icon: CheckCircle2,
        label: "Healthy",
      };
    case "yellow":
      return {
        bg: "rgba(245,158,11,0.15)",
        border: "rgba(245,158,11,0.4)",
        fg: "rgb(252,211,77)",
        Icon: AlertTriangle,
        label: "Warnings",
      };
    case "red":
      return {
        bg: "rgba(239,68,68,0.18)",
        border: "rgba(239,68,68,0.45)",
        fg: "rgb(252,165,165)",
        Icon: XCircle,
        label: "Errors",
      };
  }
}

function severityIcon(s: Severity) {
  if (s === "error") return XCircle;
  if (s === "warning") return AlertTriangle;
  return Info;
}

function severityColor(s: Severity): string {
  if (s === "error") return "rgb(252,165,165)";
  if (s === "warning") return "rgb(252,211,77)";
  return "rgb(148,163,184)";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface DoctorPanelProps {
  agentId: string;
}

export function DoctorPanel({ agentId }: DoctorPanelProps) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  /* ----- Run health check ---------------------------------------- */

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/lcm/doctor`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apply: false }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DoctorReport;
      setReport(json);
      setHasRun(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run health check");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  /* ----- Cleanup (gated) ----------------------------------------- */

  const runCleanup = useCallback(async () => {
    setCleaning(true);
    try {
      const res = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/lcm/doctor`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apply: true, confirm: true }),
        },
      );
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${txt ? `: ${txt}` : ""}`);
      }
      const json = (await res.json()) as DoctorReport;
      setReport(json);
      setConfirmOpen(false);
      toast.success("LCM cleanup completed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cleanup failed";
      toast.error(msg);
    } finally {
      setCleaning(false);
    }
  }, [agentId]);

  /* ----- Render -------------------------------------------------- */

  const hasFixable =
    !!report && report.issues.some(isFixable) && !report.cleanup;

  // Use a placeholder backup path string in the confirm dialog — the real one
  // comes back in the response. The path scheme is documented + stable.
  const backupHint = `data/lcm/lcm-backups/${agentId}-<ts>.sqlite`;

  return (
    <div className="flex flex-col gap-4 p-5" data-testid="doctor-panel">
      {/* Header + run button */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            className="flex items-center gap-2 text-[14px] font-semibold"
            style={{ color: "var(--color-foreground)" }}
          >
            <Stethoscope className="h-4 w-4" style={{ color: "var(--oc-text-dim)" }} />
            LCM diagnostics
          </h2>
          <p
            className="mt-0.5 text-[11.5px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            Integrity check, FTS-sync, orphan + lineage scan. Read-only by default.
          </p>
        </div>
        <Button
          size="sm"
          onClick={runCheck}
          disabled={loading}
          data-testid="doctor-run-check"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Stethoscope className="h-3.5 w-3.5" />
          )}
          {hasRun ? "Re-run check" : "Run health check"}
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="flex items-start gap-2 rounded border p-3 text-[12px]"
          style={{
            background: "var(--oc-bg2)",
            borderColor: "rgba(248,113,113,0.35)",
            color: "rgb(252,165,165)",
          }}
          role="alert"
          data-testid="doctor-error"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <div className="flex-1">
            <div>Failed to load: {error}</div>
            <button
              onClick={runCheck}
              className="mt-1 underline"
              data-testid="doctor-retry"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!report && !loading && !error && (
        <div
          className="rounded border p-6 text-center text-[12px]"
          style={{
            background: "var(--oc-bg1)",
            borderColor: "var(--oc-border)",
            color: "var(--oc-text-muted)",
          }}
          data-testid="doctor-empty"
        >
          No health check has been run yet. Click <em>Run health check</em> to scan.
        </div>
      )}

      {/* Report */}
      {report && (
        <div className="flex flex-col gap-3" data-testid="doctor-report">
          {/* Health badge */}
          {(() => {
            const s = healthStyle(report.health);
            const Icon = s.Icon;
            return (
              <div
                className="flex items-center gap-2 rounded border px-3 py-2 text-[12.5px] font-medium"
                style={{
                  background: s.bg,
                  borderColor: s.border,
                  color: s.fg,
                }}
                data-testid="doctor-health-badge"
                data-health={report.health}
              >
                <Icon className="h-4 w-4" />
                <span>{s.label}</span>
                <span
                  className="ml-auto text-[11px]"
                  style={{ color: s.fg, opacity: 0.85 }}
                >
                  {report.issues.length}{" "}
                  {report.issues.length === 1 ? "issue" : "issues"}
                </span>
              </div>
            );
          })()}

          {/* Issues list */}
          {report.issues.length === 0 ? (
            <div
              className="rounded border p-4 text-[12px]"
              style={{
                background: "var(--oc-bg1)",
                borderColor: "var(--oc-border)",
                color: "var(--oc-text-muted)",
              }}
              data-testid="doctor-no-issues"
            >
              No issues detected.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5" data-testid="doctor-issues">
              {report.issues.map((iss, i) => {
                const Icon = severityIcon(iss.severity);
                return (
                  <div
                    key={`${iss.code}-${i}`}
                    className="flex items-start gap-2 rounded border p-2.5 text-[12px]"
                    style={{
                      background: "var(--oc-bg1)",
                      borderColor: "var(--oc-border)",
                    }}
                    data-testid={`doctor-issue-${iss.code}`}
                  >
                    <Icon
                      className="mt-0.5 h-3.5 w-3.5 flex-shrink-0"
                      style={{ color: severityColor(iss.severity) }}
                    />
                    <div className="flex-1">
                      <div
                        className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.4px]"
                        style={{
                          color: "var(--oc-text-muted)",
                          fontFamily: "var(--oc-mono)",
                        }}
                      >
                        <span>{iss.severity}</span>
                        <span>·</span>
                        <span>{iss.code}</span>
                        {typeof iss.count === "number" && (
                          <>
                            <span>·</span>
                            <span>{iss.count}</span>
                          </>
                        )}
                      </div>
                      <div
                        className="mt-0.5"
                        style={{ color: "var(--oc-text-dim)" }}
                      >
                        {iss.message}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Cleanup CTA — only when issues exist AND we haven't already cleaned. */}
          {hasFixable && (
            <div
              className="flex items-start justify-between gap-3 rounded border p-3"
              style={{
                background: "var(--oc-bg1)",
                borderColor: "var(--oc-border)",
              }}
              data-testid="doctor-cleanup-cta"
            >
              <div className="flex-1">
                <div
                  className="text-[12px] font-medium"
                  style={{ color: "var(--color-foreground)" }}
                >
                  Cleanup available
                </div>
                <div
                  className="mt-0.5 text-[11.5px]"
                  style={{ color: "var(--oc-text-muted)" }}
                >
                  Removes orphan node references and rebuilds FTS shadows. A
                  backup of the DB is created before any mutation.
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmOpen(true)}
                data-testid="doctor-cleanup-button"
              >
                Cleanup
              </Button>
            </div>
          )}

          {/* Cleanup result (post-mutation) */}
          {report.cleanup && (
            <div
              className="rounded border p-3"
              style={{
                background: "rgba(16,185,129,0.08)",
                borderColor: "rgba(16,185,129,0.35)",
              }}
              data-testid="doctor-cleanup-result"
            >
              <div
                className="flex items-center gap-1.5 text-[12px] font-medium"
                style={{ color: "rgb(110,231,183)" }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Cleanup applied
              </div>
              <div
                className="mt-1.5 text-[11px]"
                style={{
                  color: "var(--oc-text-muted)",
                  fontFamily: "var(--oc-mono)",
                  wordBreak: "break-all",
                }}
                data-testid="doctor-cleanup-backup"
              >
                Backup: {report.cleanup.backupPath}
              </div>
              {report.cleanup.actions.length > 0 && (
                <ul
                  className="mt-1.5 flex flex-col gap-0.5 text-[11.5px]"
                  style={{ color: "var(--oc-text-dim)" }}
                  data-testid="doctor-cleanup-actions"
                >
                  {report.cleanup.actions.map((a, i) => (
                    <li
                      key={i}
                      style={{ fontFamily: "var(--oc-mono)" }}
                    >
                      · {a}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Confirm dialog — gated cleanup */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => !cleaning && setConfirmOpen(open)}
      >
        <AlertDialogContent
          style={{
            background: "var(--oc-bg1)",
            borderColor: "var(--oc-border-mid)",
          }}
          data-testid="doctor-confirm-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Run LCM cleanup?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <span>
                  This will mutate the LCM database for{" "}
                  <span style={{ fontFamily: "var(--oc-mono)" }}>{agentId}</span>.
                  A backup will be created at:
                </span>
                <code
                  className="rounded border px-2 py-1 text-[11px]"
                  style={{
                    background: "var(--oc-bg2)",
                    borderColor: "var(--oc-border)",
                    color: "var(--oc-text-dim)",
                    wordBreak: "break-all",
                  }}
                >
                  {backupHint}
                </code>
                <span>Proceed?</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={cleaning}
              data-testid="doctor-confirm-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Prevent radix from auto-closing — we close after the POST
                // resolves so the disabled state is observable.
                e.preventDefault();
                void runCleanup();
              }}
              disabled={cleaning}
              data-testid="doctor-confirm-proceed"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cleaning ? "Cleaning…" : "Proceed"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
