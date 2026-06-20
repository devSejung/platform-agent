import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import JSZip from "jszip";
import * as tar from "tar";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveBoundaryPath } from "../infra/boundary-path.js";
import {
  SafeOpenError,
  copyFileWithinRoot,
  mkdirPathWithinRoot,
  openFileWithinRoot,
} from "../infra/fs-safe.js";
import { getPlatformClawDatabase } from "../accounts/db.js";
import { resolveEmployeeAccountSummary } from "../accounts/account-provisioning.js";
import { detectMime } from "../media/mime.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { readEmployeeSession } from "./employee-web-auth.js";
import {
  EMPLOYEE_WORKSPACE_FILES_DELETE_PATH,
  EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH,
  EMPLOYEE_WORKSPACE_FILES_LIST_PATH,
  EMPLOYEE_WORKSPACE_FILES_MKDIR_PATH,
  EMPLOYEE_WORKSPACE_FILES_PREVIEW_PATH,
  EMPLOYEE_WORKSPACE_FILES_RENAME_PATH,
  EMPLOYEE_WORKSPACE_FILES_UPLOAD_PATH,
  type WorkspaceFilesBreadcrumbEntry,
  type WorkspaceFilePreviewResponse,
  type WorkspaceFilesDeleteResult,
  type WorkspaceFilesEntry,
  type WorkspaceFilesListResponse,
  type WorkspaceFilesUploadResult,
} from "./employee-workspace-files-contract.js";

const MAX_UPLOAD_FILE_BYTES = 500 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = 650 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024;
const MAX_ARCHIVE_PREVIEW_BYTES = 32 * 1024 * 1024;
const MAX_ARCHIVE_PREVIEW_ENTRIES = 200;
const HTML_ARTIFACT_RESIZE_MESSAGE = "platformclaw:artifact-resize";
const HTML_ARTIFACT_RESIZE_REQUEST = "platformclaw:artifact-resize-request";
const GENERATED_ARTIFACT_WORKSPACE_PREFIX = "outbox/generated-artifacts/";
const HTML_ARTIFACT_RESIZE_BRIDGE = `<script data-platformclaw-artifact-resize>
(() => {
  let scheduled = false;
  const measure = () => {
    scheduled = false;
    const body = document.body;
    if (!body) return;
    const bodyRect = body.getBoundingClientRect();
    const bodyStyle = getComputedStyle(body);
    const marginBottom = Number.parseFloat(bodyStyle.marginBottom) || 0;
    let contentBottom = Math.max(bodyRect.bottom, body.offsetHeight);
    for (const child of body.children) {
      contentBottom = Math.max(contentBottom, child.getBoundingClientRect().bottom);
    }
    const height = Math.ceil(contentBottom + marginBottom);
    parent.postMessage({ type: "${HTML_ARTIFACT_RESIZE_MESSAGE}", height }, "*");
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(measure);
  };
  addEventListener("message", (event) => {
    if (event.source === parent && event.data?.type === "${HTML_ARTIFACT_RESIZE_REQUEST}") {
      schedule();
    }
  });
  addEventListener("load", schedule);
  document.addEventListener("DOMContentLoaded", schedule);
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(schedule).observe(document.documentElement);
    if (document.body) new ResizeObserver(schedule).observe(document.body);
  }
  setTimeout(schedule, 250);
})();
</script>`;
const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".bash": "bash",
  ".c": "c",
  ".cc": "cpp",
  ".conf": "ini",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".csv": "plaintext",
  ".cxx": "cpp",
  ".diff": "diff",
  ".env": "bash",
  ".go": "go",
  ".h": "c",
  ".hpp": "cpp",
  ".html": "html",
  ".ini": "ini",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsonc": "json",
  ".jsx": "javascript",
  ".log": "plaintext",
  ".lua": "lua",
  ".md": "markdown",
  ".markdown": "markdown",
  ".mjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "bash",
  ".sql": "sql",
  ".svg": "xml",
  ".tex": "latex",
  ".toml": "toml",
  ".ts": "typescript",
  ".tsx": "tsx",
  ".txt": "plaintext",
  ".xml": "xml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".zsh": "bash",
};

const TEXT_PREVIEW_EXTENSIONS = new Set([
  ...Object.keys(CODE_LANGUAGE_BY_EXTENSION),
  ".gitignore",
  ".npmrc",
  ".dockerignore",
]);

type JsonBodyReader = (
  req: IncomingMessage,
  maxBytes: number,
) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;

type EmployeeWorkspaceContext = {
  employeeId: string;
  accountId: string;
  agentId: string;
  workspaceDir: string;
};

type WorkspaceErrorCode =
  | "unauthorized"
  | "invalid-request"
  | "not-found"
  | "conflict"
  | "too-large"
  | "forbidden"
  | "internal";

