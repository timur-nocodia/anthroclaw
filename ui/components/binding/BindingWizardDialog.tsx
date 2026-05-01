"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChannelStep } from "@/components/binding/steps/ChannelStep";
import {
  AccountStep,
  type AccountOption,
} from "@/components/binding/steps/AccountStep";
import { WhereStep } from "@/components/binding/steps/WhereStep";
import { TargetStep } from "@/components/binding/steps/TargetStep";
import {
  BehaviorStep,
  type BehaviorChoice,
} from "@/components/binding/steps/BehaviorStep";
import { PreviewStep } from "@/components/binding/steps/PreviewStep";

export type BindingScopeValue = "dm" | "group" | "any";

export interface BindingWizardRoute {
  channel: "telegram" | "whatsapp";
  account: string;
  scope: BindingScopeValue;
  peers?: string[] | null;
  topics?: string[] | null;
  mention_only?: boolean;
  mentionOnly?: boolean;
  reply_to_mode?: "always" | "incoming_reply_only" | "never";
  replyToMode?: "always" | "incoming_reply_only" | "never";
  pairing_mode?: "open" | "code" | "approve" | "off";
  pairingMode?: "open" | "code" | "approve" | "off";
}

export type WizardStep =
  | "channel"
  | "account"
  | "where"
  | "target"
  | "behavior"
  | "preview";

export interface WizardAccountsConfig {
  telegram: Record<string, { username?: string }>;
  whatsapp: Record<string, { username?: string }>;
}

export interface BindingWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRoute?: BindingWizardRoute;
  accounts: WizardAccountsConfig;
  onSave: (route: BindingWizardRoute) => Promise<void>;
}

interface WizardState {
  channel?: "telegram" | "whatsapp";
  account?: string;
  scope?: BindingScopeValue;
  peers?: string[] | null;
  topics?: string[] | null;
  mention_only?: boolean;
  reply_to_mode?: "always" | "incoming_reply_only" | "never";
  pairing_mode?: "open" | "code" | "approve" | "off";
  // Target sub-flow ephemeral inputs (kept here so Back preserves them).
  dmMode?: "all" | "allowlist";
  dmAllowlistInput?: string;
  groupChatId?: string;
  groupForumEnabled?: boolean;
  groupTopicsInput?: string;
  behaviorChoice?: BehaviorChoice;
}

function availableChannelsList(
  accounts: WizardAccountsConfig,
): Array<"telegram" | "whatsapp"> {
  const out: Array<"telegram" | "whatsapp"> = [];
  if (Object.keys(accounts.telegram ?? {}).length > 0) out.push("telegram");
  if (Object.keys(accounts.whatsapp ?? {}).length > 0) out.push("whatsapp");
  return out;
}

function buildAccountOptions(
  accounts: WizardAccountsConfig,
  channel: "telegram" | "whatsapp",
): AccountOption[] {
  const map = accounts[channel] ?? {};
  return Object.entries(map).map(([id, info]) => ({
    id,
    username: info?.username,
  }));
}

