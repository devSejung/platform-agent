import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type { GroupScopeOption } from "../controllers/groups.ts";
import type { AdminAccountDetail, AdminAccountEntry } from "../controllers/admin-accounts.ts";

export type AdminViewProps = {
  loading: boolean;
  entries: AdminAccountEntry[];
  error: string | null;
  query: string;
  detailLoading: boolean;
  detail: AdminAccountDetail | null;
  detailError: string | null;
  message: { kind: "success" | "error"; text: string } | null;
  roleModalOpen: boolean;
  roleModalAccountName: string | null;
  roleModalNextRole: "member" | "admin";
  groupScopeOptions: GroupScopeOption[];
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onOpenDetail: (accountId: string) => void;
  onCloseDetail: () => void;
  onOpenRoleModal: (accountId: string, accountName: string, currentRole: "member" | "admin") => void;
  onCloseRoleModal: () => void;
  onRoleChangeSelect: (value: "member" | "admin") => void;
  onConfirmRoleChange: () => void;
  onAddMembership: (scopeType: "group" | "part", scopeId: string, groupRole?: "member" | "leader") => void;
  onRemoveMembership: (scopeType: "group" | "part", scopeId: string) => void;
};

function ensureOpen(el?: Element) {
  if (!(el instanceof HTMLDialogElement) || el.open) {
    return;
  }
  try {
    el.showModal();
  } catch {
    el.setAttribute("open", "");
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function renderDetailDialog(props: AdminViewProps) {
  if (!props.detail) {
    return nothing;
  }
  const activeScopeOptions = props.groupScopeOptions.filter((entry) => !entry.archived);
  return html`
    <dialog class="md-preview-dialog" open ${ref(ensureOpen)} @close=${props.onCloseDetail}>
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">${props.detail.displayName}</div>
            <div class="md-preview-dialog__subtitle">${props.detail.employeeId}</div>
          </div>
          <button class="btn btn--sm" @click=${props.onCloseDetail}>${t("common.close")}</button>
        </div>
        <div class="md-preview-dialog__body" style="display:grid; gap:16px;">
          <div class="card" style="display:grid; gap:8px;">
            <div><strong>Email:</strong> ${props.detail.email ?? "—"}</div>
            <div><strong>Department:</strong> ${props.detail.department ?? "—"}</div>
            <div><strong>Role:</strong> ${props.detail.globalRole}</div>
            <div><strong>Last login:</strong> ${formatDate(props.detail.lastLoginAt)}</div>
          </div>
          <div style="display:flex; justify-content:space-between; gap:12px; align-items:center;">
            <div class="card-title" style="margin:0;">${t("admin.memberships.title")}</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              ${activeScopeOptions.map(
                (entry) => html`
                  <button
                    class="btn btn--sm"
                    @click=${() => props.onAddMembership(entry.scopeType, entry.scopeId, "member")}
                  >
                    ${t("admin.actions.addTo")} ${entry.label}
                  </button>
                `,
              )}
            </div>
          </div>
          <div class="list">
            ${props.detail.memberships.map(
              (membership) => html`
                <div class="list-item">
                  <div class="list-main">
                    <div class="list-title">
                      ${membership.scopeType === "group"
                        ? membership.scopeName
                        : `${membership.parentGroupName ?? "Group"} / ${membership.scopeName}`}
                    </div>
                    <div class="list-sub">${membership.groupRole}${membership.archived ? " · Archived" : ""}</div>
                  </div>
                  <div class="list-meta">
                    <button
                      class="btn btn--sm"
                      @click=${() => props.onRemoveMembership(membership.scopeType, membership.scopeId)}
                    >
                      ${t("admin.actions.remove")}
                    </button>
                  </div>
                </div>
              `,
            )}
            ${props.detail.memberships.length === 0
              ? html`<div class="skills-empty-state__body">${t("admin.memberships.empty")}</div>`
              : nothing}
          </div>
        </div>
      </div>
    </dialog>
  `;
}

function renderRoleModal(props: AdminViewProps) {
  if (!props.roleModalOpen) {
    return nothing;
  }
  return html`
    <dialog class="md-preview-dialog" open ${ref(ensureOpen)} @close=${props.onCloseRoleModal}>
      <div class="md-preview-dialog__panel admin-role-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">${t("admin.roleChange.title")}</div>
            <div class="md-preview-dialog__subtitle">${props.roleModalAccountName ?? ""}</div>
          </div>
          <button class="btn btn--sm" @click=${props.onCloseRoleModal}>${t("common.close")}</button>
        </div>
        <div class="md-preview-dialog__body admin-role-dialog__body">
          <div class="field">
            <span class="field__label">${t("admin.roleChange.fieldLabel")}</span>
            <div class="admin-role-options" role="radiogroup" aria-label=${t("admin.roleChange.fieldLabel")}>
              ${(["member", "admin"] as const).map(
                (role) => html`
                  <button
                    type="button"
                    class="admin-role-option ${props.roleModalNextRole === role ? "is-selected" : ""}"
                    aria-pressed=${props.roleModalNextRole === role}
                    @click=${() => props.onRoleChangeSelect(role)}
                  >
                    <span class="admin-role-option__title">${role}</span>
                    <span class="admin-role-option__meta">
                      ${role === "admin" ? t("admin.roleChange.adminHint") : t("admin.roleChange.memberHint")}
                    </span>
                  </button>
                `,
              )}
            </div>
          </div>
          <div class="muted">${t("admin.roleChange.confirmHint")}</div>
        </div>
        <div class="md-preview-dialog__footer">
          <button class="btn" @click=${props.onCloseRoleModal}>${t("common.cancel")}</button>
          <button class="btn primary" @click=${props.onConfirmRoleChange}>${t("admin.actions.confirmRoleChange")}</button>
        </div>
      </div>
    </dialog>
  `;
}

export function renderAdmin(props: AdminViewProps) {
  return html`
    <section class="card" style="display:grid; gap:16px;">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div>
          <div class="card-title">${t("admin.title")}</div>
          <div class="card-sub">${t("admin.subtitle")}</div>
        </div>
        <button class="btn btn--sm" @click=${props.onRefresh}>${t("common.refresh")}</button>
      </div>
      ${props.message ? html`<div class="notice notice--${props.message.kind}">${props.message.text}</div>` : nothing}
      ${props.error ? html`<div class="notice notice--error">${props.error}</div>` : nothing}
      <div class="admin-filters">
        <label class="field admin-search-field">
          <span class="field__label">${t("admin.searchLabel")}</span>
          <input
            class="admin-search-input"
            placeholder=${t("admin.searchPlaceholder")}
            .value=${props.query}
            @input=${(e: Event) => props.onQueryChange((e.target as HTMLInputElement).value)}
          />
        </label>
      </div>
      <div class="list">
        ${props.entries.map(
          (entry) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${entry.displayName} <span class="chip">${entry.globalRole}</span></div>
                <div class="list-sub">
                  ${entry.employeeId}${entry.email ? ` · ${entry.email}` : ""}
                  ${entry.department ? ` · ${entry.department}` : ""} · ${t("admin.lastLogin")} ${formatDate(entry.lastLoginAt)}
                </div>
              </div>
              <div class="list-meta" style="display:flex; gap:8px; flex-wrap:wrap;">
                <button class="btn btn--sm" @click=${() => props.onOpenDetail(entry.accountId)}>${t("admin.actions.view")}</button>
                <button class="btn btn--sm" @click=${() => props.onOpenRoleModal(entry.accountId, entry.displayName, entry.globalRole)}>${t("admin.actions.changeRole")}</button>
                <button class="btn btn--sm" @click=${() => props.onOpenDetail(entry.accountId)}>${t("admin.actions.manageGroups")}</button>
              </div>
            </div>
          `,
        )}
        ${!props.loading && props.entries.length === 0
          ? html`<div class="skills-empty-state__body">${t("admin.empty")}</div>`
          : nothing}
      </div>
      ${props.detailLoading ? html`<div class="muted">${t("admin.loadingDetail")}</div>` : nothing}
      ${props.detailError ? html`<div class="notice notice--error">${props.detailError}</div>` : nothing}
      ${renderDetailDialog(props)}
      ${renderRoleModal(props)}
    </section>
  `;
}
