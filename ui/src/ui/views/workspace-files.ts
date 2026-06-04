import { html, nothing } from "lit";
import { createRef, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type {
  WorkspaceFilesBreadcrumbEntry,
  WorkspaceFilesEntry,
  WorkspaceFilePreviewResponse,
} from "../../../../src/gateway/employee-workspace-files-contract.ts";
import type { WorkspaceFileUploadItem } from "../controllers/workspace-files.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import {
  renderWorkspaceCodePreviewHtml,
  renderWorkspacePlainTextHtml,
} from "../workspace-file-preview.ts";

type WorkspaceFilesViewProps = {
  loading: boolean;
  uploading: boolean;
  error: string | null;
  message: { kind: "success" | "error"; text: string } | null;
  currentPath: string;
  parentPath: string | null;
  breadcrumbs: WorkspaceFilesBreadcrumbEntry[];
  entries: WorkspaceFilesEntry[];
  selectedPaths: string[];
  uploads: WorkspaceFileUploadItem[];
  previewLoading: boolean;
  previewError: string | null;
  preview: WorkspaceFilePreviewResponse | null;
  onNavigate: (relativePath: string) => void;
  onRefresh: () => void;
  onToggleSelection: (relativePath: string, selected: boolean) => void;
  onToggleAllSelections: (relativePaths: string[], selected: boolean) => void;
  onDownload: (relativePaths: string[]) => void;
  onOpenFilePreview: (relativePath: string) => void | Promise<void>;
  onCloseFilePreview: () => void;
  onCreateFolder: (name: string) => Promise<void>;
  onRename: (relativePath: string, nextName: string) => Promise<void>;
  onDelete: (relativePaths: string[]) => Promise<void>;
  onUpload: (files: File[]) => Promise<void>;
  requestUpdate?: () => void;
};

const fileInputRef = createRef<HTMLInputElement>();

const modalState = {
  mkdirOpen: false,
  mkdirName: "",
  renamePath: null as string | null,
  renameName: "",
  deletePaths: [] as string[],
  dragActive: false,
  busy: false,
  sortKey: "name" as "name" | "size" | "updatedAt",
  sortDir: "asc" as "asc" | "desc",
};

const PREVIEWABLE_FILE_RE =
  /\.(md|markdown|txt|log|py|sh|bash|zsh|js|jsx|mjs|ts|tsx|json|jsonc|yaml|yml|xml|html|css|scss|sql|toml|ini|conf|c|cc|cpp|cxx|h|hpp|java|go|rs|rb|php|lua|svg|csv|diff|tex|env|zip|tar|tgz|tar\.gz)$/i;

function requestViewUpdate(props: WorkspaceFilesViewProps) {
  props.requestUpdate?.();
}

function selectedEntries(props: WorkspaceFilesViewProps): WorkspaceFilesEntry[] {
  const selected = new Set(props.selectedPaths);
  return props.entries.filter((entry) => selected.has(entry.path));
}

