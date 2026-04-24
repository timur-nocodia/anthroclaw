"use client";

import type { StepProps } from "./types";
import { Field, WizardInput, Segmented } from "./field";

export function StepIdentity({ config, updateConfig }: StepProps) {
  return (
    <>
      <Field
        label="Gateway name"
        hint="Used as hostname & slug. Must be unique within the fleet."
      >
        <WizardInput
          value={config.name}
          onChange={(v) => updateConfig("name", v)}
          placeholder="gw-prod-jp"
          mono
        />
      </Field>

      <Field label="Environment">
        <Segmented
          value={config.environment}
          onChange={(v) => updateConfig("environment", v)}
          options={[
            { value: "production", label: "Production" },
            { value: "staging", label: "Staging" },
            { value: "development", label: "Development" },
          ]}
        />
      </Field>

      <Field
        label="Region"
        hint="Primarily informational — used for map, sorting, and latency routing hints."
      >
        <WizardInput
          value={config.region}
          onChange={(v) => updateConfig("region", v)}
          placeholder="ap-northeast-1"
          mono
        />
      </Field>

      <Field
        label="City"
        hint="Displayed alongside server name in fleet overview."
      >
        <WizardInput
          value={config.city}
          onChange={(v) => updateConfig("city", v)}
          placeholder="Tokyo"
        />
      </Field>
    </>
  );
}
