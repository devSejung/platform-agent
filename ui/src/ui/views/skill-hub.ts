import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { t } from "../../i18n/index.ts";
import type { AccountDirectoryEntry } from "../controllers/accounts.ts";
import type {
  SkillHubCategoryFilter,
  SkillHubDetail,
  SkillHubEntry,
  SkillHubOverview,
  SkillHubScope,
  SkillHubSort,
  WorkspacePublishEntry,
} from "../controllers/skill-hub.ts";
import { renderSkillPresentationIcon, skillCategoryLabel } from "../skill-hub-presentation.ts";

export type SkillHubProps = {
  loading: boolean;
  entries: SkillHubEntry[];
  error: string | null;
  scope: SkillHubScope;
  sort: SkillHubSort;
  category: SkillHubCategoryFilter;
  query: string;
  detail: SkillHubDetail | null;
  detailSlug: string | null;
  detailLoading: boolean;
  detailError: string | null;
  busySlug: string | null;
  message: { kind: "success" | "error"; text: string } | null;
  workspacePublishing: boolean;
  workspacePendingKeys: string[];
  workspacePublishEntries: WorkspacePublishEntry[];
  overview: SkillHubOverview | null;
  uploading: boolean;
  workspacePanelOpen: boolean;
  editorOpen: boolean;
  editorMode: "publish" | "upload" | "edit-metadata" | null;
  editorTitle: string | null;
  editorSkillName: string | null;
  editorFile: File | null;
  editorIconFile: File | null;
  editorIconReset: boolean;
  editorHasUploadedIcon: boolean;
  editorDisplayName: string;
  editorDescription: string;
  editorCategory: SkillHubEntry["presentation"]["category"] | "";
  editorPrompts: string[];
  editorError: string | null;
  editorLoading: boolean;
  transferOpen: boolean;
  transferTitle: string | null;
  transferQuery: string;
  transferResults: AccountDirectoryEntry[];
  transferTargetAccountId: string | null;
  transferReason: string;
  transferError: string | null;
  transferLoading: boolean;
  onScopeChange: (scope: SkillHubScope) => void;
  onSortChange: (sort: SkillHubSort) => void;
  onCategoryChange: (category: SkillHubCategoryFilter) => void;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onOpenDetail: (slug: string) => void;
  onCloseDetail: () => void;
  onInstall: (slug: string) => void;
  onUpdate: (slug: string) => void;
  onDelete: (slug: string) => void;
  onDeleteFromHub: (slug: string) => void;
  onLike: (slug: string) => void;
  onCopy: (text: string, successText: string) => void;
  onOpenPublishEditor: (skillName: string, title: string) => void;
  onOpenWorkspaceSkillDetail: (skillKey: string) => void;
  onOpenUploadEditor: () => void;
  onToggleWorkspacePanel: () => void;
  onOpenEditMetadataEditor: (detail: SkillHubDetail) => void;
  onEditorClose: () => void;
  onEditorDisplayNameChange: (value: string) => void;
  onEditorDescriptionChange: (value: string) => void;
  onEditorCategoryChange: (value: SkillHubEntry["presentation"]["category"] | "") => void;
  onEditorPromptChange: (index: number, value: string) => void;
  onEditorFileChange: (file: File | null) => void;
  onEditorIconFileChange: (file: File | null) => void;
  onEditorIconReset: () => void;
  onEditorSubmit: () => void;
  onOpenTransfer: (slug: string, title: string) => void;
  onCloseTransfer: () => void;
  onTransferQueryChange: (value: string) => void;
  onTransferTargetSelect: (accountId: string) => void;
  onTransferReasonChange: (value: string) => void;
  onTransferSubmit: () => void;
};

const SCOPE_TABS: Array<{ id: SkillHubScope; labelKey: string }> = [
  { id: "discover", labelKey: "skillHub.tabs.discover" },
  { id: "installed", labelKey: "skillHub.tabs.installed" },
  { id: "uploads", labelKey: "skillHub.tabs.uploads" },
  { id: "updates", labelKey: "skillHub.tabs.updates" },
];

const SORT_OPTIONS: Array<{ id: SkillHubSort; labelKey: string }> = [
  { id: "recent", labelKey: "skillHub.sort.recent" },
  { id: "installs", labelKey: "skillHub.sort.installs" },
  { id: "likes", labelKey: "skillHub.sort.likes" },
  { id: "az", labelKey: "skillHub.sort.az" },
];

