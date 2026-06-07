import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { resolveEmployeeAccountSummary } from "../accounts/account-provisioning.js";
import { getPlatformClawDatabase } from "../accounts/db.js";
import type { OpenClawConfig } from "../config/config.js";
import { resolveBoundaryPath } from "../infra/boundary-path.js";
import { SafeOpenError, mkdirPathWithinRoot } from "../infra/fs-safe.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { readEmployeeSession } from "./employee-web-auth.js";
import {
  EMPLOYEE_CHAT_ATTACHMENTS_DELETE_PATH,
  EMPLOYEE_CHAT_ATTACHMENTS_UPLOAD_PATH,
  type EmployeeChatAttachmentUploadRecord,
} from "./employee-chat-attachments-contract.js";
import {
  normalizeWorkspaceRelativePath,
  readWorkspaceFilePreview,
  validateWorkspaceEntryName,
} from "./employee-workspace-files.js";

const CHAT_ATTACHMENT_ROOT = "inbox/chat-attachments";
const MAX_CHAT_ATTACHMENT_BYTES = 500 * 1024 * 1024;
const INLINE_ATTACHMENT_MAX_BYTES = 400 * 1024;

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

class ChatAttachmentHttpError extends Error {
  status: number;
  userMessage: string;
  constructor(status: number, message: string, userMessage = message) {
    super(message);
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

function buildRequestForMultipart(req: IncomingMessage): Request {
  return new Request("http://localhost/upload", {
    method: req.method ?? "POST",
    headers: req.headers as Record<string, string>,
    body: req as BodyInit,
    duplex: "half",
  });
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

async function requireEmployeeWorkspaceContext(
  req: IncomingMessage,
  config: OpenClawConfig,
): Promise<EmployeeWorkspaceContext> {
  const session = readEmployeeSession(req);
  if (!session) {
    throw new ChatAttachmentHttpError(401, "employee sign-in required");
  }
  const account = resolveEmployeeAccountSummary({ employeeId: session.employeeId });
  if (!account?.accountId) {
    throw new ChatAttachmentHttpError(401, "employee account not provisioned");
  }
  const agentId = normalizeAgentId(session.agentId);
  return {
    employeeId: session.employeeId,
    accountId: account.accountId,
    agentId,
    workspaceDir: resolveAgentWorkspaceDir(config, agentId),
  };
}

function appendAuditEvent(params: {
  actorAccountId: string;
  eventType: string;
  targetId: string;
  payload?: Record<string, unknown>;
}) {
  const { db } = getPlatformClawDatabase(process.env);
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

function normalizeChatAttachmentBaseName(input: string): string {
  const withoutExt = input.replace(/\.[^.]+$/g, "");
  const sanitized = withoutExt
    .normalize("NFKD")
    .replace(/[()]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/[._-]{2,}/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .toLowerCase();
  return sanitized || "attachment";
}

function splitPreservedExtension(fileName: string): { base: string; ext: string } {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".tar.gz")) {
    return { base: fileName.slice(0, -7), ext: ".tar.gz" };
  }
  if (lower.endsWith(".tar.bz2")) {
    return { base: fileName.slice(0, -8), ext: ".tar.bz2" };
  }
  return { base: fileName.slice(0, -path.extname(fileName).length) || fileName, ext: path.extname(fileName).toLowerCase() };
}

function buildStoredFileName(originalName: string, duplicateIndex = 0): string {
  const { base, ext } = splitPreservedExtension(originalName);
  const normalizedBase = normalizeChatAttachmentBaseName(base);
  return `${normalizedBase}${duplicateIndex > 0 ? `_${duplicateIndex + 1}` : ""}${ext}`;
}

function buildAttachmentDatePrefix(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function resolveAvailableWorkspacePath(params: {
  rootDir: string;
  relativeDir: string;
  originalName: string;
}): Promise<{ relativePath: string; storedFileName: string }> {
  for (let index = 0; index < 1000; index += 1) {
    const storedFileName = buildStoredFileName(params.originalName, index);
    validateWorkspaceEntryName(storedFileName.replace(/\./g, "_"));
    const relativePath = `${params.relativeDir}/${storedFileName}`;
    const resolved = await resolveBoundaryPath({
      absolutePath: path.resolve(params.rootDir, relativePath),
      rootPath: params.rootDir,
      boundaryLabel: "workspace root",
    });
    if (!resolved.exists) {
      return { relativePath, storedFileName };
    }
  }
  throw new ChatAttachmentHttpError(409, "failed to allocate a unique attachment name");
}

function isWorkspaceChatAttachmentPath(relativePath: string): boolean {
  return relativePath === CHAT_ATTACHMENT_ROOT || relativePath.startsWith(`${CHAT_ATTACHMENT_ROOT}/`);
}

async function saveUploadedAttachment(params: {
  rootDir: string;
  file: File;
}): Promise<{ relativePath: string; storedFileName: string; sizeBytes: number; mimeType: string }> {
  const relativeDir = `${CHAT_ATTACHMENT_ROOT}/${buildAttachmentDatePrefix()}`;
  await mkdirPathWithinRoot({
    rootDir: params.rootDir,
    relativePath: relativeDir,
  });
  const { relativePath, storedFileName } = await resolveAvailableWorkspacePath({
    rootDir: params.rootDir,
    relativeDir,
    originalName: params.file.name || "attachment",
  });
  const absolutePath = path.resolve(params.rootDir, relativePath);
  const buffer = Buffer.from(await params.file.arrayBuffer());
  await fs.writeFile(absolutePath, buffer);
  return {
    relativePath,
    storedFileName,
    sizeBytes: buffer.byteLength,
    mimeType: params.file.type || "application/octet-stream",
  };
}

async function buildUploadedAttachmentRecord(params: {
  rootDir: string;
  file: File;
  stored: { relativePath: string; storedFileName: string; sizeBytes: number; mimeType: string };
}): Promise<EmployeeChatAttachmentUploadRecord> {
  const isImage = params.stored.mimeType.startsWith("image/");
  if (isImage) {
    return {
      type: "image",
      originalFileName: params.file.name || params.stored.storedFileName,
      storedFileName: params.stored.storedFileName,
      workspacePath: params.stored.relativePath,
      mimeType: params.stored.mimeType,
      sizeBytes: params.stored.sizeBytes,
      promptMode: "image",
      inlineContent: null,
      inlineTruncated: false,
    };
  }
  if (params.stored.sizeBytes <= INLINE_ATTACHMENT_MAX_BYTES) {
    const preview = await readWorkspaceFilePreview({
      rootDir: params.rootDir,
      relativePath: params.stored.relativePath,
    });
    if ((preview.kind === "markdown" || preview.kind === "code" || preview.kind === "text") && preview.content) {
      return {
        type: "file",
        originalFileName: params.file.name || params.stored.storedFileName,
        storedFileName: params.stored.storedFileName,
        workspacePath: params.stored.relativePath,
        mimeType: params.stored.mimeType,
        sizeBytes: params.stored.sizeBytes,
        promptMode: "inline",
        inlineContent: preview.content,
        inlineTruncated: preview.truncated,
      };
    }
  }
  return {
    type: "file",
    originalFileName: params.file.name || params.stored.storedFileName,
    storedFileName: params.stored.storedFileName,
    workspacePath: params.stored.relativePath,
    mimeType: params.stored.mimeType,
    sizeBytes: params.stored.sizeBytes,
    promptMode: "workspace",
    inlineContent: null,
    inlineTruncated: false,
  };
}

function toUserMessage(error: unknown): string {
  if (error instanceof ChatAttachmentHttpError) {
    return error.userMessage;
  }
  if (error instanceof SafeOpenError) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export async function handleEmployeeChatAttachmentsHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenClawConfig;
  readJsonBody: JsonBodyReader;
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (pathname !== EMPLOYEE_CHAT_ATTACHMENTS_UPLOAD_PATH && pathname !== EMPLOYEE_CHAT_ATTACHMENTS_DELETE_PATH) {
    return false;
  }

  let context: EmployeeWorkspaceContext | undefined;
  try {
    context = await requireEmployeeWorkspaceContext(params.req, params.config);

    if (pathname === EMPLOYEE_CHAT_ATTACHMENTS_UPLOAD_PATH) {
      if ((params.req.method ?? "POST").toUpperCase() !== "POST") {
        params.res.statusCode = 405;
        params.res.setHeader("Allow", "POST");
        params.res.end("Method Not Allowed");
        return true;
      }
      const contentLength = readUploadContentLength(params.req);
      if (contentLength !== null && contentLength > MAX_CHAT_ATTACHMENT_BYTES + 2_000_000) {
        throw new ChatAttachmentHttpError(413, "attachment exceeds maximum upload size");
      }
      const request = buildRequestForMultipart(params.req);
      const form = await request.formData();
      const file = form.get("file");
      if (typeof File === "undefined" || !(file instanceof File)) {
        throw new ChatAttachmentHttpError(400, "attachment file is required");
      }
      if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        throw new ChatAttachmentHttpError(413, "attachment exceeds maximum upload size");
      }
      const stored = await saveUploadedAttachment({
        rootDir: context.workspaceDir,
        file,
      });
      const attachment = await buildUploadedAttachmentRecord({
        rootDir: context.workspaceDir,
        file,
        stored,
      });
      appendAuditEvent({
        actorAccountId: context.accountId,
        eventType: "chat.attachments.upload",
        targetId: attachment.workspacePath,
        payload: {
          employeeId: context.employeeId,
          agentId: context.agentId,
          promptMode: attachment.promptMode,
          sizeBytes: attachment.sizeBytes,
          mimeType: attachment.mimeType,
        },
      });
      sendJson(params.res, 200, { attachment });
      return true;
    }

    if ((params.req.method ?? "POST").toUpperCase() !== "POST") {
      params.res.statusCode = 405;
      params.res.setHeader("Allow", "POST");
      params.res.end("Method Not Allowed");
      return true;
    }
    const parsed = await params.readJsonBody(params.req, 64 * 1024);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
      throw new ChatAttachmentHttpError(400, parsed.ok ? "invalid delete payload" : parsed.error);
    }
    const body = parsed.value as { workspacePath?: unknown };
    const relativePath = normalizeWorkspaceRelativePath(body.workspacePath);
    if (!relativePath || !isWorkspaceChatAttachmentPath(relativePath)) {
      throw new ChatAttachmentHttpError(403, "접근할 수 없는 경로");
    }
    const resolved = await resolveBoundaryPath({
      absolutePath: path.resolve(context.workspaceDir, relativePath),
      rootPath: context.workspaceDir,
      boundaryLabel: "workspace root",
    });
    if (!resolved.exists || resolved.kind !== "file") {
      throw new ChatAttachmentHttpError(404, "attachment not found");
    }
    await fs.rm(resolved.canonicalPath, { force: true });
    appendAuditEvent({
      actorAccountId: context.accountId,
      eventType: "chat.attachments.delete",
      targetId: relativePath,
      payload: {
        employeeId: context.employeeId,
        agentId: context.agentId,
      },
    });
    sendJson(params.res, 200, { ok: true });
    return true;
  } catch (error) {
    sendJson(
      params.res,
      error instanceof ChatAttachmentHttpError ? error.status : 500,
      {
        ok: false,
        error: toUserMessage(error),
      },
    );
    return true;
  }
}