function stateFromRoute(route: BindingWizardRoute | undefined): WizardState {
  if (!route) {
    return {
      dmMode: "all",
      dmAllowlistInput: "",
      groupChatId: "",
      groupForumEnabled: false,
      groupTopicsInput: "",
    };
  }
  const peers = route.peers ?? null;
  const topics = route.topics ?? null;
  const pairingMode = route.pairing_mode ?? route.pairingMode;
  const replyMode = route.reply_to_mode ?? route.replyToMode;
  const mentionOnly =
    typeof route.mention_only === "boolean"
      ? route.mention_only
      : typeof route.mentionOnly === "boolean"
        ? route.mentionOnly
        : undefined;

  // For DM scope: derive ephemeral allowlist input from peers.
  const dmHasAllowlist = route.scope === "dm" && peers !== null && peers.length > 0;
  const dmMode: "all" | "allowlist" = dmHasAllowlist ? "allowlist" : "all";
  const dmAllowlistInput = dmHasAllowlist ? peers.join(", ") : "";

  // For group scope: first peer is chat ID; topics flag forum.
  const groupChatId =
    route.scope === "group" && peers !== null && peers.length > 0
      ? peers[0]
      : "";
  const groupForumEnabled =
    route.scope === "group" && topics !== null && topics.length > 0;
  const groupTopicsInput =
    route.scope === "group" && topics !== null ? topics.join(", ") : "";

  let behaviorChoice: BehaviorChoice | undefined;
  if (replyMode === "incoming_reply_only") {
    behaviorChoice = "incoming_reply_only";
  } else if (mentionOnly === true) {
    behaviorChoice = "mention_only";
  } else if (mentionOnly === false) {
    behaviorChoice = "all";
  }

  return {
    channel: route.channel,
    account: route.account,
    scope: route.scope,
    peers,
    topics,
    mention_only: mentionOnly,
    reply_to_mode: replyMode,
    pairing_mode: pairingMode,
    dmMode,
    dmAllowlistInput,
    groupChatId,
    groupForumEnabled,
    groupTopicsInput,
    behaviorChoice,
  };
}

function parseList(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function yamlListLine(values: string[] | null | undefined): string {
  if (values === null || values === undefined) return "null";
  return `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;
}

function previewYamlDiff(route: BindingWizardRoute): string {
  const lines: string[] = ["routes:", "  - channel: " + route.channel];
  lines.push("    account: " + route.account);
  lines.push("    scope: " + route.scope);
  if (route.peers !== undefined) {
    lines.push("    peers: " + yamlListLine(route.peers ?? null));
  }
  if (route.topics !== undefined) {
    lines.push("    topics: " + yamlListLine(route.topics ?? null));
  }
  if (typeof route.mention_only === "boolean") {
    lines.push("    mention_only: " + (route.mention_only ? "true" : "false"));
  }
  if (route.reply_to_mode) {
    lines.push("    reply_to_mode: " + route.reply_to_mode);
  }
  if (route.pairing_mode) {
    lines.push(`# pairing.mode: ${route.pairing_mode}`);
  }
  return lines.join("\n");
}

export function buildRouteFromState(state: WizardState): BindingWizardRoute {
  if (!state.channel) throw new Error("channel missing");
  if (!state.account) throw new Error("account missing");
  if (!state.scope) throw new Error("scope missing");

  const route: BindingWizardRoute = {
    channel: state.channel,
    account: state.account,
    scope: state.scope,
  };

  // Derive peers/topics from ephemeral inputs based on scope.
  if (state.scope === "dm") {
    if (state.dmMode === "allowlist" && state.dmAllowlistInput) {
      const list = parseList(state.dmAllowlistInput);
      route.peers = list.length > 0 ? list : null;
    } else {
      route.peers = null;
    }
    route.topics = null;
    if (state.dmMode === "all") {
      route.pairing_mode = "open";
    }
  } else if (state.scope === "group") {
    route.peers = state.groupChatId ? [state.groupChatId] : null;
    if (state.groupForumEnabled && state.groupTopicsInput) {
      const list = parseList(state.groupTopicsInput);
      route.topics = list.length > 0 ? list : null;
    } else {
      route.topics = null;
    }
  } else {
    // any-scope: combine DM allowlist + group chat ID into peers; topics from group.
    const peers: string[] = [];
    if (state.dmMode === "allowlist" && state.dmAllowlistInput) {
      peers.push(...parseList(state.dmAllowlistInput));
    }
    if (state.groupChatId) {
      peers.push(state.groupChatId);
    }
    route.peers = peers.length > 0 ? peers : null;
    if (state.groupForumEnabled && state.groupTopicsInput) {
      const list = parseList(state.groupTopicsInput);
      route.topics = list.length > 0 ? list : null;
    } else {
      route.topics = null;
    }
    if (state.dmMode === "all") {
      route.pairing_mode = "open";
    }
  }

  // Behavior step only applies to group + any scopes. For DM, leave behavior fields off.
  if (state.scope === "group" || state.scope === "any") {
    if (state.behaviorChoice === "mention_only") {
      route.mention_only = true;
    } else if (state.behaviorChoice === "all") {
      route.mention_only = false;
    } else if (state.behaviorChoice === "incoming_reply_only") {
      route.reply_to_mode = "incoming_reply_only";
    } else if (typeof state.mention_only === "boolean") {
      route.mention_only = state.mention_only;
    }
  }
  if (!route.pairing_mode && state.pairing_mode) {
    route.pairing_mode = state.pairing_mode;
  }
  return route;
}

