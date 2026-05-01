"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";

function Tip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex cursor-help">
      <HelpCircle className="h-3 w-3" style={{ color: "var(--oc-text-muted)", opacity: 0.6 }} />
      <span
        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded-md px-2.5 py-1.5 text-[11px] font-normal normal-case tracking-normal leading-[1.45] group-hover:block"
        style={{
          zIndex: 9999,
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

export interface SectionProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  tooltip?: string;
  action?: React.ReactNode;
  /**
   * When true, the section starts collapsed and displays a chevron toggle.
   * Operators click the header to expand/collapse. Once toggled, state is
   * remembered for the lifetime of the mount.
   *
   * Sections without this prop render as before (always-expanded, no chevron).
   */
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}

export function Section({
  title,
  subtitle,
  icon,
  tooltip,
  action,
  defaultCollapsed,
  children,
}: SectionProps) {
  const collapsible = defaultCollapsed !== undefined;
  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed ?? false);

  const toggle = () => {
    if (collapsible) setCollapsed((c) => !c);
  };

  return (
    <section
      role="region"
      aria-label={title}
      className="rounded-md"
      style={{ background: "var(--oc-bg1)", border: "1px solid var(--oc-border)" }}
    >
      <div
        className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5"
        style={{ borderBottom: collapsed ? "none" : "1px solid var(--oc-border)" }}
      >
        <div
          className={`flex min-w-0 flex-wrap items-center gap-2 ${collapsible ? "cursor-pointer" : ""}`}
          onClick={collapsible ? toggle : undefined}
          onKeyDown={
            collapsible
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }
              : undefined
          }
          role={collapsible ? "button" : undefined}
          tabIndex={collapsible ? 0 : undefined}
          aria-expanded={collapsible ? !collapsed : undefined}
        >
          {collapsible && (
            collapsed ? (
              <ChevronRight className="h-3.5 w-3.5" style={{ color: "var(--oc-text-muted)" }} />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" style={{ color: "var(--oc-text-muted)" }} />
            )
          )}
          {icon}
          <span className="text-[13px] font-semibold" style={{ color: "var(--color-foreground)" }}>
            {title}
          </span>
          {tooltip && <Tip text={tooltip} />}
          {subtitle && (
            <span className="text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
              &middot; {subtitle}
            </span>
          )}
        </div>
        {action}
      </div>
      {!collapsed && <div className="p-3.5">{children}</div>}
    </section>
  );
}
