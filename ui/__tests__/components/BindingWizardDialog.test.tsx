import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  BindingWizardDialog,
  type WizardAccountsConfig,
} from "@/components/binding/BindingWizardDialog";

const bothChannels: WizardAccountsConfig = {
  telegram: {
    main: { username: "clowwy_personal_bot" },
    content_sm: { username: "clowwy_bot" },
  },
  whatsapp: { humanrobot: {} },
};

describe("BindingWizardDialog — Channel + Account steps", () => {
  it("Step 1 selects telegram and advances to account step", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByTestId("binding-step-channel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("binding-channel-telegram"));
    expect(screen.getByTestId("binding-step-account")).toBeInTheDocument();
    // Step label should reflect step 2.
    expect(screen.getByTestId("binding-wizard-step-label").textContent).toMatch(
      /Step 2 of 6/,
    );
  });

  it("Step 1 auto-advances when only one channel is configured", () => {
    const single: WizardAccountsConfig = {
      telegram: {
        main: { username: "a" },
        backup: { username: "b" },
      },
      whatsapp: {},
    };
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={single}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.queryByTestId("binding-step-channel")).not.toBeInTheDocument();
    // Two telegram accounts → wizard stops on Step 2 to let operator pick.
    expect(screen.getByTestId("binding-step-account")).toBeInTheDocument();
  });

  it("Step 2 lists accounts from props with username + id", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByTestId("binding-channel-telegram"));
    const select = screen.getByTestId(
      "binding-account-select",
    ) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toContain("clowwy_personal_bot (main)");
    expect(optionLabels).toContain("clowwy_bot (content_sm)");
  });

  it("Step 2 auto-advances when only one account is configured", () => {
    const single: WizardAccountsConfig = {
      telegram: {},
      whatsapp: { humanrobot: { username: "humanrobot" } },
    };
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={single}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    // Both auto-advances should fire — channel (only whatsapp) and account (only humanrobot).
    expect(screen.getByTestId("binding-wizard-step-label").textContent).toMatch(
      /Step 3 of 6/,
    );
  });

  it("Back button preserves prior selection", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByTestId("binding-channel-telegram"));
    expect(screen.getByTestId("binding-step-account")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("binding-wizard-back"));
    // Telegram card should still be marked as selected (aria-pressed).
    const tg = screen.getByTestId("binding-channel-telegram");
    expect(tg.getAttribute("aria-pressed")).toBe("true");
  });

  it("falls back to id-only label when username is missing", () => {
    const noNames: WizardAccountsConfig = {
      telegram: {
        mystery: {},
        another: { username: "another_bot" },
      },
      whatsapp: {},
    };
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={noNames}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const select = screen.getByTestId(
      "binding-account-select",
    ) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toContain("mystery");
    expect(labels).toContain("another_bot (another)");
  });
});

function advanceToStep(target: "where" | "target"): void {
  // From freshly opened dialog at "channel" step.
  fireEvent.click(screen.getByTestId("binding-channel-telegram"));
  // Pick first account.
  const select = screen.getByTestId(
    "binding-account-select",
  ) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: select.options[1].value } });
  fireEvent.click(screen.getByTestId("binding-wizard-next"));
  if (target === "where") return;
  // Pick scope; let caller refine after this returns.
}

describe("BindingWizardDialog — Where + Target steps", () => {
  it("Step 3 presents DM/Group/Both radios", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    expect(screen.getByTestId("binding-step-where")).toBeInTheDocument();
    expect(screen.getByTestId("binding-scope-dm")).toBeInTheDocument();
    expect(screen.getByTestId("binding-scope-group")).toBeInTheDocument();
    expect(screen.getByTestId("binding-scope-any")).toBeInTheDocument();
  });

  it("Step 4 DM sub-flow shows All users vs Allowlisted radios", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-dm"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    expect(screen.getByTestId("binding-target-dm")).toBeInTheDocument();
    expect(screen.getByTestId("binding-target-dm-all")).toBeInTheDocument();
    expect(
      screen.getByTestId("binding-target-dm-allowlist"),
    ).toBeInTheDocument();
    // Allowlist input only after picking allowlist.
    expect(
      screen.queryByTestId("binding-target-dm-allowlist-input"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("binding-target-dm-allowlist"));
    expect(
      screen.getByTestId("binding-target-dm-allowlist-input"),
    ).toBeInTheDocument();
  });

  it("Step 4 Group sub-flow: chat ID input + forum toggle + topic input", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-group"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    expect(screen.getByTestId("binding-target-group")).toBeInTheDocument();
    expect(
      screen.getByTestId("binding-target-group-chat-id"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("binding-target-group-forum-toggle"),
    ).toBeInTheDocument();
    // Topics input not visible until forum toggle is on.
    expect(
      screen.queryByTestId("binding-target-group-topics-input"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("binding-target-group-forum-toggle"));
    expect(
      screen.getByTestId("binding-target-group-topics-input"),
    ).toBeInTheDocument();
  });

  it("forum toggle off hides topic input", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-group"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.click(screen.getByTestId("binding-target-group-forum-toggle"));
    expect(
      screen.getByTestId("binding-target-group-topics-input"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("binding-target-group-forum-toggle"));
    expect(
      screen.queryByTestId("binding-target-group-topics-input"),
    ).not.toBeInTheDocument();
  });

  it("validates chat ID format hint shows for non-`-100…` value", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-group"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    const input = screen.getByTestId(
      "binding-target-group-chat-id",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "garbage" } });
    expect(
      screen.getByTestId("binding-target-group-chat-id-warning"),
    ).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "-1003729315809" } });
    expect(
      screen.queryByTestId("binding-target-group-chat-id-warning"),
    ).not.toBeInTheDocument();
  });

  it("Step 4 with scope=any shows BOTH DM and Group sub-flows stacked", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-any"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    expect(screen.getByTestId("binding-target-dm")).toBeInTheDocument();
    expect(screen.getByTestId("binding-target-group")).toBeInTheDocument();
  });
});

