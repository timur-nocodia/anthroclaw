"use client";

import type { StepProps } from "./types";
import { Field, WizardInput, Segmented, ToggleSwitch } from "./field";

export function StepPolicies({ config, updateConfig }: StepProps) {
  return (
    <>
      <Field label="Backup schedule">
        <Segmented
          value={config.backupSchedule}
          onChange={(v) => updateConfig("backupSchedule", v)}
          options={[
            { value: "disabled", label: "Disabled" },
            { value: "daily", label: "Daily at 3am" },
            { value: "weekly", label: "Weekly on Sunday" },
            { value: "custom", label: "Custom cron" },
          ]}
        />
      </Field>

      {config.backupSchedule !== "disabled" && (
        <Field
          label="Backup destination"
          hint='Local stores on server. S3-compatible URL like "s3://bucket/path" requires AWS credentials.'
        >
          <WizardInput
            value={config.backupDestination}
            onChange={(v) => updateConfig("backupDestination", v)}
            placeholder="local"
            mono
          />
        </Field>
      )}

      <ToggleSwitch
        label="Enable heartbeat monitoring"
        hint="Fleet checks every 30s. Enables alert notifications for this gateway."
        value={config.monitoring}
        onChange={(v) => updateConfig("monitoring", v)}
      />

      <Field label="Log retention" hint="Applies to pino log files, not agent memory.">
        <Segmented
          value={config.logRetention}
          onChange={(v) => updateConfig("logRetention", v)}
          options={[
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "90d", label: "90 days" },
            { value: "unlimited", label: "Unlimited" },
          ]}
        />
      </Field>

      <Field
        label="Max media storage (GB)"
        hint="Auto-cleanup oldest media files when limit reached."
      >
        <WizardInput
          value={config.maxMediaGB}
          onChange={(v) => updateConfig("maxMediaGB", parseInt(v) || 5)}
          type="number"
          mono
        />
      </Field>
    </>
  );
}
