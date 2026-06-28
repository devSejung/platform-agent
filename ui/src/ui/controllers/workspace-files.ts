import {
  EMPLOYEE_WORKSPACE_FILES_DELETE_PATH,
  EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH,
  EMPLOYEE_WORKSPACE_FILES_LIST_PATH,
  EMPLOYEE_WORKSPACE_FILES_MKDIR_PATH,
  EMPLOYEE_WORKSPACE_FILES_PREVIEW_PATH,
  EMPLOYEE_WORKSPACE_FILES_RENAME_PATH,
  EMPLOYEE_WORKSPACE_FILES_UPLOAD_PATH,
  type WorkspaceFilesBreadcrumbEntry,
  type WorkspaceFilesEntry,
  type WorkspaceFilePreviewResponse,
  type WorkspaceFilesListResponse,
  type WorkspaceFilesUploadResult,
} from "../../../../src/gateway/employee-workspace-files-contract.ts";

export type WorkspaceFileUploadItem = {
  id: string;
  name: string;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error: string | null;
};

export type WorkspaceFilesState = {
  workspaceFilesLoading: boolean;
  workspaceFilesUploading: boolean;
  workspaceFilesError: string | null;
  workspaceFilesMessage: { kind: "success" | "error"; text: string } | null;
  workspaceFilesCurrentPath: string;
  workspaceFilesParentPath: string | null;
  workspaceFilesBreadcrumbs: WorkspaceFilesBreadcrumbEntry[];
  workspaceFilesEntries: WorkspaceFilesEntry[];
  workspaceFilesSelectedPaths: string[];
  workspaceFilesUploads: WorkspaceFileUploadItem[];
  workspaceFilesPreviewLoading: boolean;
  workspaceFilesPreviewError: string | null;
  workspaceFilesPreview: WorkspaceFilePreviewResponse | null;
};

const MESSAGE_CLEAR_DELAY_MS = 2400;
let messageClearTimer: number | null = null;

function scheduleWorkspaceFilesMessageClear(state: WorkspaceFilesState) {
  if (messageClearTimer !== null) {
    window.clearTimeout(messageClearTimer);
  }
  messageClearTimer = window.setTimeout(() => {
    state.workspaceFilesMessage = null;
    messageClearTimer = null;
  }, MESSAGE_CLEAR_DELAY_MS);
}

function buildListUrl(relativePath: string): string {
  const url = new URL(EMPLOYEE_WORKSPACE_FILES_LIST_PATH, window.location.origin);
  if (relativePath) {
    url.searchParams.set("path", relativePath);
  }
  return `${url.pathname}${url.search}`;
}

function buildDownloadUrl(relativePath: string): string {
  const url = new URL(EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH, window.location.origin);
  url.searchParams.set("path", relativePath);
  return `${url.pathname}${url.search}`;
}

