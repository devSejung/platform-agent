import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveStateDir } from "../../../src/config/paths.js";
import type { OpenClawConfig } from "../../../src/config/types.js";
import { loadOutboundMediaFromUrl } from "../../../src/plugin-sdk/outbound-media.js";
import { normalizeOptionalString } from "../../../src/shared/string-coerce.js";

const KNOX_FILE_LINKS_MARKER = "[KNOX_FILE_LINKS]";
const KNOX_FILE_LINKS_ROUTE_PREFIX = "/api/v1/knox/file-links";
const KNOX_FILE_LINKS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const KNOX_FILE_LINKS_DELETE_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const KNOX_FILE_LINKS_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const KNOX_FILE_LINKS_MAX_BYTES = 256 * 1024 * 1024;
const KNOX_FILE_LINKS_MAX_FILES = 10;
const KNOX_FILE_LINKS_MAX_NOTICE_ITEMS = 10;
const KNOX_FILE_LINKS_MAX_INTRO_CHARS = 1000;
const KNOX_FILE_LINKS_FILE_MODE = 0o600;
const KNOX_FILE_LINKS_DIR_MODE = 0o700;
const KNOX_FILE_LINKS_ARTIFACT_DIR = "knox-file-links";
const KNOX_FILE_LINKS_BASE_URL_ENV = "OPENCLAW_KNOX_FILE_LINKS_BASE_URL";
const KNOX_FILE_LINKS_DEFAULT_BASE_URL = "https://go/platformclaw";
const BLOCKED_EXTENSIONS = new Set([
  ".app",
  ".cmd",
  ".com",
  ".dmg",
  ".exe",
  ".jar",
  ".key",
  ".kdbx",
  ".msi",
  ".p12",
  ".pem",
  ".pfx",
  ".pkg",
  ".scr",
]);
const BLOCKED_MIME_TYPES = new Set([
  "application/java-archive",
  "application/x-executable",
  "application/x-msdos-program",
  "application/x-msdownload",
  "application/x-pkcs12",
]);
const ARTIFACT_ID_RE = /^[0-9a-f-]{36}$/i;

type KnoxFileLinkMeta = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: string;
  expiresAt: string;
  deleteAfterAt: string;
};

type KnoxFileLinkEntry = KnoxFileLinkMeta & {
  downloadUrl: string;
};

type KnoxFileLinkNotice = {
  fileName: string;
  reason: string;
};

let cleanupScheduled = false;

function resolveKnoxFileLinksRoot() {
  return path.join(resolveStateDir(), KNOX_FILE_LINKS_ARTIFACT_DIR);
}

function resolveArtifactDir(artifactId: string) {
  return path.join(resolveKnoxFileLinksRoot(), artifactId);
}

function resolveArtifactMetaPath(artifactId: string) {
  return path.join(resolveArtifactDir(artifactId), "meta.json");
}

function resolveArtifactBlobPath(artifactId: string) {
  return path.join(resolveArtifactDir(artifactId), "blob");
}

function sanitizeDownloadFileName(value: string | undefined, fallback = "attachment") {
  const trimmed = normalizeOptionalString(value) ?? fallback;
  const base = path.basename(trimmed).replace(/[\u0000-\u001f\u007f]+/g, "").trim();
  return base || fallback;
}

function resolveAugmentedMediaAccess(params: {
  mediaUrl: string;
  mediaAccess?: {
    localRoots?: readonly string[];
    readFile?: (filePath: string) => Promise<Buffer>;
  };
}) {
  const localRoots = [...(params.mediaAccess?.localRoots ?? [])];
  const isAbsoluteLocalPath = path.isAbsolute(params.mediaUrl);
  if (path.isAbsolute(params.mediaUrl)) {
    const parentDir = path.dirname(params.mediaUrl);
    if (parentDir && !localRoots.includes(parentDir)) {
      localRoots.push(parentDir);
    }
  }
  return {
    ...(localRoots.length > 0 ? { localRoots } : {}),
    ...(!isAbsoluteLocalPath && params.mediaAccess?.readFile
      ? { readFile: params.mediaAccess.readFile }
      : {}),
  };
}

function truncateKnoxIntro(text: string | undefined) {
  const intro = normalizeOptionalString(text);
  if (!intro) {
    return null;
  }
  if (intro.length <= KNOX_FILE_LINKS_MAX_INTRO_CHARS) {
    return intro;
  }
  return `${intro.slice(0, KNOX_FILE_LINKS_MAX_INTRO_CHARS).trimEnd()}\n... (truncated)`;
}

