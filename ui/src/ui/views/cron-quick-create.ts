/**
 * Upstream-compatible cron quick-create flow, adapted for PlatformClaw scope rules.
 *
 * The wizard only builds a CronFormState patch. Actual create/update validation
 * still goes through the existing cron controller and gateway policy path.
 */

import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { SessionsListResult } from "../types.ts";
import type { CronFormState } from "../ui-types.ts";

export type CronQuickCreateStep = "what" | "when" | "how";

export type CronQuickCreateDraft = {
  prompt: string;
  name: string;
  schedulePreset: SchedulePresetId | "custom";
  deliveryPreset: DeliveryPresetId;
  sessionTarget: "isolated" | "current" | `session:${string}`;
};

export type CronQuickCreateProps = {
  open: boolean;
  step: CronQuickCreateStep;
  draft: CronQuickCreateDraft;
  employeeMode?: boolean;
  currentSessionKey?: string;
  sessions?: SessionsListResult | null;
  onDraftChange: (patch: Partial<CronQuickCreateDraft>) => void;
  onStepChange: (step: CronQuickCreateStep) => void;
  onCreate: () => void;
  onCancel: () => void;
  onAdvancedCreate?: () => void;
};

type SchedulePresetId =
  | "every-morning"
  | "every-evening"
  | "hourly"
  | "weekdays"
  | "weekly"
  | "once";

type DeliveryPresetId = "notify" | "silent" | "isolated";

type SchedulePreset = {
  id: SchedulePresetId;
  labelKey: string;
  icon: string;
  descriptionKey: string;
};

const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    id: "every-morning",
    labelKey: "cron.quickCreate.schedules.everyMorning.label",
    icon: "sun",
    descriptionKey: "cron.quickCreate.schedules.everyMorning.description",
  },
  {
    id: "every-evening",
    labelKey: "cron.quickCreate.schedules.everyEvening.label",
    icon: "moon",
    descriptionKey: "cron.quickCreate.schedules.everyEvening.description",
  },
  {
    id: "hourly",
    labelKey: "cron.quickCreate.schedules.hourly.label",
    icon: "clock",
    descriptionKey: "cron.quickCreate.schedules.hourly.description",
  },
  {
    id: "weekdays",
    labelKey: "cron.quickCreate.schedules.weekdays.label",
    icon: "calendar",
    descriptionKey: "cron.quickCreate.schedules.weekdays.description",
  },
  {
    id: "weekly",
    labelKey: "cron.quickCreate.schedules.weekly.label",
    icon: "calendar",
    descriptionKey: "cron.quickCreate.schedules.weekly.description",
  },
  {
    id: "once",
    labelKey: "cron.quickCreate.schedules.once.label",
    icon: "zap",
    descriptionKey: "cron.quickCreate.schedules.once.description",
  },
];

type DeliveryPreset = {
  id: DeliveryPresetId;
  labelKey: string;
  descriptionKey: string;
};

const DELIVERY_PRESETS: DeliveryPreset[] = [
  {
    id: "notify",
    labelKey: "cron.quickCreate.delivery.notify.label",
    descriptionKey: "cron.quickCreate.delivery.notify.description",
  },
  {
    id: "silent",
    labelKey: "cron.quickCreate.delivery.silent.label",
    descriptionKey: "cron.quickCreate.delivery.silent.description",
  },
  {
    id: "isolated",
    labelKey: "cron.quickCreate.delivery.isolated.label",
    descriptionKey: "cron.quickCreate.delivery.isolated.description",
  },
];

const STEPS: CronQuickCreateStep[] = ["what", "when", "how"];
const STEP_LABELS: Record<CronQuickCreateStep, string> = {
  what: "cron.quickCreate.steps.what",
  when: "cron.quickCreate.steps.when",
  how: "cron.quickCreate.steps.how",
};

export function createDefaultDraft(): CronQuickCreateDraft {
  return {
    prompt: "",
    name: "",
    schedulePreset: "every-morning",
    deliveryPreset: "notify",
    sessionTarget: "isolated",
  };
}

