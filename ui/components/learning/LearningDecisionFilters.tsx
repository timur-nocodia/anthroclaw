"use client";

import type { LearningDecisionKind } from "@/components/learning/LearningAdminApprovalsEditor";
import type { LearningDecisionStatus } from "@/components/learning/LearningDecisionRow";

export type LearningDecisionFilterStatus = "all" | LearningDecisionStatus;
export type LearningDecisionFilterKind = "all" | LearningDecisionKind;
export type LearningDecisionFilterActor = "all" | "originating_user" | "admin" | "operator";

export interface LearningDecisionFilterValue {
  status: LearningDecisionFilterStatus;
  kind: LearningDecisionFilterKind;
  actor: LearningDecisionFilterActor;
}

const STATUS_OPTIONS: Array<{ value: LearningDecisionFilterStatus; label: string }> = [
  { value: "all", label: "all statuses" },
  { value: "pending", label: "pending" },
  { value: "approved", label: "approved" },
  { value: "rejected", label: "rejected" },
  { value: "edit_requested", label: "edit requested" },
  { value: "expired", label: "expired" },
  { value: "applied", label: "applied" },
  { value: "failed", label: "failed" },
];

const KIND_OPTIONS: Array<{ value: LearningDecisionFilterKind; label: string }> = [
  { value: "all", label: "all kinds" },
  { value: "learning_memory", label: "memory decision" },
  { value: "learning_skill", label: "skill decision" },
  { value: "curator_action", label: "curator action" },
  { value: "tool_approval", label: "tool approval" },
];

const ACTOR_OPTIONS: Array<{ value: LearningDecisionFilterActor; label: string }> = [
  { value: "all", label: "all actors" },
  { value: "originating_user", label: "originating user" },
  { value: "admin", label: "admin" },
  { value: "operator", label: "operator" },
];

export function LearningDecisionFilters({
  value,
  onChange,
}: {
  value: LearningDecisionFilterValue;
  onChange: (value: LearningDecisionFilterValue) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <LearningDecisionFilterSelect
        label="Decision status"
        value={value.status}
        options={STATUS_OPTIONS}
        onChange={(status) => onChange({ ...value, status })}
      />
      <LearningDecisionFilterSelect
        label="Decision kind"
        value={value.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => onChange({ ...value, kind })}
      />
      <LearningDecisionFilterSelect
        label="Decision actor"
        value={value.actor}
        options={ACTOR_OPTIONS}
        onChange={(actor) => onChange({ ...value, actor })}
      />
    </div>
  );
}

function LearningDecisionFilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1 text-[10.5px]" style={{ color: "var(--oc-text-muted)" }}>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-8 rounded-[5px] border px-2 text-xs outline-none"
        style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