const CATEGORY_FILTERS: Array<{ id: SkillHubCategoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "knowledge", label: "Knowledge" },
  { id: "automation", label: "Automation" },
  { id: "utility", label: "Utility" },
  { id: "other", label: "Other" },
];

function ensureDialogOpen(el?: Element) {
  if (!(el instanceof HTMLDialogElement) || el.open) {
    return;
  }
  try {
    el.showModal();
  } catch {
    el.setAttribute("open", "");
  }
}

function relativeDate(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return iso;
  }
  return value.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function renderFlagBadges(entry: SkillHubEntry | SkillHubDetail) {
  const badges: string[] = [];
  if (entry.uploadedByYou) {
    badges.push(t("skillHub.badges.uploadedByYou"));
  }
  if (entry.hidden) {
    badges.push(t("skillHub.badges.hidden"));
  }
  if (entry.flags.hasHiddenFiles) {
    badges.push(t("skillHub.badges.hiddenFiles"));
  }
  if (entry.flags.hasExecutableFiles) {
    badges.push(t("skillHub.badges.executableFiles"));
  }
  if (entry.installed) {
    badges.push(
      entry.updateAvailable ? t("skillHub.badges.updateAvailable") : t("skillHub.badges.installed"),
    );
  }
  if (badges.length === 0) {
    return nothing;
  }
  return html`<div class="chip-row" style="margin-top: 8px;">
    ${badges.map((badge) => html`<span class="chip">${badge}</span>`)}
  </div>`;
}

function renderMetaRow(entry: SkillHubEntry | SkillHubDetail) {
  return html`
    <div class="skillhub-card__meta">
      <span>${t("skillHub.meta.by")} ${entry.uploaderName}</span>
      <span>♡ ${entry.likeCount}</span>
      <span>↓ ${entry.installCount}</span>
      <span>${t("skillHub.meta.updated")} ${relativeDate(entry.updatedAt)}</span>
    </div>
  `;
}

function renderLikeButton(entry: SkillHubEntry | SkillHubDetail, props: SkillHubProps) {
  return html`
    <button
      class="btn btn--sm ${entry.likedByYou ? "primary" : ""}"
      ?disabled=${props.busySlug === entry.slug}
      @click=${() => props.onLike(entry.slug)}
      aria-pressed=${entry.likedByYou ? "true" : "false"}
    >
      ${entry.likedByYou ? "♥" : "♡"} ${entry.likeCount}
    </button>
  `;
}

function renderEntryCard(entry: SkillHubEntry, props: SkillHubProps) {
  const busy = props.busySlug === entry.slug;
  const presentation = entry.presentation;
  return html`
    <article class="skillhub-card">
      <div class="skillhub-card__body">
        <div class="skillhub-card__header">
          <div class="skillhub-card__identity">
            ${renderSkillPresentationIcon(presentation)}
            <div class="skillhub-card__title-group">
              <div class="skillhub-card__title">${presentation.displayName}</div>
              <span class="skillhub-category-badge"
                >${skillCategoryLabel(presentation.category)}</span
              >
            </div>
          </div>
          ${renderLikeButton(entry, props)}
        </div>
        <div class="skillhub-card__summary">${presentation.displayDescription}</div>
        ${renderFlagBadges(entry)} ${renderMetaRow(entry)}
      </div>
      <div class="skillhub-card__actions">
        <div class="skillhub-card__main-actions">
          <button class="btn btn--sm" @click=${() => props.onOpenDetail(entry.slug)}>
            ${t("skillHub.actions.details")}
          </button>
          ${entry.installed
            ? html`
                <button
                  class="btn btn--sm primary"
                  ?disabled=${busy || !entry.updateAvailable}
                  @click=${() => props.onUpdate(entry.slug)}
                >
                  ${busy && entry.updateAvailable
                    ? t("skillHub.actions.updating")
                    : t("skillHub.actions.update")}
                </button>
                <button
                  class="btn btn--sm"
                  ?disabled=${busy}
                  @click=${() => props.onDelete(entry.slug)}
                >
                  ${t("skillHub.actions.delete")}
                </button>
              `
            : html`
                <button
                  class="btn btn--sm primary"
                  ?disabled=${busy || entry.hidden}
                  @click=${() => props.onInstall(entry.slug)}
                >
                  ${busy ? t("skillHub.actions.installing") : t("skillHub.actions.install")}
                </button>
              `}
        </div>
        ${entry.canManageVisibility
          ? html`
              <details class="skillhub-more">
                <summary class="btn btn--sm" aria-label=${t("skillHub.actions.more")}>⋯</summary>
                <div class="skillhub-more__menu">
                  <button
                    class="btn btn--sm skillhub-danger-action"
                    ?disabled=${busy}
                    @click=${() => props.onDeleteFromHub(entry.slug)}
                  >
                    ${t("skillHub.actions.deleteFromHub")}
                  </button>
                </div>
              </details>
            `
          : nothing}
      </div>
    </article>
  `;
}

