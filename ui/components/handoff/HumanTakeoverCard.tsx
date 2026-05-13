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
import { Save, UserCheck } from "lucide-react";
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

const WIRED_CHANNELS: ReadonlySet<Channel> = new Set(["whatsapp"]);

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
    <Section
      title="Auto-pause on human takeover"
      subtitle={cfg.enabled ? "auto-pause enabled" : "auto-pause disabled"}
      icon={<UserCheck className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
      tooltip="Stops the agent from replying in a conversation after a human operator sends a message from the same connected account."
      action={<LastModifiedIndicator agentId={agentId} section="human_takeover" />}
    >
      <HandoffIntro>
        Use this when a manager takes over a live client chat. A manager&apos;s outbound WhatsApp
        message starts a per-peer pause; new manager messages extend the timer.
      </HandoffIntro>

      <div className="space-y-4">
        <HandoffToggleRow
          id="ht-enabled"
          label="Auto-pause"
          ariaLabel="Enabled"
          checked={cfg.enabled}
          onChange={(checked) => update("enabled", checked)}
          description="When enabled, inbound messages from paused peers are ignored by the agent until the pause expires or is manually removed."
          tooltip="This does not disconnect the channel. It only blocks agent replies for the matching peer."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <HandoffField
            label="Pause TTL"
            htmlFor="ht-ttl"
            tooltip="Sliding pause window in minutes. Every new manager message for the same peer extends the pause by this amount."
            hint="30 minutes is a safe default for lead handoff."
          >
            <Input
              id="ht-ttl"
              type="number"
              min={1}
              value={cfg.pause_ttl_minutes}
              onChange={(e) => update("pause_ttl_minutes", Number(e.target.value) || 0)}
              className="h-8 text-[13px]"
              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)" }}
            />
          </HandoffField>
          <HandoffField
            label="Notification throttle"
            htmlFor="ht-throttle"
            tooltip="Minimum interval between repeated operator notifications for the same pause event."
            hint="Set to 0 to disable throttling."
          >
            <Input
              id="ht-throttle"
              type="number"
              min={0}
              value={cfg.notification_throttle_minutes}
              onChange={(e) =>
                update("notification_throttle_minutes", Number(e.target.value) || 0)
              }
              className="h-8 text-[13px]"
              style={{ background: "var(--oc-bg3)", borderColor: "var(--oc-border)" }}
            />
          </HandoffField>
        </div>

        <HandoffField
          label="Channels"
          tooltip="Which channel adapters are allowed to start auto-pause. The adapter must emit operator_outbound events for this to work."
          hint="WhatsApp is wired through Baileys fromMe messages. Telegram is shown for schema compatibility but does not emit takeover events yet."
        >
          <div className="flex flex-wrap gap-2">
            {ALL_CHANNELS.map((ch) => (
              <button
                key={ch}
                type="button"
                disabled={!WIRED_CHANNELS.has(ch)}
                className="rounded-[5px] border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-55"
                onClick={() => toggleChannel(ch)}
                aria-pressed={cfg.channels.includes(ch)}
                style={{
                  background: cfg.channels.includes(ch) ? "var(--oc-accent)" : "var(--oc-bg2)",
                  borderColor: cfg.channels.includes(ch) ? "var(--oc-accent)" : "var(--oc-border)",
                  color: cfg.channels.includes(ch) ? "#0b0d12" : "var(--color-foreground)",
                }}
              >
                {ch}
                {!WIRED_CHANNELS.has(ch) && (
                  <span className="ml-1" style={{ color: "var(--oc-text-muted)" }}>
                    not wired
                  </span>
                )}
              </button>
            ))}
          </div>
        </HandoffField>

        <HandoffField
          label="Ignored WhatsApp event types"
          tooltip="Baileys can mark reactions, read receipts, typing/protocol envelopes, and similar framework noise as fromMe. These are filtered so they do not start a takeover pause."
        >
          <div className="flex flex-wrap gap-2">
            {ALL_IGNORE.map((i) => (
              <button
                key={i}
                type="button"
                className="rounded-[5px] border px-2.5 py-1 text-[11px] font-medium transition-colors"
                onClick={() => toggleIgnore(i)}
                aria-pressed={cfg.ignore.includes(i)}
                style={{
                  background: cfg.ignore.includes(i) ? "var(--oc-accent)" : "var(--oc-bg2)",
                  borderColor: cfg.ignore.includes(i) ? "var(--oc-accent)" : "var(--oc-border)",
                  color: cfg.ignore.includes(i) ? "#0b0d12" : "var(--color-foreground)",
                }}
              >
                {i}
              </button>
            ))}
          </div>
        </HandoffField>

        {!cfg.enabled && (
          <HandoffEmpty>
            Auto-pause is currently off. Manager messages from the connected WhatsApp account will not pause this agent.
          </HandoffEmpty>
        )}

        {error && <HandoffError message={error} />}
      </div>

      <HandoffActions>
        {dirty && (
          <span className="text-[11.5px]" style={{ color: "var(--oc-yellow)" }}>
            Unsaved changes
          </span>
        )}
        <Button
          size="sm"
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </HandoffActions>
    </Section>
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
