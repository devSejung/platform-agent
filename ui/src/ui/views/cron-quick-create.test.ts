/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { SessionsListResult } from "../types.ts";
import {
  createDefaultDraft,
  draftToCronFormPatch,
  renderCronQuickCreate,
  type CronQuickCreateDraft,
} from "./cron-quick-create.ts";

function renderInto(overrides?: {
  draft?: CronQuickCreateDraft;
  step?: "what" | "when" | "how";
  sessions?: SessionsListResult | null;
  employeeMode?: boolean;
  onDraftChange?: (patch: Partial<CronQuickCreateDraft>) => void;
  onStepChange?: (step: "what" | "when" | "how") => void;
  onCreate?: () => void;
}) {
  const container = document.createElement("div");
  render(
    renderCronQuickCreate({
      open: true,
      step: overrides?.step ?? "what",
      draft: overrides?.draft ?? createDefaultDraft(),
      employeeMode: overrides?.employeeMode,
      currentSessionKey: "agent:eon:main",
      sessions: overrides?.sessions ?? null,
      onDraftChange: overrides?.onDraftChange ?? (() => {}),
      onStepChange: overrides?.onStepChange ?? (() => {}),
      onCreate: overrides?.onCreate ?? (() => {}),
      onCancel: () => {},
      onAdvancedCreate: () => {},
    }),
    container,
  );
  return container;
}

describe("cron quick create", () => {
  it("renders the upstream-style first step and advances only with a prompt", async () => {
    await i18n.setLocale("en");
    const onStepChange = vi.fn();
    const container = renderInto({ onStepChange });

    expect(container.querySelector(".cqc-container")).not.toBeNull();
    expect(container.textContent).toContain("New Automation");
    const next = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Next"),
    );
    expect(next).toBeInstanceOf(HTMLButtonElement);
    expect((next as HTMLButtonElement).disabled).toBe(true);

    renderInto({
      draft: { ...createDefaultDraft(), prompt: "Summarize urgent mail" },
      onStepChange,
    })
      .querySelectorAll("button")
      .forEach((button) => {
        if (button.textContent?.includes("Next")) {
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        }
      });
    expect(onStepChange).toHaveBeenCalledWith("when");
  });

  it("lists only caller-provided scoped sessions in employee mode", async () => {
    await i18n.setLocale("en");
    const onDraftChange = vi.fn();
    const sessions = {
      sessions: [
        {
          key: "agent:eon:main",
          kind: "direct",
          label: "main",
          updatedAt: Date.now(),
          modelProvider: "openai-codex",
          model: "gpt-5.4",
        },
        {
          key: "dashboard:f91d",
          kind: "direct",
          label: "dashboard:f91d",
          updatedAt: Date.now(),
        },
      ],
      count: 2,
      defaults: {},
    } as SessionsListResult;
    const container = renderInto({
      step: "how",
      employeeMode: true,
      sessions,
      onDraftChange,
    });
    const options = Array.from(container.querySelectorAll("option")).map((option) =>
      option.textContent?.trim(),
    );
    expect(options).toContain("New isolated session");
    expect(options).toContain("Current session");
    expect(options).toContain("main · openai-codex/gpt-5.4");
    expect(options).toContain("dashboard:f91d");
    expect(container.textContent).toContain("Agent and workspace are fixed by policy.");

    const select = container.querySelector("select.cqc-input");
    expect(select).toBeInstanceOf(HTMLSelectElement);
    (select as HTMLSelectElement).value = "session:dashboard:f91d";
    select?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onDraftChange).toHaveBeenCalledWith({ sessionTarget: "session:dashboard:f91d" });
  });

  it("converts draft into the existing cron form contract", async () => {
    await i18n.setLocale("en");
    const patch = draftToCronFormPatch({
      ...createDefaultDraft(),
      prompt: "Run daily brief",
      name: "Daily brief",
      schedulePreset: "weekdays",
      deliveryPreset: "notify",
      sessionTarget: "session:agent:eon:main",
    });

    expect(patch).toMatchObject({
      name: "Daily brief",
      payloadKind: "agentTurn",
      payloadText: "Run daily brief",
      scheduleKind: "cron",
      cronExpr: "0 9 * * 1-5",
      deliveryMode: "announce",
      sessionTarget: "session:agent:eon:main",
      sessionKey: "agent:eon:main",
    });
  });
});
