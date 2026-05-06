"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export type LearningDecisionKind = "learning_memory" | "learning_skill" | "curator_action" | "tool_approval";

export interface LearningAdminApprovalRoute {
  channel: string;
  account_id?: string;
  peer_id: string;
  thread_id?: string;
}

export interface LearningAdminApprovalsConfig {
  notify: boolean;
  routes: LearningAdminApprovalRoute[];
  senders: Record<string, Record<string, string[]>>;
  notify_admin_for: LearningDecisionKind[];
}

const ADMIN_DECISION_KIND_OPTIONS: Array<{ kind: LearningDecisionKind; label: string }> = [
  { kind: "learning_skill", label: "Skill decisions" },
  { kind: "curator_action", label: "Curator actions" },
  { kind: "tool_approval", label: "Tool approvals" },
  { kind: "learning_memory", label: "Memory decisions" },
];

interface LearningAdminSenderRow {
  channel: string;
  accountId: string;
  senderIds: string[];
}

export function LearningAdminApprovalsEditor({
  value,
  onChange,
}: {
  value: LearningAdminApprovalsConfig;
  onChange: (value: LearningAdminApprovalsConfig) => void;
}) {
  const senderRows = adminSenderRowsFromMap(value.senders);

  const updateRoute = (index: number, patch: Partial<LearningAdminApprovalRoute>) => {
    const routes = value.routes.map((route, routeIndex) => (
      routeIndex === index ? compactApprovalRoute({ ...route, ...patch }) : route
    ));
    onChange({ ...value, routes });
  };

  const addRoute = () => {
    onChange({
      ...value,
      notify: true,
      routes: [...value.routes, { channel: "telegram", account_id: "main", peer_id: "" }],
    });
  };

  const removeRoute = (index: number) => {
    onChange({ ...value, routes: value.routes.filter((_, routeIndex) => routeIndex !== index) });
  };

  const updateSenderRow = (index: number, patch: Partial<LearningAdminSenderRow>) => {
    const rows = senderRows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    ));
    onChange({ ...value, senders: adminSenderMapFromRows(rows) });
  };

  const addSenderRow = () => {
    const accountId = senderRows.some((row) => row.channel === "telegram" && row.accountId === "main")
      ? `main-${senderRows.length + 1}`
      : "main";
    const nextRows = [...senderRows, { channel: "telegram", accountId, senderIds: [] }];
    onChange({ ...value, senders: adminSenderMapFromRows(nextRows) });
  };

  const removeSenderRow = (index: number) => {
    onChange({ ...value, senders: adminSenderMapFromRows(senderRows.filter((_, rowIndex) => rowIndex !== index)) });
  };

  const toggleKind = (kind: LearningDecisionKind, checked: boolean) => {
    const current = new Set(value.notify_admin_for);
    if (checked) current.add(kind);
    else current.delete(kind);
    const notify_admin_for = ADMIN_DECISION_KIND_OPTIONS
      .map((option) => option.kind)
      .filter((candidate) => current.has(candidate));
    onChange({ ...value, notify_admin_for });
  };

  return (
    <div className="mt-3.5 rounded-[6px] border p-3" style={{ background: "var(--oc-bg2)", borderColor: "var(--oc-border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>
            Admin approval delivery
          </div>
          <div className="mt-1 text-[11.5px]" style={{ color: "var(--oc-text-muted)" }}>
            Notify operator chats for admin-owned learning decisions.
          </div>
        </div>
        <label
          className="flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-[5px] border px-2.5 py-1.5 text-xs"
          style={{ background: "var(--oc-bg2)", borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}
        >
          <span>Notify admin chats</span>
          <input
            type="checkbox"
            checked={value.notify}
            onChange={(event) => onChange({ ...value, notify: event.target.checked })}
            style={{ accentColor: "var(--oc-accent)" }}
          />
        </label>
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>Routes</div>
            <Button type="button" variant="outline" size="sm" onClick={addRoute}>
              <Plus className="h-3.5 w-3.5" />
              Add route
            </Button>
          </div>
          {value.routes.length === 0 ? (
            <div className="rounded-[5px] border px-2.5 py-2 text-[11.5px]" style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-muted)" }}>
              No admin chat routes configured.
            </div>
          ) : (
            <div className="space-y-2">
              {value.routes.map((route, index) => (
                <div key={`${route.channel}:${route.account_id ?? ""}:${route.peer_id}:${index}`} className="grid gap-2 rounded-[5px] border p-2 md:grid-cols-[0.75fr_0.8fr_1fr_0.8fr_auto]" style={{ borderColor: "var(--oc-border)" }}>
                  <ApprovalTextInput label="Channel" value={route.channel} onChange={(channel) => updateRoute(index, { channel })} />
                  <ApprovalTextInput label="Account" value={route.account_id ?? ""} onChange={(account_id) => updateRoute(index, { account_id })} />
                  <ApprovalTextInput label="Peer id" value={route.peer_id} onChange={(peer_id) => updateRoute(index, { peer_id })} />
                  <ApprovalTextInput label="Thread id" value={route.thread_id ?? ""} onChange={(thread_id) => updateRoute(index, { thread_id })} />
                  <Button type="button" variant="outline" size="sm" onClick={() => removeRoute(index)} aria-label="Remove route">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.4px]" style={{ color: "var(--oc-text-muted)" }}>Allowed senders</div>
            <Button type="button" variant="outline" size="sm" onClick={addSenderRow}>
              <Plus className="h-3.5 w-3.5" />
              Add sender
            </Button>
          </div>
          {senderRows.length === 0 ? (
            <div className="rounded-[5px] border px-2.5 py-2 text-[11.5px]" style={{ borderColor: "var(--oc-border)", color: "var(--oc-text-muted)" }}>
              No admin sender allowlist configured.
            </div>
          ) : (
            <div className="space-y-2">
              {senderRows.map((row, index) => (
                <div key={`${row.channel}:${row.accountId}:${index}`} className="grid gap-2 rounded-[5px] border p-2 md:grid-cols-[0.75fr_0.8fr_1fr_auto]" style={{ borderColor: "var(--oc-border)" }}>
                  <ApprovalTextInput label="Sender channel" value={row.channel} onChange={(channel) => updateSenderRow(index, { channel })} />
                  <ApprovalTextInput label="Sender account" value={row.accountId} onChange={(accountId) => updateSenderRow(index, { accountId })} />
                  <ApprovalTextInput label="Sender ids" value={row.senderIds.join(", ")} onChange={(raw) => updateSenderRow(index, { senderIds: csvToArray(raw) })} />
                  <Button type="button" variant="outline" size="sm" onClick={() => removeSenderRow(index)} aria-label="Remove sender">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {ADMIN_DECISION_KIND_OPTIONS.map((option) => (
          <label key={option.kind} className="inline-flex items-center gap-1.5 rounded-[5px] border px-2 py-1.5 text-[11.5px]" style={{ borderColor: "var(--oc-border)", color: "var(--color-foreground)" }}>
            <input
              type="checkbox"
              checked={value.notify_admin_for.includes(option.kind)}
              onChange={(event) => toggleKind(option.kind, event.target.checked)}
              style={{ accentColor: "var(--oc-accent)" }}
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}

function ApprovalTextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[10.5px]" style={{ color: "var(--oc-text-muted)" }}>
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 min-w-0 rounded-[5px] border px-2 text-xs outline-none"
        style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)", color: "var(--color-foreground)", fontFamily: "var(--oc-mono)" }}
      />
    </label>
  );
}

function compactApprovalRoute(route: LearningAdminApprovalRoute): LearningAdminApprovalRoute {
  return {
    channel: route.channel.trim(),
    account_id: route.account_id?.trim() || undefined,
    peer_id: route.peer_id.trim(),
    thread_id: route.thread_id?.trim() || undefined,
  };
}

function adminSenderRowsFromMap(senders: Record<string, Record<string, string[]>>): LearningAdminSenderRow[] {
  return Object.entries(senders).flatMap(([channel, accounts]) => (
    Object.entries(accounts).map(([accountId, senderIds]) => ({ channel, accountId, senderIds }))
  ));
}

function adminSenderMapFromRows(rows: LearningAdminSenderRow[]): Record<string, Record<string, string[]>> {
  const next: Record<string, Record<string, string[]>> = {};
  for (const row of rows) {
    const channel = row.channel.trim();
    const accountId = row.accountId.trim();
    const senderIds = row.senderIds.map((sender) => sender.trim()).filter(Boolean);
    if (!channel || !accountId) continue;
    next[channel] ??= {};
    next[channel][accountId] = senderIds;
  }
  return next;
}

function csvToArray(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}
