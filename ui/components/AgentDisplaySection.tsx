"use client";

import React from "react";

export interface AgentDisplaySectionProps {
  display:
    | {
        toolProgress?: string;
        streaming?: boolean;
        toolPreviewLength?: number;
        showReasoning?: boolean;
        cleanupProgress?: boolean;
        subagentTools?: "parent" | "all" | "indented";
        toolEmojis?: Record<string, string>;
      }
    | undefined;
  safetyProfile: "public" | "trusted" | "private" | "chat_like_openclaw" | undefined;
  onChange: (display: AgentDisplaySectionProps["display"]) => void;
}

// Unique ID counter for label/input association
let _idCounter = 0;
function uid(prefix: string) {
  return `${prefix}-${++_idCounter}`;
}

/** Minimal semantic field wrapper with proper htmlFor linkage for accessibility. */
function FieldRow({
  label,
  fieldId,
  tooltip,
  children,
}: {
  label: string;
  fieldId: string;
  tooltip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label
        htmlFor={fieldId}
        className="flex items-center text-[11px] font-medium uppercase tracking-[0.4px]"
        style={{ color: "var(--oc-text-muted)" }}
        title={tooltip}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

export function AgentDisplaySection({
  display,
  safetyProfile,
  onChange,
}: AgentDisplaySectionProps): React.ReactElement {
  // Stable IDs for accessibility — created once per component instance.
  const ids = React.useRef({
    toolProgress: uid("tool-progress"),
    toolPreviewLength: uid("tool-preview-length"),
    cleanupProgress: uid("cleanup-progress"),
    subagentTools: uid("subagent-tools"),
    streaming: uid("streaming"),
  });

  const selectClass =
    "h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs";
  const selectStyle = {
    background: "var(--oc-bg3)",
    borderColor: "var(--oc-border)",
    color: "var(--color-foreground)",
  };
  const inputStyle = {
    background: "var(--oc-bg3)",
    borderColor: "var(--oc-border)",
    color: "var(--color-foreground)",
    fontFamily: "var(--oc-mono)",
  };

  return (
    <>
      {/* Tool progress */}
      <FieldRow
        label="Tool progress"
        fieldId={ids.current.toolProgress}
        tooltip="Whether to show tool call activity to users. Auto picks based on the agent's safety profile: public → off, anything else → new."
      >
        <select
          id={ids.current.toolProgress}
          value={display?.toolProgress ?? "auto"}
          onChange={(e) =>
            onChange({
              ...display,
              toolProgress:
                e.target.value === "auto" ? undefined : e.target.value,
            })
          }
          className={selectClass}
          style={selectStyle}
        >
          <option value="auto">auto (safety-profile default)</option>
          <option value="all">all — show every tool call</option>
          <option value="new">new — only new tool types</option>
          <option value="off">off — hide tool calls</option>
        </select>
        {!display?.toolProgress && (
          <p className="mt-1 text-[10px]" style={{ color: "var(--oc-text-dim)" }}>
            Resolved: <b>{safetyProfile === "public" ? "off" : "new"}</b>
            {" — "}safety_profile={safetyProfile ?? "<unset>"}
          </p>
        )}
      </FieldRow>

      {/* Tool preview length */}
      <FieldRow
        label="Tool preview length"
        fieldId={ids.current.toolPreviewLength}
        tooltip="Max characters of a tool's primary argument shown in the bubble. 0 disables previews (just the tool name)."
      >
        <input
          id={ids.current.toolPreviewLength}
          type="number"
          min={0}
          max={200}
          value={display?.toolPreviewLength ?? ""}
          placeholder="40"
          onChange={(e) =>
            onChange({
              ...display,
              toolPreviewLength:
                e.target.value === "" ? undefined : Number(e.target.value),
            })
          }
          className="h-8 w-full rounded-[5px] border px-2 text-xs outline-none"
          style={inputStyle}
        />
      </FieldRow>

      {/* Cleanup progress */}
      <FieldRow
        label="Cleanup progress"
        fieldId={ids.current.cleanupProgress}
        tooltip="When ON, the tool-progress bubble is deleted after a successful response. Failures leave it as a breadcrumb."
      >
        <select
          id={ids.current.cleanupProgress}
          value={display?.cleanupProgress ? "true" : "false"}
          onChange={(e) =>
            onChange({
              ...display,
              cleanupProgress: e.target.value === "true",
            })
          }
          className={selectClass}
          style={selectStyle}
        >
          <option value="false">off — leave breadcrumb in chat</option>
          <option value="true">on — delete bubble after success</option>
        </select>
      </FieldRow>

      {/* Subagent tools */}
      <FieldRow
        label="Subagent tools"
        fieldId={ids.current.subagentTools}
        tooltip="How to render tool calls made by subagents (via Task). Parent shows only the Task line; All shows every internal call; Indented shows internals with a two-space prefix."
      >
        <select
          id={ids.current.subagentTools}
          value={display?.subagentTools ?? "parent"}
          onChange={(e) =>
            onChange({
              ...display,
              subagentTools: e.target.value as "parent" | "all" | "indented",
            })
          }
          className={selectClass}
          style={selectStyle}
        >
          <option value="parent">parent — Task line only</option>
          <option value="all">all — full internals</option>
          <option value="indented">indented — internals with prefix</option>
        </select>
      </FieldRow>

      {/* Streaming */}
      <FieldRow
        label="Streaming"
        fieldId={ids.current.streaming}
        tooltip="Stream output — text appears as it's generated, not all at once. Works in Telegram via message editing."
      >
        <select
          id={ids.current.streaming}
          value={
            display?.streaming === true
              ? "true"
              : display?.streaming === false
                ? "false"
                : "auto"
          }
          onChange={(e) =>
            onChange({
              ...display,
              streaming:
                e.target.value === "auto"
                  ? undefined
                  : e.target.value === "true",
            })
          }
          className={selectClass}
          style={selectStyle}
        >
          <option value="auto">auto (platform default)</option>
          <option value="true">enabled</option>
          <option value="false">disabled</option>
        </select>
      </FieldRow>
    </>
  );
}