function buildPreviewUrl(relativePath: string): string {
  const url = new URL(EMPLOYEE_WORKSPACE_FILES_PREVIEW_PATH, window.location.origin);
  url.searchParams.set("path", relativePath);
  return `${url.pathname}${url.search}`;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | { error?: unknown; message?: unknown }
    | T
    | null;
  if (!response.ok) {
    const message =
      typeof (data as { error?: unknown } | null)?.error === "string"
        ? (data as { error: string }).error
        : typeof (data as { message?: unknown } | null)?.message === "string"
          ? (data as { message: string }).message
          : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data as T;
}

export async function loadWorkspaceFiles(
  state: WorkspaceFilesState,
  relativePath = state.workspaceFilesCurrentPath,
) {
  state.workspaceFilesLoading = true;
  state.workspaceFilesError = null;
  try {
    const response = await fetch(buildListUrl(relativePath), {
      method: "GET",
      credentials: "same-origin",
    });
    const data = await parseJsonOrThrow<WorkspaceFilesListResponse>(response);
    state.workspaceFilesCurrentPath = data.currentPath;
    state.workspaceFilesParentPath = data.parentPath;
    state.workspaceFilesBreadcrumbs = data.breadcrumbs;
    state.workspaceFilesEntries = data.entries;
    state.workspaceFilesSelectedPaths = state.workspaceFilesSelectedPaths.filter((selected) =>
      data.entries.some((entry) => entry.path === selected),
    );
  } catch (err) {
    state.workspaceFilesError = getErrorMessage(err);
  } finally {
    state.workspaceFilesLoading = false;
  }
}

export async function openWorkspaceFilePreview(state: WorkspaceFilesState, relativePath: string) {
  state.workspaceFilesPreview = null;
  state.workspaceFilesPreviewLoading = true;
  state.workspaceFilesPreviewError = null;
  state.workspaceFilesMessage = null;
  try {
    const response = await fetch(buildPreviewUrl(relativePath), {
      method: "GET",
      credentials: "same-origin",
    });
    state.workspaceFilesPreview = await parseJsonOrThrow<WorkspaceFilePreviewResponse>(response);
  } catch (err) {
    state.workspaceFilesPreview = null;
    state.workspaceFilesPreviewError = getErrorMessage(err);
  } finally {
    state.workspaceFilesPreviewLoading = false;
  }
}

export function closeWorkspaceFilePreview(state: WorkspaceFilesState) {
  state.workspaceFilesPreview = null;
  state.workspaceFilesPreviewError = null;
  state.workspaceFilesPreviewLoading = false;
}

export function toggleWorkspaceFileSelection(
  state: WorkspaceFilesState,
  relativePath: string,
  selected: boolean,
) {
  const current = new Set(state.workspaceFilesSelectedPaths);
  if (selected) {
    current.add(relativePath);
  } else {
    current.delete(relativePath);
  }
  state.workspaceFilesSelectedPaths = [...current];
}

export function setAllWorkspaceFileSelections(
  state: WorkspaceFilesState,
  relativePaths: string[],
  selected: boolean,
) {
  state.workspaceFilesSelectedPaths = selected ? [...relativePaths] : [];
}

export async function createWorkspaceFolderAction(state: WorkspaceFilesState, name: string) {
  state.workspaceFilesMessage = null;
  const response = await fetch(EMPLOYEE_WORKSPACE_FILES_MKDIR_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      parentPath: state.workspaceFilesCurrentPath,
      name,
    }),
  });
  await parseJsonOrThrow<{ ok: true; path: string }>(response);
  state.workspaceFilesMessage = { kind: "success", text: "Folder created." };
  scheduleWorkspaceFilesMessageClear(state);
  await loadWorkspaceFiles(state, state.workspaceFilesCurrentPath);
}

export async function renameWorkspaceEntryAction(
  state: WorkspaceFilesState,
  relativePath: string,
  nextName: string,
) {
  state.workspaceFilesMessage = null;
  const response = await fetch(EMPLOYEE_WORKSPACE_FILES_RENAME_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: relativePath,
      nextName,
    }),
  });
  const data = await parseJsonOrThrow<{ ok: true; path: string }>(response);
  state.workspaceFilesSelectedPaths = [data.path];
  state.workspaceFilesMessage = { kind: "success", text: "Renamed." };
  scheduleWorkspaceFilesMessageClear(state);
  await loadWorkspaceFiles(state, state.workspaceFilesCurrentPath);
}

export async function deleteWorkspaceEntriesAction(
  state: WorkspaceFilesState,
  relativePaths: string[],
) {
  state.workspaceFilesMessage = null;
  const response = await fetch(EMPLOYEE_WORKSPACE_FILES_DELETE_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paths: relativePaths,
    }),
  });
  const data = await parseJsonOrThrow<{
    deleted: string[];
    failed: Array<{ path: string; error: string }>;
  }>(response);
  state.workspaceFilesSelectedPaths = [];
  state.workspaceFilesMessage =
    data.failed.length > 0
      ? {
          kind: "error",
          text: data.failed.map((entry) => `${entry.path}: ${entry.error}`).join("\n"),
        }
      : { kind: "success", text: `Deleted ${data.deleted.length} item(s).` };
  if (data.failed.length === 0) {
    scheduleWorkspaceFilesMessageClear(state);
  }
  await loadWorkspaceFiles(state, state.workspaceFilesCurrentPath);
}

function updateUploadProgress(
  state: WorkspaceFilesState,
  uploadId: string,
  patch: Partial<WorkspaceFileUploadItem>,
) {
  state.workspaceFilesUploads = state.workspaceFilesUploads.map((entry) =>
    entry.id === uploadId ? { ...entry, ...patch } : entry,
  );
}

