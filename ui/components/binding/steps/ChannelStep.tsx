"use client";

import { MessageCircle, Send } from "lucide-react";
import type { BindingChannel } from "@/components/binding/binding-language";

export interface ChannelStepProps {
  selected?: BindingChannel;
  availableChannels: Array<"telegram" | "whatsapp">;
  onSelect: (channel: "telegram" | "whatsapp") => void;
}

interface ChannelDef {
  id: "telegram" | "whatsapp";
  label: string;
  description: string;
}

const CHANNELS: ChannelDef[] = [
  {
    id: "telegram",
    label: "Telegram",
    description: "Bots that listen in Telegram chats and groups.",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "Accounts paired via QR for WhatsApp DMs and groups.",
  },
];

export function ChannelStep({
  selected,
  availableChannels,
  onSelect,
}: ChannelStepProps) {
  const visible = CHANNELS.filter((c) => availableChannels.includes(c.id));

  return (
    <div className="flex flex-col gap-3" data-testid="binding-step-channel">
      <p className="text-[12px]" style={{ color: "var(--oc-text-muted)" }}>
        Which channel does this binding listen on?
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((c) => {
          const isSelected = selected === c.id;
          return (
            <button
              key={c.id}
              type="button"
              data-testid={`binding-channel-${c.id}`}
              aria-pressed={isSelected}
              onClick={() => onSelect(c.id)}
              className="flex flex-col items-start gap-1 rounded-md p-3 text-left"
              style={{
                background: isSelected ? "var(--oc-bg2)" : "var(--oc-bg0)",
                border: `1px solid ${isSelected ? "var(--oc-accent)" : "var(--oc-border)"}`,
              }}
            >
              <div className="flex items-center gap-1.5">
                {c.id === "telegram" ? (
                  <Send
                    className="h-3.5 w-3.5"
                    style={{ color: "var(--oc-accent)" }}
                  />
                ) : (
                  <MessageCircle
                    className="h-3.5 w-3.5"
                    style={{ color: "var(--oc-accent)" }}
                  />
                )}
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: "var(--color-foreground)" }}
                >
                  {c.label}
                </span>
              </div>
              <span
                className="text-[11.5px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                {c.description}
              </span>
            </button>
          );
        })}
      </div>
      {visible.length === 0 && (
        <p
          className="text-[12px]"
          style={{ color: "var(--oc-text-muted)" }}
          data-testid="binding-channel-empty"
        >
          No channels are configured in config.yml. Add a Telegram or WhatsApp
          account first.
        </p>
      )}
    </div>
  );
}