function renderStatusPanel(props: SkillHubProps) {
  const overview = props.overview;
  return html`
    <section class="skillhub-side-card">
      <div class="skillhub-side-card__title">${t("skillHub.status.title")}</div>
      <div class="skillhub-status-grid">
        <div>
          <strong>${overview?.sharedSkillCount ?? 0}</strong
          ><span>${t("skillHub.status.shared")}</span>
        </div>
        <div>
          <strong>${overview?.updateAvailableCount ?? 0}</strong
          ><span>${t("skillHub.status.updates")}</span>
        </div>
        <div>
          <strong>${overview?.localSkillCount ?? 0}</strong
          ><span>${t("skillHub.status.local")}</span>
        </div>
        <div>
          <strong>${overview?.installedSkillCount ?? 0}</strong
          ><span>${t("skillHub.status.installed")}</span>
        </div>
      </div>
    </section>
  `;
}

function renderRecentUpdatesPanel(props: SkillHubProps) {
  const recent = props.overview?.recentUpdates ?? [];
  return html`
    <section class="skillhub-side-card">
      <div class="skillhub-side-card__title">${t("skillHub.recent.title")}</div>
      ${recent.length === 0
        ? html`<div class="muted">${t("skillHub.recent.empty")}</div>`
        : html`<div class="skillhub-recent-list">
            ${recent.map(
              (entry) => html`
                <button class="skillhub-recent-item" @click=${() => props.onOpenDetail(entry.slug)}>
                  <span>${entry.displayName}</span>
                  <small> v${entry.latestVersion} · ${relativeDate(entry.updatedAt)} </small>
                </button>
              `,
            )}
          </div>`}
    </section>
  `;
}

function renderExamplePrompts(detail: SkillHubDetail, props: SkillHubProps) {
  return html`
    <div>
      <div
        style="display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:10px;"
      >
        <div class="card-title" style="margin:0;">${t("skillHub.detail.examplePrompts")}</div>
        ${detail.canEditMetadata
          ? html`
              <button class="btn btn--sm" @click=${() => props.onOpenEditMetadataEditor(detail)}>
                ${t("skillHub.actions.edit")}
              </button>
            `
          : nothing}
      </div>
      ${detail.examplePrompts.length === 0
        ? html`<div class="muted">${t("skillHub.detail.examplePromptsEmpty")}</div>`
        : html`<div class="list">
            ${detail.examplePrompts.map(
              (prompt) => html`
                <div class="list-item">
                  <div class="list-main">
                    <div class="list-sub" style="white-space:normal;">${prompt}</div>
                  </div>
                  <div class="list-meta">
                    <button
                      class="btn btn--sm"
                      @click=${() => props.onCopy(prompt, t("skillHub.messages.promptCopied"))}
                    >
                      ${t("common.copy")}
                    </button>
                  </div>
                </div>
              `,
            )}
          </div>`}
    </div>
  `;
}

