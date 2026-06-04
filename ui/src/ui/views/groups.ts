import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type { AccountDirectoryEntry } from "../controllers/accounts.ts";
import type { GroupDetail, GroupEntry } from "../controllers/groups.ts";

export type GroupsViewProps = {
  loading: boolean;
  entries: GroupEntry[];
  error: string | null;
  includeArchived: boolean;
  detailGroupId: string | null;
  detailLoading: boolean;
  detail: GroupDetail | null;
  detailError: string | null;
  message: { kind: "success" | "error"; text: string } | null;
  createOpen: boolean;
  createName: string;
  createDescription: string;
  createSubmitting: boolean;
  partCreateOpen: boolean;
  partCreateParentId: string | null;
  partCreateName: string;
  partCreateDescription: string;
  partCreateSubmitting: boolean;
  editOpen: boolean;
  editScopeType: "group" | "part";
  editTitle: string | null;
  editName: string;
  editDescription: string;
  editSubmitting: boolean;
  memberModalOpen: boolean;
  memberModalScopeType: "group" | "part";
  memberModalScopeLabel: string | null;
  memberModalQuery: string;
  memberModalResults: AccountDirectoryEntry[];
  memberModalSelectedAccountId: string | null;
  memberModalRole: "member" | "leader";
  memberModalError: string | null;
  memberModalLoading: boolean;
  canAssignLeader: boolean;
  onToggleArchived: (next: boolean) => void;
  onRefresh: () => void;
  onSelectGroup: (groupId: string) => void;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onCreateNameChange: (value: string) => void;
  onCreateDescriptionChange: (value: string) => void;
  onSubmitCreate: () => void;
  onOpenCreatePart: (groupId: string) => void;
  onCloseCreatePart: () => void;
  onPartNameChange: (value: string) => void;
  onPartDescriptionChange: (value: string) => void;
  onSubmitCreatePart: () => void;
  onOpenEdit: (scopeType: "group" | "part", entry: GroupEntry) => void;
  onCloseEdit: () => void;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onSubmitEdit: () => void;
  onOpenAddMember: (scopeType: "group" | "part", scopeId: string, label: string) => void;
  onCloseAddMember: () => void;
  onMemberQueryChange: (value: string) => void;
  onSelectMemberAccount: (accountId: string) => void;
  onMemberRoleChange: (value: "member" | "leader") => void;
  onSubmitAddMember: () => void;
  onRemoveMember: (scopeType: "group" | "part", scopeId: string, accountId: string, label: string) => void;
  onPromoteMember: (scopeType: "group" | "part", scopeId: string, accountId: string) => void;
  onDemoteMember: (scopeType: "group" | "part", scopeId: string, accountId: string) => void;
  onArchiveScope: (scopeId: string, label: string) => void;
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
  return parsed.toLocaleDateString();
}

function renderMemberRows(
  scopeType: "group" | "part",
  scopeId: string,
  members: GroupDetail["members"],
  canManageMembers: boolean,
  props: GroupsViewProps,
) {
  if (members.length === 0) {
    return html`<div class="muted">${t("groups.members.empty")}</div>`;
  }
  return html`
    <div class="list">
      ${members.map(
        (member) => html`
          <div class="list-item">
            <div class="list-main">
                <div class="list-title">
                ${member.displayName}
                <span class="chip ${member.groupRole === "leader" ? "groups-role-badge groups-role-badge--leader" : ""}">
                  ${member.groupRole === "leader" ? "✦ Leader" : "Member"}
                </span>
              </div>
              <div class="list-sub">
                ${member.email ? `${member.email}` : ""}
                ${member.department ? `· ${member.department}` : ""}
              </div>
            </div>
            ${canManageMembers
              ? html`
                  <div class="list-meta">
                    <button
                      class="btn btn--sm"
                      @click=${() =>
                        props.onRemoveMember(scopeType, scopeId, member.accountId, member.displayName)}
                    >
                      ${t("groups.actions.removeMember")}
                    </button>
                    ${props.canAssignLeader
                      ? html`
                          <button
                            class="btn btn--sm"
                            @click=${() =>
                              member.groupRole === "leader"
                                ? props.onDemoteMember(scopeType, scopeId, member.accountId)
                                : props.onPromoteMember(scopeType, scopeId, member.accountId)}
                          >
                            ${member.groupRole === "leader"
                              ? t("groups.actions.setMember")
                              : t("groups.actions.setLeader")}
                          </button>
                        `
                      : nothing}
                  </div>
                `
              : nothing}
          </div>
        `,
      )}
    </div>
  `;
}

