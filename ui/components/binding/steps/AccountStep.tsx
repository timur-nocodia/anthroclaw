"use client";

export interface AccountOption {
  id: string;
  username?: string;
}

export interface AccountStepProps {
  channel: "telegram" | "whatsapp";
  selected?: string;
  options: AccountOption[];
  onSelect: (accountId: string) => void;
}

function formatLabel(opt: AccountOption): string {
  if (opt.username) return `${opt.username} (${opt.id})`;
  return opt.id;
}

export function AccountStep({
  channel,
  selected,
  options,
  onSelect,
}: AccountStepProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="binding-step-account">
      <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
        Which {channel} account should this binding use?
      </p>
      <select
        data-testid="binding-account-select"
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs"
        style={{
          background: "var(--oc-bg3)",
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
        }}
      >
        <option value="" disabled>
          Select an account…
        </option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {formatLabel(opt)}
          </option>
        ))}
      </select>
      {options.length === 0 && (
        <p
          className="text-[12px]"
          style={{ color: "var(--oc-text-muted)" }}
          data-testid="binding-account-empty"
        >
          No {channel} accounts configured. Add one in config.yml first.
        </p>
      )}
    </div>
  );
}