function renderWorkspacePublishPanel(props: SkillHubProps) {
  const workspaceSkills = props.workspacePublishEntries;
  return html`
    <section class="skillhub-side-card skillhub-publish-panel">
      <div class="skillhub-side-card__header">
        <div style="min-width:0;">
          <div class="skillhub-side-card__title">${t("skillHub.publish.title")}</div>
          <div class="skillhub-side-card__sub">${t("skillHub.publish.subtitle")}</div>
        </div>
        <button class="btn btn--sm" @click=${props.onToggleWorkspacePanel}>
          ${props.workspacePanelOpen
            ? t("skillHub.actions.collapse")
            : t("skillHub.actions.expand")}
        </button>
      </div>
      <div class="muted">
        ${t("skillHub.publish.collapsedHint", { count: String(workspaceSkills.length) })}
      </div>
      ${props.workspacePanelOpen
        ? html`
            <div class="skillhub-publish-list">
              ${workspaceSkills.length === 0
                ? html`<div class="skills-empty-state__body">${t("skillHub.publish.empty")}</div>`
                : workspaceSkills.map(
                    (skill) => html`
                      <article class="skillhub-publish-item">
                        <div class="skillhub-publish-item__body">
                          <div class="skillhub-publish-item__title">${skill.skillName}</div>
                          <div class="skillhub-publish-item__desc">
                            ${skill.description || skill.skillKey}
                          </div>
                          <div class="skillhub-publish-item__reason">${skill.reason}</div>
                        </div>
                        <div class="skillhub-publish-item__actions">
                          <button
                            class="btn btn--sm"
                            @click=${() => props.onOpenWorkspaceSkillDetail(skill.skillKey)}
                          >
                            ${t("skillHub.actions.details")}
                          </button>
                          <button
                            class="btn btn--sm primary"
                            ?disabled=${skill.disabled ||
                            props.workspacePendingKeys.includes(skill.skillKey)}
                            @click=${() =>
                              props.onOpenPublishEditor(skill.skillName, skill.skillName)}
                          >
                            ${props.workspacePendingKeys.includes(skill.skillKey)
                              ? t("skillHub.publish.publishing")
                              : skill.actionLabel}
                          </button>
                        </div>
                      </article>
                    `,
                  )}
            </div>
          `
        : nothing}
    </section>
  `;
}

