import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getAccountById, resolveAccountDisplayName } from "../accounts/account-store.js";
import { getPlatformClawDatabase } from "../accounts/db.js";
import type { OpenClawConfig } from "../config/config.js";
import { formatErrorMessage } from "../infra/errors.js";
import { safeParseJson } from "../utils.js";
import { CONFIG_DIR, ensureDir } from "../utils.js";
import { extractArchive } from "./skills-install-extract.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "./skills.js";
import { loadSkillsFromDirSafe } from "./skills/local-loader.js";
import { bumpSkillsSnapshotVersion } from "./skills/refresh.js";
import { resolveSkillSource } from "./skills/source.js";

const fsp = fs.promises;

const SKILL_HUB_ROOT = path.join(CONFIG_DIR, "skill-hub");
const REGISTRY_ROOT = path.join(SKILL_HUB_ROOT, "registry", "skills");
const METADATA_ROOT = path.join(SKILL_HUB_ROOT, "metadata");
const EVENTS_ROOT = path.join(SKILL_HUB_ROOT, "events");
const AGGREGATES_ROOT = path.join(SKILL_HUB_ROOT, "aggregates");
const STATE_ROOT = path.join(SKILL_HUB_ROOT, "state");
const LIKES_ROOT = path.join(STATE_ROOT, "likes");
const STAGING_ROOT = path.join(SKILL_HUB_ROOT, "staging", "uploads");
const WORKSPACE_INSTALL_STATE_FILE = ".skill-hub-installed.json";
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const MAX_EXAMPLE_PROMPTS = 3;
const MAX_EXAMPLE_PROMPT_CHARS = 200;
const publishQueues = new Map<string, Promise<void>>();

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export type SkillHubActor = {
  employeeId: string;
  name?: string | null;
  globalRole?: "member" | "admin";
};

export type SkillHubWarningFlags = {
  hasHiddenFiles: boolean;
  hasExecutableFiles: boolean;
};

export type SkillHubInstallStateEntry = {
  slug: string;
  displayName: string;
  installedVersion: string;
  source: "hub";
  installedAt: string;
  updatedAt: string;
  installedPath: string;
};

export type SkillHubInstallState = {
  skills: Record<string, SkillHubInstallStateEntry>;
};

export type SkillHubVersionRecord = {
  version: string;
  uploadedBy: {
    employeeId: string;
    name?: string;
  };
  uploadedAt: string;
  path: string;
};

export type SkillHubMetadata = {
  slug: string;
  displayName: string;
  summary: string;
  uploader: {
    employeeId: string;
    name?: string;
  };
  owner: {
    accountId: string;
    name?: string;
  };
  publishedAt: string;
  updatedAt: string;
  latestVersion: string;
  contentChecksum?: string;
  hidden: boolean;
  flags: SkillHubWarningFlags;
  stats: {
    installCount: number;
    installerCount: number;
  };
  presentation: {
    examplePrompts: string[];
  };
  engagement: {
    likeCount: number;
  };
  versions: SkillHubVersionRecord[];
};

export type SkillHubLikesState = {
  actors: Record<string, { likedAt: string }>;
};

export type SkillHubListScope = "discover" | "installed" | "uploads" | "updates";
export type SkillHubSort = "recent" | "installs" | "likes" | "az";

export type SkillHubListEntry = {
  slug: string;
  displayName: string;
  summary: string;
  uploaderName: string;
  uploaderEmployeeId: string;
  ownerAccountId: string;
  latestVersion: string;
  publishedAt: string;
  updatedAt: string;
  installCount: number;
  installerCount: number;
  likeCount: number;
  hidden: boolean;
  uploadedByYou: boolean;
  likedByYou: boolean;
  installed: boolean;
  canEditMetadata: boolean;
  canManageVisibility: boolean;
  canAdminManage: boolean;
  canTransferOwnership: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  flags: SkillHubWarningFlags;
};

export type SkillHubDetail = SkillHubListEntry & {
  examplePrompts: string[];
  versions: SkillHubVersionRecord[];
};

export type WorkspacePublishState =
  | "new_local_skill"
  | "update_available_from_local"
  | "up_to_date"
  | "existing_skill_non_owner"
  | "conflict_or_unknown";

export type WorkspacePublishEntry = {
  skillName: string;
  skillKey: string;
  description: string;
  matchedHubSlug?: string;
  hubVersion?: string;
  ownerAccountId?: string;
  installedFromHub: boolean;
  localChecksum?: string;
  hubChecksum?: string;
  flags?: SkillHubWarningFlags;
  state: WorkspacePublishState;
  actionLabel: string;
  disabled: boolean;
  reason: string;
};

export type SkillHubOverview = {
  sharedSkillCount: number;
  updateAvailableCount: number;
  localSkillCount: number;
  installedSkillCount: number;
  recentUpdates: Array<{
    slug: string;
    displayName: string;
    latestVersion: string;
    updatedAt: string;
  }>;
};

type PublishPreparedSkill = {
  displayName: string;
  summary: string;
  sourceDir: string;
  contentChecksum: string;
  flags: SkillHubWarningFlags;
  examplePrompts: string[];
  cleanupDir?: string;
};

export type SkillHubPublishIntent = "create" | "update";

const CHECKSUM_IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".pytest_cache",
  ".cache",
  "coverage",
]);
const CHECKSUM_IGNORED_FILE_NAMES = new Set([".DS_Store", WORKSPACE_INSTALL_STATE_FILE]);

function resolveSkillHubMetadataPath(slug: string): string {
  return path.join(METADATA_ROOT, `${slug}.json`);
}

function resolveSkillHubVersionDir(slug: string, version: string): string {
  return path.join(REGISTRY_ROOT, slug, version);
}

function resolveWorkspaceInstallStatePath(workspaceDir: string): string {
  return path.join(workspaceDir, WORKSPACE_INSTALL_STATE_FILE);
}

async function ensureSkillHubDirs() {
  await Promise.all([
    ensureDir(REGISTRY_ROOT),
    ensureDir(METADATA_ROOT),
    ensureDir(EVENTS_ROOT),
    ensureDir(AGGREGATES_ROOT),
    ensureDir(LIKES_ROOT),
    ensureDir(STAGING_ROOT),
  ]);
}

function resolveLikesStatePath(slug: string): string {
  return path.join(LIKES_ROOT, `${slug}.json`);
}

function sanitizeExamplePrompts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const prompts: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.replace(/\s+/g, " ").trim();
    if (!trimmed) {
      continue;
    }
    prompts.push(trimmed.slice(0, MAX_EXAMPLE_PROMPT_CHARS));
    if (prompts.length >= MAX_EXAMPLE_PROMPTS) {
      break;
    }
  }
  return prompts;
}