function renderScopePanel(
  entry: GroupEntry,
  members: GroupDetail["members"],
  props: GroupsViewProps,
  opts: { showCreatePart?: boolean; nested?: boolean; scopeLabel?: string } = {},
) {
  return html`
    <section class="card ${opts.nested ? "groups-part-card" : "groups-scope-card"}" style="display:grid; gap:14px;">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start;">
        <div>
          ${opts.scopeLabel ? html`<div class="groups-scope-eyebrow">${opts.scopeLabel}</div>` : nothing}
          <div class="card-title">${entry.name}</div>
          <div class="card-sub">${entry.description ?? t("groups.noDescription")}</div>
          <div class="muted" style="margin-top:8px;">
            ${entry.partCount > 0 ? `${entry.partCount} parts · ` : ""}${entry.memberCount} members · ✦ ${entry.leaderCount} leaders
            ${entry.archivedAt ? `· Archived ${formatDate(entry.archivedAt)}` : ""}
          </div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          ${entry.canEditMetadata
            ? html`
                <button class="btn btn--sm" @click=${() => props.onOpenEdit(entry.scopeType, entry)}>
                  ${t("groups.actions.edit")}
                </button>
              `
            : nothing}
          ${entry.canManageMembers
            ? html`
                <button
                  class="btn btn--sm primary"
                  @click=${() =>
                    props.onOpenAddMember(entry.scopeType, entry.id, entry.name)}
                >
                  ${t("groups.actions.addMember")}
                </button>
              `
            : nothing}
          ${opts.showCreatePart && entry.canCreatePart
            ? html`
                <button class="btn btn--sm" @click=${() => props.onOpenCreatePart(entry.id)}>
                  ${t("groups.actions.createPart")}
                </button>
              `
            : nothing}
          ${entry.canArchive && !entry.archivedAt
            ? html`
                <button class="btn btn--sm" @click=${() => props.onArchiveScope(entry.id, entry.name)}>
                  ${t("groups.actions.archive")}
                </button>
              `
            : nothing}
        </div>
      </div>
      ${renderMemberRows(entry.scopeType, entry.id, members, entry.canManageMembers, props)}
    </section>
  `;
}