function renderDetailDialog(props: SkillHubProps) {
  const detail = props.detail;
  const ensureOpen = (el?: Element) => {
    if (!(el instanceof HTMLDialogElement) || el.open) {
      return;
    }
    try {
      el.showModal();
    } catch {
      el.setAttribute("open", "");
    }
  };
  return html`
    <dialog
      class="md-preview-dialog"
      open
      ${ref(ensureOpen)}
      @click=${(e: Event) => {
        const dialog = e.currentTarget as HTMLDialogElement;
        if (e.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onCloseDetail}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div class="md-preview-dialog__title">
            ${detail?.presentation.displayName ?? props.detailSlug}
          </div>
          <button
            class="btn btn--sm"
            @click=${(e: Event) => (e.currentTarget as HTMLElement).closest("dialog")?.close()}
          >
            ${t("skillHub.actions.close")}
          </button>
        </div>
        <div class="md-preview-dialog__body" style="display:grid; gap:18px;">
          ${props.detailLoading
            ? html`<div class="muted">${t("common.loading")}</div>`
            : props.detailError
              ? html`<div class="callout danger">${props.detailError}</div>`
              : detail
                ? html`
                    <div class="skillhub-detail-presentation">
                      ${renderSkillPresentationIcon(detail.presentation, "detail")}
                      <div class="skillhub-detail-presentation__body">
                        <div class="skillhub-detail-presentation__heading">
                          <span class="skillhub-category-badge"
                            >${skillCategoryLabel(detail.presentation.category)}</span
                          >
                          <span class="muted">v${detail.latestVersion}</span>
                        </div>
                        <div class="skillhub-detail-presentation__description">
                          ${detail.presentation.displayDescription}
                        </div>
                      </div>
                    </div>
                    ${renderFlagBadges(detail)} ${renderMetaRow(detail)}
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                      ${renderLikeButton(detail, props)}
                      ${detail.installed
                        ? html`
                            <button
                              class="btn primary"
                              ?disabled=${props.busySlug === detail.slug || !detail.updateAvailable}
                              @click=${() => props.onUpdate(detail.slug)}
                            >
                              ${t("skillHub.actions.update")}
                            </button>
                            <button class="btn" @click=${() => props.onDelete(detail.slug)}>
                              ${t("skillHub.actions.delete")}
                            </button>
                          `
                        : html`
                            <button
                              class="btn primary"
                              ?disabled=${props.busySlug === detail.slug || detail.hidden}
                              @click=${() => props.onInstall(detail.slug)}
                            >
                              ${t("skillHub.actions.install")}
                            </button>
                          `}
                      <button
                        class="btn"
                        @click=${() =>
                          props.onCopy(
                            `/skillhub install ${detail.slug}`,
                            t("skillHub.messages.commandCopied"),
                          )}
                      >
                        ${t("skillHub.actions.copyKnox")}
                      </button>
                      ${detail.canEditMetadata
                        ? html`
                            <button
                              class="btn"
                              @click=${() => props.onOpenEditMetadataEditor(detail)}
                            >
                              ${t("skillHub.actions.edit")}
                            </button>
                          `
                        : nothing}
                      ${detail.canManageVisibility
                        ? html`
                            <button class="btn" @click=${() => props.onDeleteFromHub(detail.slug)}>
                              ${t("skillHub.actions.deleteFromHub")}
                            </button>
                          `
                        : nothing}
                      ${detail.canTransferOwnership
                        ? html`
                            <button
                              class="btn"
                              @click=${() =>
                                props.onOpenTransfer(detail.slug, detail.presentation.displayName)}
                            >
                              ${t("skillHub.actions.transferOwnership")}
                            </button>
                          `
                        : nothing}
                    </div>
                    <div class="skills-detail-paths">
                      <div>
                        <span>Slug</span>
                        <code>${detail.slug}</code>
                      </div>
                      ${detail.sourceDescription
                        ? html`
                            <div>
                              <span>${t("skillHub.editor.descriptionLabel")} (SKILL.md)</span>
                              <code>${detail.sourceDescription}</code>
                            </div>
                          `
                        : nothing}
                      <div>
                        <span>Icon</span>
                        <code
                          >${detail.presentation.icon.source === "uploaded"
                            ? "Uploaded PNG"
                            : "Category default"}</code
                        >
                      </div>
                      <div>
                        <span>${t("skillHub.detail.uploader")}</span>
                        <code>${detail.uploaderName} (${detail.uploaderEmployeeId})</code>
                      </div>
                      <div>
                        <span>${t("skillHub.detail.published")}</span
                        ><code>${relativeDate(detail.publishedAt)}</code>
                      </div>
                      <div>
                        <span>${t("skillHub.detail.updated")}</span
                        ><code>${relativeDate(detail.updatedAt)}</code>
                      </div>
                      <div>
                        <span>${t("skillHub.detail.usage")}</span
                        ><code
                          >${detail.installCount} ${t("skillHub.meta.installs")} /
                          ${detail.installerCount} ${t("skillHub.meta.users")}</code
                        >
                      </div>
                      <div>
                        <span>${t("skillHub.detail.knoxInstall")}</span
                        ><code>/skillhub install ${detail.slug}</code>
                      </div>
                      <div>
                        <span>${t("skillHub.detail.knoxUpdate")}</span
                        ><code>/skillhub update ${detail.slug}</code>
                      </div>
                      <div>
                        <span>${t("skillHub.detail.knoxDelete")}</span
                        ><code>/skillhub delete ${detail.slug}</code>
                      </div>
                    </div>
                    ${renderExamplePrompts(detail, props)}
                    ${detail.canAdminManage && !detail.uploadedByYou
                      ? html`
                          <section
                            class="card"
                            style="padding:16px; border-style:dashed; background:var(--surface-muted);"
                          >
                            <div class="card-title" style="margin:0;">
                              ${t("skillHub.detail.adminControls")}
                            </div>
                            <div class="card-sub" style="margin-top:6px;">
                              ${t("skillHub.detail.adminControlsHelp")}
                            </div>
                          </section>
                        `
                      : nothing}
                    <div>
                      <div class="card-title" style="margin-bottom:10px;">
                        ${t("skillHub.detail.versionHistory")}
                      </div>
                      <div class="list">
                        ${detail.versions.map(
                          (version) => html`
                            <div class="list-item">
                              <div class="list-main">
                                <div class="list-title">v${version.version}</div>
                                <div class="list-sub">
                                  ${version.uploadedBy.name ?? version.uploadedBy.employeeId} •
                                  ${relativeDate(version.uploadedAt)}
                                </div>
                              </div>
                            </div>
                          `,
                        )}
                      </div>
                    </div>
                  `
                : html`<div class="muted">${t("skillHub.empty.notFound")}</div>`}
        </div>
      </div>
    </dialog>
  `;
}

