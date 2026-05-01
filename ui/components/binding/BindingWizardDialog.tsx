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
  if (!route) return {};
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
    reply_to_mode: route.reply_to_mode ?? route.replyToMode,
    pairing_mode: route.pairing_mode ?? route.pairingMode,
  };
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
  if (state.peers !== undefined) route.peers = state.peers;
  if (state.topics !== undefined) route.topics = state.topics;
  if (typeof state.mention_only === "boolean") {
    route.mention_only = state.mention_only;
  }
  if (state.reply_to_mode) route.reply_to_mode = state.reply_to_mode;
  if (state.pairing_mode) route.pairing_mode = state.pairing_mode;
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

  // Reset state whenever the dialog (re)opens.
  useEffect(() => {
    if (!open) return;
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

  const goBack = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx <= 0) return;
    setStep(STEP_ORDER[idx - 1]);
  };

  const goNext = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx === -1 || idx === STEP_ORDER.length - 1) return;
    setStep(STEP_ORDER[idx + 1]);
  };

  const canGoNext = (): boolean => {
    if (step === "channel") return Boolean(state.channel);
    if (step === "account") return Boolean(state.account);
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
            <p
              className="text-[12px]"
              style={{ color: "var(--oc-text-muted)" }}
              data-testid="binding-step-where-placeholder"
            >
              Where step — coming next.
            </p>
          )}
          {step === "target" && (
            <p
              className="text-[12px]"
              style={{ color: "var(--oc-text-muted)" }}
              data-testid="binding-step-target-placeholder"
            >
              Target step — coming next.
            </p>
          )}
          {step === "behavior" && (
            <p
              className="text-[12px]"
              style={{ color: "var(--oc-text-muted)" }}
              data-testid="binding-step-behavior-placeholder"
            >
              Behavior step — coming next.
            </p>
          )}
          {step === "preview" && (
            <div data-testid="binding-step-preview-placeholder">
              <p
                className="text-[12px]"
                style={{ color: "var(--oc-text-muted)" }}
              >
                Preview step — coming next.
              </p>
              <Button
                size="sm"
                disabled
                data-testid="binding-wizard-save-disabled"
              >
                Save
              </Button>
              {/* hidden runtime use for state and onSave to keep linter happy until later tasks */}
              <span className="sr-only">{JSON.stringify(state)}</span>
              <span className="sr-only">{typeof onSave}</span>
            </div>
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
