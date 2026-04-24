"use client";

import { Bot } from "lucide-react";
import type { StepProps } from "./types";
import { Field, WizardInput, Segmented } from "./field";

/* Mock agents — in production these would come from the source server API */
const AVAILABLE_AGENTS = [
  "orion",
  "support-fi",
  "billing-triage",
  "ops-runbook",
  "sales-intake",
];

export function StepAgents({ config, updateConfig }: StepProps) {
  const toggleAgent = (agent: string) => {
    const current = config.agents;
    if (current.includes(agent)) {
      updateConfig(
        "agents",
        current.filter((a) => a !== agent),
      );
    } else {
      updateConfig("agents", [...current, agent]);
    }
  };

  return (
    <>
      <Field label="Agent source">
        <Segmented
          value={config.agentSource}
          onChange={(v) => updateConfig("agentSource", v)}
          options={[
            { value: "blank", label: "Blank" },
            { value: "template", label: "From template" },
            { value: "git", label: "From git" },
          ]}
        />
      </Field>

      {config.agentSource === "blank" && (
        <div
          className="rounded-[5px] p-4 text-center text-[12px]"
          style={{
            background: "var(--oc-bg0)",
            border: "1px solid var(--oc-border)",
            color: "var(--oc-text-muted)",
          }}
        >
          Gateway will start with no agents. You can configure them after
          deployment.
        </div>
      )}

      {config.agentSource === "template" && (
        <>
          <Field
            label="Source gateway"
            hint="Select a gateway to copy agents from."
          >
            <WizardInput
              value={config.sourceServer}
              onChange={(v) => updateConfig("sourceServer", v)}
              placeholder="gw-prod-eu"
              mono
            />
          </Field>

          <Field
            label="Agents to deploy"
            hint="Agents are synced from the Agents workspace. You can change this anytime from the gateway detail."
          >
            <div className="flex flex-col gap-1.5">
              {AVAILABLE_AGENTS.map((a) => {
                const on = config.agents.includes(a);
                return (
                  <label
                    key={a}
                    className="flex cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 py-2"
                    style={{
                      background: on ? "var(--oc-bg2)" : "var(--oc-bg0)",
                      border: `1px solid ${on ? "rgba(110,231,183,0.3)" : "var(--oc-border)"}`,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleAgent(a)}
                      style={{ accentColor: "var(--oc-accent)" }}
                    />
                    <Bot
                      className="h-[13px] w-[13px]"
                      style={{ color: "var(--oc-accent)" }}
                    />
                    <span
                      className="text-[12.5px]"
                      style={{
                        color: "var(--color-foreground)",
                        fontFamily: "var(--oc-mono)",
                      }}
                    >
                      {a}
                    </span>
                  </label>
                );
              })}
            </div>
          </Field>
        </>
      )}

      {config.agentSource === "git" && (
        <>
          <Field label="Git URL" hint="Repository containing agent definitions.">
            <WizardInput
              value={config.agentGitUrl}
              onChange={(v) => updateConfig("agentGitUrl", v)}
              placeholder="https://github.com/org/agents.git"
              mono
            />
          </Field>
          <Field label="Branch / tag">
            <WizardInput
              value={config.agentGitRef}
              onChange={(v) => updateConfig("agentGitRef", v)}
              placeholder="main"
              mono
            />
          </Field>
        </>
      )}
    </>
  );
}
