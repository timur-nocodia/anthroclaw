"use client";

export type BehaviorChoice = "mention_only" | "all" | "incoming_reply_only";

export interface BehaviorStepProps {
  selected?: BehaviorChoice;
  onSelect: (choice: BehaviorChoice) => void;
}

interface BehaviorOption {
  id: BehaviorChoice;
  label: string;
  description: string;
  advanced?: boolean;
}

const OPTIONS: BehaviorOption[] = [
  {
    id: "mention_only",
    label: "Respond only to @-mentions",
    description: "Sets routes[].mention_only: true.",
  },
  {
    id: "all",
    label: "Respond to every message in this scope",
    description: "Default Telegram-style group binding.",
  },
  {
    id: "incoming_reply_only",
    label: "Respond only when someone replies to my message",
    description: "Sets reply_to_mode: incoming_reply_only.",
    advanced: true,
  },
];

export function BehaviorStep({ selected, onSelect }: BehaviorStepProps) {
  return (
    <div className="flex flex-col gap-2.5" data-testid="binding-step-behavior">
      <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
        How should the agent respond in this scope?
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
              data-testid={`binding-behavior-${opt.id}`}
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
                {opt.advanced && (
                  <span
                    className="ml-1.5 text-[11px] font-normal"
                    style={{ color: "var(--oc-text-muted)" }}
                  >
                    (advanced)
                  </span>
                )}
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
