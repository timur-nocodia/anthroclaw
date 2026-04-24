"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  Download,
  GitBranch,
  Key,
  Loader2,
  Power,
  RefreshCw,
  X,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FleetServerStatus } from "@/lib/fleet";

/* ------------------------------------------------------------------ */
/*  Command definitions                                                */
/* ------------------------------------------------------------------ */

interface CommandDef {
  id: string;
  icon: React.ElementType;
  name: string;
  desc: string;
  kind: "safe" | "careful" | "danger";
  state: "ready" | "ssh-only" | "disabled";
  stateLabel: string;
}

const COMMANDS: CommandDef[] = [
  {
    id: "rolling_restart",
    icon: RefreshCw,
    name: "Rolling restart",
    desc: "Restart each gateway in series via SSH or the local restart API.",
    kind: "safe",
    state: "ready",
    stateLabel: "Ready",
  },
  {
    id: "hot_reload",
    icon: Zap,
    name: "Hot-reload config",
    desc: "Requires a gateway reload endpoint before it can run safely.",
    kind: "safe",
    state: "disabled",
    stateLabel: "Not wired",
  },
  {
    id: "pull_redeploy",
    icon: GitBranch,
    name: "Pull & redeploy",
    desc: "SSH-managed gateways only: git pull \u2192 install \u2192 restart.",
    kind: "careful",
    state: "ssh-only",
    stateLabel: "SSH only",
  },
  {
    id: "sync_agents",
    icon: Bot,
    name: "Sync all agents",
    desc: "Copy local agent configs to selected gateways through the API.",
    kind: "safe",
    state: "ready",
    stateLabel: "Ready",
  },
  {
    id: "backup",
    icon: Download,
    name: "Backup now",
    desc: "Requires a gateway backup endpoint before it can run safely.",
    kind: "safe",
    state: "disabled",
    stateLabel: "Not wired",
  },
  {
    id: "rotate_keys",
    icon: Key,
    name: "Rotate JWT secret",
    desc: "Disabled until key rotation semantics are explicit and audited.",
    kind: "careful",
    state: "disabled",
    stateLabel: "Disabled",
  },
  {
    id: "stop_fleet",
    icon: Power,
    name: "Stop fleet",
    desc: "Requires a gateway stop endpoint before it can run safely.",
    kind: "danger",
    state: "disabled",
    stateLabel: "Not wired",
  },
];

/* ------------------------------------------------------------------ */
/*  Execution result types                                             */
/* ------------------------------------------------------------------ */

interface ServerResult {
  serverId: string;
  status: "pending" | "running" | "success" | "error";
  message?: string;
  elapsed?: number;
}

type CommandStreamEvent =
  | {
      type: "progress";
      serverId: string;
      serverName: string;
      status: "running" | "done" | "error";
      message?: string;
    }
  | { type: "done"; summary: { total: number; succeeded: number; failed: number } }
  | { type: "error"; message: string };

/* ------------------------------------------------------------------ */
/*  FleetCommandsDialog                                                */
/* ------------------------------------------------------------------ */

interface FleetCommandsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: FleetServerStatus[];
}

