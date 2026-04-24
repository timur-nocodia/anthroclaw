"use client";

/* ------------------------------------------------------------------ */
/*  Shared form primitives for the deploy wizard                       */
/* ------------------------------------------------------------------ */

import type { ReactNode } from "react";

/* ---- Field wrapper ---- */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-[5px]">
      <span
        className="text-[11.5px] font-medium"
        style={{ color: "var(--oc-text-dim)" }}
      >
        {label}
      </span>
      {children}
      {hint && (
        <span
          className="text-[11px] leading-relaxed"
          style={{ color: "var(--oc-text-muted)" }}
        >
          {hint}
        </span>
      )}
    </div>
  );
}

/* ---- Text input ---- */

export function WizardInput({
  value,
  onChange,
  placeholder,
  mono,
  type = "text",
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-[5px] px-2.5 py-2 text-[12.5px] outline-none"
      style={{
        background: "var(--oc-bg0)",
        border: "1px solid var(--oc-border)",
        color: "var(--color-foreground)",
        fontFamily: mono ? "var(--oc-mono)" : "inherit",
      }}
    />
  );
}

/* ---- Segmented control ---- */

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-px rounded-[5px] p-0.5"
      style={{
        background: "var(--oc-bg2)",
        border: "1px solid var(--oc-border)",
      }}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className="inline-flex h-7 cursor-pointer items-center rounded px-3 text-[11.5px] font-medium"
            style={{
              background: active ? "#232a3b" : "transparent",
              color: active
                ? "var(--color-foreground)"
                : "var(--oc-text-dim)",
              border: "none",
              fontFamily: "inherit",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---- Toggle switch ---- */

export function ToggleSwitch({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-2.5 rounded-[5px] px-3 py-2.5"
      style={{
        background: "var(--oc-bg0)",
        border: "1px solid var(--oc-border)",
      }}
    >
      <div
        onClick={(e) => {
          e.preventDefault();
          onChange(!value);
        }}
        className="relative mt-0.5 shrink-0"
        style={{
          width: 30,
          height: 18,
          borderRadius: 9,
          background: value ? "var(--oc-accent)" : "var(--oc-bg3, #2a2f3d)",
          transition: "background 0.15s",
          cursor: "pointer",
        }}
      >
        <div
          className="absolute rounded-full"
          style={{
            top: 2,
            left: value ? 14 : 2,
            width: 14,
            height: 14,
            background: "#0a0d10",
            transition: "left 0.15s",
          }}
        />
      </div>
      <div className="flex flex-col gap-0.5">
        <span
          className="text-[12.5px] font-medium"
          style={{ color: "var(--color-foreground)" }}
        >
          {label}
        </span>
        {hint && (
          <span
            className="text-[11px] leading-relaxed"
            style={{ color: "var(--oc-text-muted)" }}
          >
            {hint}
          </span>
        )}
      </div>
    </label>
  );
}

/* ---- Mode card (selectable option) ---- */

export function ModeCard({
  active,
  onClick,
  title,
  desc,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <div
      onClick={disabled ? undefined : onClick}
      className="flex flex-col gap-1.5 rounded-md p-3"
      style={{
        background: active ? "var(--oc-bg2)" : "var(--oc-bg0)",
        border: `1px solid ${active ? "var(--oc-accent)" : "var(--oc-border)"}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        className="text-[12.5px] font-semibold"
        style={{ color: "var(--color-foreground)" }}
      >
        {title}
      </span>
      <span
        className="text-[11px] leading-relaxed"
        style={{ color: "var(--oc-text-muted)" }}
      >
        {desc}
      </span>
    </div>
  );
}