function getSortedEntries(entries: WorkspaceFilesEntry[]): WorkspaceFilesEntry[] {
  const sorted = [...entries];
  sorted.sort((left, right) => {
    const kindDelta = Number(left.kind === "file") - Number(right.kind === "file");
    if (kindDelta !== 0) {
      return kindDelta;
    }
    const direction = modalState.sortDir === "asc" ? 1 : -1;
    if (modalState.sortKey === "size") {
      const leftSize = left.size ?? -1;
      const rightSize = right.size ?? -1;
      if (leftSize !== rightSize) {
        return (leftSize - rightSize) * direction;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }
    if (modalState.sortKey === "updatedAt") {
      const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
      const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
      if (leftTime !== rightTime) {
        return (leftTime - rightTime) * direction;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) * direction;
  });
  return sorted;
}

function toggleSort(props: WorkspaceFilesViewProps, key: "name" | "size" | "updatedAt") {
  if (modalState.sortKey === key) {
    modalState.sortDir = modalState.sortDir === "asc" ? "desc" : "asc";
  } else {
    modalState.sortKey = key;
    modalState.sortDir = key === "name" ? "asc" : "desc";
  }
  requestViewUpdate(props);
}

function renderSortLabel(key: "name" | "size" | "updatedAt", label: string) {
  const active = modalState.sortKey === key;
  const arrow = active ? (modalState.sortDir === "asc" ? " ↑" : " ↓") : "";
  return `${label}${arrow}`;
}

function formatSize(size: number | null): string {
  if (typeof size !== "number" || !Number.isFinite(size)) {
    return "—";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function openMkdirDialog(props: WorkspaceFilesViewProps) {
  modalState.mkdirOpen = true;
  modalState.mkdirName = "";
  requestViewUpdate(props);
}

function closeMkdirDialog(props: WorkspaceFilesViewProps) {
  modalState.mkdirOpen = false;
  modalState.mkdirName = "";
  modalState.busy = false;
  requestViewUpdate(props);
}

function openRenameDialog(props: WorkspaceFilesViewProps, entry: WorkspaceFilesEntry) {
  modalState.renamePath = entry.path;
  modalState.renameName = entry.name;
  requestViewUpdate(props);
}

function closeRenameDialog(props: WorkspaceFilesViewProps) {
  modalState.renamePath = null;
  modalState.renameName = "";
  modalState.busy = false;
  requestViewUpdate(props);
}

function openDeleteDialog(props: WorkspaceFilesViewProps, relativePaths: string[]) {
  modalState.deletePaths = [...relativePaths];
  requestViewUpdate(props);
}

function closeDeleteDialog(props: WorkspaceFilesViewProps) {
  modalState.deletePaths = [];
  modalState.busy = false;
  requestViewUpdate(props);
}

async function submitMkdir(props: WorkspaceFilesViewProps) {
  if (!modalState.mkdirName.trim() || modalState.busy) {
    return;
  }
  modalState.busy = true;
  requestViewUpdate(props);
  try {
    await props.onCreateFolder(modalState.mkdirName);
    closeMkdirDialog(props);
  } catch {
    modalState.busy = false;
    requestViewUpdate(props);
  }
}

async function submitRename(props: WorkspaceFilesViewProps) {
  if (!modalState.renamePath || !modalState.renameName.trim() || modalState.busy) {
    return;
  }
  modalState.busy = true;
  requestViewUpdate(props);
  try {
    await props.onRename(modalState.renamePath, modalState.renameName);
    closeRenameDialog(props);
  } catch {
    modalState.busy = false;
    requestViewUpdate(props);
  }
}

async function submitDelete(props: WorkspaceFilesViewProps) {
  if (modalState.deletePaths.length === 0 || modalState.busy) {
    return;
  }
  modalState.busy = true;
  requestViewUpdate(props);
  try {
    await props.onDelete(modalState.deletePaths);
    closeDeleteDialog(props);
  } catch {
    modalState.busy = false;
    requestViewUpdate(props);
  }
}

async function handleFilesSelected(props: WorkspaceFilesViewProps, fileList: FileList | null) {
  if (!fileList || fileList.length === 0) {
    return;
  }
  await props.onUpload(Array.from(fileList));
}

function renderBreadcrumbs(props: WorkspaceFilesViewProps) {
  return html`
    <div class="workspace-files-breadcrumbs">
      ${props.breadcrumbs.map(
        (entry, index) => html`
          <button
            type="button"
            class=${`workspace-files-breadcrumb${index === 0 ? " workspace-files-breadcrumb--root" : ""}`}
            @click=${() => props.onNavigate(entry.path)}
          >
            ${entry.name}
          </button>
          ${index < props.breadcrumbs.length - 1
            ? html`<span class="workspace-files-breadcrumb-sep">›</span>`
            : nothing}
        `,
      )}
    </div>
  `;
}

function renderUploads(props: WorkspaceFilesViewProps) {
  if (props.uploads.length === 0) {
    return nothing;
  }
  return html`
    <section class="card" style="display:grid; gap:10px;">
      <div class="card-title">Uploads</div>
      <div style="display:grid; gap:8px;">
        ${props.uploads.map(
          (item) => html`
            <div class="workspace-files-upload-row">
              <div class="workspace-files-upload-meta">
                <div class="workspace-files-upload-name">${item.name}</div>
                <div class="workspace-files-upload-status">
                  ${item.status === "error" ? (item.error ?? "Failed") : `${item.progress}%`}
                </div>
              </div>
              <div class="workspace-files-upload-bar">
                <div
                  class="workspace-files-upload-bar-fill"
                  style=${`width:${item.progress}%`}
                ></div>
              </div>
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

function isPreviewableEntry(entry: WorkspaceFilesEntry): boolean {
  if (entry.kind !== "file") {
    return false;
  }
  return PREVIEWABLE_FILE_RE.test(entry.name) || /^(dockerfile|makefile)$/i.test(entry.name);
}

function handleCodeBlockCopy(event: Event) {
  const btn = (event.target as HTMLElement).closest(".code-block-copy");
  if (!btn) {
    return;
  }
  const code = (btn as HTMLElement).dataset.code ?? "";
  navigator.clipboard.writeText(code).then(
    () => {
      btn.classList.add("copied");
      window.setTimeout(() => btn.classList.remove("copied"), 1500);
    },
    () => {},
  );
}

function renderFilePreviewBody(preview: WorkspaceFilePreviewResponse) {
  if (preview.kind === "markdown" && preview.content) {
    return html`<div
      class="md-preview-dialog__body sidebar-markdown workspace-files-markdown-preview"
    >
      ${unsafeHTML(toSanitizedMarkdownHtml(preview.content))}
    </div>`;
  }
  if (preview.kind === "code" && preview.content) {
    return html`<div class="workspace-files-code-preview" @click=${handleCodeBlockCopy}>
      ${unsafeHTML(renderWorkspaceCodePreviewHtml(preview.content, preview.language))}
    </div>`;
  }
  if (preview.kind === "text" && preview.content) {
    return html`<div class="workspace-files-code-preview" @click=${handleCodeBlockCopy}>
      ${unsafeHTML(renderWorkspacePlainTextHtml(preview.content))}
    </div>`;
  }
  if (preview.kind === "archive") {
    return html`
      <div class="workspace-files-preview-summary">${preview.summary ?? "Archive preview"}</div>
      ${preview.archiveEntries.length > 0
        ? html`
            <div class="workspace-files-archive-table-wrap">
              <table class="workspace-files-archive-table">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Type</th>
                    <th>Size</th>
                  </tr>
                </thead>
                <tbody>
                  ${preview.archiveEntries.map(
                    (entry) => html`
                      <tr>
                        <td class="workspace-files-archive-path">${entry.path}</td>
                        <td>${entry.kind}</td>
                        <td>${formatSize(entry.size)}</td>
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
          `
        : html`<div class="card-sub">No archive entries available.</div>`}
    `;
  }
  return html`<div class="workspace-files-preview-summary">
    ${preview.summary ?? "Preview unavailable for this file."}
  </div>`;
}

function renderFilePreview(props: WorkspaceFilesViewProps) {
  const preview = props.preview;
  const currentLabel = preview?.path ?? props.currentPath;
  return html`
    <section class="workspace-files-page">
      <div class="workspace-files-breadcrumbs-bar">
        <div class="workspace-files-path-meta">
          <button class="btn btn--sm workspace-files-up-button" @click=${props.onCloseFilePreview}>
            ← Back to files
          </button>
          <div class="card-sub">
            Previewing:
            <strong>${currentLabel || "Workspace root"}</strong>
          </div>
        </div>
        <div class="workspace-files-actions">
          ${preview
            ? html`
                <button
                  class="btn btn--sm primary"
                  @click=${() => props.onDownload([preview.path])}
                >
                  Download
                </button>
              `
            : nothing}
        </div>
      </div>
      ${props.previewError
        ? html`<div class="callout danger">${props.previewError}</div>`
        : nothing}
      ${props.previewLoading
        ? html`<section class="card"><div class="card-sub">Loading file preview...</div></section>`
        : nothing}
      ${preview
        ? html`
            <section class="card workspace-files-preview-card">
              <div class="workspace-files-preview-header">
                <div>
                  <div class="card-title">${preview.name}</div>
                  <div class="card-sub">
                    ${preview.updatedAt
                      ? `Updated ${formatDate(preview.updatedAt)} · `
                      : ""}${formatSize(preview.size)}
                    ${preview.language ? ` · ${preview.language}` : ""}
                  </div>
                </div>
              </div>
              ${preview.truncated || preview.summary
                ? html` <div class="callout">${preview.summary ?? "Preview truncated."}</div> `
                : nothing}
              ${renderFilePreviewBody(preview)}
            </section>
          `
        : nothing}
    </section>
  `;
}

function renderDialogs(props: WorkspaceFilesViewProps) {
  return html`
    ${modalState.mkdirOpen
      ? html`
          <div class="workspace-files-modal-backdrop" @click=${() => closeMkdirDialog(props)}></div>
          <dialog class="workspace-files-modal" open>
            <div class="card-title">New Folder</div>
            <div class="card-sub">Create a folder in the current directory.</div>
            <input
              class="input"
              .value=${modalState.mkdirName}
              @input=${(event: Event) => {
                modalState.mkdirName = (event.target as HTMLInputElement).value;
                requestViewUpdate(props);
              }}
              placeholder="Folder name"
            />
            <div class="workspace-files-modal-actions">
              <button class="btn btn--sm" @click=${() => closeMkdirDialog(props)}>Cancel</button>
              <button
                class="btn btn--sm primary"
                ?disabled=${modalState.busy}
                @click=${() => void submitMkdir(props)}
              >
                ${modalState.busy ? "Creating..." : "Create"}
              </button>
            </div>
          </dialog>
        `
      : nothing}
    ${modalState.renamePath
      ? html`
          <div
            class="workspace-files-modal-backdrop"
            @click=${() => closeRenameDialog(props)}
          ></div>
          <dialog class="workspace-files-modal" open>
            <div class="card-title">Rename</div>
            <div class="card-sub">Change the selected file or folder name.</div>
            <input
              class="input"
              .value=${modalState.renameName}
              @input=${(event: Event) => {
                modalState.renameName = (event.target as HTMLInputElement).value;
                requestViewUpdate(props);
              }}
              placeholder="New name"
            />
            <div class="workspace-files-modal-actions">
              <button class="btn btn--sm" @click=${() => closeRenameDialog(props)}>Cancel</button>
              <button
                class="btn btn--sm primary"
                ?disabled=${modalState.busy}
                @click=${() => void submitRename(props)}
              >
                ${modalState.busy ? "Saving..." : "Save"}
              </button>
            </div>
          </dialog>
        `
      : nothing}
    ${modalState.deletePaths.length > 0
      ? html`
          <div
            class="workspace-files-modal-backdrop"
            @click=${() => closeDeleteDialog(props)}
          ></div>
          <dialog class="workspace-files-modal" open>
            <div class="card-title">Delete Permanently</div>
            <div class="card-sub">
              This will permanently delete ${modalState.deletePaths.length} item(s), including
              nested files inside folders.
            </div>
            <div class="callout danger">This action cannot be undone.</div>
            <div class="workspace-files-modal-actions">
              <button class="btn btn--sm" @click=${() => closeDeleteDialog(props)}>Cancel</button>
              <button
                class="btn btn--sm danger"
                ?disabled=${modalState.busy}
                @click=${() => void submitDelete(props)}
              >
                ${modalState.busy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </dialog>
        `
      : nothing}
  `;
}

export function renderWorkspaceFiles(props: WorkspaceFilesViewProps) {
  const entries = getSortedEntries(props.entries);
  const selected = selectedEntries({ ...props, entries });
  const selectablePaths = entries.map((entry) => entry.path);
  const allSelected =
    selectablePaths.length > 0 &&
    selectablePaths.every((entry) => props.selectedPaths.includes(entry));
  const singleSelected = selected.length === 1 ? selected[0] : null;

  return html`
    <style>
      .workspace-files-page {
        display: grid;
        gap: 16px;
      }
      .workspace-files-toolbar,
      .workspace-files-breadcrumbs-bar {
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }
      .workspace-files-breadcrumbs {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
      }
      .workspace-files-breadcrumb {
        border: 1px solid var(--border-color);
        background: var(--panel-bg);
        padding: 7px 10px;
        color: var(--color-text);
        cursor: pointer;
        font: inherit;
        border-radius: 999px;
        transition:
          background 0.16s ease,
          border-color 0.16s ease,
          color 0.16s ease;
      }
      .workspace-files-breadcrumb:hover {
        border-color: var(--accent-color);
        color: var(--accent-color);
        background: color-mix(in srgb, var(--accent-color) 8%, var(--panel-bg));
      }
      .workspace-files-breadcrumb--root {
        font-weight: 700;
      }
      .workspace-files-breadcrumb-sep {
        opacity: 0.45;
        font-size: 14px;
      }
      .workspace-files-path-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
      }
      .workspace-files-up-button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }
      .workspace-files-dropzone {
        position: relative;
        display: grid;
        gap: 14px;
        border: 1px dashed var(--border-color);
        border-radius: 16px;
        padding: 16px;
        background: var(--panel-bg);
      }
      .workspace-files-dropzone--active {
        border-color: var(--accent-color);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 18%, transparent);
      }
      .workspace-files-table {
        width: 100%;
        border-collapse: collapse;
      }
      .workspace-files-table th,
      .workspace-files-table td {
        text-align: left;
        padding: 12px 10px;
        border-bottom: 1px solid var(--border-color);
        vertical-align: middle;
      }
      .workspace-files-table th {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.65;
      }
      .workspace-files-entry-name {
        display: flex;
        gap: 10px;
        align-items: center;
        min-width: 0;
      }
      .workspace-files-entry-button {
        border: none;
        background: none;
        padding: 0;
        color: var(--color-text);
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .workspace-files-entry-button:hover {
        color: var(--accent-color);
      }
      .workspace-files-kind-badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        border-radius: 999px;
        background: var(--panel-subtle-bg, rgba(127, 127, 127, 0.12));
        font-size: 12px;
      }
      .workspace-files-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .workspace-files-empty {
        padding: 28px 16px;
        text-align: center;
        opacity: 0.72;
      }
      .workspace-files-upload-row {
        display: grid;
        gap: 6px;
      }
      .workspace-files-upload-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .workspace-files-upload-name {
        font-weight: 600;
      }
      .workspace-files-upload-status {
        font-size: 12px;
        opacity: 0.72;
      }
      .workspace-files-upload-bar {
        height: 8px;
        border-radius: 999px;
        overflow: hidden;
        background: var(--panel-subtle-bg, rgba(127, 127, 127, 0.15));
      }
      .workspace-files-upload-bar-fill {
        height: 100%;
        background: var(--accent-color);
      }
      .workspace-files-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(20, 24, 33, 0.44);
        backdrop-filter: blur(4px);
        z-index: 70;
      }
      .workspace-files-modal {
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        margin: 0;
        width: min(480px, calc(100vw - 32px));
        max-width: calc(100vw - 32px);
        border: 1px solid color-mix(in srgb, var(--border-color) 82%, white 18%);
        border-radius: 20px;
        padding: 22px;
        display: grid;
        gap: 14px;
        z-index: 71;
        background: #fff;
        color: var(--color-text);
        box-shadow: 0 26px 80px rgba(0, 0, 0, 0.24);
      }
      .workspace-files-modal::backdrop {
        display: none;
      }
      .workspace-files-modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .workspace-files-preview-card {
        display: grid;
        gap: 18px;
        padding: 22px;
      }
      .workspace-files-preview-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
      }
      .workspace-files-markdown-preview {
        min-height: 240px;
      }
      .workspace-files-code-preview {
        min-height: 240px;
      }
      .workspace-files-preview-summary {
        font-size: 14px;
        line-height: 1.6;
        color: var(--color-text);
        opacity: 0.86;
      }
      .workspace-files-archive-table-wrap {
        overflow: auto;
        border: 1px solid var(--border-color);
        border-radius: 14px;
      }
      .workspace-files-archive-table {
        width: 100%;
        border-collapse: collapse;
      }
      .workspace-files-archive-table th,
      .workspace-files-archive-table td {
        padding: 10px 12px;
        text-align: left;
        border-bottom: 1px solid var(--border-color);
      }
      .workspace-files-archive-table th {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.65;
      }
      .workspace-files-archive-path {
        font-family: var(--mono);
        font-size: 12px;
      }
      .workspace-files-code-preview .hljs {
        color: inherit;
        background: transparent;
      }
      .workspace-files-code-preview .hljs-comment,
      .workspace-files-code-preview .hljs-quote {
        color: #6b7280;
        font-style: italic;
      }
      .workspace-files-code-preview .hljs-keyword,
      .workspace-files-code-preview .hljs-selector-tag,
      .workspace-files-code-preview .hljs-subst {
        color: #0f766e;
        font-weight: 600;
      }
      .workspace-files-code-preview .hljs-string,
      .workspace-files-code-preview .hljs-attr,
      .workspace-files-code-preview .hljs-template-tag {
        color: #b45309;
      }
      .workspace-files-code-preview .hljs-number,
      .workspace-files-code-preview .hljs-literal,
      .workspace-files-code-preview .hljs-variable,
      .workspace-files-code-preview .hljs-template-variable {
        color: #7c3aed;
      }
      .workspace-files-code-preview .hljs-title,
      .workspace-files-code-preview .hljs-function,
      .workspace-files-code-preview .hljs-section {
        color: #1d4ed8;
      }
      .workspace-files-code-preview .hljs-type,
      .workspace-files-code-preview .hljs-class .hljs-title {
        color: #be123c;
      }
      @media (max-width: 720px) {
        .workspace-files-table th:nth-child(3),
        .workspace-files-table td:nth-child(3) {
          display: none;
        }
      }
    </style>
    ${props.previewLoading || props.preview || props.previewError
      ? renderFilePreview(props)
      : html`<section class="workspace-files-page">
          <div class="workspace-files-breadcrumbs-bar">
            <div class="workspace-files-path-meta">
              ${props.parentPath !== null
                ? html`
                    <button
                      class="btn btn--sm workspace-files-up-button"
                      @click=${() => props.onNavigate(props.parentPath ?? "")}
                    >
                      ↑ Up
                    </button>
                  `
                : nothing}
              ${renderBreadcrumbs(props)}
            </div>
            <div class="workspace-files-actions">
              <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onRefresh}>
                ${props.loading ? "Refreshing..." : "Refresh"}
              </button>
              <button class="btn btn--sm" @click=${() => openMkdirDialog(props)}>New Folder</button>
              <button
                class="btn btn--sm primary"
                ?disabled=${props.uploading}
                @click=${() => fileInputRef.value?.click()}
              >
                ${props.uploading ? "Uploading..." : "Upload Files"}
              </button>
              <input
                ${ref(fileInputRef)}
                type="file"
                multiple
                hidden
                @change=${async (event: Event) => {
                  const input = event.target as HTMLInputElement;
                  try {
                    await handleFilesSelected(props, input.files);
                  } finally {
                    input.value = "";
                  }
                }}
              />
            </div>
          </div>
          ${props.message
            ? html`<div class="callout ${props.message.kind === "error" ? "danger" : "success"}">
                ${props.message.text}
              </div>`
            : nothing}
          ${props.error ? html`<div class="callout danger">${props.error}</div>` : nothing}
          ${renderUploads(props)}
          <section
            class="workspace-files-dropzone ${modalState.dragActive
              ? "workspace-files-dropzone--active"
              : ""}"
            @dragenter=${(event: DragEvent) => {
              event.preventDefault();
              modalState.dragActive = true;
              requestViewUpdate(props);
            }}
            @dragover=${(event: DragEvent) => {
              event.preventDefault();
              modalState.dragActive = true;
            }}
            @dragleave=${(event: DragEvent) => {
              if (event.currentTarget !== event.target) {
                return;
              }
              modalState.dragActive = false;
              requestViewUpdate(props);
            }}
            @drop=${async (event: DragEvent) => {
              event.preventDefault();
              modalState.dragActive = false;
              requestViewUpdate(props);
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (files.length > 0) {
                await props.onUpload(files);
              }
            }}
          >
            <div class="workspace-files-toolbar">
              <div class="card-sub">
                Current folder:
                <strong>${props.currentPath || "Workspace root"}</strong>
              </div>
              <div class="workspace-files-actions">
                <button
                  class="btn btn--sm"
                  ?disabled=${selected.length === 0}
                  @click=${() => props.onDownload(selected.map((entry) => entry.path))}
                >
                  Download
                </button>
                <button
                  class="btn btn--sm"
                  ?disabled=${singleSelected == null}
                  @click=${() => singleSelected && openRenameDialog(props, singleSelected)}
                >
                  Rename
                </button>
                <button
                  class="btn btn--sm danger"
                  ?disabled=${selected.length === 0}
                  @click=${() =>
                    openDeleteDialog(
                      props,
                      selected.map((entry) => entry.path),
                    )}
                >
                  Delete
                </button>
              </div>
            </div>
            <div class="card-sub">
              Drag files here or use the upload button. Hidden files are not shown.
            </div>
            <div style="overflow:auto;">
              <table class="workspace-files-table">
                <thead>
                  <tr>
                    <th style="width:42px;">
                      <input
                        type="checkbox"
                        .checked=${allSelected}
                        @change=${(event: Event) =>
                          props.onToggleAllSelections(
                            selectablePaths,
                            (event.target as HTMLInputElement).checked,
                          )}
                      />
                    </th>
                    <th>
                      <button
                        type="button"
                        class="workspace-files-entry-button"
                        @click=${() => toggleSort(props, "name")}
                      >
                        ${renderSortLabel("name", "Name")}
                      </button>
                    </th>
                    <th>Type</th>
                    <th>
                      <button
                        type="button"
                        class="workspace-files-entry-button"
                        @click=${() => toggleSort(props, "size")}
                      >
                        ${renderSortLabel("size", "Size")}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        class="workspace-files-entry-button"
                        @click=${() => toggleSort(props, "updatedAt")}
                      >
                        ${renderSortLabel("updatedAt", "Modified")}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  ${entries.length === 0
                    ? html`<tr>
                        <td colspan="5">
                          <div class="workspace-files-empty">No files in this folder.</div>
                        </td>
                      </tr>`
                    : entries.map(
                        (entry) => html`
                          <tr>
                            <td>
                              <input
                                type="checkbox"
                                .checked=${props.selectedPaths.includes(entry.path)}
                                @change=${(event: Event) =>
                                  props.onToggleSelection(
                                    entry.path,
                                    (event.target as HTMLInputElement).checked,
                                  )}
                              />
                            </td>
                            <td>
                              <div class="workspace-files-entry-name">
                                <span>${entry.kind === "directory" ? "📁" : "📄"}</span>
                                <button
                                  type="button"
                                  class="workspace-files-entry-button"
                                  @click=${() =>
                                    entry.kind === "directory"
                                      ? props.onNavigate(entry.path)
                                      : isPreviewableEntry(entry)
                                        ? props.onOpenFilePreview(entry.path)
                                        : props.onDownload([entry.path])}
                                >
                                  ${entry.name}
                                </button>
                              </div>
                            </td>
                            <td><span class="workspace-files-kind-badge">${entry.kind}</span></td>
                            <td>${formatSize(entry.size)}</td>
                            <td>${formatDate(entry.updatedAt)}</td>
                          </tr>
                        `,
                      )}
                </tbody>
              </table>
            </div>
          </section>
          ${renderDialogs(props)}
        </section>`}
  `;
}
