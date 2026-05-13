"use client";

/**
 * NotificationsCard — agent settings → Handoff tab → Notifications section.
 *
 * Manages the per-agent `notifications` block:
 *   - routes: name → { channel, account_id, peer_id }
 *   - subscriptions: array of { event, route, schedule?, throttle? }
 * Each route has a "Test" button that POSTs /api/notifications/test.
 *
 * Persistence mirrors HumanTakeoverCard: fetch full agent config, splice in
 * the new block, PUT it back.
 */

import { useEffect, useState, useCallback } from "react";
import { Bell, Save, Trash2, Plus, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LastModifiedIndicator } from "./LastModifiedIndicator";
import { Section } from "@/components/ui/section";
import {
  HandoffActions,
  HandoffEmpty,
  HandoffError,
  HandoffField,
  HandoffIntro,
  HandoffToggleRow,
} from "./HandoffControls";

// ── Types ────────────────────────────────────────────────────────────

const EVENTS = [
  "peer_pause_started",
  "peer_pause_ended",
  "peer_pause_intervened_during_generation",
  "peer_pause_summary_daily",
  "agent_error",
  "iteration_budget_exhausted",
  "escalation_needed",
] as const;
type EventName = (typeof EVENTS)[number];

const CHANNELS = ["telegram", "whatsapp"] as const;
type ChannelName = (typeof CHANNELS)[number];

export interface NotificationRoute {
  channel: ChannelName;
  account_id: string;
  peer_id: string;
}

export interface NotificationSubscription {
  event: EventName;
  route: string;
  schedule?: string;
  throttle?: string;
}

export interface NotificationsConfig {
  enabled: boolean;
  routes: Record<string, NotificationRoute>;
  subscriptions: NotificationSubscription[];
}

const DEFAULT_CONFIG: NotificationsConfig = {
  enabled: false,
  routes: {},
  subscriptions: [],
};

// ── Component ────────────────────────────────────────────────────────

export interface NotificationsCardProps {
  agentId: string;
  initialConfig?: Partial<NotificationsConfig>;
  onSave?: (cfg: NotificationsConfig) => Promise<void>;
}