function normalizeSkillHubMetadata(
  value: SkillHubMetadata | Record<string, unknown>,
): SkillHubMetadata {
  const raw = value as Partial<SkillHubMetadata> & {
    presentation?: { examplePrompts?: unknown };
    engagement?: { likeCount?: unknown };
  };
  return {
    ...raw,
    slug: String(raw.slug ?? ""),
    displayName: String(raw.displayName ?? ""),
    summary: String(raw.summary ?? ""),
    uploader: {
      employeeId: String(raw.uploader?.employeeId ?? ""),
      ...(raw.uploader?.name ? { name: String(raw.uploader.name) } : {}),
    },
    owner: {
      accountId: String(raw.owner?.accountId ?? raw.uploader?.employeeId ?? ""),
      ...(raw.owner?.name || raw.uploader?.name
        ? { name: String(raw.owner?.name ?? raw.uploader?.name) }
        : {}),
    },
    publishedAt: String(raw.publishedAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    latestVersion: String(raw.latestVersion ?? ""),
    ...(typeof raw.contentChecksum === "string" && raw.contentChecksum.trim()
      ? { contentChecksum: raw.contentChecksum.trim() }
      : {}),
    hidden: Boolean(raw.hidden),
    flags: {
      hasHiddenFiles: Boolean(raw.flags?.hasHiddenFiles),
      hasExecutableFiles: Boolean(raw.flags?.hasExecutableFiles),
    },
    stats: {
      installCount:
        typeof raw.stats?.installCount === "number" && Number.isFinite(raw.stats.installCount)
          ? Math.max(0, Math.floor(raw.stats.installCount))
          : 0,
      installerCount:
        typeof raw.stats?.installerCount === "number" && Number.isFinite(raw.stats.installerCount)
          ? Math.max(0, Math.floor(raw.stats.installerCount))
          : 0,
    },
    presentation: {
      examplePrompts: sanitizeExamplePrompts(raw.presentation?.examplePrompts),
    },
    engagement: {
      likeCount:
        typeof raw.engagement?.likeCount === "number" && Number.isFinite(raw.engagement.likeCount)
          ? Math.max(0, Math.floor(raw.engagement.likeCount))
          : 0,
    },
    versions: Array.isArray(raw.versions) ? raw.versions : [],
  };
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fsp.readFile(filePath, "utf8");
    return safeParseJson<T>(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tempPath, filePath);
}

async function appendEventLog(filename: string, value: Record<string, unknown>) {
  await ensureDir(EVENTS_ROOT);
  await fsp.appendFile(path.join(EVENTS_ROOT, filename), `${JSON.stringify(value)}\n`, "utf8");
}

function appendSkillOwnershipEvent(params: {
  slug: string;
  actorAccountId: string;
  eventType: string;
  payload?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO skill_events (id, skill_id, account_id, event_type, payload_json, created_at)
     VALUES (@id, @skill_id, @account_id, @event_type, @payload_json, @created_at)`,
  ).run({
    id: randomUUID(),
    skill_id: params.slug,
    account_id: params.actorAccountId,
    event_type: params.eventType,
    payload_json: params.payload ? JSON.stringify(params.payload) : null,
    created_at: new Date().toISOString(),
  });
}

function toSlug(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\p{ASCII}]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `skill-${createHash("sha256").update(value).digest("hex").slice(0, 8)}`;
}

function parseSemver(value: string): [number, number, number] | null {
  const match = value.trim().match(SEMVER_RE);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) {
    return left.localeCompare(right);
  }
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

function incrementPatch(version: string): string {
  const parsed = parseSemver(version);
  if (!parsed) {
    return "1.0.0";
  }
  return `${parsed[0]}.${parsed[1]}.${parsed[2] + 1}`;
}

function chooseNextVersion(existing: SkillHubMetadata | null): string {
  if (!existing) {
    return "1.0.0";
  }
  return incrementPatch(existing.latestVersion);
}

async function readSkillHubMetadata(slug: string): Promise<SkillHubMetadata | null> {
  const filePath = resolveSkillHubMetadataPath(slug);
  const value = await readJsonFile<Record<string, unknown> | null>(filePath, null);
  if (!value || value.slug !== slug) {
    return null;
  }
  return normalizeSkillHubMetadata(value);
}

async function listSkillHubMetadata(): Promise<SkillHubMetadata[]> {
  await ensureSkillHubDirs();
  let names: string[] = [];
  try {
    names = (await fsp.readdir(METADATA_ROOT)).filter((entry) => entry.endsWith(".json"));
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names.map(async (entry) => {
      const value = await readJsonFile<Record<string, unknown> | null>(
        path.join(METADATA_ROOT, entry),
        null,
      );
      return value ? normalizeSkillHubMetadata(value) : null;
    }),
  );
  return entries
    .filter((entry): entry is SkillHubMetadata => Boolean(entry))
    .toSorted((a, b) => a.displayName.localeCompare(b.displayName));
}

async function readWorkspaceInstallState(workspaceDir: string): Promise<SkillHubInstallState> {
  return await readJsonFile(resolveWorkspaceInstallStatePath(workspaceDir), {
    skills: {},
  });
}

async function writeWorkspaceInstallState(workspaceDir: string, state: SkillHubInstallState) {
  await writeJsonFile(resolveWorkspaceInstallStatePath(workspaceDir), state);
}

async function writeSkillHubMetadata(metadata: SkillHubMetadata) {
  const normalized = normalizeSkillHubMetadata(metadata);
  await writeJsonFile(resolveSkillHubMetadataPath(normalized.slug), normalized);
  await refreshSkillHubAggregates();
}

async function refreshSkillHubAggregates() {
  await writeJsonFile(
    path.join(AGGREGATES_ROOT, "stats.json"),
    Object.fromEntries(
      (await listSkillHubMetadata()).map((entry) => [
        entry.slug,
        {
          installCount: entry.stats.installCount,
          installerCount: entry.stats.installerCount,
          likeCount: entry.engagement.likeCount,
          latestVersion: entry.latestVersion,
          hidden: entry.hidden,
        },
      ]),
    ),
  );
}

function isInsideDir(rootDir: string, candidatePath: string): boolean {
  const relative = path.relative(rootDir, candidatePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function removeDirIfExists(targetPath: string) {
  await fsp.rm(targetPath, { recursive: true, force: true });
}

async function scanSkillTree(rootDir: string): Promise<SkillHubWarningFlags> {
  const flags: SkillHubWarningFlags = {
    hasHiddenFiles: false,
    hasExecutableFiles: false,
  };
  async function walk(currentDir: string): Promise<void> {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldIgnoreChecksumEntry(entry.name, entry.isDirectory())) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.name.startsWith(".")) {
        flags.hasHiddenFiles = true;
      }
      if (entry.isSymbolicLink()) {
        throw new Error(`symlinks are not allowed in skill packages (${entry.name})`);
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      try {
        const stat = await fsp.stat(fullPath);
        if ((stat.mode & 0o111) !== 0) {
          flags.hasExecutableFiles = true;
        }
      } catch {
        // ignore stat failures on optional files
      }
    }
  }
  await walk(rootDir);
  return flags;
}

function trimSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.slice(0, 220);
}

function summaryFromEntry(entry: SkillEntry): string {
  return trimSummary(entry.skill.description);
}

function updateHashWithLength(hash: ReturnType<typeof createHash>, value: Buffer | string) {
  const buffer = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(buffer.length));
  hash.update(length);
  hash.update(buffer);
}

function shouldIgnoreChecksumEntry(name: string, isDirectory: boolean): boolean {
  if (isDirectory) {
    return CHECKSUM_IGNORED_DIRECTORY_NAMES.has(name);
  }
  return CHECKSUM_IGNORED_FILE_NAMES.has(name) || name.endsWith(".log");
}

export async function computeSkillDirectoryChecksum(rootDir: string): Promise<string> {
  const files: Array<{ relativePath: string; absolutePath: string }> = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldIgnoreChecksumEntry(entry.name, entry.isDirectory())) {
        continue;
      }
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`symlinks are not allowed in skill packages (${entry.name})`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      files.push({
        relativePath: path.relative(rootDir, absolutePath).split(path.sep).join("/"),
        absolutePath,
      });
    }
  }

  await walk(rootDir);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const hash = createHash("sha256");
  for (const file of files) {
    const content = await fsp.readFile(file.absolutePath);
    updateHashWithLength(hash, file.relativePath);
    updateHashWithLength(hash, content);
  }
  return hash.digest("hex");
}

function flagsEqual(left: SkillHubWarningFlags, right: SkillHubWarningFlags): boolean {
  return (
    left.hasHiddenFiles === right.hasHiddenFiles &&
    left.hasExecutableFiles === right.hasExecutableFiles
  );
}

function workspacePublishPresentation(state: WorkspacePublishState, reason?: string) {
  switch (state) {
    case "new_local_skill":
      return {
        actionLabel: "발행",
        disabled: false,
        reason: reason ?? "허브에 새 스킬로 등록됩니다.",
      };
    case "update_available_from_local":
      return {
        actionLabel: "업데이트 업로드",
        disabled: false,
        reason: reason ?? "허브의 기존 스킬을 현재 로컬 내용으로 업데이트합니다.",
      };
    case "up_to_date":
      return {
        actionLabel: "최신 상태",
        disabled: true,
        reason: reason ?? "허브와 로컬 내용이 동일합니다.",
      };
    case "existing_skill_non_owner":
      return {
        actionLabel: "발행 불가",
        disabled: true,
        reason:
          reason ??
          "이 스킬은 다른 사용자가 발행한 Hub 스킬입니다. 원본 업데이트는 owner만 가능합니다.",
      };
    case "conflict_or_unknown":
      return {
        actionLabel: "확인 필요",
        disabled: true,
        reason: reason ?? "스킬 identity 또는 owner 정보를 확인할 수 없습니다.",
      };
  }
}

export function resolveWorkspacePublishState(params: {
  displayName: string;
  actor: SkillHubActor;
  existing: SkillHubMetadata | null;
  localChecksum: string;
  localFlags: SkillHubWarningFlags;
}): Pick<WorkspacePublishEntry, "state" | "actionLabel" | "disabled" | "reason"> {
  const slug = toSlug(params.displayName);
  if (!params.existing) {
    return {
      state: "new_local_skill",
      ...workspacePublishPresentation("new_local_skill"),
    };
  }
  if (params.existing.slug !== slug || params.existing.displayName !== params.displayName) {
    return {
      state: "conflict_or_unknown",
      ...workspacePublishPresentation(
        "conflict_or_unknown",
        "동일한 slug를 사용하는 다른 스킬이 있어 발행할 수 없습니다.",
      ),
    };
  }
  if (!params.existing.owner.accountId) {
    return {
      state: "conflict_or_unknown",
      ...workspacePublishPresentation(
        "conflict_or_unknown",
        "기존 Hub 스킬의 owner 정보를 확인할 수 없습니다.",
      ),
    };
  }
  if (params.existing.owner.accountId !== params.actor.employeeId) {
    return {
      state: "existing_skill_non_owner",
      ...workspacePublishPresentation("existing_skill_non_owner"),
    };
  }
  if (
    params.existing.contentChecksum &&
    params.existing.contentChecksum === params.localChecksum &&
    flagsEqual(params.existing.flags, params.localFlags)
  ) {
    return {
      state: "up_to_date",
      ...workspacePublishPresentation("up_to_date"),
    };
  }
  return {
    state: "update_available_from_local",
    ...workspacePublishPresentation(
      "update_available_from_local",
      params.existing.contentChecksum
        ? undefined
        : "기존 Hub 스킬에 checksum이 없어 업데이트 후 최신 상태 판정이 가능해집니다.",
    ),
  };
}

async function prepareWorkspacePublishSkill(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  skillName: string;
  examplePrompts?: string[];
}): Promise<PublishPreparedSkill> {
  const entries = loadWorkspaceSkillEntries(params.workspaceDir, {
    config: params.config,
  });
  const match = entries.find((entry) => {
    const source = resolveSkillSource(entry.skill);
    return source === "openclaw-workspace" && entry.skill.name === params.skillName;
  });
  if (!match) {
    throw new Error(`workspace skill not found: ${params.skillName}`);
  }
  const flags = await scanSkillTree(match.skill.baseDir);
  return {
    displayName: match.skill.name,
    summary: summaryFromEntry(match),
    sourceDir: match.skill.baseDir,
    contentChecksum: await computeSkillDirectoryChecksum(match.skill.baseDir),
    flags,
    examplePrompts: sanitizeExamplePrompts(params.examplePrompts),
  };
}

async function detectSingleExtractedSkillDir(extractedRoot: string): Promise<string> {
  const entries = await fsp.readdir(extractedRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (dirs.length !== 1) {
    throw new Error("skill package must contain exactly one top-level folder");
  }
  const skillDir = path.join(extractedRoot, dirs[0].name);
  try {
    await fsp.access(path.join(skillDir, "SKILL.md"));
  } catch {
    throw new Error("skill package top-level folder must contain SKILL.md");
  }
  return skillDir;
}

async function prepareUploadedSkill(params: {
  filename: string;
  contentBase64: string;
  examplePrompts?: string[];
}): Promise<PublishPreparedSkill> {
  await ensureSkillHubDirs();
  const lower = params.filename.trim().toLowerCase();
  if (!lower.endsWith(".skill")) {
    throw new Error("only .skill packages are supported");
  }
  const stagingId = randomUUID();
  const archivePath = path.join(STAGING_ROOT, `${stagingId}.skill`);
  const extractDir = path.join(STAGING_ROOT, `${stagingId}.dir`);
  await fsp.writeFile(archivePath, Buffer.from(params.contentBase64, "base64"));
  await ensureDir(extractDir);
  const extracted = await extractArchive({
    archivePath,
    archiveType: "zip",
    targetDir: extractDir,
    timeoutMs: 120_000,
  });
  if (extracted.code !== 0) {
    throw new Error(extracted.stderr || "failed to extract .skill package");
  }
  const skillDir = await detectSingleExtractedSkillDir(extractDir);
  try {
    const loaded = loadSkillsFromDirSafe({
      dir: skillDir,
      source: "openclaw-workspace",
    }).skills;
    const match = loaded.find((skill) => path.resolve(skill.baseDir) === path.resolve(skillDir));
    if (!match) {
      throw new Error("could not read skill metadata from uploaded package");
    }
    const flags = await scanSkillTree(skillDir);
    return {
      displayName: match.name,
      summary: trimSummary(match.description),
      sourceDir: skillDir,
      contentChecksum: await computeSkillDirectoryChecksum(skillDir),
      flags,
      examplePrompts: sanitizeExamplePrompts(params.examplePrompts),
      cleanupDir: extractDir,
    };
  } finally {
    await removeDirIfExists(archivePath);
  }
}

async function copySkillDirectory(sourceDir: string, destinationDir: string) {
  await ensureDir(path.dirname(destinationDir));
  await removeDirIfExists(destinationDir);
  await fsp.cp(sourceDir, destinationDir, {
    recursive: true,
    errorOnExist: false,
    force: true,
    preserveTimestamps: true,
  });
}

type PublishPreparedSkillResult = {
  slug: string;
  version: string;
  created: boolean;
  noOp: boolean;
};

async function publishPreparedSkillUnlocked(params: {
  actor: SkillHubActor;
  prepared: PublishPreparedSkill;
  intent?: SkillHubPublishIntent;
  expectedSlug?: string;
  expectedLocalChecksum?: string;
  expectedHubChecksum?: string | null;
}): Promise<PublishPreparedSkillResult> {
  await ensureSkillHubDirs();
  const slug = toSlug(params.prepared.displayName);
  if (params.expectedSlug && params.expectedSlug !== slug) {
    throw new Error("스킬 identity가 변경되었습니다. 목록을 새로고침한 후 다시 시도해주세요.");
  }
  if (
    params.expectedLocalChecksum &&
    params.expectedLocalChecksum !== params.prepared.contentChecksum
  ) {
    throw new Error("로컬 스킬 내용이 변경되었습니다. 목록을 새로고침한 후 다시 시도해주세요.");
  }
  const existing = await readSkillHubMetadata(slug);
  if (params.intent === "create" && existing) {
    throw new Error("이미 같은 identity의 Hub 스킬이 있습니다. 목록을 새로고침해주세요.");
  }
  if (params.intent === "update" && !existing) {
    throw new Error("업데이트할 Hub 스킬을 찾을 수 없습니다. 목록을 새로고침해주세요.");
  }
  if (existing && existing.displayName !== params.prepared.displayName) {
    throw new Error(`slug conflict for ${params.prepared.displayName}`);
  }
  if (existing && existing.owner.accountId !== params.actor.employeeId) {
    throw new Error("only the current skill owner can publish a new version of this skill");
  }
  if (params.expectedHubChecksum !== undefined) {
    const currentHubChecksum = existing?.contentChecksum ?? null;
    if (currentHubChecksum !== params.expectedHubChecksum) {
      throw new Error("Hub 스킬이 변경되었습니다. 목록을 새로고침한 후 다시 시도해주세요.");
    }
  }
  if (
    existing?.contentChecksum === params.prepared.contentChecksum &&
    flagsEqual(existing.flags, params.prepared.flags)
  ) {
    return {
      slug,
      version: existing.latestVersion,
      created: false,
      noOp: true,
    };
  }
  const version = chooseNextVersion(existing);
  const versionDir = resolveSkillHubVersionDir(slug, version);
  await copySkillDirectory(params.prepared.sourceDir, versionDir);
  const nowIso = new Date().toISOString();
  const metadata: SkillHubMetadata = existing
    ? {
        ...existing,
        summary: params.prepared.summary,
        updatedAt: nowIso,
        latestVersion: version,
        contentChecksum: params.prepared.contentChecksum,
        flags: params.prepared.flags,
        hidden: false,
        versions: [
          ...existing.versions,
          {
            version,
            uploadedBy: {
              employeeId: params.actor.employeeId,
              ...(params.actor.name?.trim() ? { name: params.actor.name.trim() } : {}),
            },
            uploadedAt: nowIso,
            path: path.relative(SKILL_HUB_ROOT, versionDir).replace(/\\/g, "/"),
          },
        ],
      }
    : {
        slug,
        displayName: params.prepared.displayName,
        summary: params.prepared.summary,
        uploader: {
          employeeId: params.actor.employeeId,
          ...(params.actor.name?.trim() ? { name: params.actor.name.trim() } : {}),
        },
        owner: {
          accountId: params.actor.employeeId,
          ...(params.actor.name?.trim() ? { name: params.actor.name.trim() } : {}),
        },
        publishedAt: nowIso,
        updatedAt: nowIso,
        latestVersion: version,
        contentChecksum: params.prepared.contentChecksum,
        hidden: false,
        flags: params.prepared.flags,
        stats: {
          installCount: 0,
          installerCount: 0,
        },
        presentation: {
          examplePrompts: params.prepared.examplePrompts,
        },
        engagement: {
          likeCount: 0,
        },
        versions: [
          {
            version,
            uploadedBy: {
              employeeId: params.actor.employeeId,
              ...(params.actor.name?.trim() ? { name: params.actor.name.trim() } : {}),
            },
            uploadedAt: nowIso,
            path: path.relative(SKILL_HUB_ROOT, versionDir).replace(/\\/g, "/"),
          },
        ],
      };
  if (existing) {
    metadata.presentation = {
      examplePrompts:
        params.prepared.examplePrompts.length > 0
          ? params.prepared.examplePrompts
          : existing.presentation.examplePrompts,
    };
    metadata.engagement = existing.engagement ?? { likeCount: 0 };
  }
  await writeSkillHubMetadata(metadata);
  await appendEventLog("uploads.ndjson", {
    ts: nowIso,
    slug,
    version,
    actor: params.actor,
    created: !existing,
    source: "skill-hub",
  });
  appendSkillOwnershipEvent({
    slug,
    actorAccountId: params.actor.employeeId,
    eventType: existing ? "skill.version.published" : "skill.created",
    payload: { version, created: !existing },
  });
  return {
    slug,
    version,
    created: !existing,
    noOp: false,
  };
}

async function publishPreparedSkill(params: {
  actor: SkillHubActor;
  prepared: PublishPreparedSkill;
  intent?: SkillHubPublishIntent;
  expectedSlug?: string;
  expectedLocalChecksum?: string;
  expectedHubChecksum?: string | null;
}): Promise<PublishPreparedSkillResult> {
  const slug = toSlug(params.prepared.displayName);
  const previous = publishQueues.get(slug) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  publishQueues.set(slug, queued);
  await previous;
  try {
    return await publishPreparedSkillUnlocked(params);
  } finally {
    release();
    if (publishQueues.get(slug) === queued) {
      publishQueues.delete(slug);
    }
  }
}

export async function publishWorkspaceSkillToHub(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  actor: SkillHubActor;
  skillName: string;
  examplePrompts?: string[];
  intent: SkillHubPublishIntent;
  expectedSlug?: string;
  expectedLocalChecksum: string;
  expectedHubChecksum?: string | null;
}) {
  const prepared = await prepareWorkspacePublishSkill({
    workspaceDir: params.workspaceDir,
    config: params.config,
    skillName: params.skillName,
    examplePrompts: params.examplePrompts,
  });
  return await publishPreparedSkill({
    actor: params.actor,
    prepared,
    intent: params.intent,
    expectedSlug: params.expectedSlug,
    expectedLocalChecksum: params.expectedLocalChecksum,
    expectedHubChecksum: params.expectedHubChecksum,
  });
}

export async function uploadSkillPackageToHub(params: {
  actor: SkillHubActor;
  filename: string;
  contentBase64: string;
  examplePrompts?: string[];
  expectedHubChecksum?: string | null;
}) {
  const prepared = await prepareUploadedSkill({
    filename: params.filename,
    contentBase64: params.contentBase64,
    examplePrompts: params.examplePrompts,
  });
  try {
    return await publishPreparedSkill({
      actor: params.actor,
      prepared,
      expectedHubChecksum: params.expectedHubChecksum,
    });
  } finally {
    if (prepared.cleanupDir) {
      await removeDirIfExists(prepared.cleanupDir);
    }
  }
}

async function readLikesState(slug: string): Promise<SkillHubLikesState> {
  await ensureSkillHubDirs();
  return await readJsonFile(resolveLikesStatePath(slug), { actors: {} });
}

async function writeLikesState(slug: string, state: SkillHubLikesState): Promise<void> {
  await writeJsonFile(resolveLikesStatePath(slug), state);
}

function hasActorLiked(state: SkillHubLikesState, actor: SkillHubActor): boolean {
  return Boolean(state.actors[actor.employeeId]);
}

async function recalculateLikeCount(slug: string): Promise<number> {
  const state = await readLikesState(slug);
  return Object.keys(state.actors).length;
}

async function mapMetadataToListEntry(params: {
  metadata: SkillHubMetadata;
  actor: SkillHubActor;
  installState: SkillHubInstallState;
}): Promise<SkillHubListEntry> {
  const installed = params.installState.skills[params.metadata.slug];
  const likesState = await readLikesState(params.metadata.slug);
  const actorIsOwner = params.metadata.owner.accountId === params.actor.employeeId;
  const actorIsAdmin = params.actor.globalRole === "admin";
  return {
    slug: params.metadata.slug,
    displayName: params.metadata.displayName,
    summary: params.metadata.summary,
    uploaderName:
      params.metadata.owner.name ??
      params.metadata.uploader.name ??
      params.metadata.owner.accountId,
    uploaderEmployeeId: params.metadata.owner.accountId,
    ownerAccountId: params.metadata.owner.accountId,
    latestVersion: params.metadata.latestVersion,
    publishedAt: params.metadata.publishedAt,
    updatedAt: params.metadata.updatedAt,
    installCount: params.metadata.stats.installCount,
    installerCount: params.metadata.stats.installerCount,
    likeCount: params.metadata.engagement.likeCount,
    hidden: params.metadata.hidden,
    uploadedByYou: actorIsOwner,
    likedByYou: hasActorLiked(likesState, params.actor),
    installed: Boolean(installed),
    canEditMetadata: actorIsOwner || actorIsAdmin,
    canManageVisibility: actorIsOwner || actorIsAdmin,
    canAdminManage: actorIsAdmin,
    canTransferOwnership: actorIsOwner || actorIsAdmin,
    ...(installed ? { installedVersion: installed.installedVersion } : {}),
    updateAvailable: Boolean(
      installed && compareSemver(params.metadata.latestVersion, installed.installedVersion) > 0,
    ),
    flags: params.metadata.flags,
  };
}

export async function listSkillHubEntries(params: {
  workspaceDir: string;
  actor: SkillHubActor;
  query?: string;
  scope?: SkillHubListScope;
  sort?: SkillHubSort;
}): Promise<SkillHubListEntry[]> {
  const all = await listSkillHubMetadata();
  const installState = await readWorkspaceInstallState(params.workspaceDir);
  const query = params.query?.trim().toLowerCase() ?? "";
  const entries = (
    await Promise.all(
      all.map((metadata) =>
        mapMetadataToListEntry({ metadata, actor: params.actor, installState }),
      ),
    )
  )
    .filter((entry) => {
      if (!query) {
        return true;
      }
      return [entry.displayName, entry.summary, entry.slug].join(" ").toLowerCase().includes(query);
    })
    .filter((entry) => {
      switch (params.scope) {
        case "installed":
          return entry.installed;
        case "uploads":
          return entry.uploadedByYou;
        case "updates":
          return entry.installed && entry.updateAvailable;
        case "discover":
        default:
          return !entry.hidden || entry.installed || entry.uploadedByYou;
      }
    })
    .filter((entry) => {
      if (params.scope === "uploads") {
        return true;
      }
      return !entry.hidden || entry.installed || entry.uploadedByYou;
    });
  const sort = params.sort ?? "recent";
  return entries.toSorted((a, b) => {
    const pinned = Number(b.uploadedByYou) - Number(a.uploadedByYou);
    if (pinned !== 0 && sort !== "az") {
      return pinned;
    }
    switch (sort) {
      case "installs":
        if (b.installCount !== a.installCount) {
          return b.installCount - a.installCount;
        }
        break;
      case "likes":
        if (b.likeCount !== a.likeCount) {
          return b.likeCount - a.likeCount;
        }
        break;
      case "az":
        return a.displayName.localeCompare(b.displayName);
      case "recent":
      default:
        if (b.updatedAt !== a.updatedAt) {
          return b.updatedAt.localeCompare(a.updatedAt);
        }
        break;
    }
    return a.displayName.localeCompare(b.displayName);
  });
}

export async function listWorkspacePublishEntries(params: {
  workspaceDir: string;
  actor: SkillHubActor;
  config?: OpenClawConfig;
}): Promise<WorkspacePublishEntry[]> {
  const entries = loadWorkspaceSkillEntries(params.workspaceDir, {
    config: params.config,
  }).filter((entry) => resolveSkillSource(entry.skill) === "openclaw-workspace");
  const metadata = await listSkillHubMetadata();
  const metadataBySlug = new Map(metadata.map((entry) => [entry.slug, entry]));
  const installState = await readWorkspaceInstallState(params.workspaceDir);

  return await Promise.all(
    entries.map(async (entry): Promise<WorkspacePublishEntry> => {
      const displayName = entry.skill.name;
      const skillKey = entry.metadata?.skillKey ?? displayName;
      const slug = toSlug(displayName);
      const existing = metadataBySlug.get(slug) ?? null;
      const installedFromHub = Object.values(installState.skills).some(
        (installed) =>
          installed.displayName === displayName ||
          path.resolve(installed.installedPath) === path.resolve(entry.skill.baseDir),
      );
      try {
        const flags = await scanSkillTree(entry.skill.baseDir);
        const localChecksum = await computeSkillDirectoryChecksum(entry.skill.baseDir);
        const presentation = resolveWorkspacePublishState({
          displayName,
          actor: params.actor,
          existing,
          localChecksum,
          localFlags: flags,
        });
        return {
          skillName: displayName,
          skillKey,
          description: entry.skill.description,
          ...(existing
            ? {
                matchedHubSlug: existing.slug,
                hubVersion: existing.latestVersion,
                ownerAccountId: existing.owner.accountId,
              }
            : {}),
          installedFromHub,
          localChecksum,
          ...(existing?.contentChecksum ? { hubChecksum: existing.contentChecksum } : {}),
          flags,
          ...presentation,
        };
      } catch (err) {
        const message = formatErrorMessage(err);
        const symlink = message.toLowerCase().includes("symlink");
        return {
          skillName: displayName,
          skillKey,
          description: entry.skill.description,
          ...(existing
            ? {
                matchedHubSlug: existing.slug,
                hubVersion: existing.latestVersion,
                ownerAccountId: existing.owner.accountId,
              }
            : {}),
          installedFromHub,
          state: "conflict_or_unknown",
          ...workspacePublishPresentation(
            "conflict_or_unknown",
            symlink
              ? "심볼릭 링크가 포함된 스킬은 발행할 수 없습니다."
              : `스킬 내용을 확인할 수 없습니다: ${message}`,
          ),
        };
      }
    }),
  );
}

export async function getSkillHubOverview(params: {
  workspaceDir: string;
  actor: SkillHubActor;
  config?: OpenClawConfig;
}): Promise<SkillHubOverview> {
  const [allMetadata, installState, localEntries] = await Promise.all([
    listSkillHubMetadata(),
    readWorkspaceInstallState(params.workspaceDir),
    Promise.resolve(
      loadWorkspaceSkillEntries(params.workspaceDir, { config: params.config }).filter(
        (entry) => resolveSkillSource(entry.skill) === "openclaw-workspace",
      ),
    ),
  ]);
  const installedEntries = await Promise.all(
    allMetadata.map((metadata) =>
      mapMetadataToListEntry({ metadata, actor: params.actor, installState }),
    ),
  );
  return {
    sharedSkillCount: allMetadata.filter((entry) => !entry.hidden).length,
    updateAvailableCount: installedEntries.filter((entry) => entry.updateAvailable).length,
    localSkillCount: localEntries.length,
    installedSkillCount: Object.keys(installState.skills).length,
    recentUpdates: allMetadata
      .filter((entry) => !entry.hidden || entry.owner.accountId === params.actor.employeeId)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 5)
      .map((entry) => ({
        slug: entry.slug,
        displayName: entry.displayName,
        latestVersion: entry.latestVersion,
        updatedAt: entry.updatedAt,
      })),
  };
}

export async function getSkillHubDetail(params: {
  workspaceDir: string;
  actor: SkillHubActor;
  slug: string;
}): Promise<SkillHubDetail | null> {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    return null;
  }
  const installState = await readWorkspaceInstallState(params.workspaceDir);
  return {
    ...(await mapMetadataToListEntry({ metadata, actor: params.actor, installState })),
    examplePrompts: metadata.presentation.examplePrompts,
    versions: metadata.versions.slice().toSorted((a, b) => compareSemver(b.version, a.version)),
  };
}

async function recalculateInstallerCount(slug: string): Promise<number> {
  let count = 0;
  const stateDir = CONFIG_DIR;
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.name !== WORKSPACE_INSTALL_STATE_FILE) {
        continue;
      }
      const state = await readJsonFile(fullPath, { skills: {} });
      if (state.skills[slug]) {
        count += 1;
      }
    }
  }
  await walk(stateDir);
  return count;
}

async function detachHubInstallReferences(slug: string): Promise<void> {
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[] = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.name !== WORKSPACE_INSTALL_STATE_FILE) {
        continue;
      }
      const state = await readJsonFile(fullPath, { skills: {} });
      if (!state.skills[slug]) {
        continue;
      }
      delete state.skills[slug];
      await writeJsonFile(fullPath, state);
    }
  }
  await walk(CONFIG_DIR);
}

async function installSkillHubVersionToWorkspace(params: {
  workspaceDir: string;
  actor: SkillHubActor;
  slug: string;
  version: string;
}) {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  if (metadata.hidden) {
    const current = await readWorkspaceInstallState(params.workspaceDir);
    if (!current.skills[params.slug]) {
      throw new Error("skill is hidden and cannot be newly installed");
    }
  }
  const versionDir = resolveSkillHubVersionDir(params.slug, params.version);
  const destinationDir = path.join(params.workspaceDir, "skills", params.slug);
  await copySkillDirectory(versionDir, destinationDir);
  const state = await readWorkspaceInstallState(params.workspaceDir);
  const nowIso = new Date().toISOString();
  state.skills[params.slug] = {
    slug: params.slug,
    displayName: metadata.displayName,
    installedVersion: params.version,
    source: "hub",
    installedAt: state.skills[params.slug]?.installedAt ?? nowIso,
    updatedAt: nowIso,
    installedPath: destinationDir,
  };
  await writeWorkspaceInstallState(params.workspaceDir, state);
  metadata.stats.installCount += 1;
  metadata.stats.installerCount = await recalculateInstallerCount(params.slug);
  await writeSkillHubMetadata(metadata);
  bumpSkillsSnapshotVersion({
    workspaceDir: params.workspaceDir,
    reason: "manual",
    changedPath: path.join(destinationDir, "SKILL.md"),
  });
}

export async function installSkillFromHub(params: {
  workspaceDir: string;
  actor: SkillHubActor;
  slug: string;
}) {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  await installSkillHubVersionToWorkspace({
    workspaceDir: params.workspaceDir,
    actor: params.actor,
    slug: params.slug,
    version: metadata.latestVersion,
  });
  await appendEventLog("installs.ndjson", {
    ts: new Date().toISOString(),
    slug: params.slug,
    version: metadata.latestVersion,
    actor: params.actor,
    workspaceDir: params.workspaceDir,
  });
  return {
    slug: params.slug,
    version: metadata.latestVersion,
  };
}

export async function updateSkillFromHub(params: {
  workspaceDir: string;
  actor: SkillHubActor;
  slug: string;
}) {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  const state = await readWorkspaceInstallState(params.workspaceDir);
  if (!state.skills[params.slug]) {
    throw new Error("skill is not installed in this workspace");
  }
  if (compareSemver(metadata.latestVersion, state.skills[params.slug].installedVersion) <= 0) {
    return {
      slug: params.slug,
      version: state.skills[params.slug].installedVersion,
      updated: false,
    };
  }
  await installSkillHubVersionToWorkspace({
    workspaceDir: params.workspaceDir,
    actor: params.actor,
    slug: params.slug,
    version: metadata.latestVersion,
  });
  await appendEventLog("updates.ndjson", {
    ts: new Date().toISOString(),
    slug: params.slug,
    version: metadata.latestVersion,
    actor: params.actor,
    workspaceDir: params.workspaceDir,
  });
  return {
    slug: params.slug,
    version: metadata.latestVersion,
    updated: true,
  };
}

export async function deleteSkillFromHub(params: { slug: string; actor: SkillHubActor }) {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  const actorIsOwner = metadata.owner.accountId === params.actor.employeeId;
  const actorIsAdmin = params.actor.globalRole === "admin";
  if (!actorIsOwner && !actorIsAdmin) {
    throw new Error("only the skill owner or an admin can delete this skill from Skill Hub");
  }
  const nowIso = new Date().toISOString();
  await removeDirIfExists(resolveSkillHubMetadataPath(params.slug));
  await removeDirIfExists(path.join(REGISTRY_ROOT, params.slug));
  await removeDirIfExists(resolveLikesStatePath(params.slug));
  await detachHubInstallReferences(params.slug);
  await refreshSkillHubAggregates();
  await appendEventLog("hub-deletes.ndjson", {
    ts: nowIso,
    slug: params.slug,
    actor: params.actor,
    by: actorIsAdmin && !actorIsOwner ? "admin" : "owner",
  });
  appendSkillOwnershipEvent({
    slug: params.slug,
    actorAccountId: params.actor.employeeId,
    eventType: "skill.deleted.from_hub",
    payload: {
      by: actorIsAdmin && !actorIsOwner ? "admin" : "owner",
      previousOwnerAccountId: metadata.owner.accountId,
      previousUploaderEmployeeId: metadata.uploader.employeeId,
    },
  });
}

export async function toggleSkillHubLike(params: {
  slug: string;
  actor: SkillHubActor;
}): Promise<{ slug: string; liked: boolean; likeCount: number }> {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  const state = await readLikesState(params.slug);
  const actorId = params.actor.employeeId;
  let liked = false;
  if (state.actors[actorId]) {
    delete state.actors[actorId];
    liked = false;
  } else {
    state.actors[actorId] = { likedAt: new Date().toISOString() };
    liked = true;
  }
  await writeLikesState(params.slug, state);
  metadata.engagement.likeCount = await recalculateLikeCount(params.slug);
  await writeSkillHubMetadata(metadata);
  await appendEventLog("likes.ndjson", {
    ts: new Date().toISOString(),
    slug: params.slug,
    actor: params.actor,
    liked,
  });
  return {
    slug: params.slug,
    liked,
    likeCount: metadata.engagement.likeCount,
  };
}

export async function updateSkillHubExamplePrompts(params: {
  slug: string;
  actor: SkillHubActor;
  examplePrompts: string[];
}): Promise<{ slug: string; examplePrompts: string[] }> {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  const actorIsOwner = metadata.owner.accountId === params.actor.employeeId;
  const actorIsAdmin = params.actor.globalRole === "admin";
  if (!actorIsOwner && !actorIsAdmin) {
    throw new Error("only the skill owner or an admin can edit example prompts");
  }
  metadata.presentation.examplePrompts = sanitizeExamplePrompts(params.examplePrompts);
  metadata.updatedAt = new Date().toISOString();
  await writeSkillHubMetadata(metadata);
  await appendEventLog("example-prompts.ndjson", {
    ts: metadata.updatedAt,
    slug: params.slug,
    actor: params.actor,
    count: metadata.presentation.examplePrompts.length,
    by: actorIsAdmin && !actorIsOwner ? "admin" : "owner",
  });
  return {
    slug: params.slug,
    examplePrompts: metadata.presentation.examplePrompts,
  };
}

export async function updateSkillHubMetadata(params: {
  slug: string;
  actor: SkillHubActor;
  summary: string;
  examplePrompts: string[];
}): Promise<{ slug: string; summary: string; examplePrompts: string[] }> {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  const actorIsOwner = metadata.owner.accountId === params.actor.employeeId;
  const actorIsAdmin = params.actor.globalRole === "admin";
  if (!actorIsOwner && !actorIsAdmin) {
    throw new Error("only the skill owner or an admin can edit this skill");
  }
  metadata.summary = trimSummary(params.summary);
  metadata.presentation.examplePrompts = sanitizeExamplePrompts(params.examplePrompts);
  metadata.updatedAt = new Date().toISOString();
  await writeSkillHubMetadata(metadata);
  await appendEventLog("skill-metadata.ndjson", {
    ts: metadata.updatedAt,
    slug: params.slug,
    actor: params.actor,
    by: actorIsAdmin && !actorIsOwner ? "admin" : "owner",
  });
  appendSkillOwnershipEvent({
    slug: params.slug,
    actorAccountId: params.actor.employeeId,
    eventType: "skill.metadata.updated",
    payload: {
      by: actorIsAdmin && !actorIsOwner ? "admin" : "owner",
    },
  });
  return {
    slug: params.slug,
    summary: metadata.summary,
    examplePrompts: metadata.presentation.examplePrompts,
  };
}

export async function transferSkillHubOwnership(params: {
  slug: string;
  actor: SkillHubActor;
  targetAccountId: string;
  reason?: string | null;
}): Promise<{ slug: string; ownerAccountId: string; ownerName: string }> {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  const actorIsOwner = metadata.owner.accountId === params.actor.employeeId;
  const actorIsAdmin = params.actor.globalRole === "admin";
  if (!actorIsOwner && !actorIsAdmin) {
    throw new Error("only the current owner or an admin can transfer skill ownership");
  }
  const target = getAccountById(params.targetAccountId);
  if (!target || target.status !== "active") {
    throw new Error("target account not found");
  }
  if (actorIsAdmin && !actorIsOwner && !trimOrNull(params.reason)) {
    throw new Error("admins must provide a transfer reason");
  }
  const previousOwnerAccountId = metadata.owner.accountId;
  metadata.owner = {
    accountId: target.id,
    ...(resolveAccountDisplayName(target.id)
      ? { name: resolveAccountDisplayName(target.id)! }
      : {}),
  };
  metadata.updatedAt = new Date().toISOString();
  await writeSkillHubMetadata(metadata);
  await appendEventLog("ownership-transfers.ndjson", {
    ts: metadata.updatedAt,
    slug: params.slug,
    actor: params.actor,
    previousOwnerAccountId,
    nextOwnerAccountId: target.id,
    reason: trimOrNull(params.reason),
  });
  appendSkillOwnershipEvent({
    slug: params.slug,
    actorAccountId: params.actor.employeeId,
    eventType: "skill.ownership.transferred",
    payload: {
      previousOwnerAccountId,
      nextOwnerAccountId: target.id,
      reason: trimOrNull(params.reason),
    },
  });
  return {
    slug: params.slug,
    ownerAccountId: target.id,
    ownerName: resolveAccountDisplayName(target.id) ?? target.id,
  };
}

export async function deleteSkillFromWorkspace(params: {
  workspaceDir: string;
  skillKey: string;
  slug?: string;
  config?: OpenClawConfig;
}) {
  const state = await readWorkspaceInstallState(params.workspaceDir);
  const hubSlug = params.slug?.trim() || findManifestSlugBySkillKey(state, params.skillKey);
  if (hubSlug) {
    const installed = state.skills[hubSlug];
    if (!installed) {
      throw new Error("installed hub skill not found");
    }
    if (!isInsideDir(params.workspaceDir, installed.installedPath)) {
      throw new Error("refusing to delete skill path outside workspace");
    }
    await removeDirIfExists(installed.installedPath);
    delete state.skills[hubSlug];
    await writeWorkspaceInstallState(params.workspaceDir, state);
    const metadata = await readSkillHubMetadata(hubSlug);
    if (metadata) {
      metadata.stats.installerCount = await recalculateInstallerCount(hubSlug);
      await writeSkillHubMetadata(metadata);
    }
    await appendEventLog("deletes.ndjson", {
      ts: new Date().toISOString(),
      slug: hubSlug,
      workspaceDir: params.workspaceDir,
      source: "hub",
    });
    bumpSkillsSnapshotVersion({
      workspaceDir: params.workspaceDir,
      reason: "manual",
      changedPath: path.join(installed.installedPath, "SKILL.md"),
    });
    return { kind: "hub" as const, slug: hubSlug };
  }

  const entries = loadWorkspaceSkillEntries(params.workspaceDir, {
    config: params.config,
  });
  const local = entries.find((entry) => {
    const source = resolveSkillSource(entry.skill);
    return (
      source === "openclaw-workspace" &&
      (entry.skill.name === params.skillKey || entry.metadata?.skillKey === params.skillKey)
    );
  });
  if (!local) {
    throw new Error(`workspace skill not found: ${params.skillKey}`);
  }
  if (!isInsideDir(path.join(params.workspaceDir, "skills"), local.skill.baseDir)) {
    throw new Error("refusing to delete workspace skill outside workspace/skills");
  }
  await removeDirIfExists(local.skill.baseDir);
  await appendEventLog("deletes.ndjson", {
    ts: new Date().toISOString(),
    skillKey: params.skillKey,
    workspaceDir: params.workspaceDir,
    source: "workspace",
  });
  bumpSkillsSnapshotVersion({
    workspaceDir: params.workspaceDir,
    reason: "manual",
    changedPath: path.join(local.skill.baseDir, "SKILL.md"),
  });
  return { kind: "workspace" as const, skillKey: params.skillKey };
}

function findManifestSlugBySkillKey(
  state: SkillHubInstallState,
  skillKey: string,
): string | undefined {
  return Object.entries(state.skills).find(([, value]) => value.displayName === skillKey)?.[0];
}

export function resolveSkillHubActor(params: {
  employee?: { employeeId?: string; name?: string | null } | null;
  fallbackAgentId: string;
}): SkillHubActor {
  const employeeId = params.employee?.employeeId?.trim() || params.fallbackAgentId;
  const account = getAccountById(employeeId);
  return {
    employeeId,
    name: params.employee?.name?.trim() || undefined,
    globalRole: account?.globalRole,
  };
}

export function readInstalledSkillHubStateSync(workspaceDir: string): SkillHubInstallState {
  try {
    const raw = fs.readFileSync(resolveWorkspaceInstallStatePath(workspaceDir), "utf8");
    return safeParseJson<SkillHubInstallState>(raw) ?? { skills: {} };
  } catch {
    return { skills: {} };
  }
}

export function resolveInstalledHubVersionForSkill(params: {
  workspaceDir: string;
  skillName: string;
  baseDir: string;
}): SkillHubInstallStateEntry | null {
  const state = readInstalledSkillHubStateSync(params.workspaceDir);
  for (const value of Object.values(state.skills)) {
    if (
      value.displayName === params.skillName ||
      path.resolve(value.installedPath) === path.resolve(params.baseDir)
    ) {
      return value;
    }
  }
  return null;
}

export async function tryResolveLatestHubVersion(slug: string): Promise<string | null> {
  return (await readSkillHubMetadata(slug))?.latestVersion ?? null;
}

export function readSkillHubMetadataSync(slug: string): SkillHubMetadata | null {
  try {
    const raw = fs.readFileSync(resolveSkillHubMetadataPath(slug), "utf8");
    const parsed = safeParseJson<Record<string, unknown>>(raw);
    return parsed?.slug === slug ? normalizeSkillHubMetadata(parsed) : null;
  } catch {
    return null;
  }
}

export async function cleanupSkillUploadStaging() {
  try {
    const entries = await fsp.readdir(STAGING_ROOT);
    const cutoff = Date.now() - 60 * 60 * 1000;
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(STAGING_ROOT, entry);
        try {
          const stat = await fsp.stat(fullPath);
          if (stat.mtimeMs < cutoff) {
            await removeDirIfExists(fullPath);
          }
        } catch {
          // ignore cleanup errors
        }
      }),
    );
  } catch {
    // ignore missing staging dir
  }
}

export function formatSkillHubInstallMessage(slug: string): string {
  return `Skill installed: ${slug}`;
}

export function formatSkillHubUpdateMessage(slug: string, version: string): string {
  return `Skill updated: ${slug} -> v${version}`;
}

export function formatSkillHubDeleteMessage(slug: string): string {
  return `Skill deleted from workspace: ${slug}`;
}

export function formatHubPublishMessage(params: {
  slug: string;
  version: string;
  created: boolean;
  noOp?: boolean;
}): string {
  if (params.noOp) {
    return "이미 최신 상태입니다.";
  }
  if (params.created) {
    return `Published to Skill Hub: ${params.slug}`;
  }
  return `Updated in Skill Hub: ${params.slug} -> v${params.version}`;
}

export function formatSkillHubError(err: unknown): string {
  return formatErrorMessage(err);
}
