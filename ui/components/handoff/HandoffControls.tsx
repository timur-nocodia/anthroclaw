"use client";

import type { ReactNode } from "react";
import { AlertCircle, HelpCircle } from "lucide-react";

export function HandoffTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex cursor-help">
      <HelpCircle className="h-3 w-3" style={{ color: "var(--oc-text-muted)", opacity: 0.68 }} />
      <span
        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden w-max max-w-[280px] -translate-x-1/2 rounded-md px-2.5 py-1.5 text-[11px] font-normal leading-[1.45] group-hover:block"
        style={{
          zIndex: 30,
          background: "var(--oc-bg3)",
          border: "1px solid var(--oc-border)",
          color: "var(--color-foreground)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        {text}
      </span>
    </span>
  );
}

export function HandoffIntro({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 max-w-[78ch] text-[12px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
      {children}
    </p>
  );
}

export function HandoffField({
  label,
  hint,
  tooltip,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  tooltip?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.4px]"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {label}
        {tooltip && <HandoffTip text={tooltip} />}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function HandoffToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  tooltip,
  ariaLabel,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  tooltip?: string;
  ariaLabel?: string;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-[52px] cursor-pointer items-start gap-2.5 rounded-[5px] border px-2.5 py-2 text-xs"
      style={{
        background: "var(--oc-bg2)",
        borderColor: checked ? "rgba(129, 149, 246, 0.55)" : "var(--oc-border)",
        color: "var(--color-foreground)",
      }}
    >
      <input
        id={id}
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer"
        style={{ accentColor: "var(--oc-accent)" }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-medium">
          {label}
          {tooltip && <HandoffTip text={tooltip} />}
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed" style={{ color: "var(--oc-text-muted)" }}>
          {description}
        </span>
      </span>
      <span
        className="mt-0.5 rounded-[4px] border px-1.5 py-0.5 text-[10.5px] font-medium"
        style={{
          borderColor: checked ? "rgba(129, 149, 246, 0.45)" : "var(--oc-border)",
          color: checked ? "var(--oc-accent)" : "var(--oc-text-muted)",
          background: checked ? "rgba(129, 149, 246, 0.10)" : "var(--oc-bg3)",
        }}
      >
        {checked ? "Enabled" : "Disabled"}
      </span>
    </label>
  );
}

export function HandoffError({ message }: { message: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-[5px] border px-2.5 py-2 text-[12px]"
      style={{ borderColor: "rgba(248,113,113,0.35)", background: "rgba(248,113,113,0.08)", color: "var(--oc-danger)" }}
    >
      <AlertCircle className="h-3.5 w-3.5" />
      {message}
    </div>
  );
}

export function HandoffEmpty({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-[5px] border px-3 py-2 text-[12px]"
      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)", color: "var(--oc-text-muted)" }}
    >
      {children}
    </div>
  );
}

export function HandoffActions({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      {children}
    </div>
  );
}