function renderSelectedGroupDetail(props: GroupsViewProps) {
  const detail = props.detail;
  if (!detail) {
    return nothing;
  }
  return html`
    <section class="card groups-selected-card">
      <div class="groups-selected-header">
        <div>
          <div class="groups-scope-eyebrow">${t("groups.selectedGroup")}</div>
          <div class="groups-selected-title-row">
            <h3 class="groups-selected-title">${detail.group.name}</h3>
            <span class="chip groups-selected-chip">${t("groups.scope.group")}</span>
          </div>
          <div class="groups-selected-subtitle">
            ${detail.group.description ?? t("groups.noDescription")}
          </div>
          <div class="muted groups-selected-meta">
            ${detail.group.partCount} parts · ${detail.group.memberCount} members · ✦ ${detail.group.leaderCount} leaders
            ${detail.group.archivedAt ? `· Archived ${formatDate(detail.group.archivedAt)}` : ""}
          </div>
        </div>
        <div class="groups-selected-actions">
          ${detail.group.canEditMetadata
            ? html`
                <button class="btn btn--sm" @click=${() => props.onOpenEdit("group", detail.group)}>
                  ${t("groups.actions.edit")}
                </button>
              `
            : nothing}
          ${detail.group.canManageMembers
            ? html`
                <button
                  class="btn btn--sm primary"
                  @click=${() => props.onOpenAddMember(detail.group.scopeType, detail.group.id, detail.group.name)}
                >
                  ${t("groups.actions.addMember")}
                </button>
              `
            : nothing}
          ${detail.group.canCreatePart
            ? html`
                <button class="btn btn--sm" @click=${() => props.onOpenCreatePart(detail.group.id)}>
                  ${t("groups.actions.createPart")}
                </button>
              `
            : nothing}
          ${detail.group.canArchive && !detail.group.archivedAt
            ? html`
                <button class="btn btn--sm" @click=${() => props.onArchiveScope(detail.group.id, detail.group.name)}>
                  ${t("groups.actions.archive")}
                </button>
              `
            : nothing}
        </div>
      </div>

      <section class="groups-section-block">
        <div class="groups-section-block__header">
          <div class="groups-scope-eyebrow">${t("groups.membersSection")}</div>
        </div>
        ${renderMemberRows(detail.group.scopeType, detail.group.id, detail.members, detail.group.canManageMembers, props)}
      </section>

      <section class="groups-section-block groups-section-block--parts">
        <div class="groups-section-block__header">
          <div>
            <div class="groups-scope-eyebrow">${t("groups.scope.part")}</div>
            <div class="card-title">${t("groups.partsTitle", { groupName: detail.group.name })}</div>
          </div>
        </div>
        <div class="groups-parts-grid">
          ${detail.parts.length > 0
            ? detail.parts.map((part) =>
                renderScopePanel(part, part.members, props, {
                  nested: true,
                  scopeLabel: `${detail.group.name} / ${t("groups.scope.part")}`,
                }),
              )
            : html`<div class="groups-part-empty">${t("groups.partsEmpty")}</div>`}
        </div>
      </section>
    </section>
  `;
}

function renderCreateGroupDialog(props: GroupsViewProps) {
  if (!props.createOpen) {
    return nothing;
  }
  return html`
    <dialog class="md-preview-dialog" open ${ref(ensureOpen)} @close=${props.onCloseCreate}>
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">${t("groups.create.title")}</div>
            <div class="md-preview-dialog__subtitle">${t("groups.create.subtitle")}</div>
          </div>
          <button class="btn btn--sm" @click=${props.onCloseCreate}>${t("common.close")}</button>
        </div>
        <div class="md-preview-dialog__body" style="display:grid; gap:12px;">
          <label class="field">
            <span class="field__label">${t("groups.fields.name")}</span>
            <input class="input" .value=${props.createName} @input=${(e: Event) => props.onCreateNameChange((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span class="field__label">${t("groups.fields.description")}</span>
            <textarea class="input" rows="4" .value=${props.createDescription} @input=${(e: Event) => props.onCreateDescriptionChange((e.target as HTMLTextAreaElement).value)}></textarea>
          </label>
        </div>
        <div class="md-preview-dialog__footer">
          <button class="btn" @click=${props.onCloseCreate}>${t("common.cancel")}</button>
          <button class="btn primary" ?disabled=${props.createSubmitting || !props.createName.trim()} @click=${props.onSubmitCreate}>
            ${props.createSubmitting ? t("groups.actions.creating") : t("groups.actions.createGroup")}
          </button>
        </div>
      </div>
    </dialog>
  `;
}

function renderCreatePartDialog(props: GroupsViewProps) {
  if (!props.partCreateOpen) {
    return nothing;
  }
  return html`
    <dialog class="md-preview-dialog" open ${ref(ensureOpen)} @close=${props.onCloseCreatePart}>
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">${t("groups.partCreate.title")}</div>
            <div class="md-preview-dialog__subtitle">${t("groups.partCreate.subtitle")}</div>
          </div>
          <button class="btn btn--sm" @click=${props.onCloseCreatePart}>${t("common.close")}</button>
        </div>
        <div class="md-preview-dialog__body" style="display:grid; gap:12px;">
          <label class="field">
            <span class="field__label">${t("groups.fields.name")}</span>
            <input class="input" .value=${props.partCreateName} @input=${(e: Event) => props.onPartNameChange((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span class="field__label">${t("groups.fields.description")}</span>
            <textarea class="input" rows="4" .value=${props.partCreateDescription} @input=${(e: Event) => props.onPartDescriptionChange((e.target as HTMLTextAreaElement).value)}></textarea>
          </label>
        </div>
        <div class="md-preview-dialog__footer">
          <button class="btn" @click=${props.onCloseCreatePart}>${t("common.cancel")}</button>
          <button class="btn primary" ?disabled=${props.partCreateSubmitting || !props.partCreateName.trim()} @click=${props.onSubmitCreatePart}>
            ${props.partCreateSubmitting ? t("groups.actions.creating") : t("groups.actions.createPart")}
          </button>
        </div>
      </div>
    </dialog>
  `;
}

