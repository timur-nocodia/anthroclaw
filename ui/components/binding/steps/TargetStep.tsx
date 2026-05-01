"use client";

import { useMemo } from "react";
import type { BindingScopeValue } from "@/components/binding/BindingWizardDialog";

export interface TargetStepProps {
  scope: BindingScopeValue;
  channel: "telegram" | "whatsapp";

  dmMode?: "all" | "allowlist";
  dmAllowlistInput: string;
  onDmModeChange: (mode: "all" | "allowlist") => void;
  onDmAllowlistChange: (value: string) => void;

  groupChatId: string;
  groupForumEnabled: boolean;
  groupTopicsInput: string;
  onGroupChatIdChange: (value: string) => void;
  onGroupForumChange: (enabled: boolean) => void;
  onGroupTopicsChange: (value: string) => void;
}

function isLikelyTelegramSupergroup(id: string): boolean {
  return /^-100\d+$/.test(id);
}

function isLikelyTelegramGroup(id: string): boolean {
  return /^-\d+$/.test(id);
}

function looksLikeNumericList(value: string): boolean {
  const tokens = value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => /^\d+$/.test(t));
}

function DmSubFlow({
  dmMode,
  dmAllowlistInput,
  onDmModeChange,
  onDmAllowlistChange,
}: Pick<
  TargetStepProps,
  "dmMode" | "dmAllowlistInput" | "onDmModeChange" | "onDmAllowlistChange"
>) {
  return (
    <fieldset
      className="flex flex-col gap-2"
      data-testid="binding-target-dm"
    >
      <legend
        className="text-[12px] font-semibold"
        style={{ color: "var(--color-foreground)" }}
      >
        Direct messages
      </legend>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="radio"
          name="dm-mode"
          checked={dmMode === "all"}
          onChange={() => onDmModeChange("all")}
          data-testid="binding-target-dm-all"
        />
        <span
          className="text-[12px]"
          style={{ color: "var(--color-foreground)" }}
        >
          All users (open pairing)
        </span>
      </label>
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="radio"
          name="dm-mode"
          checked={dmMode === "allowlist"}
          onChange={() => onDmModeChange("allowlist")}
          data-testid="binding-target-dm-allowlist"
        />
        <span
          className="text-[12px]"
          style={{ color: "var(--color-foreground)" }}
        >
          Allowlisted users only
        </span>
      </label>
      {dmMode === "allowlist" && (
        <div className="flex flex-col gap-1 pl-5">
          <input
            type="text"
            value={dmAllowlistInput}
            onChange={(e) => onDmAllowlistChange(e.target.value)}
            placeholder="48705953, 12345678"
            data-testid="binding-target-dm-allowlist-input"
            className="h-7 w-full rounded-[5px] border px-2 text-xs"
            style={{
              background: "var(--oc-bg3)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
            }}
          />
          <span
            className="text-[11px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            Telegram user IDs are numbers like <code>48705953</code>. You can
            find them with @userinfobot.
          </span>
        </div>
      )}
    </fieldset>
  );
}

