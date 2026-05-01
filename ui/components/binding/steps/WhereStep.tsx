"use client";

import type { BindingScopeValue } from "@/components/binding/BindingWizardDialog";

export interface WhereStepProps {
  selected?: BindingScopeValue;
  onSelect: (scope: BindingScopeValue) => void;
}

interface ScopeOption {
  id: BindingScopeValue;
  label: string;
  description: string;
}

const OPTIONS: ScopeOption[] = [
  {
    id: "dm",
    label: "Direct messages",
    description: "1:1 chats between users and the agent.",
  },
  {
    id: "group",
    label: "Group chat",
    description: "Groups and supergroups (including forum topics).",
  },
  {
    id: "any",
    label: "Both DMs and groups",
    description: "Listen everywhere — DMs and group chats.",
  },
];

export function WhereStep({ selected, onSelect }: WhereStepProps) {
  return (
    <div className="flex flex-col gap-2.5" data-testid="binding-step-where">
      <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
        Where should the agent listen?
      </p>
      <div className="flex flex-col gap-1.5">
        {OPTIONS.map((opt) => {
          const isSelected = selected === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-testid={`binding-scope-${opt.id}`}
              onClick={() => onSelect(opt.id)}
              className="flex flex-col items-start gap-0.5 rounded-md p-2.5 text-left"
              style={{
                background: isSelected ? "var(--oc-bg2)" : "var(--oc-bg0)",
                border: `1px solid ${isSelected ? "var(--oc-accent)" : "var(--oc-border)"}`,
              }}
            >
              <span
                className="text-[12.5px] font-semibold"
                style={{ color: "var(--color-foreground)" }}
              >
                {opt.label}
              </span>
              <span
                className="text-[11.5px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                {opt.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
