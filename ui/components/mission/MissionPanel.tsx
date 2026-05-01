"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Archive, CheckCircle2, CircleDot, Clock, Plus, RefreshCw, Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type MissionMode = "lightweight" | "lifecycle" | "operations" | "custom";
type MissionPhase = "define" | "design" | "build" | "verify" | "ship";

interface MissionResponse {
  active: boolean;
  agentId: string;
  mission?: {
    id: string;
    title: string;
    goal: string;
    mode: MissionMode;
    phase: MissionPhase;
    status: string;
    current_state: string;
    next_actions: string[];
    created_at: number;
    updated_at: number;
  };
  objectives?: Array<{ id: string; content: string; status: string; rationale?: string | null }>;
  decisions?: Array<{ id: string; decision: string; rationale: string; status: string; outcome?: string | null }>;
  recent_handoffs?: Array<{ id: string; summary: string; session_key?: string | null; nextActions?: string[]; created_at: number }>;
}

interface DraftMission {
  title: string;
  goal: string;
  mode: MissionMode;
  phase: MissionPhase;
  current_state: string;
  next_actions: string;
}

const emptyDraft: DraftMission = {
  title: "",
  goal: "",
  mode: "lightweight",
  phase: "define",
  current_state: "",
  next_actions: "",
};

export function MissionPanel({ agentId }: { agentId: string }) {
  const [state, setState] = useState<MissionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const [draft, setDraft] = useState<DraftMission>(emptyDraft);

  const endpoint = useMemo(
    () => `/api/agents/${encodeURIComponent(agentId)}/mission`,
    [agentId],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`mission ${res.status}`);
      setState((await res.json()) as MissionResponse);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load mission state");
      setState({ active: false, agentId });
    } finally {
      setLoading(false);
    }
  }, [agentId, endpoint]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createMission = useCallback(async () => {
    if (!draft.title.trim() || !draft.goal.trim()) {
      toast.error("Mission title and goal are required");
      return;
    }

    setSaving(true);
    try {
      const nextActions = draft.next_actions
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title.trim(),
          goal: draft.goal.trim(),
          mode: draft.mode,
          phase: draft.phase,
          current_state: draft.current_state.trim() || undefined,
          next_actions: nextActions,
        }),
      });
      if (!res.ok) throw new Error(`create mission ${res.status}`);
      setState((await res.json()) as MissionResponse);
      setDraft(emptyDraft);
      toast.success("Mission created");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create mission");
    } finally {
      setSaving(false);
    }
  }, [draft, endpoint]);

  const archiveMission = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: archiveReason.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`archive mission ${res.status}`);
      setState((await res.json()) as MissionResponse);
      setArchiveReason("");
      await refresh();
      toast.success("Mission archived");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to archive mission");
    } finally {
      setSaving(false);
    }
  }, [archiveReason, endpoint, refresh]);

  return (
    <div className="p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium" style={{ color: "var(--color-foreground)" }}>
            Mission State
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: "var(--oc-text-muted)" }}>
            Durable working state for long-running agent responsibilities.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} data-testid="mission-refresh">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="rounded-lg border p-5 text-sm" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)", color: "var(--oc-text-muted)" }}>
          Loading mission state...
        </div>
      ) : state?.active && state.mission ? (
        <ActiveMission
          state={state}
          archiveReason={archiveReason}
          setArchiveReason={setArchiveReason}
          archiveMission={archiveMission}
          saving={saving}
        />
      ) : (
        <CreateMission draft={draft} setDraft={setDraft} createMission={createMission} saving={saving} />
      )}
    </div>
  );
}

