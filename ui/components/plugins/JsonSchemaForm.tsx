"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  JSON Schema → Form generator                                       */
/*                                                                     */
/*  Supports the subset Zod 4 produces:                                */
/*    - object/properties (with nested objects)                        */
/*    - string                                                         */
/*    - number / integer                                               */
/*    - boolean                                                        */
/*    - enum (string)                                                  */
/*    - array of primitives (string/number/boolean)                    */
/*    - description → helper text                                      */
/*    - default values from `defaults` are merged in by the caller     */
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
      <Field label={label} description={desc} pathKey={pathKey} error={error}>
        <select
          className="h-9 w-full rounded-[5px] border px-2 text-xs outline-none"
          style={{
            background: "var(--oc-bg3)",
            borderColor: "var(--oc-border)",
            color: "var(--color-foreground)",
            fontFamily: "var(--oc-mono)",
          }}
          value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
          onChange={(e) => {
            const v = e.target.value;
            // Try to coerce back to the original type from enum
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
      // No declared properties → fallback to JSON
      return (
        <Field label={label} description={desc} pathKey={pathKey} error={error}>
          <JsonFallback value={value} onChange={onChange} />
        </Field>
      );
    }
    const propEntries = Object.entries(properties);
    const root = path.length === 0;
    return (
      <fieldset
        className={root ? "flex flex-col gap-3" : "flex flex-col gap-3 rounded-md border p-3"}
        style={
          root
            ? undefined
            : { borderColor: "var(--oc-border)", background: "var(--oc-bg1)" }
        }
        data-path={pathKey || "root"}
      >
        {label && !root && (
          <legend
            className="px-1 text-xs font-medium"
            style={{ color: "var(--oc-text-muted)" }}
          >
            {label}
            {required.includes(label) ? " *" : ""}
          </legend>
        )}
        {desc && !root && (
          <p className="-mt-1 text-[11px]" style={{ color: "var(--oc-text-dim)" }}>
            {desc}
          </p>
        )}
        {propEntries.map(([key, propSchema]) => (
          <SchemaNode
            key={key}
            schema={propSchema}
            value={v[key]}
            onChange={(next) => {
              const updated = { ...v, [key]: next };
              onChange(updated);
            }}
            path={[...path, key]}
            fieldErrors={fieldErrors}
            label={key}
            description={propSchema.description as string | undefined}
          />
        ))}
      </fieldset>
    );
  }

  if (type === "boolean") {
    return (
      <Field label={label} description={desc} pathKey={pathKey} error={error} inline>
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
      <Field label={label} description={desc} pathKey={pathKey} error={error}>
        <Input
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
          className="h-9 text-xs"
          style={{ fontFamily: "var(--oc-mono)" }}
          data-path={pathKey}
        />
      </Field>
    );
  }

  if (type === "string") {
    return (
      <Field label={label} description={desc} pathKey={pathKey} error={error}>
        <Input
          type="text"
          value={typeof value === "string" ? value : value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 text-xs"
          style={{ fontFamily: "var(--oc-mono)" }}
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
        <Field label={label} description={desc} pathKey={pathKey} error={error}>
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
    // Non-primitive arrays → fallback
    return (
      <Field label={label} description={desc} pathKey={pathKey} error={error}>
        <JsonFallback value={value} onChange={onChange} />
      </Field>
    );
  }

  // Fallback for oneOf/anyOf/recursive/etc.
  return (
    <Field label={label} description={desc} pathKey={pathKey} error={error}>
      <JsonFallback value={value} onChange={onChange} />
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/*  Field wrapper                                                      */
/* ------------------------------------------------------------------ */

interface FieldWrapperProps {
  label?: string;
  description?: string;
  pathKey: string;
  error?: string;
  inline?: boolean;
  children: React.ReactNode;
}

function Field({ label, description, pathKey, error, inline, children }: FieldWrapperProps) {
  return (
    <div className="flex flex-col gap-1" data-field-path={pathKey || "root"}>
      {label && (
        <div
          className={inline ? "flex items-center justify-between gap-3" : "flex flex-col gap-1"}
        >
          <label
            className="text-xs"
            style={{ color: "var(--oc-text-muted)", fontFamily: "var(--oc-mono)" }}
          >
            {label}
          </label>
          {inline && children}
        </div>
      )}
      {!inline && children}
      {description && (
        <p className="text-[11px]" style={{ color: "var(--oc-text-dim)" }}>
          {description}
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
