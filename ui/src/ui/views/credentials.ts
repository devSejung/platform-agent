import { html, nothing } from "lit";
import { i18n } from "../../i18n/index.ts";
import type {
  CredentialDefinition,
  CredentialMetadata,
  CredentialOwnerPolicy,
} from "../controllers/credentials.ts";
import { icons } from "../icons.ts";

const LABELS = {
  en: {
    admin: "Admin",
    adminSettings: "Admin Settings",
    credentialTypes: "Credential Types",
    accountScope: "Account scope",
    myAccount: "My account",
    keyWarningTitle: "Credential encryption key is not configured",
    keyWarningBody:
      "Credentials cannot be saved or read until the server encryption key is configured.",
    refresh: "Refresh",
    loading: "Loading credentials...",
    empty: "No credential types are available.",
    missing: "Missing",
    expired: "Expired",
    expiringSoon: "Expiring soon",
    registered: "Registered",
    english: "English",
    updated: "Updated",
    lastUsed: "Last used",
    expires: "Expires",
    rotation: "Rotation",
    usageSkills: "Used by",
    value: "Value",
    updateValue: "Update value",
    enterValue: "Enter value",
    save: "Save",
    update: "Update",
    saving: "Saving",
    revoke: "Revoke",
    revoking: "Revoking",
    manageTypes: "Manage Types",
    key: "Key",
    label: "Label",
    type: "Type",
    scope: "Account",
    rotationDays: "Rotation days",
    description: "Description",
    englishDescription: "English description",
    saveType: "Save Type",
    deleteType: "Delete",
    typeTemplates: "Credential type templates",
    registeredPreview: "Registration preview",
    adminLead: "Create and archive the credential types users can register.",
    addType: "Add credential type",
    close: "Close",
    more: "More",
  },
  ko: {
    admin: "관리자",
    adminSettings: "관리자 설정",
    credentialTypes: "Credential 유형",
    accountScope: "내 계정 범위",
    myAccount: "내 계정",
    keyWarningTitle: "Credential 암호화 설정이 필요합니다",
    keyWarningBody: "서버 암호화 키가 준비되기 전까지 Credential을 저장하거나 읽을 수 없습니다.",
    refresh: "새로고침",
    loading: "Credential을 불러오는 중...",
    empty: "등록 가능한 Credential 유형이 없습니다.",
    missing: "미등록",
    expired: "만료됨",
    expiringSoon: "곧 만료",
    registered: "등록됨",
    english: "영어 설명",
    updated: "수정일",
    lastUsed: "마지막 사용",
    expires: "만료일",
    rotation: "교체 주기",
    usageSkills: "사용 스킬",
    value: "값",
    updateValue: "새 값 입력",
    enterValue: "값 입력",
    save: "저장",
    update: "교체",
    saving: "저장 중",
    revoke: "폐기",
    revoking: "폐기 중",
    manageTypes: "유형 관리",
    key: "키",
    label: "표시 이름",
    type: "종류",
    scope: "계정",
    rotationDays: "교체 주기(일)",
    description: "설명",
    englishDescription: "영어 설명",
    saveType: "유형 저장",
    deleteType: "삭제",
    typeTemplates: "Credential 유형 목록",
    registeredPreview: "등록 미리보기",
    adminLead: "사용자가 등록할 수 있는 Credential 유형을 만들고 삭제합니다.",
    addType: "Credential 유형 추가",
    close: "닫기",
    more: "더보기",
  },
} as const;

function labels() {
  return i18n.getLocale() === "ko" ? LABELS.ko : LABELS.en;
}

export type CredentialDefinitionDraft = {
  key: string;
  label: string;
  type: string;
  description: string;
  descriptionEn: string;
  usageHint: string;
  ownerPolicy: CredentialOwnerPolicy;
  rotationDays: string;
  required: boolean;
};

