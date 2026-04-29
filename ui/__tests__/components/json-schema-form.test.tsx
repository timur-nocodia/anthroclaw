/**
 * Unit tests for JsonSchemaForm — validates the main-app UX overhaul:
 *  1. `_model` / `model` fields render a dropdown of canonical Anthropic
 *     models, with an "inherit" option and a custom-value passthrough.
 *  2. Field labels show a `?` tooltip whose text comes from `description`.
 *  3. Object children render as titled <Section/> cards (not bare fieldsets).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { JsonSchemaForm } from "@/components/plugins/JsonSchemaForm";
import { ANTHROPIC_MODELS } from "@/lib/anthropic-models";

describe("<JsonSchemaForm /> — model dropdown", () => {
  const schema = {
    type: "object",
    properties: {
      summarizer: {
        type: "object",
        properties: {
          summary_model: {
            type: "string",
            description: "Summary model description",
          },
        },
      },
    },
  };

  it("renders *_model fields as a select with the canonical Anthropic models", () => {
    render(
      <JsonSchemaForm
        schema={schema}
        values={{}}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );

    const select = document.querySelector(
      '[data-path="summarizer.summary_model"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.tagName).toBe("SELECT");
    expect(select.dataset.modelSelect).toBeTruthy();

    const optionValues = Array.from(select.options).map((o) => o.value);
    // The leading empty option (= inherit from agent) plus every canonical model.
    expect(optionValues).toContain("");
    for (const m of ANTHROPIC_MODELS) {
      expect(optionValues).toContain(m);
    }
  });

  it("preserves a custom value not in the canonical list as a passthrough option", () => {
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ summarizer: { summary_model: "claude-mystery-1" } }}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );

    const select = document.querySelector(
      '[data-path="summarizer.summary_model"]',
    ) as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.textContent);
    expect(opts.some((t) => t?.includes("claude-mystery-1"))).toBe(true);
    expect(select.value).toBe("claude-mystery-1");
  });

  it("changing dropdown to empty calls onChange(undefined) — inherit semantics", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const startValue = ANTHROPIC_MODELS[0];
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ summarizer: { summary_model: startValue } }}
        fieldErrors={{}}
        onChange={onChange}
      />,
    );

    const select = document.querySelector(
      '[data-path="summarizer.summary_model"]',
    ) as HTMLSelectElement;
    expect(select.value).toBe(startValue);

    await user.selectOptions(select, "");

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last).toEqual({ summarizer: { summary_model: undefined } });
  });
});

describe("<JsonSchemaForm /> — tooltips from description", () => {
  it("attaches a `?` tooltip when a field has a description", () => {
    const schema = {
      type: "object",
      properties: {
        threshold: { type: "integer", description: "Token threshold" },
      },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{}}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );
    const tips = screen.getAllByTestId("field-tip");
    expect(tips.length).toBeGreaterThan(0);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Token threshold");
  });

  it("omits the tooltip when no description is provided", () => {
    const schema = {
      type: "object",
      properties: { threshold: { type: "integer" } },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{}}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId("field-tip")).not.toBeInTheDocument();
  });
});

describe("<JsonSchemaForm /> — nested object sections", () => {
  it("renders nested object as a titled section header", () => {
    const schema = {
      type: "object",
      properties: {
        triggers: {
          type: "object",
          description: "Trigger settings",
          properties: {
            threshold: { type: "integer" },
          },
        },
      },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{}}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );

    // Section header renders the property key as the title.
    expect(screen.getByText("triggers")).toBeInTheDocument();
    // And the section description surfaces via tooltip.
    expect(screen.getByRole("tooltip")).toHaveTextContent("Trigger settings");
  });
});

describe("<JsonSchemaForm /> — primitive types", () => {
  it("renders integer field as <input type=number>", () => {
    const schema = {
      type: "object",
      properties: { count: { type: "integer" } },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ count: 42 }}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );
    const input = document.querySelector('[data-path="count"]') as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.value).toBe("42");
  });

  it("renders boolean field as a checkbox", () => {
    const schema = {
      type: "object",
      properties: { flag: { type: "boolean" } },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ flag: true }}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );
    const input = document.querySelector('[data-path="flag"]') as HTMLInputElement;
    expect(input.type).toBe("checkbox");
    expect(input.checked).toBe(true);
  });

  it("renders enum field as a select", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["a", "b", "c"] },
      },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ mode: "b" }}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );
    const select = document.querySelector('[data-path="mode"]') as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(select.value).toBe("b");
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["a", "b", "c"]);
  });

  it("renders string field as text input", () => {
    const schema = {
      type: "object",
      properties: { name: { type: "string" } },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ name: "alpha" }}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );
    const input = document.querySelector('[data-path="name"]') as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.value).toBe("alpha");
  });

  it("propagates field errors via testid", () => {
    const schema = {
      type: "object",
      properties: { count: { type: "integer" } },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ count: "not-a-number" }}
        fieldErrors={{ count: "Expected integer" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("field-error-count")).toHaveTextContent("Expected integer");
  });

  it("propagates field errors on a nested path", () => {
    const schema = {
      type: "object",
      properties: {
        triggers: {
          type: "object",
          properties: { threshold: { type: "integer" } },
        },
      },
    };
    render(
      <JsonSchemaForm
        schema={schema}
        values={{}}
        fieldErrors={{ "triggers.threshold": "Must be positive" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("field-error-triggers.threshold")).toHaveTextContent(
      "Must be positive",
    );
  });
});

describe("<JsonSchemaForm /> — array fields", () => {
  const schema = {
    type: "object",
    properties: {
      tags: {
        type: "array",
        items: { type: "string" },
      },
    },
  };

  it("adds a new item via Add button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ tags: ["a"] }}
        fieldErrors={{}}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByTestId("array-add-tags"));

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last).toEqual({ tags: ["a", ""] });
  });

  it("removes an item via the X button", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ tags: ["a", "b", "c"] }}
        fieldErrors={{}}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByTestId("array-remove-tags-1"));

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last).toEqual({ tags: ["a", "c"] });
  });

  it("seeds the right zero-value for non-string item types", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JsonSchemaForm
        schema={{
          type: "object",
          properties: {
            counts: { type: "array", items: { type: "integer" } },
          },
        }}
        values={{ counts: [] }}
        fieldErrors={{}}
        onChange={onChange}
      />,
    );

    await user.click(screen.getByTestId("array-add-counts"));

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last).toEqual({ counts: [0] });
  });
});

describe("<JsonSchemaForm /> — JSON fallback", () => {
  // Schemas without `properties` and without `type` fall through to the JSON
  // textarea fallback. This is the escape hatch for things Zod 4 emits that
  // we don't render natively (oneOf/anyOf/recursive/etc.).
  const schema = {
    type: "object",
    properties: {
      blob: {},
    },
  };

  it("renders a textarea with serialized JSON for unsupported schemas", () => {
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ blob: { foo: 1 } }}
        fieldErrors={{}}
        onChange={() => {}}
      />,
    );
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(JSON.parse(textarea.value)).toEqual({ foo: 1 });
  });

  it("commits a parsed value via onChange when textarea blurs with valid JSON", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ blob: {} }}
        fieldErrors={{}}
        onChange={onChange}
      />,
    );
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, '{{"k":42}');
    await user.tab();      // blur

    const last = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];
    expect(last).toEqual({ blob: { k: 42 } });
  });

  it("shows a parse error when blurring with invalid JSON without calling onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <JsonSchemaForm
        schema={schema}
        values={{ blob: {} }}
        fieldErrors={{}}
        onChange={onChange}
      />,
    );
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    await user.clear(textarea);
    await user.type(textarea, "not json");
    await user.tab();

    // The error banner appears under the textarea
    const errorEls = document.querySelectorAll("p");
    const hasParseError = Array.from(errorEls).some((el) =>
      /JSON|Unexpected/i.test(el.textContent ?? ""),
    );
    expect(hasParseError).toBe(true);
    // Invalid JSON should not call onChange (commit is gated on parse success)
    expect(onChange).not.toHaveBeenCalled();
  });
});
