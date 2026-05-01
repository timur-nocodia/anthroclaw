"use client";

import { Globe } from "lucide-react";
import { Section } from "@/components/ui/section";

export interface BindingRoute {
  channel: string;
  account: string;
  scope: string;
  peers?: string[] | null;
  topics?: string[] | null;
  mentionOnly?: boolean;
}

export interface WhereAgentListensSectionProps {
  routes?: BindingRoute[];
}

function channelEmoji(channel: string): string {
  if (channel === "telegram") return "📱";
  if (channel === "whatsapp") return "💬";
  return "🔌";
}

function channelLabel(channel: string): string {
  if (channel === "telegram") return "Telegram";
  if (channel === "whatsapp") return "WhatsApp";
  return channel;
}

function scopeLabel(scope: string): string {
  if (scope === "dm") return "direct messages";
  if (scope === "group") return "groups";
  if (scope === "any") return "any chat";
  return scope;
}

function summarizeRoute(route: BindingRoute): string {
  const peerPart = route.peers && route.peers.length > 0
    ? route.peers.join(", ")
    : "any peer";
  const topicPart = route.topics && route.topics.length > 0
    ? ` → topic ${route.topics.join(", ")}`
    : "";
  const mention = route.mentionOnly ? " (mention only)" : "";
  const account = route.account ? `(${route.account})` : "(default)";
  return `${channelEmoji(route.channel)} ${channelLabel(route.channel)} ${account} — ${scopeLabel(route.scope)} — ${peerPart}${topicPart}${mention}`;
}

/**
 * Placeholder version of the "Where this agent listens" section.
 *
 * Stage 1 ships this as a plain-text summary only — Stage 2 will add the
 * BindingWizardDialog (Add binding) and BindingCard components per the
 * binding-ux spec. The existing flat-row Routes editor stays in place
 * until Stage 2's Task 10 hides it under an Advanced expandable.
 */
export function WhereAgentListensSection({
  routes,
}: WhereAgentListensSectionProps) {
  const list = routes ?? [];

  return (
    <Section
      title="Where this agent listens"
      subtitle={`${list.length} ${list.length === 1 ? "binding" : "bindings"}`}
      tooltip="Channels and chats this agent listens to. Each binding is a (channel, account, scope, peer, topic) combination — built from the agent.yml routes block."
      icon={<Globe className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
    >
      {list.length === 0 ? (
        <p
          className="text-[12px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          No bindings yet — add one to start receiving messages.
        </p>
      ) : (
        <ul
          className="flex flex-col gap-1.5"
          style={{ fontFamily: "var(--oc-mono)" }}
          data-testid="binding-list"
        >
          {list.map((route, i) => (
            <li
              key={i}
              className="text-[12px]"
              style={{ color: "var(--color-foreground)" }}
              data-testid={`binding-row-${i}`}
            >
              {summarizeRoute(route)}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