export type CredentialsViewProps = {
  statusLoading: boolean;
  encryptionReady: boolean;
  encryptionKeyName: string;
  statusError: string | null;
  loading: boolean;
  definitions: CredentialDefinition[];
  definitionsError: string | null;
  credentialsLoading: boolean;
  credentials: CredentialMetadata[];
  credentialsError: string | null;
  message: { kind: "success" | "error"; text: string } | null;
  valueDrafts: Record<string, string>;
  expiresAtDrafts: Record<string, string>;
  savingKey: string | null;
  revokingKey: string | null;
  canManageDefinitions: boolean;
  definitionDraft: CredentialDefinitionDraft;
  definitionSaving: boolean;
  definitionDeletingKey: string | null;
  definitionModalOpen: boolean;
  onRefresh: () => void;
  onValueDraftChange: (definitionKey: string, value: string) => void;
  onExpiresAtDraftChange: (definitionKey: string, value: string) => void;
  onSaveCredential: (definitionKey: string) => void;
  onRevokeCredential: (definitionKey: string) => void;
  onDefinitionDraftChange: (patch: Partial<CredentialDefinitionDraft>) => void;
  onOpenDefinitionCreate: () => void;
  onCloseDefinitionModal: () => void;
  onSaveDefinition: () => void;
  onDeleteDefinition: (definitionKey: string) => void;
  onUseDefinitionTemplate: (definition: CredentialDefinition) => void;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleDateString(i18n.getLocale() === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(i18n.getLocale() === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isExpiringSoon(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return false;
  }
  const days = (parsed - Date.now()) / 86_400_000;
  return days >= 0 && days <= 14;
}

function getCredentialStatus(
  definition: CredentialDefinition,
  credential: CredentialMetadata | undefined,
) {
  const text = labels();
  if (!credential) {
    return {
      label: text.missing,
      className: "credentials-status--missing",
    };
  }
  if (credential.expiresAt && Date.parse(credential.expiresAt) < Date.now()) {
    return { label: text.expired, className: "credentials-status--expired" };
  }
  if (isExpiringSoon(credential.expiresAt)) {
    return { label: text.expiringSoon, className: "credentials-status--warning" };
  }
  return { label: text.registered, className: "credentials-status--ok" };
}

function renderDescription(definition: CredentialDefinition) {
  const description =
    i18n.getLocale() === "ko"
      ? definition.description?.trim() || definition.descriptionEn?.trim()
      : definition.descriptionEn?.trim() || definition.description?.trim();
  if (!description) {
    return nothing;
  }
  return html`<div class="credentials-definition-description">${description}</div>`;
}

function renderCredentialRow(
  definition: CredentialDefinition,
  credential: CredentialMetadata | undefined,
  props: CredentialsViewProps,
) {
  const status = getCredentialStatus(definition, credential);
  const draft = props.valueDrafts[definition.key] ?? "";
  const text = labels();
  const expiresAtDraft = props.expiresAtDrafts[definition.key] ?? "";
  const saving = props.savingKey === definition.key;
  const revoking = props.revokingKey === definition.key;
  const initial = (definition.label.trim()[0] || definition.key.trim()[0] || "C").toUpperCase();
  return html`
    <article class="credentials-card ${credential ? "credentials-card--registered" : ""}">
      <div class="credentials-card__header">
        <div class="credentials-card__identity">
          <div class="credentials-card__avatar" aria-hidden="true">${initial}</div>
          <div class="credentials-card__titleblock">
            <h3>${definition.label}</h3>
            <div class="credentials-card__chips">
              <span class="chip mono">${definition.key}</span>
              <span class="chip">${definition.type}</span>
            </div>
          </div>
        </div>
        <div class="credentials-card__header-actions">
          <span class="chip credentials-status ${status.className}">${status.label}</span>
          ${props.canManageDefinitions
            ? html`
                <details class="skillhub-more credentials-card-more">
                  <summary class="btn btn--sm" aria-label=${text.more}>...</summary>
                  <div class="skillhub-more__menu">
                    <button
                      class="btn btn--sm"
                      type="button"
                      @click=${() => props.onUseDefinitionTemplate(definition)}
                    >
                      ${text.update}
                    </button>
                    <button
                      class="btn btn--sm skillhub-danger-action"
                      type="button"
                      ?disabled=${props.definitionDeletingKey === definition.key}
                      @click=${() => props.onDeleteDefinition(definition.key)}
                    >
                      ${props.definitionDeletingKey === definition.key
                        ? text.saving
                        : text.deleteType}
                    </button>
                  </div>
                </details>
              `
            : nothing}
        </div>
      </div>
      ${renderDescription(definition)}
      <div class="credentials-meta-grid">
        <div><span>${text.scope}</span><strong>${text.myAccount}</strong></div>
        <div><span>${text.usageSkills}</span><strong>${definition.usageHint || "—"}</strong></div>
        <div>
          <span>${text.lastUsed}</span
          ><strong>${formatDateTime(credential?.lastUsedAt ?? null)}</strong>
        </div>
        <div>
          <span>${text.expires}</span><strong>${formatDate(credential?.expiresAt ?? null)}</strong>
        </div>
      </div>
      <form
        class="credentials-card__form"
        @submit=${(event: Event) => {
          event.preventDefault();
          props.onSaveCredential(definition.key);
        }}
      >
        <label class="field credentials-secret-field">
          <span class="field__label">${text.value}</span>
          <input
            type="password"
            autocomplete="off"
            spellcheck="false"
            ?disabled=${!props.encryptionReady}
            placeholder=${credential ? text.updateValue : text.enterValue}
            .value=${draft}
            @input=${(event: Event) =>
              props.onValueDraftChange(definition.key, (event.target as HTMLInputElement).value)}
          />
        </label>
        <label class="field credentials-expiry-field">
          <span class="field__label">${text.expires}</span>
          <input
            type="text"
            inputmode="numeric"
            placeholder="YYYY-MM-DD"
            ?disabled=${!props.encryptionReady}
            .value=${expiresAtDraft}
            @input=${(event: Event) =>
              props.onExpiresAtDraftChange(
                definition.key,
                (event.target as HTMLInputElement).value,
              )}
          />
        </label>
        <div class="credentials-card__actions">
          <button
            class="btn btn--sm primary"
            type="submit"
            ?disabled=${!props.encryptionReady || saving || !draft.trim()}
          >
            ${saving ? text.saving : credential ? text.update : text.save}
          </button>
          ${credential
            ? html`
                <button
                  class="btn btn--sm"
                  type="button"
                  ?disabled=${revoking}
                  @click=${() => props.onRevokeCredential(definition.key)}
                >
                  ${revoking ? text.revoking : text.revoke}
                </button>
              `
            : nothing}
        </div>
      </form>
    </article>
  `;
}

function renderDefinitionAddCard(props: CredentialsViewProps) {
  if (!props.canManageDefinitions) {
    return nothing;
  }
  const text = labels();
  return html`
    <button class="credentials-add-card" type="button" @click=${props.onOpenDefinitionCreate}>
      <span aria-hidden="true">+</span>
      <strong>${text.addType}</strong>
    </button>
  `;
}

function renderDefinitionModal(props: CredentialsViewProps) {
  if (!props.canManageDefinitions) {
    return nothing;
  }
  if (!props.definitionModalOpen) {
    return nothing;
  }
  const draft = props.definitionDraft;
  const text = labels();
  return html`
    <dialog
      class="md-preview-dialog credentials-definition-dialog"
      open
      @click=${(event: Event) => {
        if (event.target === event.currentTarget) {
          props.onCloseDefinitionModal();
        }
      }}
    >
      <div class="md-preview-dialog__panel credentials-definition-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">${text.credentialTypes}</div>
            <div class="md-preview-dialog__subtitle">${text.adminLead}</div>
          </div>
          <button class="btn btn--sm" type="button" @click=${props.onCloseDefinitionModal}>
            ${text.close}
          </button>
        </div>
        <form
          class="md-preview-dialog__body credentials-definition-form"
          @submit=${(event: Event) => {
            event.preventDefault();
            props.onSaveDefinition();
          }}
        >
          <label class="field">
            <span class="field__label">${text.key}</span>
            <input
              autocomplete="off"
              placeholder="jira.default"
              .value=${draft.key}
              @input=${(event: Event) =>
                props.onDefinitionDraftChange({ key: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span class="field__label">${text.label}</span>
            <input
              autocomplete="off"
              placeholder="Jira Token"
              .value=${draft.label}
              @input=${(event: Event) =>
                props.onDefinitionDraftChange({ label: (event.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            <span class="field__label">${text.type}</span>
            <select
              .value=${draft.type}
              @change=${(event: Event) =>
                props.onDefinitionDraftChange({ type: (event.target as HTMLSelectElement).value })}
            >
              <option value="jira_token">jira_token</option>
              <option value="mail_app_password">mail_app_password</option>
              <option value="api_token">api_token</option>
              <option value="custom_secret">custom_secret</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">${text.rotationDays}</span>
            <input
              type="number"
              min="1"
              inputmode="numeric"
              .value=${draft.rotationDays}
              @input=${(event: Event) =>
                props.onDefinitionDraftChange({
                  rotationDays: (event.target as HTMLInputElement).value,
                })}
            />
          </label>
          <label class="field credentials-definition-form__wide">
            <span class="field__label">${text.usageSkills}</span>
            <input
              autocomplete="off"
              placeholder=${i18n.getLocale() === "ko"
                ? "예: Jira 이슈 생성 Skill"
                : "e.g. Jira issue writer"}
              .value=${draft.usageHint}
              @input=${(event: Event) =>
                props.onDefinitionDraftChange({
                  usageHint: (event.target as HTMLInputElement).value,
                })}
            />
          </label>
          <label class="field credentials-definition-form__wide">
            <span class="field__label">${text.description}</span>
            <textarea
              rows="3"
              .value=${draft.description}
              @input=${(event: Event) =>
                props.onDefinitionDraftChange({
                  description: (event.target as HTMLTextAreaElement).value,
                })}
            ></textarea>
          </label>
          <label class="field credentials-definition-form__wide">
            <span class="field__label">${text.englishDescription}</span>
            <textarea
              rows="3"
              .value=${draft.descriptionEn}
              @input=${(event: Event) =>
                props.onDefinitionDraftChange({
                  descriptionEn: (event.target as HTMLTextAreaElement).value,
                })}
            ></textarea>
          </label>
          <div class="credentials-definition-form__actions">
            <button class="btn btn--sm" type="button" @click=${props.onCloseDefinitionModal}>
              ${text.close}
            </button>
            <button
              class="btn btn--sm primary"
              type="submit"
              ?disabled=${props.definitionSaving ||
              !draft.key.trim() ||
              !draft.label.trim() ||
              !draft.type.trim()}
            >
              ${props.definitionSaving ? text.saving : text.saveType}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  `;
}

function renderEncryptionWarning(props: CredentialsViewProps) {
  if (props.statusLoading || props.encryptionReady) {
    return nothing;
  }
  const text = labels();
  const body = text.keyWarningBody.replace("{keyName}", props.encryptionKeyName);
  return html`
    <div class="credentials-warning" role="status">
      <div class="credentials-warning__icon">!</div>
      <span>
        <strong>${text.keyWarningTitle}</strong>
        <span>${body}</span>
      </span>
    </div>
  `;
}

export function renderCredentials(props: CredentialsViewProps) {
  const text = labels();
  const credentialsByDefinition = new Map(
    props.credentials.map((entry) => [entry.definitionKey, entry]),
  );
  const sortedDefinitions = props.definitions.toSorted((a, b) => {
    if (a.required !== b.required) {
      return a.required ? -1 : 1;
    }
    return a.label.localeCompare(b.label);
  });
  const errorMessages = [props.statusError, props.definitionsError, props.credentialsError].filter(
    (message, index, messages): message is string =>
      Boolean(message) && messages.indexOf(message) === index,
  );
  return html`
    <section class="credentials-view">
      <div class="credentials-page-actions">
        <button class="btn btn--sm credentials-icon-button" type="button" @click=${props.onRefresh}>
          <span aria-hidden="true">${icons.refresh}</span>
          ${text.refresh}
        </button>
      </div>
      ${renderEncryptionWarning(props)}
      ${errorMessages.map((message) => html`<div class="notice notice--error">${message}</div>`)}
      <div class="credentials-layout">
        <section class="credentials-main-panel">
          <div class="credentials-section-header">
            <div>
              <div class="card-title">
                ${i18n.getLocale() === "ko" ? "내 계정 Credential" : "My Account Credentials"}
              </div>
              <div class="card-sub">${text.accountScope}</div>
            </div>
          </div>
          ${props.message
            ? html`<div class="notice notice--${props.message.kind}">${props.message.text}</div>`
            : nothing}
          ${props.loading || props.credentialsLoading
            ? html`<div class="muted">${text.loading}</div>`
            : nothing}
          <div class="credentials-card-grid">
            ${sortedDefinitions.map((definition) =>
              renderCredentialRow(definition, credentialsByDefinition.get(definition.key), props),
            )}
            ${renderDefinitionAddCard(props)}
            ${!props.loading && sortedDefinitions.length === 0 && !props.canManageDefinitions
              ? html`<div class="skills-empty-state__body">${text.empty}</div>`
              : nothing}
          </div>
        </section>
      </div>
      ${renderDefinitionModal(props)}
    </section>
  `;
}
