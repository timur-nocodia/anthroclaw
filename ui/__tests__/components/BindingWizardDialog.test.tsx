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