class WorkspaceHttpError extends Error {
  code: WorkspaceErrorCode;
  status: number;
  userMessage: string;

  constructor(code: WorkspaceErrorCode, status: number, message: string, userMessage = message) {
    super(message);
    this.code = code;
    this.status = status;
    this.userMessage = userMessage;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function pathToPosixSegments(raw: string): string[] {
  return raw
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function validateWorkspaceEntryName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new WorkspaceHttpError("invalid-request", 400, "empty name is not allowed");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new WorkspaceHttpError("invalid-request", 400, "reserved path segment");
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new WorkspaceHttpError("invalid-request", 400, "path separators are not allowed");
  }
  if (trimmed.includes("\0")) {
    throw new WorkspaceHttpError("invalid-request", 400, "null byte is not allowed");
  }
  if (trimmed.startsWith(".")) {
    throw new WorkspaceHttpError("forbidden", 403, "hidden entries are not available", "접근할 수 없는 경로");
  }
  const normalized = trimmed.replace(/[. ]+$/g, "").toLowerCase();
  if (normalized && RESERVED_WINDOWS_NAMES.has(normalized)) {
    throw new WorkspaceHttpError("invalid-request", 400, "reserved OS filename");
  }
  return trimmed;
}

export function normalizeWorkspaceRelativePath(raw: unknown): string {
  if (raw == null) {
    return "";
  }
  if (typeof raw !== "string") {
    throw new WorkspaceHttpError("invalid-request", 400, "path must be a string");
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("\0")) {
    throw new WorkspaceHttpError("invalid-request", 400, "null byte is not allowed");
  }
  if (path.isAbsolute(trimmed) || trimmed.startsWith("/") || /^[A-Za-z]:/.test(trimmed)) {
    throw new WorkspaceHttpError("forbidden", 403, "absolute path is not allowed", "접근할 수 없는 경로");
  }
  const segments = pathToPosixSegments(trimmed);
  if (segments.length === 0) {
    return "";
  }
  for (const segment of segments) {
    if (segment === "." || segment === "..") {
      throw new WorkspaceHttpError("forbidden", 403, "path traversal blocked", "접근할 수 없는 경로");
    }
    validateWorkspaceEntryName(segment);
  }
  return segments.join("/");
}

function buildBreadcrumbs(currentPath: string): WorkspaceFilesBreadcrumbEntry[] {
  const breadcrumbs: WorkspaceFilesBreadcrumbEntry[] = [{ name: "Workspace", path: "" }];
  if (!currentPath) {
    return breadcrumbs;
  }
  const segments = currentPath.split("/").filter(Boolean);
  let acc = "";
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    breadcrumbs.push({ name: segment, path: acc });
  }
  return breadcrumbs;
}

function dirnameRelativePath(relativePath: string): string | null {
  if (!relativePath) {
    return null;
  }
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return "";
  }
  return segments.slice(0, -1).join("/");
}

function getLowercaseBasename(relativePath: string): string {
  return path.posix.basename(relativePath).toLowerCase();
}

function inferArchiveKind(relativePath: string): "zip" | "tar" | null {
  const lower = getLowercaseBasename(relativePath);
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  if (lower.endsWith(".tar") || lower.endsWith(".tgz") || lower.endsWith(".tar.gz")) {
    return "tar";
  }
  return null;
}

function isMarkdownPreviewPath(relativePath: string): boolean {
  return /\.(md|markdown)$/i.test(getLowercaseBasename(relativePath));
}

function inferCodeLanguage(relativePath: string): string | null {
  const lower = getLowercaseBasename(relativePath);
  if (lower === "dockerfile") {
    return "dockerfile";
  }
  if (lower === "makefile") {
    return "makefile";
  }
  for (const [extension, language] of Object.entries(CODE_LANGUAGE_BY_EXTENSION)) {
    if (lower.endsWith(extension)) {
      return language;
    }
  }
  return null;
}

function isKnownTextPreviewPath(relativePath: string): boolean {
  const lower = getLowercaseBasename(relativePath);
  if (lower === "dockerfile" || lower === "makefile") {
    return true;
  }
  for (const extension of TEXT_PREVIEW_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return true;
    }
  }
  return false;
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function looksLikeReadableText(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }
  let suspicious = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      return false;
    }
    const isControl = byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 12;
    if (isControl) {
      suspicious += 1;
    }
  }
  return suspicious / buffer.length < 0.12;
}

async function readPreviewTextBuffer(filePath: string, totalSize: number) {
  const opened = await fs.open(filePath, "r");
  try {
    const readLength = Math.min(totalSize, MAX_TEXT_PREVIEW_BYTES);
    const buffer = Buffer.alloc(readLength);
    const { bytesRead } = await opened.read(buffer, 0, readLength, 0);
    return {
      buffer: buffer.subarray(0, bytesRead),
      truncated: totalSize > MAX_TEXT_PREVIEW_BYTES,
    };
  } finally {
    await opened.close();
  }
}