function renderEditorDialog(props: SkillHubProps) {
  if (!props.editorOpen || !props.editorMode) {
    return nothing;
  }
  const ensureOpen = (el?: Element) => {
    if (!(el instanceof HTMLDialogElement) || el.open) {
      return;
    }
    try {
      el.showModal();
    } catch {
      el.setAttribute("open", "");
    }
  };
  let fileInput: HTMLInputElement | null = null;
  let iconInput: HTMLInputElement | null = null;
  const publishEntry =
    props.editorMode === "publish"
      ? props.workspacePublishEntries.find((entry) => entry.skillName === props.editorSkillName)
      : null;
  return html`
    <dialog
      class="md-preview-dialog"
      open
      ${ref(ensureOpen)}
      @click=${(e: Event) => {
        const dialog = e.currentTarget as HTMLDialogElement;
        if (e.target === dialog) {
          dialog.close();
        }
      }}
      @close=${props.onEditorClose}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div class="md-preview-dialog__title">
            ${props.editorMode === "publish"
              ? t("skillHub.editor.publishTitle")
              : props.editorMode === "upload"
                ? t("skillHub.editor.uploadTitle")
                : t("skillHub.editor.editMetadataTitle")}
            ${props.editorTitle ? ` · ${props.editorTitle}` : ""}
          </div>
          <button
            class="btn btn--sm"
            @click=${(e: Event) => (e.currentTarget as HTMLElement).closest("dialog")?.close()}
          >
            ${t("skillHub.actions.close")}
          </button>
        </div>
        <div class="md-preview-dialog__body" style="display:grid; gap:16px;">
          <div class="muted">${t("skillHub.editor.help")}</div>
          ${props.editorLoading
            ? html`<div class="muted">${t("skillHub.editor.prefillLoading")}</div>`
            : nothing}
          ${props.editorMode === "upload"
            ? html`
                <input
                  ${ref((el?: Element) => {
                    fileInput = el instanceof HTMLInputElement ? el : null;
                  })}
                  type="file"
                  accept=".skill"
                  style="display:none"
                  @change=${(e: Event) => {
                    const target = e.target as HTMLInputElement;
                    props.onEditorFileChange(target.files?.[0] ?? null);
                    target.value = "";
                  }}
                />
                <div style="display:flex; gap:10px; align-items:center; flex-wrap:wrap;">
                  <button class="btn" @click=${() => fileInput?.click()}>
                    ${t("skillHub.editor.chooseFile")}
                  </button>
                  <div class="muted">${props.editorFile?.name ?? t("skillHub.editor.noFile")}</div>
                </div>
              `
            : nothing}
          ${props.editorMode === "edit-metadata" ||
          props.editorMode === "publish" ||
          props.editorMode === "upload"
            ? html`
                <input
                  ${ref((el?: Element) => {
                    iconInput = el instanceof HTMLInputElement ? el : null;
                  })}
                  type="file"
                  accept="image/png,.png"
                  style="display:none"
                  @change=${(e: Event) => {
                    const target = e.target as HTMLInputElement;
                    props.onEditorIconFileChange(target.files?.[0] ?? null);
                    target.value = "";
                  }}
                />
                <div class="skillhub-icon-editor">
                  <div>
                    <div class="field__label">Icon</div>
                    <div class="muted">PNG · max 256 KB · max 1024×1024</div>
                  </div>
                  <div class="skillhub-icon-editor__actions">
                    <button class="btn" @click=${() => iconInput?.click()}>Choose PNG</button>
                    ${props.editorMode === "edit-metadata" &&
                    (props.editorHasUploadedIcon || props.editorIconFile)
                      ? html`
                          <button class="btn" @click=${props.onEditorIconReset}>
                            Use category icon
                          </button>
                        `
                      : nothing}
                  </div>
                  ${props.editorIconFile
                    ? html`<div class="muted skillhub-icon-editor__file">
                        Selected: ${props.editorIconFile.name}
                      </div>`
                    : props.editorIconReset
                      ? html`<div class="muted skillhub-icon-editor__file">
                          Category default icon will be used after saving.
                        </div>`
                      : nothing}
                </div>
                <label class="field">
                  <div class="field__label">
                    Display name
                    <span class="muted" style="margin-left:8px;"
                      >${props.editorDisplayName.length}/80</span
                    >
                  </div>
                  <input
                    maxlength="80"
                    .value=${props.editorDisplayName}
                    placeholder="Fallback: skill slug"
                    @input=${(e: Event) =>
                      props.onEditorDisplayNameChange((e.target as HTMLInputElement).value)}
                  />
                </label>
                <label class="field">
                  <div class="field__label">
                    ${t("skillHub.editor.descriptionLabel")}
                    <span class="muted" style="margin-left:8px;"
                      >${props.editorDescription.length}/100</span
                    >
                  </div>
                  <textarea
                    rows="4"
                    maxlength="100"
                    .value=${props.editorDescription}
                    placeholder=${t("skillHub.editor.descriptionPlaceholder")}
                    @input=${(e: Event) =>
                      props.onEditorDescriptionChange((e.target as HTMLTextAreaElement).value)}
                  ></textarea>
                </label>
                <label class="field">
                  <div class="field__label">Category</div>
                  <select
                    .value=${props.editorCategory}
                    @change=${(e: Event) =>
                      props.onEditorCategoryChange(
                        (e.target as HTMLSelectElement).value as
                          | SkillHubEntry["presentation"]["category"]
                          | "",
                      )}
                  >
                    <option value="" ?selected=${props.editorCategory === ""}>
                      Default (Other)
                    </option>
                    ${(["knowledge", "automation", "utility", "other"] as const).map(
                      (category) =>
                        html`<option
                          value=${category}
                          ?selected=${props.editorCategory === category}
                        >
                          ${skillCategoryLabel(category)}
                        </option>`,
                    )}
                  </select>
                </label>
              `
            : nothing}
          <div style="display:grid; gap:12px;">
            ${props.editorPrompts.map(
              (value, index) => html`
                <label class="field">
                  <div class="field__label">
                    ${t("skillHub.editor.promptLabel")} ${index + 1}
                    <span class="muted" style="margin-left:8px;">${value.length}/200</span>
                  </div>
                  <textarea
                    rows="3"
                    maxlength="200"
                    ?disabled=${props.editorLoading}
                    .value=${value}
                    placeholder=${t("skillHub.editor.promptPlaceholder")}
                    @input=${(e: Event) =>
                      props.onEditorPromptChange(index, (e.target as HTMLTextAreaElement).value)}
                  ></textarea>
                </label>
              `,
            )}
          </div>
          ${props.editorError
            ? html`<div class="callout danger">${props.editorError}</div>`
            : nothing}
          <div style="display:flex; justify-content:flex-end; gap:10px;">
            <button class="btn" @click=${props.onEditorClose}>${t("cron.form.cancel")}</button>
            <button
              class="btn primary"
              ?disabled=${props.editorLoading ||
              (props.editorMode === "upload"
                ? props.uploading
                : props.editorMode === "publish"
                  ? props.workspacePublishing
                  : false)}
              @click=${props.onEditorSubmit}
            >
              ${props.editorMode === "edit-metadata"
                ? t("skillHub.actions.save")
                : props.editorMode === "upload"
                  ? props.uploading
                    ? t("skillHub.upload.uploading")
                    : t("skillHub.editor.uploadAction")
                  : props.workspacePublishing
                    ? t("skillHub.publish.publishing")
                    : (publishEntry?.actionLabel ?? t("skillHub.editor.publishAction"))}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

function renderTransferDialog(props: SkillHubProps) {
  if (!props.transferOpen) {
    return nothing;
  }
  return html`
    <dialog
      class="md-preview-dialog skillhub-transfer-dialog"
      open
      ${ref(ensureDialogOpen)}
      @close=${props.onCloseTransfer}
    >
      <div class="md-preview-dialog__panel skillhub-transfer-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">${t("skillHub.transfer.title")}</div>
            <div class="md-preview-dialog__subtitle">${props.transferTitle ?? ""}</div>
          </div>
          <button class="btn btn--sm" @click=${props.onCloseTransfer}>
            ${t("skillHub.actions.close")}
          </button>
        </div>
        <div class="md-preview-dialog__body skillhub-transfer-dialog__body">
          <label class="skillhub-transfer-dialog__search">
            <input
              aria-label=${t("skillHub.transfer.searchPlaceholder")}
              .value=${props.transferQuery}
              placeholder=${t("skillHub.transfer.searchPlaceholder")}
              @input=${(e: Event) =>
                props.onTransferQueryChange((e.target as HTMLInputElement).value)}
            />
          </label>
          <div class="skillhub-transfer-dialog__results" role="listbox">
            ${props.transferResults.map(
              (entry) => html`
                <button
                  class="skillhub-transfer-account ${props.transferTargetAccountId ===
                  entry.accountId
                    ? "is-selected"
                    : ""}"
                  role="option"
                  aria-selected=${props.transferTargetAccountId === entry.accountId
                    ? "true"
                    : "false"}
                  @click=${() => props.onTransferTargetSelect(entry.accountId)}
                >
                  <div class="skillhub-transfer-account__identity">
                    <div class="skillhub-transfer-account__name">${entry.displayName}</div>
                    <div class="skillhub-transfer-account__meta">
                      ${entry.employeeId}${entry.email ? ` · ${entry.email}` : ""}
                    </div>
                  </div>
                  <span class="skillhub-transfer-account__select" aria-hidden="true">
                    ${props.transferTargetAccountId === entry.accountId ? "Selected" : "Select"}
                  </span>
                </button>
              `,
            )}
          </div>
          <label class="skillhub-transfer-dialog__reason">
            <textarea
              aria-label=${t("skillHub.transfer.reasonPlaceholder")}
              rows="3"
              .value=${props.transferReason}
              placeholder=${t("skillHub.transfer.reasonPlaceholder")}
              @input=${(e: Event) =>
                props.onTransferReasonChange((e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </label>
          ${props.transferError
            ? html`<div class="callout danger">${props.transferError}</div>`
            : nothing}
          <div class="skillhub-transfer-dialog__actions">
            <button class="btn" @click=${props.onCloseTransfer}>${t("common.cancel")}</button>
            <button
              class="btn primary"
              ?disabled=${props.transferLoading || !props.transferTargetAccountId}
              @click=${props.onTransferSubmit}
            >
              ${props.transferLoading
                ? t("skillHub.actions.transferring")
                : t("skillHub.actions.transferOwnership")}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

export function renderSkillHub(props: SkillHubProps) {
  return html`
    <section class="skillhub-page">
      <section class="skillhub-page__header">
        <div style="min-width:0;">
          <div class="card-title skillhub-page__title">${t("skillHub.title")}</div>
          <div class="card-sub">${t("skillHub.subtitleShort")}</div>
        </div>
        <button class="btn primary" @click=${props.onOpenUploadEditor}>
          ${t("skillHub.actions.upload")}
        </button>
      </section>

      <div class="skillhub-market-layout">
        <main class="skillhub-catalog">
          <section class="skillhub-catalog__header">
            <div style="min-width:0;">
              <div class="card-title">${t("skillHub.heroTitle")}</div>
              <div class="card-sub">${t("skillHub.subtitle")}</div>
            </div>
            <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? t("common.refreshing") : t("common.refresh")}
            </button>
          </section>
          <div class="agent-tabs">
            ${SCOPE_TABS.map(
              (scope) => html`
                <button
                  class="agent-tab ${props.scope === scope.id ? "active" : ""}"
                  @click=${() => props.onScopeChange(scope.id)}
                >
                  ${t(scope.labelKey)}
                </button>
              `,
            )}
          </div>
          <div class="skillhub-category-filters" aria-label="Skill categories">
            ${CATEGORY_FILTERS.map(
              (category) => html`
                <button
                  class="skillhub-category-filter ${props.category === category.id ? "active" : ""}"
                  aria-pressed=${props.category === category.id ? "true" : "false"}
                  @click=${() => props.onCategoryChange(category.id)}
                >
                  ${category.label}
                </button>
              `,
            )}
          </div>
          <div class="skillhub-filter-row">
            <label class="field skillhub-search-field">
              <input
                .value=${props.query}
                placeholder=${t("skillHub.searchPlaceholder")}
                @input=${(e: Event) => props.onQueryChange((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="field skillhub-sort-field">
              <select
                .value=${props.sort}
                @change=${(e: Event) =>
                  props.onSortChange((e.target as HTMLSelectElement).value as SkillHubSort)}
              >
                ${SORT_OPTIONS.map(
                  (option) => html`<option value=${option.id}>${t(option.labelKey)}</option>`,
                )}
              </select>
            </label>
            <div class="muted skillhub-shown-count">
              ${props.entries.length} ${t("skillHub.shown")}
            </div>
          </div>
          ${props.message
            ? html`<div class="callout ${props.message.kind === "error" ? "danger" : "success"}">
                ${props.message.text}
              </div>`
            : nothing}
          ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
          <section class="skillhub-card-grid">
            ${props.entries.length === 0
              ? html`
                  <div class="skills-empty-state skillhub-empty">
                    <div class="skills-empty-state__title">${t("skillHub.empty.title")}</div>
                    <div class="skills-empty-state__body">${t("skillHub.empty.body")}</div>
                  </div>
                `
              : props.entries.map((entry) => renderEntryCard(entry, props))}
          </section>
        </main>

        <aside class="skillhub-side-rail">
          ${renderWorkspacePublishPanel(props)} ${renderStatusPanel(props)}
          ${renderRecentUpdatesPanel(props)}
        </aside>
      </div>
      ${props.detailSlug ? renderDetailDialog(props) : nothing}
      ${props.editorOpen ? renderEditorDialog(props) : nothing}
      ${props.transferOpen ? renderTransferDialog(props) : nothing}
    </section>
  `;
}
