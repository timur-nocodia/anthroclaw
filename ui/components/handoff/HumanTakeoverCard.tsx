"use client";

/**
 * HumanTakeoverCard — agent settings → Handoff tab → Auto-pause section.
 *
 * Form for the per-agent `human_takeover` block:
 *   - enabled (bool)
 *   - pause_ttl_minutes (number)
 *   - channels (string[]; whatsapp + telegram, only whatsapp wired in Stage 1)
 *   - ignore (string[])
 *   - notification_throttle_minutes (number)
 *
 * Persists by fetching the full agent config, splicing the new block in,
 * and PUTting the result to /api/agents/[agentId] (matches the existing
 * config-tab persistence pattern).
 */

import { useEffect, useState, useCallback } from "react";
import { Save, UserCheck, AlertCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LastModifiedIndicator } from "./LastModifiedIndicator";

const ALL_CHANNELS = ["whatsapp", "telegram"] as const;
type Channel = (typeof ALL_CHANNELS)[number];

const ALL_IGNORE = ["reactions", "receipts", "typing", "protocol"] as const;
type IgnoreType = (typeof ALL_IGNORE)[number];

export interface HumanTakeoverConfig {
  enabled: boolean;
  pause_ttl_minutes: number;
  channels: Channel[];
  ignore: IgnoreType[];
  notification_throttle_minutes: number;
}

const DEFAULT_CONFIG: HumanTakeoverConfig = {
  enabled: false,
  pause_ttl_minutes: 30,
  channels: ["whatsapp"],
  ignore: ["reactions", "receipts", "typing", "protocol"],
  notification_throttle_minutes: 5,
};

export interface HumanTakeoverCardProps {
  agentId: string;
  /** Initial config from the loaded agent.yml. May be undefined when the block is missing. */
  initialConfig?: Partial<HumanTakeoverConfig>;
  /**
   * Persist callback. Receives the new block; the parent is responsible
   * for merging it into the full agent config and PUTting it. Falls back
   * to a built-in fetch-and-update flow when not provided.
   */
  onSave?: (cfg: HumanTakeoverConfig) => Promise<void>;
}

export function HumanTakeoverCard({
  agentId,
  initialConfig,
  onSave,
}: HumanTakeoverCardProps) {
  const [cfg, setCfg] = useState<HumanTakeoverConfig>({
    ...DEFAULT_CONFIG,
    ...initialConfig,
    channels: initialConfig?.channels ?? DEFAULT_CONFIG.channels,
    ignore: initialConfig?.ignore ?? DEFAULT_CONFIG.ignore,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCfg({
      ...DEFAULT_CONFIG,
      ...initialConfig,
      channels: initialConfig?.channels ?? DEFAULT_CONFIG.channels,
      ignore: initialConfig?.ignore ?? DEFAULT_CONFIG.ignore,
    });
    setDirty(false);
  }, [initialConfig]);

  const update = useCallback(<K extends keyof HumanTakeoverConfig>(key: K, val: HumanTakeoverConfig[K]) => {
    setCfg((prev) => ({ ...prev, [key]: val }));
    setDirty(true);
  }, []);

  const toggleChannel = (ch: Channel) => {
    update(
      "channels",
      cfg.channels.includes(ch)
        ? cfg.channels.filter((c) => c !== ch)
        : [...cfg.channels, ch],
    );
  };

  const toggleIgnore = (i: IgnoreType) => {
    update(
      "ignore",
      cfg.ignore.includes(i) ? cfg.ignore.filter((x) => x !== i) : [...cfg.ignore, i],
    );
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
        <CardTitle className="flex items-center justify-between gap-2 text-[14px] font-medium">
          <span className="flex items-center gap-2">
            <UserCheck className="h-4 w-4" />
            Auto-pause on human takeover
          </span>
          <LastModifiedIndicator agentId={agentId} section="human_takeover" />
        </CardTitle>
        <CardDescription className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
          When the operator messages a peer directly through their own account, the agent
          pauses replies for a sliding TTL window so it doesn&apos;t talk over you.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="ht-enabled" className="text-[13px]">
            Enabled
          </Label>
          <input
            id="ht-enabled"
            type="checkbox"
            role="switch"
            aria-checked={cfg.enabled}
            checked={cfg.enabled}
            onChange={(e) => update("enabled", e.target.checked)}
            className="h-4 w-7 cursor-pointer appearance-none rounded-full border transition-colors checked:bg-[var(--oc-accent)]"
            style={{ borderColor: "var(--oc-border)" }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="ht-ttl" className="text-[12px]">
              Pause TTL (minutes)
            </Label>
            <Input
              id="ht-ttl"
              type="number"
              min={1}
              value={cfg.pause_ttl_minutes}
              onChange={(e) => update("pause_ttl_minutes", Number(e.target.value) || 0)}
              className="h-8 text-[13px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ht-throttle" className="text-[12px]">
              Notification throttle (minutes)
            </Label>
            <Input
              id="ht-throttle"
              type="number"
              min={0}
              value={cfg.notification_throttle_minutes}
              onChange={(e) =>
                update("notification_throttle_minutes", Number(e.target.value) || 0)
              }
              className="h-8 text-[13px]"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12px]">Channels</Label>
          <div className="flex flex-wrap gap-2">
            {ALL_CHANNELS.map((ch) => (
              <Badge
                key={ch}
                variant={cfg.channels.includes(ch) ? "default" : "outline"}
                className="cursor-pointer text-[11px]"
                onClick={() => toggleChannel(ch)}
                role="button"
                aria-pressed={cfg.channels.includes(ch)}
              >
                {ch}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[12px]">Ignore (these inbound types do not trigger pause)</Label>
          <div className="flex flex-wrap gap-2">
            {ALL_IGNORE.map((i) => (
              <Badge
                key={i}
                variant={cfg.ignore.includes(i) ? "default" : "outline"}
                className="cursor-pointer text-[11px]"
                onClick={() => toggleIgnore(i)}
                role="button"
                aria-pressed={cfg.ignore.includes(i)}
              >
                {i}
              </Badge>
            ))}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded border p-2 text-[12px]" style={{ borderColor: "var(--oc-border)", color: "var(--oc-danger)" }}>
            <AlertCircle className="h-3.5 w-3.5" />
            {error}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardFooter>
    </Card>
  );
}

async function defaultPersist(
  agentId: string,
  cfg: HumanTakeoverConfig,
): Promise<void> {
  // Stage 1 self-config-tools: route OCP-section saves through the unified
  // PATCH endpoint backed by AgentConfigWriter. Comment-preserving writes,
  // automatic backups, audit-log entry tagged `source: 'ui'`.
  const url = `/api/agents/${encodeURIComponent(agentId)}/config`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ section: "human_takeover", value: cfg }),
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