const STEP_ORDER: WizardStep[] = [
  "channel",
  "account",
  "where",
  "target",
  "behavior",
  "preview",
];

export function BindingWizardDialog({
  open,
  onOpenChange,
  initialRoute,
  accounts,
  onSave,
}: BindingWizardDialogProps) {
  const channelsAvailable = useMemo(
    () => availableChannelsList(accounts),
    [accounts],
  );

  const [state, setState] = useState<WizardState>(() =>
    stateFromRoute(initialRoute),
  );
  const [step, setStep] = useState<WizardStep>("channel");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset state whenever the dialog (re)opens.
  useEffect(() => {
    if (!open) return;
    setSaveError(null);
    const next = stateFromRoute(initialRoute);
    setState(next);
    if (initialRoute) {
      setStep("preview");
      return;
    }
    if (channelsAvailable.length === 1) {
      setState((s) => ({ ...s, channel: channelsAvailable[0] }));
      setStep("account");
      return;
    }
    setStep("channel");
  }, [open, initialRoute, channelsAvailable]);

  // Auto-advance Step 2 when only one account is configured for the chosen channel.
  useEffect(() => {
    if (!open) return;
    if (step !== "account") return;
    if (!state.channel) return;
    const opts = buildAccountOptions(accounts, state.channel);
    if (opts.length === 1 && state.account === undefined) {
      setState((s) => ({ ...s, account: opts[0].id }));
      setStep("where");
    }
  }, [open, step, state.channel, state.account, accounts]);

  const handleChannelSelect = (channel: "telegram" | "whatsapp") => {
    setState((s) => ({ ...s, channel }));
    setStep("account");
  };

  const handleAccountSelect = (accountId: string) => {
    setState((s) => ({ ...s, account: accountId }));
  };

  const handleScopeSelect = (scope: BindingScopeValue) => {
    setState((s) => ({ ...s, scope }));
  };

  const handleDmModeChange = (mode: "all" | "allowlist") => {
    setState((s) => ({ ...s, dmMode: mode }));
  };

  const handleDmAllowlistChange = (value: string) => {
    setState((s) => ({ ...s, dmAllowlistInput: value }));
  };

  const handleGroupChatIdChange = (value: string) => {
    setState((s) => ({ ...s, groupChatId: value }));
  };

  const handleGroupForumChange = (enabled: boolean) => {
    setState((s) => ({ ...s, groupForumEnabled: enabled }));
  };

  const handleGroupTopicsChange = (value: string) => {
    setState((s) => ({ ...s, groupTopicsInput: value }));
  };

  const isStepActive = (s: WizardStep): boolean => {
    if (s === "behavior" && state.scope === "dm") return false;
    return true;
  };

  const goBack = () => {
    const idx = STEP_ORDER.indexOf(step);
    for (let i = idx - 1; i >= 0; i--) {
      if (isStepActive(STEP_ORDER[i])) {
        setStep(STEP_ORDER[i]);
        return;
      }
    }
  };

  const goNext = () => {
    const idx = STEP_ORDER.indexOf(step);
    for (let i = idx + 1; i < STEP_ORDER.length; i++) {
      if (isStepActive(STEP_ORDER[i])) {
        setStep(STEP_ORDER[i]);
        return;
      }
    }
  };

  const handleBehaviorSelect = (choice: BehaviorChoice) => {
    setState((s) => ({ ...s, behaviorChoice: choice }));
  };

  const previewRoute = useMemo<BindingWizardRoute | null>(() => {
    if (!state.channel || !state.account || !state.scope) return null;
    try {
      return buildRouteFromState(state);
    } catch {
      return null;
    }
  }, [state]);

  const describeContext = useMemo(
    () => ({
      telegramAccounts: accounts.telegram,
      whatsappAccounts: accounts.whatsapp,
      pairingMode: previewRoute?.pairing_mode,
    }),
    [accounts, previewRoute],
  );

  const handleSave = async () => {
    if (!previewRoute) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(previewRoute);
      onOpenChange(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save binding",
      );
    } finally {
      setSaving(false);
    }
  };

  const canGoNext = (): boolean => {
    if (step === "channel") return Boolean(state.channel);
    if (step === "account") return Boolean(state.account);
    if (step === "where") return Boolean(state.scope);
    if (step === "target") {
      if (state.scope === "group" || state.scope === "any") {
        if (!state.groupChatId || state.groupChatId.trim().length === 0) {
          return false;
        }
      }
      return true;
    }
    return true;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {initialRoute ? "Edit binding" : "Add binding"}
          </DialogTitle>
          <DialogDescription>
            Configure where this agent listens — channel, account, scope, and
            behavior.
          </DialogDescription>
        </DialogHeader>

        <div
          className="text-[11.5px]"
          style={{ color: "var(--oc-text-muted)" }}
          data-testid="binding-wizard-step-label"
        >
          Step {STEP_ORDER.indexOf(step) + 1} of {STEP_ORDER.length}:{" "}
          {step}
        </div>

        <div className="flex flex-col gap-3">
          {step === "channel" && (
            <ChannelStep
              selected={state.channel}
              availableChannels={channelsAvailable}
              onSelect={handleChannelSelect}
            />
          )}
          {step === "account" && state.channel && (
            <AccountStep
              channel={state.channel}
              selected={state.account}
              options={buildAccountOptions(accounts, state.channel)}
              onSelect={handleAccountSelect}
            />
          )}
          {step === "where" && (
            <WhereStep
              selected={state.scope}
              onSelect={handleScopeSelect}
            />
          )}
          {step === "target" && state.channel && state.scope && (
            <TargetStep
              scope={state.scope}
              channel={state.channel}
              dmMode={state.dmMode}
              dmAllowlistInput={state.dmAllowlistInput ?? ""}
              groupChatId={state.groupChatId ?? ""}
              groupForumEnabled={state.groupForumEnabled ?? false}
              groupTopicsInput={state.groupTopicsInput ?? ""}
              onDmModeChange={handleDmModeChange}
              onDmAllowlistChange={handleDmAllowlistChange}
              onGroupChatIdChange={handleGroupChatIdChange}
              onGroupForumChange={handleGroupForumChange}
              onGroupTopicsChange={handleGroupTopicsChange}
            />
          )}
          {step === "behavior" && state.scope !== "dm" && (
            <BehaviorStep
              selected={state.behaviorChoice}
              onSelect={handleBehaviorSelect}
            />
          )}
          {step === "preview" && previewRoute && (
            <PreviewStep
              route={previewRoute}
              context={describeContext}
              yamlDiff={previewYamlDiff(previewRoute)}
              saving={saving}
              saveError={saveError}
              onSave={handleSave}
            />
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={goBack}
            disabled={STEP_ORDER.indexOf(step) === 0}
            data-testid="binding-wizard-back"
          >
            Back
          </Button>
          {step !== "preview" && (
            <Button
              type="button"
              size="sm"
              onClick={goNext}
              disabled={!canGoNext()}
              data-testid="binding-wizard-next"
            >
              Next
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
