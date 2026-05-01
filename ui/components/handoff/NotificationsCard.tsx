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
import { Bell, Save, Trash2, Plus, AlertCircle, Send } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
  enabled: true,
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
    <Card
      className="rounded-md"
      style={{ background: "var(--oc-bg0)", borderColor: "var(--oc-border)" }}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[14px] font-medium">
          <Bell className="h-4 w-4" />
          Notifications
        </CardTitle>
        <CardDescription className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
          Routes are named delivery targets. Subscriptions wire events to one of those routes,
          optionally with a cron schedule (for periodic events) and a throttle window.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Enabled */}
        <div className="flex items-center justify-between">
          <Label htmlFor="notif-enabled" className="text-[13px]">
            Enabled
          </Label>
          <input
            id="notif-enabled"
            type="checkbox"
            role="switch"
            aria-checked={cfg.enabled}
            checked={cfg.enabled}
            onChange={(e) => update({ ...cfg, enabled: e.target.checked })}
            className="h-4 w-7 cursor-pointer appearance-none rounded-full border transition-colors checked:bg-[var(--oc-accent)]"
            style={{ borderColor: "var(--oc-border)" }}
          />
        </div>

        {/* Routes */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-[13px] font-medium">Routes</Label>
            <Button size="sm" variant="ghost" onClick={addRoute}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add route
            </Button>
          </div>
          {Object.keys(cfg.routes).length === 0 ? (
            <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
              No routes configured. Add one to receive notifications.
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(cfg.routes).map(([name, route]) => (
                <div
                  key={name}
                  className="rounded border p-2"
                  style={{ borderColor: "var(--oc-border)" }}
                  data-testid={`route-${name}`}
                >
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <Input
                      aria-label={`route-name-${name}`}
                      value={name}
                      onBlur={(e) => renameRoute(name, e.target.value.trim())}
                      onChange={() => undefined}
                      defaultValue={name}
                      className="h-8 text-[12px]"
                    />
                    <select
                      aria-label={`route-channel-${name}`}
                      value={route.channel}
                      onChange={(e) =>
                        updateRoute(name, { channel: e.target.value as ChannelName })
                      }
                      className="h-8 rounded border px-2 text-[12px]"
                      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
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
                    />
                    <Input
                      aria-label={`route-peer-${name}`}
                      placeholder="peer_id"
                      value={route.peer_id}
                      onChange={(e) => updateRoute(name, { peer_id: e.target.value })}
                      className="h-8 text-[12px]"
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
                        {testStatus[name] === "ok" && <span className="ml-1 text-green-500">✓</span>}
                        {testStatus[name] === "fail" && <span className="ml-1 text-red-500">✗</span>}
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
        </div>

        {/* Subscriptions */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="text-[13px] font-medium">Subscriptions</Label>
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
            <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
              No subscriptions yet. Add one to start receiving notifications.
            </p>
          ) : (
            <div className="space-y-2">
              {cfg.subscriptions.map((sub, idx) => (
                <div
                  key={idx}
                  className="rounded border p-2"
                  style={{ borderColor: "var(--oc-border)" }}
                  data-testid={`subscription-${idx}`}
                >
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <select
                      aria-label={`sub-event-${idx}`}
                      value={sub.event}
                      onChange={(e) => updateSub(idx, { event: e.target.value as EventName })}
                      className="h-8 rounded border px-2 text-[12px]"
                      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
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
                      style={{ borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }}
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
                    />
                    <Input
                      aria-label={`sub-throttle-${idx}`}
                      placeholder="throttle (5m, 30s, …)"
                      value={sub.throttle ?? ""}
                      onChange={(e) =>
                        updateSub(idx, { throttle: e.target.value || undefined })
                      }
                      className="h-8 text-[12px]"
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
        </div>

        {error && (
          <div
            className="flex items-center gap-2 rounded border p-2 text-[12px]"
            style={{ borderColor: "var(--oc-border)", color: "var(--oc-danger)" }}
          >
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex justify-end">
        <Button size="sm" disabled={!dirty || saving} onClick={handleSave}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardFooter>
    </Card>
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
  const url = `/api/agents/${encodeURIComponent(agentId)}`;
  const getRes = await fetch(url);
  if (!getRes.ok) throw new Error(`GET /api/agents/${agentId} failed: ${getRes.status}`);
  const current = (await getRes.json()) as { parsed?: Record<string, unknown> };
  const parsed = (current.parsed ?? {}) as Record<string, unknown>;
  const next = { ...parsed, notifications: cfg };
  const putRes = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config: next }),
  });
  if (!putRes.ok) throw new Error(`PUT failed: ${putRes.status}`);
}