function GroupSubFlow({
  channel,
  groupChatId,
  groupForumEnabled,
  groupTopicsInput,
  onGroupChatIdChange,
  onGroupForumChange,
  onGroupTopicsChange,
}: Pick<
  TargetStepProps,
  | "channel"
  | "groupChatId"
  | "groupForumEnabled"
  | "groupTopicsInput"
  | "onGroupChatIdChange"
  | "onGroupForumChange"
  | "onGroupTopicsChange"
>) {
  const chatIdWarning = useMemo(() => {
    if (!groupChatId) return null;
    if (channel !== "telegram") return null;
    if (
      !isLikelyTelegramSupergroup(groupChatId) &&
      !isLikelyTelegramGroup(groupChatId)
    ) {
      return "This does not look like a Telegram group ID — supergroups start with -100…";
    }
    return null;
  }, [channel, groupChatId]);

  const topicsWarning = useMemo(() => {
    if (!groupForumEnabled) return null;
    if (!groupTopicsInput) return null;
    if (!looksLikeNumericList(groupTopicsInput)) {
      return "Topic IDs should be numeric (e.g. 3, 4).";
    }
    return null;
  }, [groupForumEnabled, groupTopicsInput]);

  return (
    <fieldset
      className="flex flex-col gap-2"
      data-testid="binding-target-group"
    >
      <legend
        className="text-[12px] font-semibold"
        style={{ color: "var(--color-foreground)" }}
      >
        Group chat
      </legend>
      <label className="flex flex-col gap-1">
        <span
          className="text-[12px]"
          style={{ color: "var(--color-foreground)" }}
        >
          Chat ID
        </span>
        <input
          type="text"
          value={groupChatId}
          onChange={(e) => onGroupChatIdChange(e.target.value)}
          placeholder="-1003729315809"
          data-testid="binding-target-group-chat-id"
          className="h-7 w-full rounded-[5px] border px-2 text-xs"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
          }}
        />
        <span className="text-[11px]" style={{ color: "var(--oc-text-muted)" }}>
          Group chat ID. Telegram: starts with <code>-100…</code>. From chat
          settings &rarr; &apos;Copy ID&apos;.
        </span>
        {chatIdWarning && (
          <span
            className="text-[11px]"
            style={{ color: "var(--oc-warning, #d97706)" }}
            data-testid="binding-target-group-chat-id-warning"
          >
            {chatIdWarning}
          </span>
        )}
      </label>

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={groupForumEnabled}
          onChange={(e) => onGroupForumChange(e.target.checked)}
          data-testid="binding-target-group-forum-toggle"
        />
        <span
          className="text-[12px]"
          style={{ color: "var(--color-foreground)" }}
        >
          This group has topics (forum mode)
        </span>
      </label>

      {groupForumEnabled && (
        <label className="flex flex-col gap-1 pl-5">
          <span
            className="text-[12px]"
            style={{ color: "var(--color-foreground)" }}
          >
            Topic IDs
          </span>
          <input
            type="text"
            value={groupTopicsInput}
            onChange={(e) => onGroupTopicsChange(e.target.value)}
            placeholder="3, 4"
            data-testid="binding-target-group-topics-input"
            className="h-7 w-full rounded-[5px] border px-2 text-xs"
            style={{
              background: "var(--oc-bg3)",
              borderColor: "var(--oc-border)",
              color: "var(--color-foreground)",
            }}
          />
          <span
            className="text-[11px]"
            style={{ color: "var(--oc-text-muted)" }}
          >
            Topic ID is in the topic URL or visible to operator console with
            &apos;Show config&apos;.
          </span>
          {topicsWarning && (
            <span
              className="text-[11px]"
              style={{ color: "var(--oc-warning, #d97706)" }}
              data-testid="binding-target-group-topics-warning"
            >
              {topicsWarning}
            </span>
          )}
        </label>
      )}
    </fieldset>
  );
}

export function TargetStep(props: TargetStepProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="binding-step-target">
      {(props.scope === "dm" || props.scope === "any") && (
        <DmSubFlow
          dmMode={props.dmMode}
          dmAllowlistInput={props.dmAllowlistInput}
          onDmModeChange={props.onDmModeChange}
          onDmAllowlistChange={props.onDmAllowlistChange}
        />
      )}
      {(props.scope === "group" || props.scope === "any") && (
        <GroupSubFlow
          channel={props.channel}
          groupChatId={props.groupChatId}
          groupForumEnabled={props.groupForumEnabled}
          groupTopicsInput={props.groupTopicsInput}
          onGroupChatIdChange={props.onGroupChatIdChange}
          onGroupForumChange={props.onGroupForumChange}
          onGroupTopicsChange={props.onGroupTopicsChange}
        />
      )}
    </div>
  );
}
