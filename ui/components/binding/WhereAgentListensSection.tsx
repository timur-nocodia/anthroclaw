"use client";

import { useState } from "react";
import { Globe, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/section";
import { BindingCard } from "@/components/binding/BindingCard";
import {
  BindingWizardDialog,
  type BindingWizardRoute,
  type WizardAccountsConfig,
} from "@/components/binding/BindingWizardDialog";
import { BindingTestPanel } from "@/components/binding/BindingTestPanel";

export interface BindingRoute {
  channel: string;
  account: string;
  scope: string;
  peers?: string[] | null;
  topics?: string[] | null;
  mentionOnly?: boolean;
  mention_only?: boolean;
  reply_to_mode?: string;
}

export interface WhereAgentListensSectionProps {
  agentId?: string;
  routes?: BindingRoute[];
  accounts?: WizardAccountsConfig;
  pairingMode?: "open" | "code" | "approve" | "off";
  onRoutesChange?: (routes: BindingRoute[]) => void;
  onSaveRoutes?: (routes: BindingRoute[]) => Promise<void>;
}

function normalizeRoute(route: BindingRoute): BindingWizardRoute | null {
  if (route.channel !== "telegram" && route.channel !== "whatsapp") {
    return null;
  }
  if (route.scope !== "dm" && route.scope !== "group" && route.scope !== "any") {
    return null;
  }
  return {
    channel: route.channel,
    account: route.account,
    scope: route.scope,
    peers: route.peers ?? null,
    topics: route.topics ?? null,
    mention_only:
      typeof route.mention_only === "boolean"
        ? route.mention_only
        : typeof route.mentionOnly === "boolean"
          ? route.mentionOnly
          : undefined,
    reply_to_mode:
      route.reply_to_mode === "incoming_reply_only" ||
      route.reply_to_mode === "always" ||
      route.reply_to_mode === "never"
        ? route.reply_to_mode
        : undefined,
  };
}

const EMPTY_ACCOUNTS: WizardAccountsConfig = { telegram: {}, whatsapp: {} };

export function WhereAgentListensSection({
  agentId,
  routes,
  accounts,
  pairingMode,
  onRoutesChange,
  onSaveRoutes,
}: WhereAgentListensSectionProps) {
  const list = routes ?? [];
  const accountsCfg = accounts ?? EMPTY_ACCOUNTS;

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [testRoute, setTestRoute] = useState<BindingWizardRoute | null>(null);

  const editingRoute =
    editIndex !== null
      ? (normalizeRoute(list[editIndex]) ?? undefined)
      : undefined;

  const persist = async (next: BindingRoute[]) => {
    if (onSaveRoutes) {
      await onSaveRoutes(next);
    } else if (onRoutesChange) {
      onRoutesChange(next);
    } else if (agentId) {
      const res = await fetch(`/api/agents/${agentId}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "routes", value: next }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || "Failed to save routes");
      }
    }
  };

  const handleAdd = () => {
    setEditIndex(null);
    setWizardOpen(true);
  };

  const handleEdit = (route: BindingRoute) => {
    const idx = list.indexOf(route);
    if (idx === -1) return;
    setEditIndex(idx);
    setWizardOpen(true);
  };

  const handleRemove = async (route: BindingRoute) => {
    const idx = list.indexOf(route);
    if (idx === -1) return;
    const next = list.filter((_, i) => i !== idx);
    await persist(next);
  };

  const handleSaveFromWizard = async (newRoute: BindingWizardRoute) => {
    const cleaned: BindingRoute = {
      channel: newRoute.channel,
      account: newRoute.account,
      scope: newRoute.scope,
      peers: newRoute.peers ?? null,
      topics: newRoute.topics ?? null,
    };
    if (typeof newRoute.mention_only === "boolean") {
      cleaned.mention_only = newRoute.mention_only;
    }
    if (newRoute.reply_to_mode) {
      cleaned.reply_to_mode = newRoute.reply_to_mode;
    }

    const next =
      editIndex !== null
        ? list.map((r, i) => (i === editIndex ? cleaned : r))
        : [...list, cleaned];
    await persist(next);
  };

  return (
    <>
      <Section
        title="Where this agent listens"
        subtitle={`${list.length} ${list.length === 1 ? "binding" : "bindings"}`}
        tooltip="Channels and chats this agent listens to. Each binding is a (channel, account, scope, peer, topic) combination — built from the agent.yml routes block."
        icon={<Globe className="h-3.5 w-3.5" style={{ color: "var(--oc-accent)" }} />}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={handleAdd}
            data-testid="binding-add-button"
          >
            <Plus className="h-3 w-3" />
            Add binding
          </Button>
        }
      >
        {list.length === 0 ? (
          <p
            className="text-[12px]"
            style={{ color: "var(--oc-text-muted)" }}
            data-testid="binding-empty-state"
          >
            No bindings yet — click + Add binding to start receiving messages.
          </p>
        ) : (
          <ul
            className="flex flex-col gap-2"
            data-testid="binding-list"
          >
            {list.map((route, i) => {
              const wizardRoute = normalizeRoute(route);
              if (!wizardRoute) {
                return (
                  <li
                    key={i}
                    className="text-[12px]"
                    style={{ color: "var(--oc-text-muted)" }}
                    data-testid={`binding-row-${i}`}
                  >
                    Unsupported route shape — edit via Advanced section.
                  </li>
                );
              }
              return (
                <li key={i} data-testid={`binding-row-${i}`}>
                  <BindingCard
                    route={wizardRoute}
                    context={{
                      telegramAccounts: accountsCfg.telegram,
                      whatsappAccounts: accountsCfg.whatsapp,
                      pairingMode,
                    }}
                    onEdit={() => handleEdit(route)}
                    onRemove={() => handleRemove(route)}
                    onTest={
                      agentId ? () => setTestRoute(wizardRoute) : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <BindingWizardDialog
        open={wizardOpen}
        onOpenChange={(o) => {
          setWizardOpen(o);
          if (!o) setEditIndex(null);
        }}
        accounts={accountsCfg}
        initialRoute={editingRoute}
        onSave={handleSaveFromWizard}
      />
      {agentId && testRoute && (
        <BindingTestPanel
          open={testRoute !== null}
          onOpenChange={(o) => {
            if (!o) setTestRoute(null);
          }}
          agentId={agentId}
          route={testRoute}
        />
      )}
    </>
  );
}