function resolveKnoxFileLinksBaseUrl(params: {
  cfg: OpenClawConfig;
  baseUrl?: string;
}) {
  const configured = params.baseUrl?.trim();
  if (configured) {
    return configured.replace(/\/+$/u, "");
  }
  const envConfigured = process.env[KNOX_FILE_LINKS_BASE_URL_ENV]?.trim();
  if (envConfigured) {
    return envConfigured.replace(/\/+$/u, "");
  }
  return KNOX_FILE_LINKS_DEFAULT_BASE_URL;
}

function buildDownloadUrl(params: { cfg: OpenClawConfig; artifactId: string; baseUrl?: string }) {
  return `${resolveKnoxFileLinksBaseUrl({
    cfg: params.cfg,
    baseUrl: params.baseUrl,
  })}${KNOX_FILE_LINKS_ROUTE_PREFIX}/${params.artifactId}`;
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  const units = ["KB", "MB", "GB"];
  let value = sizeBytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatExpiryForKnox(expiresAt: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(expiresAt))
    .replace(/\.\s*/gu, "-")
    .replace(/-$/u, "")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^(\d{4})-(\d{2})-(\d{2}) /u, "$1-$2-$3 ");
}

function ensureKnoxFileAllowed(params: { fileName: string; contentType?: string }) {
  const ext = path.extname(params.fileName).toLowerCase();
  if (BLOCKED_EXTENSIONS.has(ext)) {
    throw new Error(`Knox file links block sensitive extension: ${ext}`);
  }
  const contentType = normalizeOptionalString(params.contentType?.split(";")[0])?.toLowerCase();
  if (contentType && BLOCKED_MIME_TYPES.has(contentType)) {
    throw new Error(`Knox file links block sensitive content type: ${contentType}`);
  }
}

function describeKnoxFileLinkFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const extMatch = /block sensitive extension:\s*(\S+)/iu.exec(message);
  if (extMatch) {
    return `민감한 확장자(${extMatch[1]})`;
  }
  const contentTypeMatch = /block sensitive content type:\s*(\S+)/iu.exec(message);
  if (contentTypeMatch) {
    return `민감한 MIME 타입(${contentTypeMatch[1]})`;
  }
  if (/max bytes|too large|exceeds?/iu.test(message)) {
    return `최대 용량 ${formatBytes(KNOX_FILE_LINKS_MAX_BYTES)} 초과`;
  }
  if (/not under an allowed directory|path is not under an allowed directory/iu.test(message)) {
    return "허용된 작업 경로 밖 파일";
  }
  if (/Host-local media sends only allow/i.test(message)) {
    return "링크 공유에서 지원하지 않는 파일 형식";
  }
  if (/not found|file not found/iu.test(message)) {
    return "파일을 찾을 수 없음";
  }
  return "처리 실패";
}

async function ensureKnoxFileLinksRoot() {
  await fsPromises.mkdir(resolveKnoxFileLinksRoot(), {
    recursive: true,
    mode: KNOX_FILE_LINKS_DIR_MODE,
  });
}

async function writeArtifact(params: {
  mediaUrl: string;
  cfg: OpenClawConfig;
  baseUrl?: string;
  mediaAccess?: {
    localRoots?: readonly string[];
    readFile?: (filePath: string) => Promise<Buffer>;
  };
  expiresAt: string;
}): Promise<KnoxFileLinkEntry> {
  const mediaAccess = resolveAugmentedMediaAccess({
    mediaUrl: params.mediaUrl,
    mediaAccess: params.mediaAccess,
  });
  ensureKnoxFileAllowed({
    fileName: sanitizeDownloadFileName(path.basename(params.mediaUrl) || "attachment"),
  });
  const loaded = await loadOutboundMediaFromUrl(params.mediaUrl, {
    maxBytes: KNOX_FILE_LINKS_MAX_BYTES,
    mediaAccess,
    mediaLocalRoots: mediaAccess.localRoots,
    mediaReadFile: mediaAccess.readFile,
  });
  const fileName = sanitizeDownloadFileName(
    loaded.fileName,
    path.basename(params.mediaUrl) || "attachment",
  );
  const contentType = normalizeOptionalString(loaded.contentType) ?? "application/octet-stream";
  ensureKnoxFileAllowed({ fileName, contentType });
  const id = randomUUID();
  const checksumSha256 = createHash("sha256").update(loaded.buffer).digest("hex");
  const artifactDir = resolveArtifactDir(id);
  const meta: KnoxFileLinkMeta = {
    id,
    fileName,
    contentType,
    sizeBytes: loaded.buffer.byteLength,
    checksumSha256,
    createdAt: new Date().toISOString(),
    expiresAt: params.expiresAt,
    deleteAfterAt: new Date(Date.parse(params.expiresAt) + KNOX_FILE_LINKS_DELETE_GRACE_MS).toISOString(),
  };
  await fsPromises.mkdir(artifactDir, { recursive: true, mode: KNOX_FILE_LINKS_DIR_MODE });
  await fsPromises.writeFile(resolveArtifactBlobPath(id), loaded.buffer, {
    mode: KNOX_FILE_LINKS_FILE_MODE,
  });
  await fsPromises.writeFile(resolveArtifactMetaPath(id), JSON.stringify(meta, null, 2), {
    mode: KNOX_FILE_LINKS_FILE_MODE,
  });
  return {
    ...meta,
    downloadUrl: buildDownloadUrl({
      cfg: params.cfg,
      artifactId: id,
      baseUrl: params.baseUrl,
    }),
  };
}