function renderEditScopeDialog(props: GroupsViewProps) {
  if (!props.editOpen) {
    return nothing;
  }
  return html`
    <dialog class="md-preview-dialog" open ${ref(ensureOpen)} @close=${props.onCloseEdit}>
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">
              ${props.editScopeType === "group" ? t("groups.edit.groupTitle") : t("groups.edit.partTitle")}
            </div>
            <div class="md-preview-dialog__subtitle">${props.editTitle ?? ""}</div>
          </div>
          <button class="btn btn--sm" @click=${props.onCloseEdit}>${t("common.close")}</button>
        </div>
        <div class="md-preview-dialog__body" style="display:grid; gap:12px;">
          <label class="field">
            <span class="field__label">${t("groups.fields.name")}</span>
            <input class="input" .value=${props.editName} @input=${(e: Event) => props.onEditNameChange((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span class="field__label">${t("groups.fields.description")}</span>
            <textarea class="input" rows="4" .value=${props.editDescription} @input=${(e: Event) => props.onEditDescriptionChange((e.target as HTMLTextAreaElement).value)}></textarea>
          </label>
        </div>
        <div class="md-preview-dialog__footer">
          <button class="btn" @click=${props.onCloseEdit}>${t("common.cancel")}</button>
          <button class="btn primary" ?disabled=${props.editSubmitting || !props.editName.trim()} @click=${props.onSubmitEdit}>
            ${props.editSubmitting ? t("groups.actions.saving") : t("groups.actions.save")}
          </button>
        </div>
      </div>
    </dialog>
  `;
}

function renderAddMemberDialog(props: GroupsViewProps) {
  if (!props.memberModalOpen) {
    return nothing;
  }
  return html`
    <dialog class="md-preview-dialog" open ${ref(ensureOpen)} @close=${props.onCloseAddMember}>
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">${t("groups.members.addTitle")}</div>
            <div class="md-preview-dialog__subtitle">${props.memberModalScopeLabel ?? ""}</div>
          </div>
          <button class="btn btn--sm" @click=${props.onCloseAddMember}>${t("common.close")}</button>
        </div>
        <div class="md-preview-dialog__body" style="display:grid; gap:12px;">
          <input
            class="input"
            placeholder=${t("groups.members.searchPlaceholder")}
            .value=${props.memberModalQuery}
            @input=${(e: Event) => props.onMemberQueryChange((e.target as HTMLInputElement).value)}
          />
          ${props.canAssignLeader
            ? html`
                <div class="field">
                  <span class="field__label">${t("groups.members.roleLabel")}</span>
                  <div class="admin-role-options">
                    ${(["member", "leader"] as const).map(
                      (role) => html`
                        <button
                          type="button"
                          class="admin-role-option ${props.memberModalRole === role ? "is-selected" : ""}"
                          aria-pressed=${props.memberModalRole === role}
                          @click=${() => props.onMemberRoleChange(role)}
                        >
                          <span class="admin-role-option__title">
                            ${role === "leader" ? "✦ Leader" : "Member"}
                          </span>
                          <span class="admin-role-option__meta">
                            ${role === "leader"
                              ? t("groups.members.leaderHint")
                              : t("groups.members.memberHint")}
                          </span>
                        </button>
                      `,
                    )}
                  </div>
                </div>
              `
            : nothing}
          ${props.memberModalError ? html`<div class="notice notice--error">${props.memberModalError}</div>` : nothing}
          <div class="list">
            ${props.memberModalResults.map(
              (entry) => html`
                <button
                  class="list-item"
                  @click=${() => props.onSelectMemberAccount(entry.accountId)}
                  style="text-align:left; width:100%; ${props.memberModalSelectedAccountId === entry.accountId
                    ? "outline:2px solid var(--accent);"
                    : ""}"
                >
                  <div class="list-main">
                    <div class="list-title">${entry.displayName}</div>
                    <div class="list-sub">${entry.employeeId}${entry.email ? ` · ${entry.email}` : ""}</div>
                  </div>
                </button>
              `,
            )}
          </div>
        </div>
        <div class="md-preview-dialog__footer">
          <button class="btn" @click=${props.onCloseAddMember}>${t("common.cancel")}</button>
          <button
            class="btn primary"
            ?disabled=${props.memberModalLoading || !props.memberModalSelectedAccountId}
            @click=${props.onSubmitAddMember}
          >
            ${props.memberModalLoading
              ? t("groups.actions.addingMember")
              : props.memberModalRole === "leader"
                ? t("groups.actions.addLeader")
                : t("groups.actions.addMember")}
          </button>
        </div>
      </div>
    </dialog>
  `;
}

