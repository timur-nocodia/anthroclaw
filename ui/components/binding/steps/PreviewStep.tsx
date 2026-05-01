"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  describeBinding,
  type BindingDescribeContext,
  type BindingRouteInput,
} from "@/components/binding/binding-language";

export interface PreviewStepProps {
  route: BindingRouteInput;
  context?: BindingDescribeContext;
  yamlDiff: string;
  saving: boolean;
  saveError?: string | null;
  onSave: () => void;
}

export function PreviewStep({
  route,
  context,
  yamlDiff,
  saving,
  saveError,
  onSave,
}: PreviewStepProps) {
  const [diffOpen, setDiffOpen] = useState(false);
  const desc = describeBinding(route, context);

  return (
    <div className="flex flex-col gap-3" data-testid="binding-step-preview">
      <div className="flex flex-col gap-1">
        <span
          className="text-[12.5px] font-semibold"
          style={{ color: "var(--color-foreground)" }}
        >
          {desc.title}
        </span>
        <ul
          className="flex flex-col gap-0.5"
          data-testid="binding-preview-lines"
        >
          {desc.lines.map((line, i) => (
            <li
              key={i}
              className="text-[12px]"
              style={{ color: "var(--oc-text-muted)" }}
            >
              {line}
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => setDiffOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px]"
        style={{ color: "var(--oc-text-muted)" }}
        data-testid="binding-preview-diff-toggle"
      >
        {diffOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        Show YAML diff
      </button>
      {diffOpen && (
        <pre
          data-testid="binding-preview-yaml-diff"
          className="rounded-md border p-2 text-[11.5px] whitespace-pre-wrap"
          style={{
            background: "var(--oc-bg0)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
            fontFamily: "var(--oc-mono)",
          }}
        >
          {yamlDiff}
        </pre>
      )}

      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={onSave}
          disabled={saving}
          data-testid="binding-wizard-save"
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        {saveError && (
          <p
            className="text-[12px]"
            style={{ color: "var(--oc-danger, #b91c1c)" }}
            data-testid="binding-wizard-save-error"
          >
            {saveError}
          </p>
        )}
      </div>
    </div>
  );
}