async function readArtifactMeta(artifactId: string): Promise<KnoxFileLinkMeta | null> {
  try {
    const raw = await fsPromises.readFile(resolveArtifactMetaPath(artifactId), "utf8");
    return JSON.parse(raw) as KnoxFileLinkMeta;
  } catch {
    return null;
  }
}

async function removeArtifact(artifactId: string) {
  await fsPromises.rm(resolveArtifactDir(artifactId), { recursive: true, force: true });
}

async function cleanupExpiredArtifacts(nowMs = Date.now()) {
  const rootDir = resolveKnoxFileLinksRoot();
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && ARTIFACT_ID_RE.test(entry.name))
      .map(async (entry) => {
        const meta = await readArtifactMeta(entry.name);
        if (!meta) {
          await removeArtifact(entry.name);
          return;
        }
        const deleteAfterAt = Date.parse(meta.deleteAfterAt ?? meta.expiresAt) + (meta.deleteAfterAt ? 0 : KNOX_FILE_LINKS_DELETE_GRACE_MS);
        if (deleteAfterAt <= nowMs) {
          await removeArtifact(entry.name);
        }
      }),
  );
}

function ensureCleanupScheduled() {
  if (cleanupScheduled) {
    return;
  }
  cleanupScheduled = true;
  setInterval(() => {
    void cleanupExpiredArtifacts();
  }, KNOX_FILE_LINKS_CLEANUP_INTERVAL_MS).unref();
}

function renderKnoxFileLinksMessage(params: {
  entries: KnoxFileLinkEntry[];
  expiresAt?: string;
  text?: string;
  notices?: KnoxFileLinkNotice[];
}) {
  const lines: string[] = [KNOX_FILE_LINKS_MARKER];
  const intro = truncateKnoxIntro(params.text);
  if (intro) {
    lines.push(intro, "");
  }
  if (params.entries.length === 0) {
    lines.push("첨부 가능한 파일이 없습니다.");
  } else {
    lines.push(
      `파일 ${params.entries.length}개를 준비했습니다.`,
      `링크 만료: ${formatExpiryForKnox(params.expiresAt ?? new Date().toISOString())} KST`,
      "",
    );
    params.entries.forEach((entry, index) => {
      lines.push(
        `${index + 1}. ${entry.fileName}`,
        `- ${formatBytes(entry.sizeBytes)}`,
        `- ${entry.contentType}`,
        `- 링크: ${entry.downloadUrl}`,
      );
      if (index < params.entries.length - 1) {
        lines.push("");
      }
    });
  }
  const notices = params.notices ?? [];
  if (notices.length > 0) {
    const shown = notices.slice(0, KNOX_FILE_LINKS_MAX_NOTICE_ITEMS);
    lines.push("", `제외된 파일 ${notices.length}개:`);
    for (const notice of shown) {
      lines.push(`- ${notice.fileName}: ${notice.reason}`);
    }
    if (notices.length > shown.length) {
      lines.push(`- 외 ${notices.length - shown.length}개`);
    }
  }
  return lines.join("\n");
}