async function buildZipArchivePreview(filePath: string) {
  const zip = await JSZip.loadAsync(await fs.readFile(filePath));
  const archiveEntries = Object.values(zip.files)
    .toSorted((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }))
    .slice(0, MAX_ARCHIVE_PREVIEW_ENTRIES)
    .map((entry) => ({
      path: entry.name,
      kind: entry.dir ? ("directory" as const) : ("file" as const),
      size:
        entry.dir
          ? null
          : typeof (entry as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize === "number"
            ? ((entry as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? null)
            : null,
    }));
  return {
    archiveEntries,
    archiveTruncated: Object.keys(zip.files).length > MAX_ARCHIVE_PREVIEW_ENTRIES,
  };
}

async function buildTarArchivePreview(filePath: string) {
  const collected: Array<{ path: string; kind: "file" | "directory"; size: number | null }> = [];
  let totalEntries = 0;
  await tar.list({
    file: filePath,
    onReadEntry: (entry) => {
      totalEntries += 1;
      if (collected.length >= MAX_ARCHIVE_PREVIEW_ENTRIES) {
        return;
      }
      collected.push({
        path: entry.path,
        kind: entry.type === "Directory" ? "directory" : "file",
        size: typeof entry.size === "number" ? entry.size : null,
      });
    },
  });
  return {
    archiveEntries: collected,
    archiveTruncated: totalEntries > MAX_ARCHIVE_PREVIEW_ENTRIES,
  };
}

async function resolveDirectoryPath(rootDir: string, relativePath: string) {
  const absolutePath = relativePath ? path.resolve(rootDir, relativePath) : path.resolve(rootDir);
  const resolved = await resolveBoundaryPath({
    absolutePath,
    rootPath: rootDir,
    boundaryLabel: "workspace root",
  });
  if (!resolved.exists) {
    throw new WorkspaceHttpError("not-found", 404, "directory not found");
  }
  if (resolved.kind !== "directory") {
    throw new WorkspaceHttpError("invalid-request", 400, "path is not a directory");
  }
  return resolved;
}

async function resolveFilePath(rootDir: string, relativePath: string) {
  const absolutePath = relativePath ? path.resolve(rootDir, relativePath) : path.resolve(rootDir);
  const resolved = await resolveBoundaryPath({
    absolutePath,
    rootPath: rootDir,
    boundaryLabel: "workspace root",
  });
  if (!resolved.exists) {
    throw new WorkspaceHttpError("not-found", 404, "file not found");
  }
  if (resolved.kind !== "file") {
    throw new WorkspaceHttpError("invalid-request", 400, "path is not a file");
  }
  return resolved;
}

export async function listWorkspaceDirectory(params: {
  rootDir: string;
  relativePath: string;
}): Promise<WorkspaceFilesListResponse> {
  const normalized = normalizeWorkspaceRelativePath(params.relativePath);
  const resolvedDir = await resolveDirectoryPath(params.rootDir, normalized);
  const entries = await fs.readdir(resolvedDir.canonicalPath, { withFileTypes: true });
  const listed: WorkspaceFilesEntry[] = [];

  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith(".")) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      continue;
    }
    const childRelativePath = normalized ? `${normalized}/${entry.name}` : entry.name;
    const childAbsolutePath = path.resolve(params.rootDir, childRelativePath);
    const childResolved = await resolveBoundaryPath({
      absolutePath: childAbsolutePath,
      rootPath: params.rootDir,
      boundaryLabel: "workspace root",
    });
    if (!childResolved.exists) {
      continue;
    }
    if (childResolved.kind !== "file" && childResolved.kind !== "directory") {
      continue;
    }
    const childStat = await fs.stat(childResolved.canonicalPath).catch(() => null);
    listed.push({
      path: childRelativePath,
      name: entry.name,
      kind: childResolved.kind === "directory" ? "directory" : "file",
      size: childResolved.kind === "file" ? childStat?.size ?? null : null,
      updatedAt: childStat ? new Date(childStat.mtimeMs).toISOString() : null,
    });
  }

  listed.sort((left, right) => {
    const kindDelta = Number(left.kind === "file") - Number(right.kind === "file");
    if (kindDelta !== 0) {
      return kindDelta;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });

  return {
    currentPath: normalized,
    parentPath: dirnameRelativePath(normalized),
    breadcrumbs: buildBreadcrumbs(normalized),
    entries: listed,
  };
}

