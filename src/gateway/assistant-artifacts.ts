import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileWithinRoot } from "../infra/fs-safe.js";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";
import { detectMime } from "../media/mime.js";
import { resolveConfigDir } from "../utils.js";
import {
  normalizeWorkspaceRelativePath,
  validateWorkspaceEntryName,
} from "./employee-workspace-files.js";

const ASSISTANT_ARTIFACT_ROOT = "outbox/generated-artifacts";
const MAX_ASSISTANT_ARTIFACT_BYTES = 25 * 1024 * 1024;
const MANAGED_GLOBAL_MEDIA_SUBDIRS = new Set(["outbound"]);
const GLOBAL_DOCS_DIRNAME = "global_docs";
const SENSITIVE_ARTIFACT_NAME_RE = /(?:secret|token|credential|password|private-key)/i;
const BLOCKED_ARTIFACT_EXTENSIONS = new Set([
  ".cer",
  ".crt",
  ".key",
  ".p12",
  ".pfx",
  ".pem",
]);
// AIDEV-TODO: Add generated artifact retention/cleanup config for this root.
// Today these files are session-history durable and should be pruned by an explicit policy,
// not by transient media TTL cleanup.
const ALLOWED_ASSISTANT_ARTIFACT_MIMES = new Set([
  "application/json",
  "application/pdf",
  "application/zip",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);

export type AssistantArtifactAttachment = {
  type: "image" | "file";
  fileName: string;
  storedFileName: string;
  workspacePath: string;
  mimeType: string;
  sizeBytes: number;
  promptMode: "workspace";
};

export type AssistantArtifactContentBlock = {
  type: "attachment";
  attachmentType: "image" | "file";
  fileName: string;
  storedFileName: string;
  workspacePath: string;
  mimeType: string;
  sizeBytes: number;
  promptMode: "workspace";
};

type AssistantArtifactsLog = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeLocalMediaPath(raw: string, workspaceDir: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || isHttpUrl(trimmed) || /^data:/i.test(trimmed)) {
    return null;
  }
  if (trimmed.startsWith("file:")) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return null;
    }
  }
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(workspaceDir, trimmed);
}