export async function buildKnoxFileLinksText(params: {
  cfg: OpenClawConfig;
  mediaUrls: string[];
  text?: string;
  baseUrl?: string;
  mediaAccess?: {
    localRoots?: readonly string[];
    readFile?: (filePath: string) => Promise<Buffer>;
  };
}) {
  if (params.mediaUrls.length === 0) {
    return params.text ?? "";
  }
  ensureCleanupScheduled();
  await ensureKnoxFileLinksRoot();
  await cleanupExpiredArtifacts();
  const expiresAt = new Date(Date.now() + KNOX_FILE_LINKS_TTL_MS).toISOString();
  const entries: KnoxFileLinkEntry[] = [];
  const notices: KnoxFileLinkNotice[] = [];
  const seenChecksums = new Set<string>();
  const seenSources = new Set<string>();
  for (const mediaUrl of params.mediaUrls) {
    const normalizedSource = mediaUrl.trim();
    if (!normalizedSource || seenSources.has(normalizedSource)) {
      continue;
    }
    seenSources.add(normalizedSource);
    const fileName = sanitizeDownloadFileName(path.basename(normalizedSource) || "attachment");
    if (entries.length >= KNOX_FILE_LINKS_MAX_FILES) {
      notices.push({
        fileName,
        reason: `최대 ${KNOX_FILE_LINKS_MAX_FILES}개 제한`,
      });
      continue;
    }
    try {
      const entry = await writeArtifact({
        mediaUrl: normalizedSource,
        cfg: params.cfg,
        baseUrl: params.baseUrl,
        mediaAccess: params.mediaAccess,
        expiresAt,
      });
      if (seenChecksums.has(entry.checksumSha256)) {
        await removeArtifact(entry.id);
        continue;
      }
      seenChecksums.add(entry.checksumSha256);
      entries.push(entry);
    } catch (error) {
      notices.push({
        fileName,
        reason: describeKnoxFileLinkFailure(error),
      });
    }
  }
  return renderKnoxFileLinksMessage({
    entries,
    expiresAt,
    text: params.text,
    notices,
  });
}

function resolveDownloadHeaders(meta: KnoxFileLinkMeta) {
  const encoded = encodeURIComponent(meta.fileName).replace(/['()]/gu, escape).replace(/\*/gu, "%2A");
  const isPreviewable = meta.contentType === "application/pdf" || meta.contentType.startsWith("image/");
  return {
    "Content-Type": meta.contentType,
    "Content-Length": String(meta.sizeBytes),
    "Content-Disposition": `${isPreviewable ? "inline" : "attachment"}; filename*=UTF-8''${encoded}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": `private, max-age=${Math.max(0, Math.floor((Date.parse(meta.expiresAt) - Date.now()) / 1000))}`,
  };
}

export async function handleKnoxFileLinksHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return false;
  }
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (!pathname.startsWith(`${KNOX_FILE_LINKS_ROUTE_PREFIX}/`)) {
    return false;
  }
  const artifactId = pathname.slice(`${KNOX_FILE_LINKS_ROUTE_PREFIX}/`.length).trim();
  if (!ARTIFACT_ID_RE.test(artifactId)) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("invalid artifact id");
    return true;
  }
  ensureCleanupScheduled();
  const meta = await readArtifactMeta(artifactId);
  if (!meta) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
    return true;
  }
  if (Date.parse(meta.expiresAt) <= Date.now()) {
    res.statusCode = 410;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("expired");
    return true;
  }
  const blobPath = resolveArtifactBlobPath(artifactId);
  const stat = await fsPromises.stat(blobPath).catch(() => null);
  if (!stat?.isFile()) {
    await removeArtifact(artifactId);
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("not found");
    return true;
  }
  Object.entries(resolveDownloadHeaders(meta)).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.statusCode = 200;
  if (method === "HEAD") {
    res.end();
    return true;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(blobPath);
    stream.on("error", reject);
    res.on("close", resolve);
    res.on("finish", resolve);
    stream.pipe(res);
  }).catch(async () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("download failed");
    } else {
      res.destroy();
    }
  });
  return true;
}

export {
  KNOX_FILE_LINKS_BASE_URL_ENV,
  KNOX_FILE_LINKS_DEFAULT_BASE_URL,
  KNOX_FILE_LINKS_DELETE_GRACE_MS,
  KNOX_FILE_LINKS_MARKER,
  KNOX_FILE_LINKS_MAX_FILES,
  KNOX_FILE_LINKS_MAX_BYTES,
  KNOX_FILE_LINKS_ROUTE_PREFIX,
  KNOX_FILE_LINKS_TTL_MS,
};