export async function readWorkspaceFilePreview(params: {
  rootDir: string;
  relativePath: string;
}): Promise<WorkspaceFilePreviewResponse> {
  const relativePath = normalizeWorkspaceRelativePath(params.relativePath);
  if (!relativePath) {
    throw new WorkspaceHttpError("invalid-request", 400, "file path is required");
  }
  const resolved = await resolveFilePath(params.rootDir, relativePath);
  const stat = await fs.stat(resolved.canonicalPath);
  const archiveKind = inferArchiveKind(relativePath);
  if (archiveKind) {
    if (stat.size > MAX_ARCHIVE_PREVIEW_BYTES) {
      return {
        path: relativePath,
        name: path.posix.basename(relativePath),
        updatedAt: stat.mtime.toISOString(),
        size: stat.size,
        kind: "archive",
        language: null,
        content: null,
        truncated: false,
        archiveEntries: [],
        archiveTruncated: false,
        summary: `Archive preview is limited to ${Math.floor(MAX_ARCHIVE_PREVIEW_BYTES / (1024 * 1024))}MB. Download the file to inspect it fully.`,
      };
    }
    const archivePreview =
      archiveKind === "zip"
        ? await buildZipArchivePreview(resolved.canonicalPath)
        : await buildTarArchivePreview(resolved.canonicalPath);
    return {
      path: relativePath,
      name: path.posix.basename(relativePath),
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
      kind: "archive",
      language: null,
      content: null,
      truncated: false,
      archiveEntries: archivePreview.archiveEntries,
      archiveTruncated: archivePreview.archiveTruncated,
      summary:
        archivePreview.archiveEntries.length === 0
          ? "No archive entries were detected."
          : archivePreview.archiveTruncated
            ? `Showing first ${archivePreview.archiveEntries.length} archive entries.`
            : `Archive contains ${archivePreview.archiveEntries.length} entries.`,
    };
  }
  const textPreview = await readPreviewTextBuffer(resolved.canonicalPath, stat.size);
  const knownText = isKnownTextPreviewPath(relativePath);
  if (!knownText && !looksLikeReadableText(textPreview.buffer)) {
    return {
      path: relativePath,
      name: path.posix.basename(relativePath),
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
      kind: "unsupported",
      language: null,
      content: null,
      truncated: false,
      archiveEntries: [],
      archiveTruncated: false,
      summary: "Inline preview is not available for this file type. Use download instead.",
    };
  }
  const language = inferCodeLanguage(relativePath);
  const content = stripUtf8Bom(textPreview.buffer.toString("utf8")).replace(/\r\n?/g, "\n");
  return {
    path: relativePath,
    name: path.posix.basename(relativePath),
    updatedAt: stat.mtime.toISOString(),
    size: stat.size,
    kind: isMarkdownPreviewPath(relativePath)
      ? "markdown"
      : language && language !== "plaintext"
        ? "code"
        : "text",
    language,
    content,
    truncated: textPreview.truncated,
    archiveEntries: [],
    archiveTruncated: false,
    summary: textPreview.truncated
      ? `Showing first ${Math.floor(MAX_TEXT_PREVIEW_BYTES / 1024)}KB of this file.`
      : null,
  };
}

async function ensureTargetDoesNotExist(rootDir: string, relativePath: string) {
  const absolutePath = relativePath ? path.resolve(rootDir, relativePath) : path.resolve(rootDir);
  const resolved = await resolveBoundaryPath({
    absolutePath,
    rootPath: rootDir,
    boundaryLabel: "workspace root",
  });
  if (resolved.exists) {
    throw new WorkspaceHttpError("conflict", 409, "target already exists");
  }
}

export async function renameWorkspacePath(params: {
  rootDir: string;
  relativePath: string;
  nextName: string;
}): Promise<{ path: string }> {
  const relativePath = normalizeWorkspaceRelativePath(params.relativePath);
  if (!relativePath) {
    throw new WorkspaceHttpError("forbidden", 403, "cannot rename workspace root");
  }
  const nextName = validateWorkspaceEntryName(params.nextName);
  const source = await resolveBoundaryPath({
    absolutePath: path.resolve(params.rootDir, relativePath),
    rootPath: params.rootDir,
    boundaryLabel: "workspace root",
  });
  if (!source.exists) {
    throw new WorkspaceHttpError("not-found", 404, "path not found");
  }
  if (source.kind !== "file" && source.kind !== "directory") {
    throw new WorkspaceHttpError("invalid-request", 400, "path cannot be renamed");
  }
  const parentRelativePath = dirnameRelativePath(relativePath) ?? "";
  const parentResolved = await resolveDirectoryPath(params.rootDir, parentRelativePath);
  const nextRelativePath = parentRelativePath ? `${parentRelativePath}/${nextName}` : nextName;
  await ensureTargetDoesNotExist(params.rootDir, nextRelativePath);
  const destinationPath = path.join(parentResolved.canonicalPath, nextName);
  await fs.rename(source.canonicalPath, destinationPath);
  return { path: nextRelativePath };
}