function ActiveMission({
  state,
  archiveReason,
  setArchiveReason,
  archiveMission,
  saving,
}: {
  state: MissionResponse;
  archiveReason: string;
  setArchiveReason: (value: string) => void;
  archiveMission: () => void;
  saving: boolean;
}) {
  const mission = state.mission!;
  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-4" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold" style={{ color: "var(--color-foreground)" }}>
                {mission.title}
              </h3>
              <Pill>{mission.phase}</Pill>
              <Pill>{mission.mode}</Pill>
            </div>
            <p className="mt-1 max-w-3xl text-xs" style={{ color: "var(--oc-text-muted)" }}>
              {mission.goal}
            </p>
          </div>
          <Pill>
            <CircleDot className="h-3 w-3" />
            {mission.status}
          </Pill>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <InfoBlock title="Current State" value={mission.current_state || "not set"} />
          <InfoList title="Next Actions" items={mission.next_actions} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <InfoList
          title="Objectives"
          items={(state.objectives ?? []).slice(0, 8).map((item) => `[${item.status}] ${item.content}`)}
          icon={<Target className="h-3.5 w-3.5" />}
        />
        <InfoList
          title="Decisions"
          items={(state.decisions ?? []).slice(0, 8).map((item) => `[${item.status}] ${item.decision}`)}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        />
        <InfoList
          title="Handoffs"
          items={(state.recent_handoffs ?? []).slice(0, 5).map((item) => item.summary)}
          icon={<Clock className="h-3.5 w-3.5" />}
        />
      </div>

      <section className="rounded-lg border p-4" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs" style={{ color: "var(--oc-text-muted)" }}>
              Archive reason
            </label>
            <Input
              value={archiveReason}
              onChange={(event) => setArchiveReason(event.target.value)}
              placeholder="Shipped, superseded, or no longer needed"
              data-testid="mission-archive-reason"
            />
          </div>
          <Button variant="outline" onClick={archiveMission} disabled={saving} data-testid="mission-archive">
            <Archive className="h-3.5 w-3.5" />
            Archive
          </Button>
        </div>
      </section>
    </div>
  );
}

function CreateMission({
  draft,
  setDraft,
  createMission,
  saving,
}: {
  draft: DraftMission;
  setDraft: (draft: DraftMission) => void;
  createMission: () => void;
  saving: boolean;
}) {
  return (
    <section className="rounded-lg border p-4" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
      <div className="mb-4">
        <h3 className="text-sm font-medium" style={{ color: "var(--color-foreground)" }}>
          Create Mission
        </h3>
        <p className="mt-0.5 text-xs" style={{ color: "var(--oc-text-muted)" }}>
          Start a scoped state layer for this agent. This does not enable the plugin by itself.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Title">
          <Input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            placeholder="Release Mission State"
            data-testid="mission-title"
          />
        </Field>
        <Field label="Goal">
          <Input
            value={draft.goal}
            onChange={(event) => setDraft({ ...draft, goal: event.target.value })}
            placeholder="Keep long-running work scoped"
            data-testid="mission-goal"
          />
        </Field>
        <Field label="Mode">
          <Select value={draft.mode} onValueChange={(mode: MissionMode) => setDraft({ ...draft, mode })}>
            <SelectTrigger data-testid="mission-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["lightweight", "lifecycle", "operations", "custom"] as MissionMode[]).map((mode) => (
                <SelectItem key={mode} value={mode}>{mode}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Phase">
          <Select value={draft.phase} onValueChange={(phase: MissionPhase) => setDraft({ ...draft, phase })}>
            <SelectTrigger data-testid="mission-phase">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["define", "design", "build", "verify", "ship"] as MissionPhase[]).map((phase) => (
                <SelectItem key={phase} value={phase}>{phase}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Field label="Current state">
          <Textarea
            value={draft.current_state}
            onChange={(event) => setDraft({ ...draft, current_state: event.target.value })}
            placeholder="Research complete, implementation started"
            data-testid="mission-current-state"
          />
        </Field>
        <Field label="Next actions">
          <Textarea
            value={draft.next_actions}
            onChange={(event) => setDraft({ ...draft, next_actions: event.target.value })}
            placeholder={"One action per line"}
            data-testid="mission-next-actions"
          />
        </Field>
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={createMission} disabled={saving} data-testid="mission-create">
          <Plus className="h-3.5 w-3.5" />
          {saving ? "Creating..." : "Create Mission"}
        </Button>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs" style={{ color: "var(--oc-text-muted)" }}>{label}</span>
      {children}
    </label>
  );
}

function InfoBlock({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs" style={{ color: "var(--oc-text-muted)" }}>{title}</div>
      <p className="whitespace-pre-wrap text-sm" style={{ color: "var(--color-foreground)" }}>{value}</p>
    </div>
  );
}

function InfoList({ title, items, icon }: { title: string; items: string[]; icon?: ReactNode }) {
  return (
    <section className="rounded-lg border p-4" style={{ background: "var(--oc-bg1)", borderColor: "var(--oc-border)" }}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--color-foreground)" }}>
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--oc-text-muted)" }}>none</p>
      ) : (
        <ul className="space-y-1.5 text-xs" style={{ color: "var(--oc-text-muted)" }}>
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="break-words">- {item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[10.5px] font-medium"
      style={{
        background: "var(--oc-bg2)",
        border: "1px solid var(--oc-border)",
        color: "var(--oc-text-muted)",
      }}
    >
      {children}
    </span>
  );
}