function buildDefaultScheduleAt(now = new Date()): string {
  const next = new Date(now);
  next.setHours(next.getHours() + 1, 0, 0, 0);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  const day = String(next.getDate()).padStart(2, "0");
  const hour = String(next.getHours()).padStart(2, "0");
  const minute = String(next.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function sessionKeyFromTarget(target: CronQuickCreateDraft["sessionTarget"]): string {
  return target.startsWith("session:") ? target.slice("session:".length).trim() : "";
}

export function draftToCronFormPatch(draft: CronQuickCreateDraft): Partial<CronFormState> {
  const explicitSessionKey = sessionKeyFromTarget(draft.sessionTarget);
  const sessionTarget: CronFormState["sessionTarget"] = explicitSessionKey
    ? `session:${explicitSessionKey}`
    : draft.sessionTarget === "current"
      ? "current"
      : "isolated";
  const patch: Partial<CronFormState> = {
    name: draft.name.trim() || t("cron.quickCreate.defaultName"),
    payloadKind: "agentTurn",
    deleteAfterRun: false,
    scheduleAt: "",
    payloadText: draft.prompt,
    enabled: true,
    sessionTarget,
    sessionKey: explicitSessionKey,
  };

  switch (draft.schedulePreset) {
    case "every-morning":
      patch.scheduleKind = "cron";
      patch.cronExpr = "0 8 * * *";
      break;
    case "every-evening":
      patch.scheduleKind = "cron";
      patch.cronExpr = "0 18 * * *";
      break;
    case "hourly":
      patch.scheduleKind = "every";
      patch.everyAmount = "1";
      patch.everyUnit = "hours";
      break;
    case "weekdays":
      patch.scheduleKind = "cron";
      patch.cronExpr = "0 9 * * 1-5";
      break;
    case "weekly":
      patch.scheduleKind = "cron";
      patch.cronExpr = "0 9 * * 1";
      break;
    case "once":
      patch.scheduleKind = "at";
      patch.scheduleAt = buildDefaultScheduleAt();
      patch.deleteAfterRun = true;
      break;
  }

  switch (draft.deliveryPreset) {
    case "notify":
      patch.deliveryMode = "announce";
      patch.wakeMode = "now";
      break;
    case "silent":
      patch.payloadKind = "systemEvent";
      patch.deliveryMode = "none";
      patch.wakeMode = "now";
      patch.sessionTarget = explicitSessionKey ? `session:${explicitSessionKey}` : "current";
      break;
    case "isolated":
      patch.deliveryMode = "none";
      patch.wakeMode = "now";
      break;
  }

  return patch;
}

function renderStepIndicator(current: CronQuickCreateStep) {
  const currentIdx = STEPS.indexOf(current);
  return html`
    <div class="cqc-steps">
      ${STEPS.map((step, idx) => {
        const state = idx < currentIdx ? "done" : idx === currentIdx ? "active" : "pending";
        return html`
          <div class="cqc-step cqc-step--${state}">
            <span class="cqc-step__dot">${state === "done" ? icons.check : idx + 1}</span>
            <span class="cqc-step__label">${t(STEP_LABELS[step])}</span>
          </div>
          ${idx < STEPS.length - 1
            ? html`<div class="cqc-step__line cqc-step__line--${state}"></div>`
            : nothing}
        `;
      })}
    </div>
  `;
}

function renderAdvancedButton(props: CronQuickCreateProps) {
  if (!props.onAdvancedCreate) {
    return nothing;
  }
  return html`
    <button class="btn cqc-advanced-button" type="button" @click=${props.onAdvancedCreate}>
      ${t("cron.quickCreate.advanced")}
    </button>
  `;
}

function renderWhatStep(props: CronQuickCreateProps) {
  return html`
    <div class="cqc-body">
      <h3 class="cqc-body__heading">${t("cron.quickCreate.whatHeading")}</h3>
      <p class="cqc-body__hint muted">${t("cron.quickCreate.whatHint")}</p>
      <textarea
        class="cqc-textarea"
        placeholder=${t("cron.quickCreate.promptPlaceholder")}
        rows="4"
        .value=${props.draft.prompt}
        @input=${(e: Event) =>
          props.onDraftChange({ prompt: (e.target as HTMLTextAreaElement).value })}
      ></textarea>
      <div class="cqc-field">
        <label class="cqc-field__label">${t("cron.quickCreate.nameOptional")}</label>
        <input
          class="cqc-input"
          type="text"
          placeholder=${t("cron.quickCreate.namePlaceholder")}
          .value=${props.draft.name}
          @input=${(e: Event) =>
            props.onDraftChange({ name: (e.target as HTMLInputElement).value })}
        />
      </div>
    </div>
    <div class="cqc-actions">
      <div class="cqc-actions__secondary">
        <button class="btn" type="button" @click=${props.onCancel}>${t("common.cancel")}</button>
        ${renderAdvancedButton(props)}
      </div>
      <button
        class="btn primary"
        type="button"
        ?disabled=${!props.draft.prompt.trim()}
        @click=${() => props.onStepChange("when")}
      >
        ${t("common.next")} ${icons.chevronRight}
      </button>
    </div>
  `;
}

function renderWhenStep(props: CronQuickCreateProps) {
  return html`
    <div class="cqc-body">
      <h3 class="cqc-body__heading">${t("cron.quickCreate.whenHeading")}</h3>
      <p class="cqc-body__hint muted">${t("cron.quickCreate.whenHint")}</p>
      <div class="cqc-preset-grid">
        ${SCHEDULE_PRESETS.map(
          (preset) => html`
            <button
              type="button"
              class="cqc-preset-card ${props.draft.schedulePreset === preset.id
                ? "cqc-preset-card--active"
                : ""}"
              @click=${() => props.onDraftChange({ schedulePreset: preset.id })}
            >
              <span class="cqc-preset-card__icon">${preset.icon}</span>
              <span class="cqc-preset-card__label">${t(preset.labelKey)}</span>
              <span class="cqc-preset-card__desc muted">${t(preset.descriptionKey)}</span>
            </button>
          `,
        )}
      </div>
    </div>
    <div class="cqc-actions">
      <div class="cqc-actions__secondary">
        <button class="btn" type="button" @click=${() => props.onStepChange("what")}>
          ${t("common.back")}
        </button>
        ${renderAdvancedButton(props)}
      </div>
      <button class="btn primary" type="button" @click=${() => props.onStepChange("how")}>
        ${t("common.next")} ${icons.chevronRight}
      </button>
    </div>
  `;
}

function renderSessionOptionLabel(
  session: NonNullable<SessionsListResult["sessions"]>[number],
): string {
  const label = session.label?.trim() || session.key;
  const model =
    typeof session.model === "string" && session.model.trim() ? ` · ${session.model}` : "";
  const provider =
    typeof session.modelProvider === "string" && session.modelProvider.trim()
      ? `${session.modelProvider}/`
      : "";
  return `${label}${provider || model ? ` · ${provider}${session.model ?? ""}` : ""}`;
}

function renderSessionPicker(props: CronQuickCreateProps) {
  const rows = props.sessions?.sessions ?? [];
  const currentKey = props.currentSessionKey?.trim() ?? "";
  const value = props.draft.sessionTarget;
  return html`
    <div class="cqc-session-picker">
      <label class="cqc-field__label">${t("cron.quickCreate.sessionLabel")}</label>
      <select
        class="cqc-input"
        .value=${value}
        @change=${(event: Event) => {
          props.onDraftChange({
            sessionTarget: (event.target as HTMLSelectElement)
              .value as CronQuickCreateDraft["sessionTarget"],
          });
        }}
      >
        <option value="isolated">${t("cron.quickCreate.sessionIsolated")}</option>
        ${currentKey
          ? html`<option value="current">${t("cron.quickCreate.sessionCurrent")}</option>`
          : nothing}
        ${rows.map(
          (row) => html`
            <option value=${`session:${row.key}`}>${renderSessionOptionLabel(row)}</option>
          `,
        )}
      </select>
      <p class="cqc-session-picker__hint muted">
        ${props.employeeMode
          ? t("cron.quickCreate.sessionEmployeeHint")
          : t("cron.quickCreate.sessionHint")}
      </p>
    </div>
  `;
}

function renderHowStep(props: CronQuickCreateProps) {
  return html`
    <div class="cqc-body">
      <h3 class="cqc-body__heading">${t("cron.quickCreate.howHeading")}</h3>
      <p class="cqc-body__hint muted">${t("cron.quickCreate.howHint")}</p>
      ${renderSessionPicker(props)}
      <div class="cqc-delivery-options">
        ${DELIVERY_PRESETS.map(
          (preset) => html`
            <label
              class="cqc-radio-card ${props.draft.deliveryPreset === preset.id
                ? "cqc-radio-card--active"
                : ""}"
            >
              <input
                type="radio"
                name="delivery"
                .checked=${props.draft.deliveryPreset === preset.id}
                @change=${() => props.onDraftChange({ deliveryPreset: preset.id })}
              />
              <span class="cqc-radio-card__label">${t(preset.labelKey)}</span>
              <span class="cqc-radio-card__desc muted">${t(preset.descriptionKey)}</span>
            </label>
          `,
        )}
      </div>
    </div>
    <div class="cqc-actions">
      <div class="cqc-actions__secondary">
        <button class="btn" type="button" @click=${() => props.onStepChange("when")}>
          ${t("common.back")}
        </button>
        ${renderAdvancedButton(props)}
      </div>
      <button class="btn primary" type="button" @click=${props.onCreate}>
        ${t("common.create")} ${icons.check}
      </button>
    </div>
  `;
}

export function renderCronQuickCreate(props: CronQuickCreateProps) {
  if (!props.open) {
    return nothing;
  }

  return html`
    <div class="cqc-backdrop" @click=${props.onCancel}>
      <section
        class="cqc-container"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cron-quick-create-title"
        @click=${(event: Event) => event.stopPropagation()}
      >
        <div class="cqc-header">
          <h2 id="cron-quick-create-title" class="cqc-header__title">
            ${icons.zap} ${t("cron.quickCreate.title")}
          </h2>
          <button
            type="button"
            class="cqc-header__close"
            aria-label=${t("common.dismiss")}
            @click=${props.onCancel}
          >
            ${icons.x}
          </button>
        </div>

        ${renderStepIndicator(props.step)}
        ${props.step === "what"
          ? renderWhatStep(props)
          : props.step === "when"
            ? renderWhenStep(props)
            : renderHowStep(props)}
      </section>
    </div>
  `;
}