export async function deleteWorkspacePaths(params: {
  rootDir: string;
  relativePaths: string[];
}): Promise<WorkspaceFilesDeleteResult> {
  const deleted: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];
  for (const candidate of params.relativePaths) {
    let relativePath = "";
    try {
      relativePath = normalizeWorkspaceRelativePath(candidate);
      if (!relativePath) {
        throw new WorkspaceHttpError("forbidden", 403, "cannot delete workspace root");
      }
      const resolved = await resolveBoundaryPath({
        absolutePath: path.resolve(params.rootDir, relativePath),
        rootPath: params.rootDir,
        boundaryLabel: "workspace root",
      });
      if (!resolved.exists || (resolved.kind !== "file" && resolved.kind !== "directory")) {
        throw new WorkspaceHttpError("not-found", 404, "path not found");
      }
      await fs.rm(resolved.canonicalPath, {
        recursive: resolved.kind === "directory",
        force: false,
      });
      deleted.push(relativePath);
    } catch (error) {
      failed.push({
        path: relativePath || String(candidate ?? ""),
        error: toUserFacingWorkspaceError(error),
      });
    }
  }
  return { deleted, failed };
}

export async function createWorkspaceDirectory(params: {
  rootDir: string;
  parentPath: string;
  name: string;
}): Promise<{ path: string }> {
  const parentPath = normalizeWorkspaceRelativePath(params.parentPath);
  const name = validateWorkspaceEntryName(params.name);
  const nextRelativePath = parentPath ? `${parentPath}/${name}` : name;
  await ensureTargetDoesNotExist(params.rootDir, nextRelativePath);
  await mkdirPathWithinRoot({
    rootDir: params.rootDir,
    relativePath: nextRelativePath,
  });
  return { path: nextRelativePath };
}

async function writeUploadedFile(params: {
  rootDir: string;
  parentPath: string;
  file: File;
  overwrite: boolean;
}): Promise<string> {
  const parentPath = normalizeWorkspaceRelativePath(params.parentPath);
  const sanitizedName = validateWorkspaceEntryName(path.posix.basename(params.file.name.replace(/\\/g, "/")));
  if (params.file.size > MAX_UPLOAD_FILE_BYTES) {
    throw new WorkspaceHttpError("too-large", 413, "file exceeds 500MB limit");
  }
  const targetRelativePath = parentPath ? `${parentPath}/${sanitizedName}` : sanitizedName;
  if (!params.overwrite) {
    await ensureTargetDoesNotExist(params.rootDir, targetRelativePath);
  }
  const tempPath = path.join(process.cwd(), ".openclaw-upload-tmp", `${Date.now()}-${sanitizedName}`);
  await fs.mkdir(path.dirname(tempPath), { recursive: true });
  const arrayBuffer = await params.file.arrayBuffer();
  await fs.writeFile(tempPath, Buffer.from(arrayBuffer));
  try {
    await copyFileWithinRoot({
      sourcePath: tempPath,
      rootDir: params.rootDir,
      relativePath: targetRelativePath,
      maxBytes: MAX_UPLOAD_FILE_BYTES,
      mkdir: true,
      rejectSourceHardlinks: true,
    });
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
  return targetRelativePath;
}

export async function uploadWorkspaceFiles(params: {
  rootDir: string;
  parentPath: string;
  files: File[];
  overwrite: boolean;
}): Promise<WorkspaceFilesUploadResult> {
  const uploaded: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const file of params.files) {
    try {
      const uploadedPath = await writeUploadedFile({
        rootDir: params.rootDir,
        parentPath: params.parentPath,
        file,
        overwrite: params.overwrite,
      });
      uploaded.push(uploadedPath);
    } catch (error) {
      failed.push({
        name: file.name,
        error: toUserFacingWorkspaceError(error),
      });
    }
  }
  return { uploaded, failed };
}

function appendWorkspaceAuditEvent(params: {
  actorAccountId: string;
  eventType: string;
  targetId: string;
  payload?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}) {
  const { db } = getPlatformClawDatabase(params.env ?? process.env);
  db.prepare(
    `INSERT INTO audit_events (
       id, actor_account_id, event_type, target_type, target_id, payload_json, created_at
     ) VALUES (
       hex(randomblob(16)), @actor_account_id, @event_type, 'workspace_path', @target_id, @payload_json, @created_at
     )`,
  ).run({
    actor_account_id: params.actorAccountId,
    event_type: params.eventType,
    target_id: params.targetId,
    payload_json: params.payload ? JSON.stringify(params.payload) : null,
    created_at: new Date().toISOString(),
  });
}

