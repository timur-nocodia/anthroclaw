"use client";

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Cpu } from "lucide-react";
import type { RuntimeModelOption } from "@/lib/runtime-models";

export interface RuntimeProviderOption {
  id: string;
  label: string;
  configured: boolean;
  availableModelCount: number;
}

interface RuntimeModelPickerProps {
  providers: RuntimeProviderOption[];
  models: RuntimeModelOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  showProviderStatus?: boolean;
  onConfigureProvider?: (provider: string) => void;
}

export function RuntimeModelPicker({
  providers,
  models,
  value,
  onChange,
  label = "Model",
  disabled,
  showProviderStatus = true,
  onConfigureProvider,
}: RuntimeModelPickerProps) {
  const selectedProvider = providerFromModel(value);
  const provider = providers.find((p) => p.id === selectedProvider);
  const grouped = useMemo(() => {
    const byProvider = new Map<string, RuntimeModelOption[]>();
    for (const model of models) {
      const key = providerFromModel(model.id) || model.provider || "other";
      byProvider.set(key, [...(byProvider.get(key) ?? []), model]);
    }
    return Array.from(byProvider.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
          {label}
        </label>
        {showProviderStatus && selectedProvider && (
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-px text-[10.5px] font-medium"
            style={{
              border: "1px solid var(--oc-border)",
              color: provider?.configured ? "var(--oc-green)" : "var(--oc-yellow)",
              background: provider?.configured ? "rgba(74,222,128,0.10)" : "rgba(251,191,36,0.10)",
            }}
          >
            {provider?.configured ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {provider?.label ?? selectedProvider}
          </span>
        )}
      </div>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: "var(--oc-bg3)",
          borderColor: "var(--oc-border)",
          color: "var(--color-foreground)",
        }}
      >
        {grouped.map(([providerId, providerModels]) => (
          <optgroup key={providerId} label={providers.find((p) => p.id === providerId)?.label ?? providerId}>
            {providerModels.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label ?? model.id}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {showProviderStatus && provider && !provider.configured && (
        <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
          <span className="inline-flex items-center gap-1">
            <Cpu className="h-3 w-3" />
            Provider credentials are missing.
          </span>
          {onConfigureProvider && (
            <button
              type="button"
              onClick={() => onConfigureProvider(provider.id)}
              className="font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--oc-accent)" }}
            >
              Configure
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function providerFromModel(model: string): string {
  const slash = model.indexOf("/");
  if (slash > 0) return model.slice(0, slash);
  if (model.startsWith("claude-")) return "anthropic";
  return "";
}