function isPathInside(rootDir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isManagedGlobalMediaPath(candidate: string): boolean {
  const globalMediaRoot = path.join(resolveConfigDir(), "media");
  const relative = path.relative(path.resolve(globalMediaRoot), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const firstSegment = relative.split(path.sep)[0] ?? "";
  return MANAGED_GLOBAL_MEDIA_SUBDIRS.has(firstSegment) || firstSegment.startsWith("tool-");
}

function isGlobalDocsPath(candidate: string): boolean {
  return isPathInside(path.join(resolveConfigDir(), GLOBAL_DOCS_DIRNAME), candidate);
}

function isAllowedAssistantArtifactSource(params: {
  workspaceDir: string;
  candidate: string;
}): boolean {
  if (isPathInside(params.workspaceDir, params.candidate)) {
    return true;
  }
  if (isManagedGlobalMediaPath(params.candidate)) {
    return true;
  }
  if (isGlobalDocsPath(params.candidate)) {
    return true;
  }
  return isPathInside(resolvePreferredOpenClawTmpDir(), params.candidate);
}

async function isRealPathInside(rootDir: string, candidate: string): Promise<boolean> {
  const [rootReal, candidateReal] = await Promise.all([
    fs.realpath(rootDir),
    fs.realpath(candidate),
  ]);
  return isPathInside(rootReal, candidateReal);
}

function hasHiddenPathSegment(relativePath: string): boolean {
  return relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .some((segment) => segment !== "." && segment !== ".." && segment.startsWith("."));
}

function validateAssistantArtifactPolicy(params: {
  sourcePath: string;
  workspaceDir: string;
}): string | null {
  const fileName = path.basename(params.sourcePath);
  const extension = path.extname(fileName).toLowerCase();
  if (SENSITIVE_ARTIFACT_NAME_RE.test(fileName)) {
    return "sensitive filename";
  }
  if (BLOCKED_ARTIFACT_EXTENSIONS.has(extension)) {
    return "blocked key/certificate extension";
  }
  if (isPathInside(params.workspaceDir, params.sourcePath)) {
    const workspaceRelativePath = path.relative(
      path.resolve(params.workspaceDir),
      path.resolve(params.sourcePath),
    );
    if (!workspaceRelativePath || hasHiddenPathSegment(workspaceRelativePath)) {
      return "hidden workspace path segment";
    }
  }
  return null;
}

function sanitizeArtifactBaseName(value: string): string {
  const parsed = path.parse(value);
  const base = (parsed.name || "artifact")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/[._-]{2,}/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .toLowerCase();
  return base || "artifact";
}

function sanitizeArtifactExtension(value: string): string {
  const ext = path
    .extname(value)
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "");
  return ext && ext.length <= 12 ? ext : "";
}

function buildStoredArtifactName(sourcePath: string): string {
  const base = sanitizeArtifactBaseName(path.basename(sourcePath));
  const ext = sanitizeArtifactExtension(sourcePath);
  const suffix = crypto.randomUUID().slice(0, 8);
  const storedFileName = `${base}-${suffix}${ext}`;
  validateWorkspaceEntryName(storedFileName.replace(/\./g, "_"));
  return storedFileName;
}

function buildArtifactRelativePath(
  sourcePath: string,
  now = new Date(),
): {
  relativePath: string;
  storedFileName: string;
} {
  const datePrefix = now.toISOString().slice(0, 10);
  const storedFileName = buildStoredArtifactName(sourcePath);
  const relativePath = normalizeWorkspaceRelativePath(
    `${ASSISTANT_ARTIFACT_ROOT}/${datePrefix}/${storedFileName}`,
  );
  return { relativePath, storedFileName };
}

function toArtifactAttachment(params: {
  fileName: string;
  storedFileName: string;
  workspacePath: string;
  mimeType: string;
  sizeBytes: number;
}): AssistantArtifactAttachment {
  const type = params.mimeType.startsWith("image/") ? "image" : "file";
  return {
    type,
    fileName: params.fileName,
    storedFileName: params.storedFileName,
    workspacePath: params.workspacePath,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    promptMode: "workspace",
  };
}

export function assistantArtifactToContentBlock(
  attachment: AssistantArtifactAttachment,
): AssistantArtifactContentBlock {
  return {
    type: "attachment",
    attachmentType: attachment.type,
    fileName: attachment.fileName,
    storedFileName: attachment.storedFileName,
    workspacePath: attachment.workspacePath,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    promptMode: "workspace",
  };
}

export async function materializeAssistantArtifacts(params: {
  mediaUrls: readonly string[];
  workspaceDir: string;
  log?: AssistantArtifactsLog;
  now?: Date;
  maxBytes?: number;
}): Promise<{
  attachments: AssistantArtifactAttachment[];
  contentBlocks: AssistantArtifactContentBlock[];
}> {
  const attachments: AssistantArtifactAttachment[] = [];
  const seen = new Set<string>();
  const maxBytes = params.maxBytes ?? MAX_ASSISTANT_ARTIFACT_BYTES;

  for (const raw of params.mediaUrls) {
    const localPath = normalizeLocalMediaPath(raw, params.workspaceDir);
    if (!localPath || seen.has(localPath)) {
      continue;
    }
    seen.add(localPath);
    if (
      !isAllowedAssistantArtifactSource({
        workspaceDir: params.workspaceDir,
        candidate: localPath,
      })
    ) {
      params.log?.warn?.("assistant artifact skipped outside allowed roots", { mediaUrl: raw });
      continue;
    }

    try {
      const policyRejection = validateAssistantArtifactPolicy({
        sourcePath: localPath,
        workspaceDir: params.workspaceDir,
      });
      if (policyRejection) {
        params.log?.warn?.("assistant artifact skipped by policy", {
          mediaUrl: raw,
          reason: policyRejection,
        });
        continue;
      }
      if (
        isPathInside(params.workspaceDir, localPath) &&
        !(await isRealPathInside(params.workspaceDir, localPath))
      ) {
        params.log?.warn?.("assistant artifact skipped symlink escape", { mediaUrl: raw });
        continue;
      }
      const stat = await fs.stat(localPath);
      if (!stat.isFile() || stat.size > maxBytes) {
        continue;
      }
      const mimeType =
        (await detectMime({
          filePath: localPath,
        }).catch(() => undefined)) ?? "application/octet-stream";
      if (!ALLOWED_ASSISTANT_ARTIFACT_MIMES.has(mimeType)) {
        params.log?.warn?.("assistant artifact skipped unsupported mime", {
          mediaUrl: raw,
          mimeType,
        });
        continue;
      }
      const { relativePath, storedFileName } = buildArtifactRelativePath(localPath, params.now);
      await copyFileWithinRoot({
        sourcePath: localPath,
        rootDir: params.workspaceDir,
        relativePath,
        maxBytes,
        mkdir: true,
        rejectSourceHardlinks: true,
      });
      attachments.push(
        toArtifactAttachment({
          fileName: path.basename(localPath) || storedFileName,
          storedFileName,
          workspacePath: relativePath,
          mimeType,
          sizeBytes: stat.size,
        }),
      );
    } catch (err) {
      params.log?.warn?.("assistant artifact materialization failed", {
        mediaUrl: raw,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    attachments,
    contentBlocks: attachments.map(assistantArtifactToContentBlock),
  };
}