function toUserFacingWorkspaceError(error: unknown): string {
  if (error instanceof WorkspaceHttpError) {
    if (error.code === "forbidden") {
      return "접근할 수 없는 경로";
    }
    return error.userMessage;
  }
  if (error instanceof SafeOpenError) {
    if (error.code === "outside-workspace" || error.code === "invalid-path") {
      return "접근할 수 없는 경로";
    }
    if (error.code === "not-found") {
      return "대상을 찾을 수 없습니다.";
    }
    if (error.code === "too-large") {
      return "파일 크기 제한을 초과했습니다.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

function toWorkspaceHttpError(error: unknown): WorkspaceHttpError {
  if (error instanceof WorkspaceHttpError) {
    return error;
  }
  if (error instanceof SafeOpenError) {
    if (error.code === "not-found") {
      return new WorkspaceHttpError("not-found", 404, "path not found");
    }
    if (error.code === "too-large") {
      return new WorkspaceHttpError("too-large", 413, error.message);
    }
    if (error.code === "outside-workspace" || error.code === "invalid-path") {
      return new WorkspaceHttpError("forbidden", 403, error.message, "접근할 수 없는 경로");
    }
    return new WorkspaceHttpError("invalid-request", 400, error.message);
  }
  if ((error as { code?: string } | null)?.code === "EEXIST") {
    return new WorkspaceHttpError("conflict", 409, "target already exists");
  }
  return new WorkspaceHttpError("internal", 500, error instanceof Error ? error.message : String(error));
}

function readUploadContentLength(req: IncomingMessage): number | null {
  const raw = req.headers["content-length"];
  const value = typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? raw[0]?.trim() : "";
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function wantsInlineWorkspaceResponse(url: URL): boolean {
  const inline = url.searchParams.get("inline");
  return inline === "1" || inline === "true";
}

export function appendHtmlArtifactResizeBridge(html: string): string {
  return `${html}${HTML_ARTIFACT_RESIZE_BRIDGE}`;
}

function buildRequestForMultipart(req: IncomingMessage): Request {
  return new Request("http://localhost/upload", {
    method: req.method ?? "POST",
    headers: req.headers as Record<string, string>,
    body: req as BodyInit,
    duplex: "half",
  });
}

async function requireEmployeeWorkspaceContext(
  req: IncomingMessage,
  config: OpenClawConfig,
): Promise<EmployeeWorkspaceContext> {
  const session = readEmployeeSession(req);
  if (!session) {
    throw new WorkspaceHttpError("unauthorized", 401, "employee sign-in required");
  }
  const account = resolveEmployeeAccountSummary({ employeeId: session.employeeId });
  if (!account?.accountId) {
    throw new WorkspaceHttpError("unauthorized", 401, "employee account not provisioned");
  }
  const agentId = normalizeAgentId(session.agentId);
  return {
    employeeId: session.employeeId,
    accountId: account.accountId,
    agentId,
    workspaceDir: resolveAgentWorkspaceDir(config, agentId),
  };
}

function logWorkspaceFailure(params: {
  context?: EmployeeWorkspaceContext;
  action: string;
  target: string;
  error: WorkspaceHttpError;
}) {
  if (!params.context) {
    return;
  }
  appendWorkspaceAuditEvent({
    actorAccountId: params.context.accountId,
    eventType: `workspace.files.${params.action}.failed`,
    targetId: params.target,
    payload: {
      employeeId: params.context.employeeId,
      agentId: params.context.agentId,
      errorCode: params.error.code,
      error: params.error.message,
    },
  });
}

export async function handleEmployeeWorkspaceFilesHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenClawConfig;
  readJsonBody: JsonBodyReader;
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (
    pathname !== EMPLOYEE_WORKSPACE_FILES_LIST_PATH &&
    pathname !== EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH &&
    pathname !== EMPLOYEE_WORKSPACE_FILES_PREVIEW_PATH &&
    pathname !== EMPLOYEE_WORKSPACE_FILES_UPLOAD_PATH &&
    pathname !== EMPLOYEE_WORKSPACE_FILES_MKDIR_PATH &&
    pathname !== EMPLOYEE_WORKSPACE_FILES_RENAME_PATH &&
    pathname !== EMPLOYEE_WORKSPACE_FILES_DELETE_PATH
  ) {
    return false;
  }

  let context: EmployeeWorkspaceContext | undefined;
  try {
    context = await requireEmployeeWorkspaceContext(params.req, params.config);

    if (pathname === EMPLOYEE_WORKSPACE_FILES_LIST_PATH) {
      const method = (params.req.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        params.res.statusCode = 405;
        params.res.setHeader("Allow", "GET");
        params.res.end("Method Not Allowed");
        return true;
      }
      const result = await listWorkspaceDirectory({
        rootDir: context.workspaceDir,
        relativePath: url.searchParams.get("path") ?? "",
      });
      appendWorkspaceAuditEvent({
        actorAccountId: context.accountId,
        eventType: "workspace.files.list",
        targetId: result.currentPath || "/",
        payload: {
          employeeId: context.employeeId,
          agentId: context.agentId,
          entryCount: result.entries.length,
        },
      });
      sendJson(params.res, 200, result);
      return true;
    }

    if (pathname === EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH) {
      const method = (params.req.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        params.res.statusCode = 405;
        params.res.setHeader("Allow", "GET");
        params.res.end("Method Not Allowed");
        return true;
      }
      const relativePath = normalizeWorkspaceRelativePath(url.searchParams.get("path") ?? "");
      if (!relativePath) {
        throw new WorkspaceHttpError("invalid-request", 400, "file path is required");
      }
      await resolveFilePath(context.workspaceDir, relativePath);
      const opened = await openFileWithinRoot({
        rootDir: context.workspaceDir,
        relativePath,
      });
      const inline = wantsInlineWorkspaceResponse(url);
      const detectedMime =
        (await detectMime({
          filePath: path.resolve(context.workspaceDir, relativePath),
        }).catch(() => null)) ?? "application/octet-stream";
      params.res.statusCode = 200;
      params.res.setHeader("Cache-Control", "no-store");
      params.res.setHeader("Content-Type", detectedMime);
      params.res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(path.posix.basename(relativePath))}`,
      );
      appendWorkspaceAuditEvent({
        actorAccountId: context.accountId,
        eventType: "workspace.files.download",
        targetId: relativePath,
        payload: {
          employeeId: context.employeeId,
          agentId: context.agentId,
          size: opened.stat.size,
        },
      });
      if (
        inline &&
        detectedMime === "text/html" &&
        relativePath.startsWith(GENERATED_ARTIFACT_WORKSPACE_PREFIX)
      ) {
        params.res.setHeader(
          "Content-Length",
          String(opened.stat.size + Buffer.byteLength(HTML_ARTIFACT_RESIZE_BRIDGE)),
        );
      } else {
        params.res.setHeader("Content-Length", String(opened.stat.size));
      }
      const stream = opened.handle.createReadStream();
      stream.on("error", () => {
        void opened.handle.close().catch(() => {});
        if (!params.res.headersSent) {
          params.res.statusCode = 500;
          params.res.end("Internal Server Error");
        } else {
          params.res.destroy();
        }
      });
      stream.on("close", () => {
        void opened.handle.close().catch(() => {});
      });
      const appendResizeBridge =
        inline &&
        detectedMime === "text/html" &&
        relativePath.startsWith(GENERATED_ARTIFACT_WORKSPACE_PREFIX);
      if (appendResizeBridge) {
        stream.on("end", () => {
          if (!params.res.destroyed) {
            params.res.end(HTML_ARTIFACT_RESIZE_BRIDGE);
          }
        });
        stream.pipe(params.res, { end: false });
      } else {
        stream.pipe(params.res);
      }
      return true;
    }

    if (pathname === EMPLOYEE_WORKSPACE_FILES_PREVIEW_PATH) {
      const method = (params.req.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        params.res.statusCode = 405;
        params.res.setHeader("Allow", "GET");
        params.res.end("Method Not Allowed");
        return true;
      }
      const result = await readWorkspaceFilePreview({
        rootDir: context.workspaceDir,
        relativePath: url.searchParams.get("path") ?? "",
      });
      appendWorkspaceAuditEvent({
        actorAccountId: context.accountId,
        eventType: "workspace.files.preview",
        targetId: result.path,
        payload: {
          employeeId: context.employeeId,
          agentId: context.agentId,
          size: result.size,
        },
      });
      sendJson(params.res, 200, result);
      return true;
    }

    if (pathname === EMPLOYEE_WORKSPACE_FILES_UPLOAD_PATH) {
      const method = (params.req.method ?? "POST").toUpperCase();
      if (method !== "POST") {
        params.res.statusCode = 405;
        params.res.setHeader("Allow", "POST");
        params.res.end("Method Not Allowed");
        return true;
      }
      const contentLength = readUploadContentLength(params.req);
      if (contentLength !== null && contentLength > MAX_UPLOAD_REQUEST_BYTES) {
        throw new WorkspaceHttpError("too-large", 413, "upload request exceeds limit");
      }
      const request = buildRequestForMultipart(params.req);
      const form = await request.formData();
      const files = form
        .getAll("files")
        .filter((entry): entry is File => typeof File !== "undefined" && entry instanceof File);
      if (files.length === 0) {
        throw new WorkspaceHttpError("invalid-request", 400, "no files provided");
      }
      const parentPath = normalizeWorkspaceRelativePath(url.searchParams.get("path") ?? "");
      const overwrite = url.searchParams.get("overwrite") === "1";
      const result = await uploadWorkspaceFiles({
        rootDir: context.workspaceDir,
        parentPath,
        files,
        overwrite,
      });
      appendWorkspaceAuditEvent({
        actorAccountId: context.accountId,
        eventType: "workspace.files.upload",
        targetId: parentPath || "/",
        payload: {
          employeeId: context.employeeId,
          agentId: context.agentId,
          uploaded: result.uploaded,
          failed: result.failed,
          overwrite,
        },
      });
      sendJson(params.res, result.failed.length > 0 ? 207 : 200, result);
      return true;
    }

    if (pathname === EMPLOYEE_WORKSPACE_FILES_MKDIR_PATH) {
      const method = (params.req.method ?? "POST").toUpperCase();
      if (method !== "POST") {
        params.res.statusCode = 405;
        params.res.setHeader("Allow", "POST");
        params.res.end("Method Not Allowed");
        return true;
      }
      const parsed = await params.readJsonBody(params.req, 64 * 1024);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
        throw new WorkspaceHttpError("invalid-request", 400, parsed.ok ? "invalid mkdir payload" : parsed.error);
      }
      const body = parsed.value as { parentPath?: unknown; name?: unknown };
      const result = await createWorkspaceDirectory({
        rootDir: context.workspaceDir,
        parentPath: typeof body.parentPath === "string" ? body.parentPath : "",
        name: typeof body.name === "string" ? body.name : "",
      });
      appendWorkspaceAuditEvent({
        actorAccountId: context.accountId,
        eventType: "workspace.files.mkdir",
        targetId: result.path,
        payload: {
          employeeId: context.employeeId,
          agentId: context.agentId,
        },
      });
      sendJson(params.res, 200, { ok: true, path: result.path });
      return true;
    }

    if (pathname === EMPLOYEE_WORKSPACE_FILES_RENAME_PATH) {
      const method = (params.req.method ?? "POST").toUpperCase();
      if (method !== "POST") {
        params.res.statusCode = 405;
        params.res.setHeader("Allow", "POST");
        params.res.end("Method Not Allowed");
        return true;
      }
      const parsed = await params.readJsonBody(params.req, 64 * 1024);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
        throw new WorkspaceHttpError("invalid-request", 400, parsed.ok ? "invalid rename payload" : parsed.error);
      }
      const body = parsed.value as { path?: unknown; nextName?: unknown };
      const result = await renameWorkspacePath({
        rootDir: context.workspaceDir,
        relativePath: typeof body.path === "string" ? body.path : "",
        nextName: typeof body.nextName === "string" ? body.nextName : "",
      });
      appendWorkspaceAuditEvent({
        actorAccountId: context.accountId,
        eventType: "workspace.files.rename",
        targetId: result.path,
        payload: {
          employeeId: context.employeeId,
          agentId: context.agentId,
        },
      });
      sendJson(params.res, 200, { ok: true, path: result.path });
      return true;
    }

    if (pathname === EMPLOYEE_WORKSPACE_FILES_DELETE_PATH) {
      const method = (params.req.method ?? "POST").toUpperCase();
      if (method !== "POST") {
        params.res.statusCode = 405;
        params.res.setHeader("Allow", "POST");
        params.res.end("Method Not Allowed");
        return true;
      }
      const parsed = await params.readJsonBody(params.req, 256 * 1024);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
        throw new WorkspaceHttpError("invalid-request", 400, parsed.ok ? "invalid delete payload" : parsed.error);
      }
      const body = parsed.value as { paths?: unknown };
      const paths = Array.isArray(body.paths) ? body.paths.map((entry) => String(entry ?? "")) : [];
      if (paths.length === 0) {
        throw new WorkspaceHttpError("invalid-request", 400, "delete paths are required");
      }
      const result = await deleteWorkspacePaths({
        rootDir: context.workspaceDir,
        relativePaths: paths,
      });
      appendWorkspaceAuditEvent({
        actorAccountId: context.accountId,
        eventType: "workspace.files.delete",
        targetId: paths.join(","),
        payload: {
          employeeId: context.employeeId,
          agentId: context.agentId,
          deleted: result.deleted,
          failed: result.failed,
        },
      });
      sendJson(params.res, result.failed.length > 0 ? 207 : 200, result);
      return true;
    }
  } catch (error) {
    const normalized = toWorkspaceHttpError(error);
    logWorkspaceFailure({
      context,
      action:
        pathname === EMPLOYEE_WORKSPACE_FILES_LIST_PATH
          ? "list"
          : pathname === EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH
            ? "download"
            : pathname === EMPLOYEE_WORKSPACE_FILES_PREVIEW_PATH
              ? "preview"
            : pathname === EMPLOYEE_WORKSPACE_FILES_UPLOAD_PATH
              ? "upload"
              : pathname === EMPLOYEE_WORKSPACE_FILES_MKDIR_PATH
                ? "mkdir"
                : pathname === EMPLOYEE_WORKSPACE_FILES_RENAME_PATH
                  ? "rename"
                  : "delete",
      target: new URL(params.req.url ?? "/", "http://localhost").searchParams.get("path") ?? "/",
      error: normalized,
    });
    sendJson(params.res, normalized.status, {
      ok: false,
      error: normalized.userMessage,
      code: normalized.code,
    });
    return true;
  }

  return false;
}
