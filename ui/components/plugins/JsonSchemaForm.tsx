"use client";

import { useEffect, useMemo, useState } from "react";
import { HelpCircle, KeyRound, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ANTHROPIC_MODELS } from "@/lib/anthropic-models";
import {
  DEFAULT_HONCHO_ANTHROPIC_MODEL,
  DEFAULT_HONCHO_OPENAI_MODEL,
  modelsForProvider,
} from "@/lib/llm-models";

/* ------------------------------------------------------------------ */
/*  JSON Schema → Form generator                                       */
/*                                                                     */
/*  Mirrors the agent-config page's Section/Field/Tip styling so the   */
/*  plugin form looks native to the main app, not bolted on.           */
/*                                                                     */
/*  Supports the subset Zod 4 produces:                                */
/*    - object / properties (nested → titled section)                  */
/*    - string  (with inline help + `?` tooltip from .describe())       */
/*    - number / integer                                               */
/*    - boolean                                                        */
/*    - enum (string)                                                  */
/*    - array of primitives (string/number/boolean)                    */
/*                                                                     */
/*  Field name heuristics:                                             */
/*    - `model` or `*_model` strings → Anthropic models dropdown       */
/*                                                                     */
/*  Anything else falls back to a JSON textarea (validate on blur).    */
/* ------------------------------------------------------------------ */

export interface ZodIssue {
  path?: (string | number)[];
  message?: string;
  code?: string;
}

interface FormProps {
  schema: Record<string, unknown>;
  values: Record<string, unknown>;
  fieldErrors: Record<string, string>;
  onChange: (next: Record<string, unknown>) => void;
}

export function JsonSchemaForm(props: FormProps) {
  return (
    <SchemaNode
      schema={props.schema}
      value={props.values}
      onChange={(v) =>
        props.onChange((v && typeof v === "object" ? (v as Record<string, unknown>) : {}) ?? {})
      }
      path={[]}
      fieldErrors={props.fieldErrors}
      rootValues={props.values}
    />
  );
}

interface NodeProps {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (next: unknown) => void;
  path: string[];
  fieldErrors: Record<string, string>;
  rootValues: Record<string, unknown>;
  label?: string;
  description?: string;
}

const INPUT_CLASS =
  "h-8 w-full rounded-[5px] border px-2 text-xs outline-none";
const SELECT_CLASS =
  "h-8 w-full cursor-pointer rounded-[5px] border px-2 text-xs";
const FIELD_STYLE: React.CSSProperties = {
  background: "var(--oc-bg3)",
  borderColor: "var(--oc-border)",
  color: "var(--color-foreground)",
};
const MONO_FIELD_STYLE: React.CSSProperties = {
  ...FIELD_STYLE,
  fontFamily: "var(--oc-mono)",
};

/** Field name implies Anthropic model selection — render dropdown. */
function isModelField(label: string | undefined): boolean {
  if (!label) return false;
  return label === "model" || label.endsWith("_model") || label.endsWith("Model");
}

function isProviderScopedModelField(pathKey: string): boolean {
  return pathKey === "llm.model" || pathKey.endsWith(".llm.model");
}

function isLlmObjectPath(pathKey: string): boolean {
  return pathKey === "llm" || pathKey.endsWith(".llm");
}

function isSecretRefField(label: string | undefined): boolean {
  return label === "api_key_secret_ref" || label === "secret_ref" || label?.endsWith("_secret_ref") === true;
}

function defaultModelForProvider(provider: unknown): string {
  return provider === "anthropic" ? DEFAULT_HONCHO_ANTHROPIC_MODEL : DEFAULT_HONCHO_OPENAI_MODEL;
}

function readStringAtPath(root: Record<string, unknown>, path: string[]): string | undefined {
  let cursor: unknown = root;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function humanizeLabel(label: string | undefined): string {
  if (!label) return "";
  return label
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\bId\b/g, "ID")
    .replace(/\bApi\b/g, "API")
    .replace(/\bUrl\b/g, "URL")
    .replace(/\bLlm\b/g, "LLM")
    .replace(/\bMs\b/g, "ms");
}

