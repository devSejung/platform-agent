export const EMPLOYEE_WORKSPACE_FILES_BASE_PATH = "/employee/api/workspace-files";
export const EMPLOYEE_WORKSPACE_FILES_LIST_PATH = `${EMPLOYEE_WORKSPACE_FILES_BASE_PATH}/list`;
export const EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH = `${EMPLOYEE_WORKSPACE_FILES_BASE_PATH}/download`;
export const EMPLOYEE_WORKSPACE_FILES_PREVIEW_PATH = `${EMPLOYEE_WORKSPACE_FILES_BASE_PATH}/preview`;
export const EMPLOYEE_WORKSPACE_FILES_UPLOAD_PATH = `${EMPLOYEE_WORKSPACE_FILES_BASE_PATH}/upload`;
export const EMPLOYEE_WORKSPACE_FILES_MKDIR_PATH = `${EMPLOYEE_WORKSPACE_FILES_BASE_PATH}/mkdir`;
export const EMPLOYEE_WORKSPACE_FILES_RENAME_PATH = `${EMPLOYEE_WORKSPACE_FILES_BASE_PATH}/rename`;
export const EMPLOYEE_WORKSPACE_FILES_DELETE_PATH = `${EMPLOYEE_WORKSPACE_FILES_BASE_PATH}/delete`;

export type WorkspaceFilesEntryKind = "file" | "directory";

export type WorkspaceFilesEntry = {
  path: string;
  name: string;
  kind: WorkspaceFilesEntryKind;
  size: number | null;
  updatedAt: string | null;
};

export type WorkspaceFilesBreadcrumbEntry = {
  name: string;
  path: string;
};

export type WorkspaceFilesListResponse = {
  currentPath: string;
  parentPath: string | null;
  breadcrumbs: WorkspaceFilesBreadcrumbEntry[];
  entries: WorkspaceFilesEntry[];
};

export type WorkspaceFilesDeleteResult = {
  deleted: string[];
  failed: Array<{ path: string; error: string }>;
};

export type WorkspaceFilesUploadResult = {
  uploaded: string[];
  failed: Array<{ name: string; error: string }>;
};

export type WorkspaceFilePreviewKind =
  | "markdown"
  | "code"
  | "text"
  | "archive"
  | "unsupported";

export type WorkspaceArchivePreviewEntry = {
  path: string;
  kind: "file" | "directory";
  size: number | null;
};

export type WorkspaceFilePreviewResponse = {
  path: string;
  name: string;
  updatedAt: string | null;
  size: number;
  kind: WorkspaceFilePreviewKind;
  language: string | null;
  content: string | null;
  truncated: boolean;
  archiveEntries: WorkspaceArchivePreviewEntry[];
  archiveTruncated: boolean;
  summary: string | null;
};