export function renderGroups(props: GroupsViewProps) {
  return html`
    <section class="card" style="display:grid; gap:16px;">
      <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
        <div>
          <div class="card-title">${t("groups.title")}</div>
          <div class="card-sub">${t("groups.subtitle")}</div>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <label class="muted" style="display:flex; gap:8px; align-items:center;">
            <input type="checkbox" .checked=${props.includeArchived} @change=${(e: Event) => props.onToggleArchived((e.target as HTMLInputElement).checked)} />
            ${t("groups.showArchived")}
          </label>
          <button class="btn btn--sm" @click=${props.onRefresh}>${t("common.refresh")}</button>
          <button class="btn btn--sm primary" @click=${props.onOpenCreate}>${t("groups.actions.createGroup")}</button>
        </div>
      </div>
      ${props.message ? html`<div class="notice notice--${props.message.kind}">${props.message.text}</div>` : nothing}
      ${props.error ? html`<div class="notice notice--error">${props.error}</div>` : nothing}
      <div class="groups-layout">
        <div class="groups-sidebar">
          ${props.entries.map(
            (entry) => html`
              <button
                class="list-item groups-list-item ${props.detailGroupId === entry.id ? "groups-list-item--selected" : ""}"
                @click=${() => props.onSelectGroup(entry.id)}
                style="text-align:left; width:100%;"
              >
                <div class="list-main">
                  <div class="list-title">
                    ${entry.name}
                    ${props.detailGroupId === entry.id
                      ? html`<span class="chip groups-selected-chip">${t("groups.selectedBadge")}</span>`
                      : nothing}
                  </div>
                  <div class="list-sub">
                    ${entry.description ?? t("groups.noDescription")} · ${entry.partCount} parts · ${entry.memberCount}
                    members · ✦ ${entry.leaderCount} leaders
                  </div>
                </div>
              </button>
            `,
          )}
          ${!props.loading && props.entries.length === 0
            ? html`<div class="skills-empty-state__body">${t("groups.empty")}</div>`
            : nothing}
        </div>
        <div class="groups-detail-column">
          ${props.detailLoading ? html`<div class="card">${t("groups.loadingDetail")}</div>` : nothing}
          ${props.detailError ? html`<div class="notice notice--error">${props.detailError}</div>` : nothing}
          ${props.detail
            ? renderSelectedGroupDetail(props)
            : !props.detailLoading
              ? html`<div class="card">${t("groups.selectHint")}</div>`
              : nothing}
        </div>
      </div>
      ${renderCreateGroupDialog(props)}
      ${renderCreatePartDialog(props)}
      ${renderEditScopeDialog(props)}
      ${renderAddMemberDialog(props)}
    </section>
  `;
}