function SchemaNode(props: NodeProps) {
  const { schema, value, onChange, path, fieldErrors, rootValues, label, description } = props;
  const type = schema.type as string | string[] | undefined;
  const enumValues = schema.enum as unknown[] | undefined;
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (schema.required as string[] | undefined) ?? [];
  const items = schema.items as Record<string, unknown> | undefined;
  const desc = description ?? (schema.description as string | undefined);

  const pathKey = path.join(".");
  const error = fieldErrors[pathKey];

  // Enum (assume string for the common case)
  if (Array.isArray(enumValues)) {
    return (
      <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
        <select
          className={SELECT_CLASS}
          style={FIELD_STYLE}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(e) => {
            const v = e.target.value;
            const matched = enumValues.find((ev) => String(ev) === v);
            onChange(matched ?? v);
          }}
          data-path={pathKey}
        >
          {enumValues.map((ev) => (
            <option key={String(ev)} value={String(ev)}>
              {String(ev)}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (type === "object" || (properties && !type)) {
    const v = (value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    if (!properties) {
      return (
        <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
          <JsonFallback value={value} onChange={onChange} />
        </Field>
      );
    }

    const isComplex = (s: Record<string, unknown>) => {
      const t = s.type as string | undefined;
      return t === "object" || t === "array" || (s.properties !== undefined && !t);
    };

    const primitives: [string, Record<string, unknown>][] = [];
    const complex: [string, Record<string, unknown>][] = [];
    for (const entry of Object.entries(properties)) {
      (isComplex(entry[1]) ? complex : primitives).push(entry);
    }

    const renderChild = ([key, propSchema]: [string, Record<string, unknown>]) => {
      const childPath = [...path, key];
      return (
        <SchemaNode
          key={key}
          schema={propSchema}
          value={v[key]}
          onChange={(next) => {
            const patched = { ...v, [key]: next };
            if (key === "provider" && isLlmObjectPath(pathKey) && "model" in properties) {
              patched.model = defaultModelForProvider(next);
              if ("api_key_secret_ref" in properties) {
                patched.api_key_secret_ref = undefined;
              }
            }
            onChange(patched);
          }}
          path={childPath}
          fieldErrors={fieldErrors}
          label={key}
          description={propSchema.description as string | undefined}
          rootValues={rootValues}
        />
      );
    };

    const primitivesGrid = primitives.length > 0 ? <FormGrid>{primitives.map(renderChild)}</FormGrid> : null;

    if (path.length === 0) {
      return (
        <div className="flex flex-col gap-3.5" data-path="root">
          {primitivesGrid}
          {complex.map(renderChild)}
        </div>
      );
    }

    return (
      <Section
        title={label ?? ""}
        tooltip={desc}
        pathKey={pathKey || "root"}
        required={label ? required.includes(label) : false}
      >
        {primitivesGrid}
        {complex.length > 0 && (
          <div className={primitives.length > 0 ? "mt-3.5 flex flex-col gap-3.5" : "flex flex-col gap-3.5"}>
            {complex.map(renderChild)}
          </div>
        )}
      </Section>
    );
  }

  if (type === "boolean") {
    return (
      <Field label={label} tooltip={desc} pathKey={pathKey} error={error} inline>
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: "var(--oc-accent)", width: 16, height: 16 }}
          data-path={pathKey}
        />
      </Field>
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
        <input
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          step={type === "integer" ? 1 : "any"}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") {
              onChange(undefined);
              return;
            }
            const n = type === "integer" ? parseInt(raw, 10) : parseFloat(raw);
            onChange(Number.isNaN(n) ? raw : n);
          }}
          className={INPUT_CLASS}
          style={MONO_FIELD_STYLE}
          data-path={pathKey}
        />
      </Field>
    );
  }

  if (type === "string") {
    if (isProviderScopedModelField(pathKey)) {
      const current = typeof value === "string" ? value : "";
      const provider = readStringAtPath(rootValues, [...path.slice(0, -1), "provider"]);
      const modelOptions = modelsForProvider(provider);
      const fallbackModel = defaultModelForProvider(provider);
      const isCustom = current !== "" && !modelOptions.includes(current);
      return (
        <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
          <select
            className={SELECT_CLASS}
            style={FIELD_STYLE}
            value={current || fallbackModel}
            onChange={(e) => onChange(e.target.value)}
            data-path={pathKey}
            data-provider-model-select
          >
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {isCustom && (
              <option key={`extra-${current}`} value={current}>
                {current} (custom)
              </option>
            )}
          </select>
        </Field>
      );
    }

    if (isSecretRefField(label)) {
      return (
        <SecretRefField
          label={label}
          tooltip={desc}
          pathKey={pathKey}
          error={error}
          value={typeof value === "string" ? value : ""}
          provider={readStringAtPath(rootValues, [...path.slice(0, -1), "provider"])}
          onChange={onChange}
        />
      );
    }

    // Anthropic-model dropdown for generic fields named `model` / `*_model`.
    if (isModelField(label)) {
      const current = typeof value === "string" ? value : "";
      const isCustom =
        current !== "" &&
        !ANTHROPIC_MODELS.includes(current as typeof ANTHROPIC_MODELS[number]);
      return (
        <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
          <select
            className={SELECT_CLASS}
            style={FIELD_STYLE}
            value={current}
            onChange={(e) => {
              const v = e.target.value;
              onChange(v === "" ? undefined : v);
            }}
            data-path={pathKey}
            data-model-select
          >
            <option value="">— inherit from agent —</option>
            {ANTHROPIC_MODELS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {isCustom && (
              <option key={`extra-${current}`} value={current}>
                {current} (custom)
              </option>
            )}
          </select>
        </Field>
      );
    }
    return (
      <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
        <input
          type="text"
          value={typeof value === "string" ? value : value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          className={INPUT_CLASS}
          style={MONO_FIELD_STYLE}
          data-path={pathKey}
        />
      </Field>
    );
  }

  if (type === "array") {
    const arr = Array.isArray(value) ? value : [];
    const itemType = (items?.type as string | undefined) ?? "string";
    if (
      itemType === "string" ||
      itemType === "number" ||
      itemType === "integer" ||
      itemType === "boolean"
    ) {
      return (
        <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
          <div className="flex flex-col gap-2">
            {arr.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <SchemaNode
                  schema={items ?? { type: itemType }}
                  value={item}
                  onChange={(next) => {
                    const copy = [...arr];
                    copy[idx] = next;
                    onChange(copy);
                  }}
                  path={[...path, String(idx)]}
                  fieldErrors={fieldErrors}
                  rootValues={rootValues}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const copy = [...arr];
                    copy.splice(idx, 1);
                    onChange(copy);
                  }}
                  data-testid={`array-remove-${pathKey}-${idx}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const next =
                  itemType === "boolean"
                    ? false
                    : itemType === "number" || itemType === "integer"
                      ? 0
                      : "";
                onChange([...arr, next]);
              }}
              data-testid={`array-add-${pathKey}`}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add item
            </Button>
          </div>
        </Field>
      );
    }
    return (
      <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
        <JsonFallback value={value} onChange={onChange} />
      </Field>
    );
  }

  // Fallback for oneOf/anyOf/recursive/etc.
  return (
    <Field label={label} tooltip={desc} pathKey={pathKey} error={error}>
      <JsonFallback value={value} onChange={onChange} />
    </Field>
  );
}

function SecretRefField({
  label,
  tooltip,
  pathKey,
  error,
  value,
  provider,
  onChange,
}: {
  label?: string;
  tooltip?: string;
  pathKey: string;
  error?: string;
  value: string;
  provider?: string;
  onChange: (next: unknown) => void;
}) {
  const [secretValue, setSecretValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const effectiveProvider = provider === "anthropic" ? "anthropic" : "openai";
  const key = `${effectiveProvider}_api_key`;

  const saveSecret = async () => {
    setSaving(true);
    setLocalError("");
    try {
      const res = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "global",
          service: "honcho",
          key,
          label: `Honcho ${effectiveProvider} API key`,
          value: secretValue,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message ?? `Secret save failed (${res.status})`);
      }
      const ref = typeof data.secret?.ref === "string" ? data.secret.ref : "";
      if (!ref) throw new Error("Secret API did not return a vault ref.");
      onChange(ref);
      setSecretValue("");
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Failed to save secret.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Field label={label} tooltip={tooltip} pathKey={pathKey} error={error ?? localError}>
      <div className="grid gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={`vault://global/honcho/${key}`}
          className={INPUT_CLASS}
          style={MONO_FIELD_STYLE}
          data-path={pathKey}
        />
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={secretValue}
            onChange={(e) => setSecretValue(e.target.value)}
            placeholder={`Paste ${effectiveProvider} API key`}
            className={INPUT_CLASS}
            style={FIELD_STYLE}
            data-testid={`secret-value-${pathKey}`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!secretValue || saving}
            onClick={() => void saveSecret()}
            data-testid={`secret-save-${pathKey}`}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {saving ? "Saving..." : "Store"}
          </Button>
        </div>
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/*  Section — titled card matching the agent-config Section style      */
/* ------------------------------------------------------------------ */

function Section({
  title,
  tooltip,
  pathKey,
  required,
  children,
}: {
  title: string;
  tooltip?: string;
  pathKey: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-md"
      style={{ background: "var(--oc-bg1)", border: "1px solid var(--oc-border)" }}
      data-path={pathKey}
    >
      <div
        className="flex items-center gap-2 px-3.5 py-2.5"
        style={{ borderBottom: "1px solid var(--oc-border)" }}
      >
        <span
          className="text-[13px] font-semibold"
          style={{ color: "var(--color-foreground)" }}
        >
          {humanizeLabel(title)}
          {required ? " *" : ""}
        </span>
        {tooltip && <Tip text={tooltip} />}
      </div>
      {tooltip && (
        <div
          className="px-3.5 pt-3 text-[11.5px] leading-relaxed whitespace-pre-line"
          style={{ color: "var(--oc-text-dim)" }}
          data-testid={`section-help-${pathKey || "root"}`}
        >
          {tooltip}
        </div>
      )}
      <div className="p-3.5">{children}</div>
    </div>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3.5">{children}</div>;
}

/* ------------------------------------------------------------------ */
/*  Tip — `?` icon with hover popover                                  */
/* ------------------------------------------------------------------ */

function Tip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-flex cursor-help" data-testid="field-tip">
      <HelpCircle
        className="h-3 w-3"
        style={{ color: "var(--oc-text-muted)", opacity: 0.6 }}
      />
      <span
        className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 hidden w-max max-w-[260px] -translate-x-1/2 rounded-md px-2.5 py-1.5 text-[11px] font-normal normal-case tracking-normal leading-[1.45] group-hover:block"
        style={{
          zIndex: 9999,
          background: "var(--oc-bg3)",
          border: "1px solid var(--oc-border)",
          color: "var(--color-foreground)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
        role="tooltip"
      >
        {text}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Field wrapper — matches the agent-config Field component           */
/* ------------------------------------------------------------------ */

interface FieldWrapperProps {
  label?: string;
  tooltip?: string;
  pathKey: string;
  error?: string;
  inline?: boolean;
  children: React.ReactNode;
}

function Field({ label, tooltip, pathKey, error, inline, children }: FieldWrapperProps) {
  const displayLabel = humanizeLabel(label);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field-path={pathKey || "root"}>
      {label && (
        <label
          className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.4px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          <span>{displayLabel}</span>
          {displayLabel !== label && (
            <span
              className="normal-case tracking-normal"
              style={{
                color: "var(--oc-text-muted)",
                fontFamily: "var(--oc-mono)",
                opacity: 0.72,
              }}
            >
              {label}
            </span>
          )}
          {tooltip && <Tip text={tooltip} />}
        </label>
      )}
      {inline ? <div>{children}</div> : children}
      {tooltip && (
        <p
          className="text-[11.5px] leading-relaxed whitespace-pre-line"
          style={{ color: "var(--oc-text-dim)" }}
          data-testid={`field-help-${pathKey || "root"}`}
        >
          {tooltip}
        </p>
      )}
      {error && (
        <p
          className="text-[11px]"
          style={{ color: "var(--oc-red, #f87171)" }}
          data-testid={`field-error-${pathKey || "root"}`}
        >
          {error}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  JSON textarea fallback                                             */
/* ------------------------------------------------------------------ */

function JsonFallback({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const initial = useMemo(() => {
    try {
      return value === undefined ? "" : JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }, [value]);

  const [text, setText] = useState(initial);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setText(initial);
    setParseError(null);
  }, [initial]);

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim() === "") {
            setParseError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(text);
            setParseError(null);
            onChange(parsed);
          } catch (err) {
            setParseError(err instanceof Error ? err.message : "Invalid JSON");
          }
        }}
        className="min-h-[100px] text-xs"
        style={{ fontFamily: "var(--oc-mono)" }}
      />
      {parseError && (
        <p className="text-[11px]" style={{ color: "var(--oc-red, #f87171)" }}>
          {parseError}
        </p>
      )}
    </div>
  );
}