async function uploadSingleWorkspaceFile(params: {
  state: WorkspaceFilesState;
  file: File;
  uploadId: string;
  overwrite: boolean;
}): Promise<WorkspaceFilesUploadResult> {
  const url = new URL(EMPLOYEE_WORKSPACE_FILES_UPLOAD_PATH, window.location.origin);
  if (params.state.workspaceFilesCurrentPath) {
    url.searchParams.set("path", params.state.workspaceFilesCurrentPath);
  }
  if (params.overwrite) {
    url.searchParams.set("overwrite", "1");
  }
  return await new Promise<WorkspaceFilesUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${url.pathname}${url.search}`);
    xhr.withCredentials = true;
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }
      updateUploadProgress(params.state, params.uploadId, {
        progress: Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))),
      });
    });
    xhr.addEventListener("load", () => {
      let parsed: WorkspaceFilesUploadResult | { error?: string } | null = null;
      try {
        parsed = xhr.responseText
          ? (JSON.parse(xhr.responseText) as WorkspaceFilesUploadResult)
          : null;
      } catch {
        parsed = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed) {
        resolve(parsed);
        return;
      }
      reject(
        new Error(
          typeof (parsed as { error?: string } | null)?.error === "string"
            ? (parsed as unknown as { error: string }).error
            : `${xhr.status} ${xhr.statusText}`,
        ),
      );
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed.")));
    const form = new FormData();
    form.append("files", params.file);
    xhr.send(form);
  });
}

export async function uploadWorkspaceFilesAction(
  state: WorkspaceFilesState,
  files: File[],
  confirmOverwrite: (fileName: string) => boolean | Promise<boolean>,
) {
  if (files.length === 0) {
    return;
  }
  state.workspaceFilesUploading = true;
  state.workspaceFilesMessage = null;
  const queue = files.map((file, index) => ({
    id: `${Date.now()}-${index}-${file.name}`,
    name: file.name,
    progress: 0,
    status: "queued" as const,
    error: null,
  }));
  state.workspaceFilesUploads = queue;

  const uploaded: string[] = [];
  const failed: string[] = [];

  for (const [index, item] of queue.entries()) {
    const file = files[index];
    updateUploadProgress(state, item.id, { status: "uploading", progress: 0, error: null });
    try {
      const firstAttempt = await uploadSingleWorkspaceFile({
        state,
        file,
        uploadId: item.id,
        overwrite: false,
      });
      if (firstAttempt.failed.length > 0) {
        const conflict = firstAttempt.failed[0]?.error ?? "Upload failed.";
        if (!/already exists|exists/i.test(conflict)) {
          throw new Error(conflict);
        }
        const shouldOverwrite = await confirmOverwrite(file.name);
        if (!shouldOverwrite) {
          throw new Error("Upload cancelled.");
        }
        const retry = await uploadSingleWorkspaceFile({
          state,
          file,
          uploadId: item.id,
          overwrite: true,
        });
        if (retry.failed.length > 0) {
          throw new Error(retry.failed[0]?.error ?? "Upload failed.");
        }
        uploaded.push(...retry.uploaded);
      } else {
        uploaded.push(...firstAttempt.uploaded);
      }
      updateUploadProgress(state, item.id, { status: "done", progress: 100 });
    } catch (err) {
      failed.push(`${file.name}: ${getErrorMessage(err)}`);
      updateUploadProgress(state, item.id, {
        status: "error",
        error: getErrorMessage(err),
      });
    }
  }

  state.workspaceFilesUploading = false;
  state.workspaceFilesUploads = state.workspaceFilesUploads.filter(
    (item) => item.status === "error",
  );
  state.workspaceFilesMessage =
    failed.length > 0
      ? { kind: "error", text: failed.join("\n") }
      : { kind: "success", text: `Uploaded ${uploaded.length} file(s).` };
  if (failed.length === 0) {
    scheduleWorkspaceFilesMessageClear(state);
  }
  await loadWorkspaceFiles(state, state.workspaceFilesCurrentPath);
}

export function downloadWorkspaceFiles(relativePaths: string[]) {
  for (const [index, relativePath] of relativePaths.entries()) {
    window.setTimeout(() => {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = buildDownloadUrl(relativePath);
      document.body.appendChild(iframe);
      window.setTimeout(() => iframe.remove(), 60_000);
    }, index * 180);
  }
}