export function FleetCommandsDialog({
  open,
  onOpenChange,
  servers,
}: FleetCommandsDialogProps) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"menu" | "targets" | "executing" | "done">(
    "menu",
  );
  const [results, setResults] = useState<ServerResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  /* Reset state when dialog opens/closes */
  useEffect(() => {
    if (open) {
      setChosen(null);
      setPhase("menu");
      setResults([]);
      setSelected(
        new Set(
          servers
            .filter((s) => s.status !== "offline")
            .map((s) => s.id),
        ),
      );
    }
  }, [open, servers]);

  /* ---- Select command ---- */
  const handleChooseCommand = (cmdId: string) => {
    const command = COMMANDS.find((c) => c.id === cmdId);
    if (!command || command.state === "disabled") return;
    setChosen(cmdId);
    setPhase("targets");
  };

  /* ---- Toggle server selection ---- */
  const toggleServer = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ---- Select all / none ---- */
  const selectAll = () => setSelected(new Set(servers.map((s) => s.id)));
  const selectNone = () => setSelected(new Set());
  const selectProd = () =>
    setSelected(
      new Set(
        servers
          .filter((s) => s.environment === "production")
          .map((s) => s.id),
      ),
    );

  /* ---- Execute command ---- */
  const executeCommand = useCallback(async () => {
    if (!chosen || selected.size === 0) return;

    setPhase("executing");
    const initialResults: ServerResult[] = Array.from(selected).map((id) => ({
      serverId: id,
      status: "pending",
    }));
    setResults(initialResults);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/fleet/commands/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: chosen,
          targetServerIds: Array.from(selected),
        }),
        signal: controller.signal,
      });

      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6)) as CommandStreamEvent;
              if (event.type === "progress") {
                setResults((prev) =>
                  prev.map((r) =>
                    r.serverId === event.serverId
                      ? {
                          ...r,
                          status:
                            event.status === "done"
                              ? "success"
                              : event.status === "error"
                                ? "error"
                                : "running",
                          message: event.message,
                        }
                      : r,
                  ),
                );
              } else if (event.type === "error") {
                setResults((prev) =>
                  prev.map((r) =>
                    r.status === "pending" || r.status === "running"
                      ? { ...r, status: "error", message: event.message }
                      : r,
                  ),
                );
              }
            } catch {
              // skip malformed SSE
            }
          }
        }
      } else {
        const message = `Command failed: HTTP ${res.status}`;
        setResults((prev) =>
          prev.map((r) => ({ ...r, status: "error", message })),
        );
      }
    } catch {
      // On abort or error, mark remaining as error
      setResults((prev) =>
        prev.map((r) =>
          r.status === "pending" || r.status === "running"
            ? { ...r, status: "error", message: "Aborted" }
            : r,
        ),
      );
    } finally {
      setPhase("done");
    }
  }, [chosen, selected]);

  const cmd = COMMANDS.find((c) => c.id === chosen);
  const successCount = results.filter((r) => r.status === "success").length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[85vh] w-full max-w-[760px] flex-col gap-0 overflow-hidden p-0"
        style={{
          background: "var(--oc-bg1)",
          border: "1px solid var(--oc-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 border-b px-[18px] py-3.5"
          style={{
            background: "var(--oc-bg0)",
            borderColor: "var(--oc-border)",
          }}
        >
          <div className="flex-1">
            <DialogTitle
              className="text-[14px] font-semibold"
              style={{ color: "var(--color-foreground)" }}
            >
              Fleet-wide command
            </DialogTitle>
            <DialogDescription
              className="mt-0.5 text-[11.5px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              {phase === "menu"
                ? "Choose an action to run across multiple gateways."
                : cmd
                  ? `Will execute on ${selected.size} of ${servers.length} gateways`
                  : ""}
            </DialogDescription>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="flex h-6 w-6 cursor-pointer items-center justify-center rounded"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--oc-text-muted)",
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {/* ---- Command menu ---- */}
          {phase === "menu" && (
            <div className="grid grid-cols-2 gap-2 p-4">
              {COMMANDS.map((c) => {
                const tone =
                  c.kind === "danger"
                    ? "var(--oc-red)"
                    : c.kind === "careful"
                      ? "var(--oc-yellow)"
                      : "var(--oc-accent)";
                const Icon = c.icon;
                const disabled = c.state === "disabled";
                const labelTone =
                  c.state === "ready"
                    ? "var(--oc-green)"
                    : c.state === "ssh-only"
                      ? "var(--oc-yellow)"
                      : "var(--oc-text-muted)";
                return (
                  <button
                    key={c.id}
                    onClick={() => handleChooseCommand(c.id)}
                    disabled={disabled}
                    className="flex items-start gap-2.5 rounded-md p-3 text-left transition-colors"
                    style={{
                      background: "var(--oc-bg0)",
                      border: "1px solid var(--oc-border)",
                      fontFamily: "inherit",
                      cursor: disabled ? "not-allowed" : "pointer",
                      opacity: disabled ? 0.52 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (!disabled) {
                        (e.currentTarget as HTMLElement).style.borderColor =
                          "#323a50";
                      }
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor =
                        "var(--oc-border)";
                    }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                      style={{
                        background: "var(--oc-bg2)",
                        border: "1px solid var(--oc-border)",
                      }}
                    >
                      <Icon className="h-[14px] w-[14px]" style={{ color: tone }} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div
                          className="text-[12.5px] font-semibold"
                          style={{ color: "var(--color-foreground)" }}
                        >
                          {c.name}
                        </div>
                        <span
                          className="ml-auto inline-flex shrink-0 items-center rounded px-1.5 py-px text-[9.5px] font-medium uppercase tracking-[0.08em]"
                          style={{
                            color: labelTone,
                            background: "var(--oc-bg2)",
                            border: "1px solid var(--oc-border)",
                          }}
                        >
                          {c.stateLabel}
                        </span>
                      </div>
                      <div
                        className="mt-0.5 text-[11px] leading-relaxed"
                        style={{ color: "var(--oc-text-muted)" }}
                      >
                        {c.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ---- Target selection ---- */}
          {phase === "targets" && cmd && (
            <div className="flex flex-col gap-3 p-4">
              {/* Info banner */}
              <div
                className="flex items-start gap-2.5 rounded-md p-3"
                style={{
                  background:
                    cmd.kind === "danger"
                      ? "rgba(248,113,113,0.08)"
                      : cmd.kind === "careful"
                        ? "rgba(251,191,36,0.08)"
                        : "rgba(74,222,128,0.08)",
                  border: `1px solid ${
                    cmd.kind === "danger"
                      ? "rgba(248,113,113,0.3)"
                      : cmd.kind === "careful"
                        ? "rgba(251,191,36,0.3)"
                        : "rgba(74,222,128,0.3)"
                  }`,
                }}
              >
                <cmd.icon
                  className="mt-0.5 h-[14px] w-[14px] shrink-0"
                  style={{
                    color:
                      cmd.kind === "danger"
                        ? "var(--oc-red)"
                        : cmd.kind === "careful"
                          ? "var(--oc-yellow)"
                          : "var(--oc-green)",
                  }}
                />
                <div>
                  <div
                    className="text-[12.5px] font-semibold"
                    style={{ color: "var(--color-foreground)" }}
                  >
                    {cmd.name}
                  </div>
                  <div
                    className="mt-0.5 text-[11px] leading-relaxed"
                    style={{ color: "var(--oc-text-muted)" }}
                  >
                    {cmd.desc}
                    {cmd.state === "ssh-only"
                      ? " This command requires SSH configuration on every selected gateway."
                      : " Commands stream real gateway results and do not simulate success."}
                  </div>
                </div>
              </div>

              {/* Select targets header */}
              <div>
                <div
                  className="mb-2 text-[11.5px] font-medium"
                  style={{ color: "var(--oc-text-dim)" }}
                >
                  Select targets
                </div>
                <div className="mb-2 flex items-center gap-2">
                  <button
                    onClick={selectAll}
                    className="inline-flex h-[22px] cursor-pointer items-center rounded-[4px] px-2 text-[11px] font-medium"
                    style={{
                      background: "transparent",
                      color: "var(--oc-text-dim)",
                      border: "1px solid var(--oc-border)",
                      fontFamily: "inherit",
                    }}
                  >
                    Select all
                  </button>
                  <button
                    onClick={selectProd}
                    className="inline-flex h-[22px] cursor-pointer items-center rounded-[4px] px-2 text-[11px] font-medium"
                    style={{
                      background: "transparent",
                      color: "var(--oc-text-dim)",
                      border: "1px solid var(--oc-border)",
                      fontFamily: "inherit",
                    }}
                  >
                    Production only
                  </button>
                  <button
                    onClick={selectNone}
                    className="inline-flex h-[22px] cursor-pointer items-center rounded-[4px] px-2 text-[11px] font-medium"
                    style={{
                      background: "transparent",
                      color: "var(--oc-text-dim)",
                      border: "1px solid var(--oc-border)",
                      fontFamily: "inherit",
                    }}
                  >
                    Clear
                  </button>
                  <span
                    className="ml-auto text-[11px]"
                    style={{
                      color: "var(--oc-text-muted)",
                      fontFamily: "var(--oc-mono)",
                    }}
                  >
                    {selected.size} selected
                  </span>
                </div>

                {/* Server list */}
                <div
                  className="flex max-h-[260px] flex-col overflow-auto rounded-md"
                  style={{
                    background: "var(--oc-bg0)",
                    border: "1px solid var(--oc-border)",
                  }}
                >
                  {servers.map((s, i) => {
                    const on = selected.has(s.id);
                    const isOffline = s.status === "offline";
                    const envColor =
                      s.environment === "production"
                        ? { bg: "rgba(124,156,255,0.12)", fg: "var(--oc-accent)", bd: "var(--oc-accent-ring)" }
                        : s.environment === "staging"
                          ? { bg: "rgba(251,191,36,0.15)", fg: "var(--oc-yellow)", bd: "rgba(251,191,36,0.35)" }
                          : { bg: "var(--oc-bg2)", fg: "var(--oc-text-muted)", bd: "var(--oc-border)" };
                    const statusColor =
                      s.status === "healthy"
                        ? { bg: "rgba(74,222,128,0.15)", fg: "var(--oc-green)", bd: "rgba(74,222,128,0.35)" }
                        : s.status === "degraded"
                          ? { bg: "rgba(251,191,36,0.15)", fg: "var(--oc-yellow)", bd: "rgba(251,191,36,0.35)" }
                          : { bg: "rgba(248,113,113,0.15)", fg: "var(--oc-red)", bd: "rgba(248,113,113,0.35)" };

                    return (
                      <label
                        key={s.id}
                        className="grid items-center gap-2.5 px-3 py-2"
                        style={{
                          gridTemplateColumns: "20px 1.4fr 90px 80px 1fr",
                          borderBottom:
                            i === servers.length - 1
                              ? "none"
                              : "1px solid var(--oc-border)",
                          cursor: isOffline ? "not-allowed" : "pointer",
                          opacity: isOffline ? 0.5 : 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={isOffline}
                          onChange={() => toggleServer(s.id)}
                          style={{ accentColor: "var(--oc-accent)" }}
                        />
                        <span
                          className="text-[12px]"
                          style={{
                            color: "var(--color-foreground)",
                            fontFamily: "var(--oc-mono)",
                          }}
                        >
                          {s.name}
                        </span>
                        <span
                          className="inline-flex w-fit items-center rounded px-[5px] py-px text-[10px] font-medium"
                          style={{
                            background: envColor.bg,
                            color: envColor.fg,
                            border: `1px solid ${envColor.bd}`,
                          }}
                        >
                          {s.environment}
                        </span>
                        <span
                          className="inline-flex w-fit items-center rounded px-[5px] py-px text-[10px] font-medium"
                          style={{
                            background: statusColor.bg,
                            color: statusColor.fg,
                            border: `1px solid ${statusColor.bd}`,
                          }}
                        >
                          {s.status}
                        </span>
                        <span
                          className="text-[11px]"
                          style={{
                            color: "var(--oc-text-muted)",
                            fontFamily: "var(--oc-mono)",
                          }}
                        >
                          {s.version ? `v${s.version}` : "\u2014"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ---- Executing / Done ---- */}
          {(phase === "executing" || phase === "done") && (
            <div className="flex flex-col gap-3 p-4">
              {phase === "done" && (
                <div
                  className="flex items-center gap-2 rounded-md p-3"
                  style={{
                    background:
                      successCount === results.length
                        ? "rgba(74,222,128,0.08)"
                        : "rgba(251,191,36,0.08)",
                    border: `1px solid ${
                      successCount === results.length
                        ? "rgba(74,222,128,0.3)"
                        : "rgba(251,191,36,0.3)"
                    }`,
                  }}
                >
                  <Check
                    className="h-4 w-4"
                    style={{
                      color:
                        successCount === results.length
                          ? "var(--oc-green)"
                          : "var(--oc-yellow)",
                    }}
                  />
                  <span
                    className="text-[12.5px] font-medium"
                    style={{ color: "var(--color-foreground)" }}
                  >
                    {successCount}/{results.length} succeeded
                  </span>
                </div>
              )}

              <div
                className="flex flex-col rounded-md"
                style={{
                  background: "var(--oc-bg0)",
                  border: "1px solid var(--oc-border)",
                }}
              >
                {results.map((r, i) => {
                  const server = servers.find((s) => s.id === r.serverId);
                  return (
                    <div
                      key={r.serverId}
                      className="flex items-center gap-3 px-3 py-2.5"
                      style={{
                        borderBottom:
                          i === results.length - 1
                            ? "none"
                            : "1px solid var(--oc-border)",
                      }}
                    >
                      {/* Status icon */}
                      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                        {r.status === "pending" && (
                          <div
                            className="h-2 w-2 rounded-full"
                            style={{ background: "var(--oc-text-muted)" }}
                          />
                        )}
                        {r.status === "running" && (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            style={{ color: "var(--oc-accent)" }}
                          />
                        )}
                        {r.status === "success" && (
                          <Check
                            className="h-3.5 w-3.5"
                            style={{ color: "var(--oc-green)" }}
                          />
                        )}
                        {r.status === "error" && (
                          <X
                            className="h-3.5 w-3.5"
                            style={{ color: "var(--oc-red)" }}
                          />
                        )}
                      </div>

                      {/* Server name */}
                      <span
                        className="flex-1 text-[12px]"
                        style={{
                          color: "var(--color-foreground)",
                          fontFamily: "var(--oc-mono)",
                        }}
                      >
                        {server?.name ?? r.serverId}
                      </span>

                      {/* Status text */}
                      <span
                        className="text-[11px]"
                        style={{
                          color:
                            r.status === "success"
                              ? "var(--oc-green)"
                              : r.status === "error"
                                ? "var(--oc-red)"
                                : "var(--oc-text-muted)",
                          fontFamily: "var(--oc-mono)",
                        }}
                      >
                        {r.status === "running" && "running..."}
                        {r.status === "success" &&
                          `done${r.elapsed ? ` (${r.elapsed}s)` : ""}`}
                        {r.status === "error" &&
                          (r.message ?? "failed")}
                        {r.status === "pending" && "waiting"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-2 border-t px-[18px] py-3"
          style={{
            background: "var(--oc-bg0)",
            borderColor: "var(--oc-border)",
          }}
        >
          <div className="flex-1" />
          <button
            onClick={() => onOpenChange(false)}
            className="inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium"
            style={{
              background: "transparent",
              color: "var(--color-foreground)",
              border: "1px solid var(--oc-border)",
              fontFamily: "inherit",
            }}
          >
            {phase === "done" ? "Close" : "Cancel"}
          </button>
          {phase === "targets" && (
            <>
              <button
                onClick={() => {
                  setChosen(null);
                  setPhase("menu");
                }}
                className="inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] px-2.5 text-xs font-medium"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--color-foreground)",
                  border: "1px solid var(--oc-border)",
                  fontFamily: "inherit",
                }}
              >
                Back
              </button>
              <button
                onClick={executeCommand}
                disabled={selected.size === 0}
                className="inline-flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[5px] px-3 text-xs font-medium"
                style={{
                  background:
                    selected.size === 0
                      ? "var(--oc-bg2)"
                      : "var(--oc-accent)",
                  color:
                    selected.size === 0
                      ? "var(--oc-text-muted)"
                      : "var(--oc-bg0)",
                  border: `1px solid ${
                    selected.size === 0
                      ? "var(--oc-border)"
                      : "var(--oc-accent)"
                  }`,
                  fontFamily: "inherit",
                  cursor: selected.size === 0 ? "not-allowed" : "pointer",
                }}
              >
                <Zap className="h-3.5 w-3.5" />
                Run on {selected.size} gateway
                {selected.size === 1 ? "" : "s"}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
