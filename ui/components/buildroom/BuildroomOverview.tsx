"use client";

import { type ComponentType, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleStop,
  Pause,
  Play,
  Power,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { HelpHint } from "./HelpHint";
import { BuildroomSettingsPanel } from "./BuildroomSettingsPanel";

type BuildroomMode = "off" | "observe_only" | "manual_approval";

interface BuildroomCounts {
  pendingApprovals: number;
  approvedNotBuilt: number;
  activeBuilds: number;
  qaPending: number;
  trustPending?: number;
  unresolvedErrors: number;
  complete?: number;
}

interface BuildroomStatus {
  ok: true;
  initialized?: boolean;
  roomId: string;
  state: {
    roomState: string;
    mode: BuildroomMode | string;
    paused: boolean;
    killSwitchActive: boolean;
    latestTrust: string;
    counts: BuildroomCounts;
  };
  nextActions?: string[];
}

type BuildroomTab = "overview" | "settings";

export function BuildroomOverview({ serverId }: { serverId: string }) {
  const [status, setStatus] = useState<BuildroomStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<BuildroomTab>("overview");

  const loadStatus = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const next = await requestStatus("/api/buildroom/status");
      setStatus(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Buildroom status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const initialized = status ? status.initialized !== false : false;
  const counts = status?.state.counts;
  const nextAction = status?.nextActions?.[0] ?? "anthroclaw buildroom status";

  const controlState = useMemo(() => {
    if (!status) return { tone: "muted", label: "loading" };
    if (!initialized) return { tone: "yellow", label: "not initialized" };
    if (status.state.killSwitchActive) return { tone: "red", label: "hard stop" };
    if (status.state.paused) return { tone: "yellow", label: "paused" };
    if (status.state.mode === "off") return { tone: "muted", label: "disabled" };
    return { tone: "green", label: "ready" };
  }, [initialized, status]);

  async function runAction(action: string, request: () => Promise<BuildroomStatus>) {
    setActing(action);
    setError(null);
    try {
      setStatus(await request());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Buildroom action failed");
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b px-5 py-3" style={{ borderColor: "var(--oc-border)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold" style={{ color: "var(--color-foreground)" }}>
              Auto-Buildroom
            </h1>
            <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
              Approval and receipt layer for autonomous agent work.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill tone={controlState.tone} label={controlState.label} />
            <button
              type="button"
              onClick={loadStatus}
              disabled={loading || acting !== null}
              title="Reload Buildroom status from local artifacts and derived state. This does not start any stage."
              className="flex h-8 items-center gap-2 rounded-[5px] border px-2.5 text-xs transition-colors hover:bg-[var(--oc-bg2)] disabled:opacity-50"
              style={{ borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
          </div>
        </div>
        <div className="mt-3 flex w-fit rounded-[6px] border p-0.5" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
          <TabButton label="Overview" active={tab === "overview"} onClick={() => setTab("overview")} />
          <TabButton label="Settings" active={tab === "settings"} onClick={() => setTab("settings")} />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-5">
        {loading && !status ? (
          <Skeleton />
        ) : error ? (
          <InlineMessage tone="red" title="Buildroom status failed" text={error} />
        ) : status && tab === "settings" ? (
          <BuildroomSettingsPanel initialized={initialized} />
        ) : status ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
            <section
              className="min-w-0 rounded-md border"
              style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}
            >
              <div className="relative z-20 border-b px-3 py-2.5" style={{ borderColor: "var(--oc-border)" }}>
                <div className="flex items-center justify-between gap-3">
                  <SectionTitle
                    label="Overview"
                    hint="Buildroom is not another chat agent. It is the control surface that turns agent suggestions into scoped proposals, approvals, receipts, QA evidence, and trust reports."
                  />
                  <span className="text-[11px]" style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}>
                    {serverId}
                  </span>
                </div>
              </div>

              {!initialized ? (
                <div className="p-4">
                  <BuildroomPrimer />
                  <InlineMessage
                    tone="yellow"
                    title="Buildroom is not initialized"
                    text="This repository does not have .anthroclaw/auto-buildroom/ yet. Initialize creates local Buildroom config and folders; it does not start a build."
                  />
                  <div className="mt-4">
                    <ActionButton
                      icon={Power}
                      label="Initialize"
                      hint="Creates project-local Buildroom config and folders under .anthroclaw/auto-buildroom/. It does not approve, build, or run agents."
                      disabled={acting !== null}
                      busy={acting === "init"}
                      onClick={() => runAction("init", () => postStatus("/api/buildroom/init", {}))}
                    />
                  </div>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: "var(--oc-border)" }}>
                  <BuildroomPrimer />
                  <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Room" value={status.roomId} hint="The project-local Buildroom identity. v0.1 stores room state under .anthroclaw/auto-buildroom/ for this repository." />
                    <Metric label="State" value={status.state.roomState} hint="The current workflow state: idle, collecting, awaiting approval, approved, building, QA pending, trust pending, complete, paused, or blocked." />
                    <Metric label="Mode" value={status.state.mode} hint="manual_approval requires explicit operator approval before any build. observe_only can collect/propose but should not build. off blocks Buildroom stages." />
                    <Metric label="Trust" value={status.state.latestTrust} hint="Trust comes from QA and verification evidence, not Builder claims. CLEAN/WATCH/INVESTIGATE/BLOCKED tell the operator what is proven." />
                  </div>
                  <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Pending approvals" value={counts?.pendingApprovals ?? 0} hint="Reviewed proposals waiting for an explicit operator approval. Approval grants authority; it does not execute the build." />
                    <Metric label="Approved not built" value={counts?.approvedNotBuilt ?? 0} hint="Approved scope that has authority but has not been consumed by a Builder run yet." />
                    <Metric label="Active builds" value={counts?.activeBuilds ?? 0} hint="Builder runs currently executing inside approved scope through the native runtime." />
                    <Metric label="QA pending" value={counts?.qaPending ?? 0} hint="Builds that produced claims and now need independent QA evidence before trust can be clean." />
                  </div>
                  <div className="grid gap-0 sm:grid-cols-2 lg:grid-cols-4">
                    <Metric label="Trust pending" value={counts?.trustPending ?? 0} hint="QA exists, but verification delta or trust report still needs to be generated." />
                    <Metric label="Errors" value={counts?.unresolvedErrors ?? 0} hint="Durable error receipts that need operator attention. Failures should leave receipts instead of disappearing." />
                    <Metric label="Paused" value={status.state.paused ? "yes" : "no"} hint="Soft pause prevents new stages from starting. It does not mean existing native runtime work was automatically cancelled." />
                    <Metric label="Kill switch" value={status.state.killSwitchActive ? "active" : "inactive"} hint="Kill switch blocks scheduled stages and new builds. Use it when you want the room to stop making progress." />
                  </div>
                </div>
              )}
            </section>

            <aside
              className="min-w-0 rounded-md border"
              style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}
            >
              <div className="relative z-20 border-b px-3 py-2.5" style={{ borderColor: "var(--oc-border)" }}>
                <SectionTitle
                  label="Controls"
                  hint="These controls change room authority. They do not approve proposals by themselves, and approval still does not automatically start a build."
                />
              </div>
              <div className="flex flex-col gap-3 p-3">
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
                    Mode
                    <HelpHint label="Mode" hint="manual_approval is the normal v0.1 mode: Buildroom may propose, but only an operator approval can grant build authority. observe_only is read/propose-only. off disables Buildroom stages." />
                  </span>
                  <select
                    aria-label="Mode"
                    value={status.state.mode}
                    disabled={!initialized || acting !== null}
                    onChange={(event) =>
                      runAction("mode", () => postStatus("/api/buildroom/mode", { mode: event.target.value }))
                    }
                    className="h-8 rounded-[5px] border bg-transparent px-2 text-xs"
                    style={{
                      borderColor: "var(--oc-border)",
                      color: "var(--color-foreground)",
                      background: "var(--oc-bg0)",
                    }}
                  >
                    <option value="manual_approval">manual_approval</option>
                    <option value="observe_only">observe_only</option>
                    <option value="off">off</option>
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  {status.state.paused ? (
                    <ActionButton
                      icon={Play}
                      label="Resume"
                      hint="Allows new Buildroom stages again after a soft pause. It does not automatically start a pending build."
                      disabled={!initialized || acting !== null}
                      busy={acting === "resume"}
                      onClick={() => runAction("resume", () => postStatus("/api/buildroom/resume", {}))}
                    />
                  ) : (
                    <ActionButton
                      icon={Pause}
                      label="Pause"
                      hint="Soft pause blocks new Buildroom stages. It does not automatically cancel an already running native runtime."
                      disabled={!initialized || acting !== null}
                      busy={acting === "pause"}
                      onClick={() => runAction("pause", () => postStatus("/api/buildroom/pause", {}))}
                    />
                  )}
                  <ActionButton
                    icon={CircleStop}
                    label={status.state.killSwitchActive ? "Kill switch off" : "Kill switch on"}
                    hint="Kill switch blocks new scheduled stages and new builds. It is the hard stop for Buildroom progress."
                    disabled={!initialized || acting !== null}
                    busy={acting === "kill-switch"}
                    danger={!status.state.killSwitchActive}
                    onClick={() =>
                      runAction("kill-switch", () =>
                        postStatus("/api/buildroom/kill-switch", { active: !status.state.killSwitchActive }))
                    }
                  />
                </div>

                <div className="rounded-[5px] border px-2.5 py-2" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
                    Next
                    <HelpHint label="Next action" hint="Suggested CLI command for the safest next explicit operator step. It is a hint, not an automatic action." />
                  </div>
                  <div className="mt-1 break-all text-xs" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
                    {nextAction}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BuildroomPrimer() {
  return (
    <div className="grid gap-3 border-b p-4" style={{ borderColor: "var(--oc-border)" }}>
      <div className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
        <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-foreground)" }}>
          What is this?
          <HelpHint
            label="Buildroom overview"
            hint="Buildroom is the approval and receipt layer around agent work. It is not a separate chat worker and it should not bypass native runtime permissions."
          />
        </div>
        <p className="mt-1.5 max-w-[920px] text-xs leading-5" style={{ color: "var(--oc-text-dim)" }}>
          Buildroom turns agent suggestions into scoped, approvable work. Agents may notice friction,
          Research may gather evidence, Main Review may lock scope, but only an explicit operator
          approval grants authority. Builder then works inside that approved box, QA checks the claims,
          and Trust tells you what is actually proven.
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <ConceptCard
          title="1. Proposal asks"
          hint="A proposal is a request for authority. It should describe scope, non-goals, risks, acceptance criteria, and blocked paths."
          text="Signals and ideas do not build anything. A reviewed proposal asks whether this work is worth granting authority."
        />
        <ConceptCard
          title="2. Approval grants"
          hint="Approval creates an approval artifact. In v0.1 it does not automatically launch Builder."
          text="Approval grants authority. Build consumes authority. This separation prevents accidental builds from a casual yes."
        />
        <ConceptCard
          title="3. Trust proves"
          hint="Builder claims are not proof. QA evidence and Verification Delta decide what the operator should believe."
          text="Runtime success is required but not sufficient. CLEAN requires QA, delta, policy checks, and no unresolved blockers."
        />
      </div>
    </div>
  );
}

function ConceptCard({ title, text, hint }: { title: string; text: string; hint: string }) {
  return (
    <div className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
      <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-foreground)" }}>
        {title}
        <HelpHint label={title} hint={hint} />
      </div>
      <p className="mt-1.5 text-xs leading-5" style={{ color: "var(--oc-text-dim)" }}>
        {text}
      </p>
    </div>
  );
}

async function requestStatus(url: string, init?: RequestInit): Promise<BuildroomStatus> {
  const res = await fetch(url, init);
  const body = await res.json() as unknown;
  if (!res.ok) {
    throw new Error(readErrorMessage(body));
  }
  return body as BuildroomStatus;
}

function postStatus(url: string, body: unknown): Promise<BuildroomStatus> {
  return requestStatus(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function readErrorMessage(body: unknown): string {
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") return message;
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Buildroom request failed";
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 rounded-[5px] px-3 text-xs transition-colors"
      style={{
        color: active ? "var(--color-foreground)" : "var(--oc-text-muted)",
        background: active ? "var(--oc-bg1)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}

function SectionTitle({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "var(--color-foreground)" }}>
      {label}
      <HelpHint label={label} hint={hint} />
    </span>
  );
}

function StatusPill({ tone, label }: { tone: string; label: string }) {
  const toneColor =
    tone === "green"
      ? "var(--oc-green)"
      : tone === "yellow"
        ? "var(--oc-yellow)"
        : tone === "red"
          ? "var(--oc-red)"
          : "var(--oc-text-muted)";
  return (
    <span
      className="inline-flex h-8 items-center gap-2 rounded-[5px] border px-2.5 text-xs"
      style={{ borderColor: "var(--oc-border)", color: toneColor, background: "var(--oc-bg1)" }}
    >
      {tone === "green" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

function InlineMessage({ tone, title, text }: { tone: "yellow" | "red"; title: string; text: string }) {
  const color = tone === "red" ? "var(--oc-red)" : "var(--oc-yellow)";
  return (
    <div className="rounded-md border p-3" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg0)" }}>
      <div className="flex items-center gap-2 text-xs font-semibold" style={{ color }}>
        <AlertTriangle className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="mt-1 text-xs" style={{ color: "var(--oc-text-dim)" }}>
        {text}
      </div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="min-w-0 border-b p-3 sm:border-r sm:last:border-r-0 lg:border-b-0" style={{ borderColor: "var(--oc-border)" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
        {label}
        <HelpHint label={label} hint={hint} />
      </div>
      <div className="mt-1 truncate text-[13px]" style={{ color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}>
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  hint,
  disabled,
  busy,
  danger,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 items-center justify-center gap-2 rounded-[5px] border px-2.5 text-xs transition-colors hover:bg-[var(--oc-bg2)] active:translate-y-px disabled:opacity-50"
      style={{
        borderColor: danger ? "rgba(248,113,113,0.45)" : "var(--oc-border)",
        color: danger ? "var(--oc-red)" : "var(--color-foreground)",
        background: "var(--oc-bg0)",
      }}
    >
      {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
      {hint ? <HelpHint label={label} hint={hint} /> : null}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="h-[230px] rounded-md border" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }} />
      <div className="h-[230px] rounded-md border" style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }} />
    </div>
  );
}
