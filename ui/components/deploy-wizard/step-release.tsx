"use client";

import type { StepProps } from "./types";
import { Field, WizardInput, Segmented } from "./field";

export function StepRelease({ config, updateConfig }: StepProps) {
  return (
    <>
      <Field label="Release channel">
        <Segmented
          value={config.channel}
          onChange={(v) => updateConfig("channel", v)}
          options={[
            { value: "stable", label: "stable (1.8.2)" },
            { value: "rc", label: "release-candidate (1.9.0-rc.3)" },
            { value: "dev", label: "dev (nightly)" },
            { value: "pin", label: "Pin version\u2026" },
          ]}
        />
      </Field>

      {config.channel === "pin" && (
        <Field label="Version to pin">
          <WizardInput
            value={config.version}
            onChange={(v) => updateConfig("version", v)}
            placeholder="1.8.2"
            mono
          />
        </Field>
      )}

      <Field label="Git repository" hint="Override for private forks.">
        <WizardInput
          value={config.gitRepo}
          onChange={(v) => updateConfig("gitRepo", v)}
          placeholder="https://github.com/org/anthroclaw.git"
          mono
        />
      </Field>

      <Field
        label="Upgrade policy"
        hint="Auto-updates run at 3am server local time."
      >
        <Segmented
          value={config.upgradePolicy}
          onChange={(v) => updateConfig("upgradePolicy", v)}
          options={[
            { value: "manual", label: "Manual only" },
            { value: "auto-patch", label: "Auto-patch" },
            { value: "auto-minor", label: "Auto-minor" },
            { value: "auto-latest", label: "Track latest" },
          ]}
        />
      </Field>
    </>
  );
}