export function NotificationsCard({
  agentId,
  initialConfig,
  onSave,
}: NotificationsCardProps) {
  const [cfg, setCfg] = useState<NotificationsConfig>(() => mergeInitial(initialConfig));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<Record<string, "idle" | "ok" | "fail">>({});

  useEffect(() => {
    setCfg(mergeInitial(initialConfig));
    setDirty(false);
  }, [initialConfig]);

  const update = useCallback((next: NotificationsConfig) => {
    setCfg(next);
    setDirty(true);
  }, []);

  const addRoute = () => {
    const baseName = "operator";
    let name = baseName;
    let i = 2;
    while (cfg.routes[name]) {
      name = `${baseName}_${i++}`;
    }
    update({
      ...cfg,
      routes: {
        ...cfg.routes,
        [name]: { channel: "telegram", account_id: "main", peer_id: "" },
      },
    });
  };

  const renameRoute = (oldName: string, newName: string) => {
    if (!newName || newName === oldName || cfg.routes[newName]) return;
    const next: Record<string, NotificationRoute> = {};
    for (const [k, v] of Object.entries(cfg.routes)) {
      next[k === oldName ? newName : k] = v;
    }
    const subs = cfg.subscriptions.map((s) =>
      s.route === oldName ? { ...s, route: newName } : s,
    );
    update({ ...cfg, routes: next, subscriptions: subs });
  };

  const updateRoute = (name: string, patch: Partial<NotificationRoute>) => {
    update({
      ...cfg,
      routes: { ...cfg.routes, [name]: { ...cfg.routes[name], ...patch } },
    });
  };

  const removeRoute = (name: string) => {
    const next = { ...cfg.routes };
    delete next[name];
    update({
      ...cfg,
      routes: next,
      subscriptions: cfg.subscriptions.filter((s) => s.route !== name),
    });
  };

  const addSubscription = () => {
    const firstRoute = Object.keys(cfg.routes)[0] ?? "";
    update({
      ...cfg,
      subscriptions: [
        ...cfg.subscriptions,
        { event: "escalation_needed", route: firstRoute },
      ],
    });
  };

  const updateSub = (idx: number, patch: Partial<NotificationSubscription>) => {
    const next = cfg.subscriptions.slice();
    next[idx] = { ...next[idx], ...patch };
    update({ ...cfg, subscriptions: next });
  };

  const removeSub = (idx: number) => {
    update({
      ...cfg,
      subscriptions: cfg.subscriptions.filter((_, i) => i !== idx),
    });
  };

  const testRoute = async (routeName: string) => {
    setTestStatus((s) => ({ ...s, [routeName]: "idle" }));
    try {
      const res = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, message: `Test from route "${routeName}"` }),
      });
      setTestStatus((s) => ({ ...s, [routeName]: res.ok ? "ok" : "fail" }));
    } catch {
      setTestStatus((s) => ({ ...s, [routeName]: "fail" }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (onSave) {
        await onSave(cfg);
      } else {
        await defaultPersist(agentId, cfg);
      }
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Notifications"
      subtitle={cfg.enabled ? "delivery enabled" : "delivery disabled"}
      icon={<Bell className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
      tooltip="Sends operator-facing messages when pause, error, budget, or escalation events happen."
      action={<LastModifiedIndicator agentId={agentId} section="notifications" />}
    >
      <HandoffIntro>
        Notifications are separate from client replies. Define a route first, then subscribe
        specific events to that route.
      </HandoffIntro>

      <div className="space-y-4">
        <HandoffToggleRow
          id="notif-enabled"
          label="Notification delivery"
          ariaLabel="Enabled"
          checked={cfg.enabled}
          onChange={(checked) => update({ ...cfg, enabled: checked })}
          description="When disabled, subscriptions stay in config but no notification messages are sent."
          tooltip="Useful while testing an agent without spamming operator chats."
        />

        {/* Routes */}
        <HandoffField
          label="Routes"
          tooltip="A route is a named delivery target: channel, account, and peer. Subscriptions reference routes by name."
          hint="Example: operator -> telegram/main/123456789."
        >
          <div className="mb-2 flex items-center justify-end">
            <Button size="sm" variant="ghost" onClick={addRoute}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add route
            </Button>
          </div>
          {Object.keys(cfg.routes).length === 0 ? (
            <HandoffEmpty>No routes configured. Add one before creating subscriptions.</HandoffEmpty>
          ) : (
            <div className="space-y-2">
              {Object.entries(cfg.routes).map(([name, route]) => (
                <div
                  key={name}
                  className="rounded-[6px] border p-2"
                  style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}
                  data-testid={`route-${name}`}
                >
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <Input
                      aria-label={`route-name-${name}`}
                      onBlur={(e) => renameRoute(name, e.target.value.trim())}
                      defaultValue={name}
                      className="h-8 text-[12px]"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)" }}
                    />
                    <select
                      aria-label={`route-channel-${name}`}
                      value={route.channel}
                      onChange={(e) =>
                        updateRoute(name, { channel: e.target.value as ChannelName })
                      }
                      className="h-8 rounded border px-2 text-[12px]"
                      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)", color: "var(--color-foreground)" }}
                    >
                      {CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={`route-account-${name}`}
                      placeholder="account_id"
                      value={route.account_id}
                      onChange={(e) => updateRoute(name, { account_id: e.target.value })}
                      className="h-8 text-[12px]"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)" }}
                    />
                    <Input
                      aria-label={`route-peer-${name}`}
                      placeholder="peer_id"
                      value={route.peer_id}
                      onChange={(e) => updateRoute(name, { peer_id: e.target.value })}
                      className="h-8 text-[12px]"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)" }}
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => testRoute(name)}
                        title="Send test notification through this route"
                      >
                        <Send className="mr-1 h-3 w-3" />
                        Test
                        {testStatus[name] === "ok" && <span className="ml-1 text-green-500">OK</span>}
                        {testStatus[name] === "fail" && <span className="ml-1 text-red-500">failed</span>}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeRoute(name)}
                        aria-label={`remove-route-${name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </HandoffField>

        {/* Subscriptions */}
        <HandoffField
          label="Subscriptions"
          tooltip="A subscription connects one event to one route. Optional schedule is cron-style for periodic summary events; optional throttle accepts values like 30s, 5m, or 1h."
          hint="Pause events are useful for human takeover; agent_error and escalation_needed are useful for operator escalation."
        >
          <div className="mb-2 flex items-center justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={addSubscription}
              disabled={Object.keys(cfg.routes).length === 0}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add subscription
            </Button>
          </div>
          {cfg.subscriptions.length === 0 ? (
            <HandoffEmpty>No subscriptions yet. Add one to start receiving notifications.</HandoffEmpty>
          ) : (
            <div className="space-y-2">
              {cfg.subscriptions.map((sub, idx) => (
                <div
                  key={idx}
                  className="rounded-[6px] border p-2"
                  style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg2)" }}
                  data-testid={`subscription-${idx}`}
                >
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <select
                      aria-label={`sub-event-${idx}`}
                      value={sub.event}
                      onChange={(e) => updateSub(idx, { event: e.target.value as EventName })}
                      className="h-8 rounded border px-2 text-[12px]"
                      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)", color: "var(--color-foreground)" }}
                    >
                      {EVENTS.map((ev) => (
                        <option key={ev} value={ev}>
                          {ev}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`sub-route-${idx}`}
                      value={sub.route}
                      onChange={(e) => updateSub(idx, { route: e.target.value })}
                      className="h-8 rounded border px-2 text-[12px]"
                      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg3)", color: "var(--color-foreground)" }}
                    >
                      {Object.keys(cfg.routes).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label={`sub-schedule-${idx}`}
                      placeholder="schedule (cron, optional)"
                      value={sub.schedule ?? ""}
                      onChange={(e) =>
                        updateSub(idx, { schedule: e.target.value || undefined })
                      }
                      className="h-8 text-[12px]"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)" }}
                    />
                    <Input
                      aria-label={`sub-throttle-${idx}`}
                      placeholder="throttle (5m, 30s, …)"
                      value={sub.throttle ?? ""}
                      onChange={(e) =>
                        updateSub(idx, { throttle: e.target.value || undefined })
                      }
                      className="h-8 text-[12px]"
                      style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)" }}
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeSub(idx)}
                        aria-label={`remove-sub-${idx}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </HandoffField>

        {error && <HandoffError message={error} />}
      </div>

      <HandoffActions>
        {dirty && (
          <span className="text-[11.5px]" style={{ color: "var(--oc-yellow)" }}>
            Unsaved changes
          </span>
        )}
        <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </HandoffActions>
    </Section>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function mergeInitial(initial?: Partial<NotificationsConfig>): NotificationsConfig {
  return {
    enabled: initial?.enabled ?? DEFAULT_CONFIG.enabled,
    routes: initial?.routes ?? DEFAULT_CONFIG.routes,
    subscriptions: initial?.subscriptions ?? DEFAULT_CONFIG.subscriptions,
  };
}

async function defaultPersist(
  agentId: string,
  cfg: NotificationsConfig,
): Promise<void> {
  // Stage 1 self-config-tools: route OCP-section saves through the unified
  // PATCH endpoint backed by AgentConfigWriter. Comment-preserving writes,
  // automatic backups, audit-log entry tagged `source: 'ui'`.
  const url = `/api/agents/${encodeURIComponent(agentId)}/config`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section: "notifications", value: cfg }),
  });
  if (!res.ok) {
    let message = `PATCH /api/agents/${agentId}/config failed: ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      if (body?.message) message = body.message;
      else if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
}
