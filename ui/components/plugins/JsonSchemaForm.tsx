"use client";

import { useEffect, useMemo, useState } from "react";
import { HelpCircle, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ANTHROPIC_MODELS } from "@/lib/anthropic-models";

/* ------------------------------------------------------------------ */
/*  JSON Schema → Form generator                                       */
/*                                                                     */
/*  Mirrors the agent-config page's Section/Field/Tip styling so the   */
/*  plugin form looks native to the main app, not bolted on.           */
/*                                                                     */
/*  Supports the subset Zod 4 produces:                                */
/*    - object / properties (nested → titled section)                  */
/*    - string  (with `?` tooltip from .describe())                    */
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
    />
  );
}

interface NodeProps {
  schema: Record<string, unknown>;
  value: unknown;
  onChange: (next: unknown) => void;
  path: string[];
  fieldErrors: Record<string, string>;
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

function SchemaNode(props: NodeProps) {
  const { schema, value, onChange, path, fieldErrors, label, description } = props;
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

    const renderChild = ([key, propSchema]: [string, Record<string, unknown>]) => (
      <SchemaNode
        key={key}
        schema={propSchema}
        value={v[key]}
        onChange={(next) => onChange({ ...v, [key]: next })}
        path={[...path, key]}
        fieldErrors={fieldErrors}
        label={key}
        description={propSchema.description as string | undefined}
      />
    );

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
    // Anthropic-model dropdown for fields named `model` / `*_model`.
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
          {title}
          {required ? " *" : ""}
        </span>
        {tooltip && <Tip text={tooltip} />}
      </div>
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
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-field-path={pathKey || "root"}>
      {label && (
        <label
          className="flex items-center text-[11px] font-medium uppercase tracking-[0.4px]"
          style={{ color: "var(--oc-text-muted)" }}
        >
          {label}
          {tooltip && <Tip text={tooltip} />}
        </label>
      )}
      {inline ? <div>{children}</div> : children}
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