import { waitFor } from "@testing-library/react";

describe("BindingWizardDialog — Behavior + Preview steps", () => {
  it("Step 5 (Behavior) shows three radios for group scope", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-group"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.change(screen.getByTestId("binding-target-group-chat-id"), {
      target: { value: "-1003729315809" },
    });
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    expect(screen.getByTestId("binding-step-behavior")).toBeInTheDocument();
    expect(
      screen.getByTestId("binding-behavior-mention_only"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("binding-behavior-all")).toBeInTheDocument();
    expect(
      screen.getByTestId("binding-behavior-incoming_reply_only"),
    ).toBeInTheDocument();
  });

  it("Step 5 skipped for DM-only scope", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-dm"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    // Now in target step (DM); next should jump straight to preview, skipping behavior.
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    expect(
      screen.queryByTestId("binding-step-behavior"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("binding-step-preview")).toBeInTheDocument();
  });

  it("Step 6 (Preview) shows plain-language summary via describeBinding", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-group"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.change(screen.getByTestId("binding-target-group-chat-id"), {
      target: { value: "-1003729315809" },
    });
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.click(screen.getByTestId("binding-behavior-mention_only"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    expect(screen.getByTestId("binding-step-preview")).toBeInTheDocument();
    expect(screen.getByText("In group: -1003729315809")).toBeInTheDocument();
    expect(
      screen.getByText("Behavior: Responds only when @-mentioned"),
    ).toBeInTheDocument();
  });

  it("Step 6 shows YAML diff when toggle is clicked", () => {
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-group"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.change(screen.getByTestId("binding-target-group-chat-id"), {
      target: { value: "-1003729315809" },
    });
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.click(screen.getByTestId("binding-behavior-mention_only"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    expect(
      screen.queryByTestId("binding-preview-yaml-diff"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("binding-preview-diff-toggle"));
    const diff = screen.getByTestId("binding-preview-yaml-diff");
    expect(diff).toBeInTheDocument();
    expect(diff.textContent).toMatch(/channel: telegram/);
    expect(diff.textContent).toMatch(/peers: \["-1003729315809"\]/);
  });

  it("Step 6 Save calls onSave with assembled state", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <BindingWizardDialog
        open
        onOpenChange={onOpenChange}
        accounts={bothChannels}
        onSave={onSave}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-group"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.change(screen.getByTestId("binding-target-group-chat-id"), {
      target: { value: "-1003729315809" },
    });
    fireEvent.click(screen.getByTestId("binding-target-group-forum-toggle"));
    fireEvent.change(screen.getByTestId("binding-target-group-topics-input"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.click(screen.getByTestId("binding-behavior-mention_only"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.click(screen.getByTestId("binding-wizard-save"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const arg = onSave.mock.calls[0][0];
    expect(arg).toMatchObject({
      channel: "telegram",
      scope: "group",
      peers: ["-1003729315809"],
      topics: ["3"],
      mention_only: true,
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("Save error renders inline below the Save button", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <BindingWizardDialog
        open
        onOpenChange={vi.fn()}
        accounts={bothChannels}
        onSave={onSave}
      />,
    );
    advanceToStep("where");
    fireEvent.click(screen.getByTestId("binding-scope-group"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.change(screen.getByTestId("binding-target-group-chat-id"), {
      target: { value: "-1003729315809" },
    });
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.click(screen.getByTestId("binding-behavior-mention_only"));
    fireEvent.click(screen.getByTestId("binding-wizard-next"));
    fireEvent.click(screen.getByTestId("binding-wizard-save"));
    await waitFor(() => {
      expect(screen.getByTestId("binding-wizard-save-error")).toHaveTextContent(
        "boom",
      );
    });
  });
});
