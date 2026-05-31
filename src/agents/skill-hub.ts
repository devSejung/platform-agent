import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractArchive } from "./skills-install-extract.js";
import {
  loadWorkspaceSkillEntries,
  type ParsedSkillFrontmatter,
  type SkillEntry,
} from "./skills.js";
import { bumpSkillsSnapshotVersion } from "./skills/refresh.js";
import { readSkillFrontmatterSafe } from "./skills/local-loader.js";
import { resolveSkillSource } from "./skills/source.js";
import type { OpenClawConfig } from "../config/config.js";
import { formatErrorMessage } from "../infra/errors.js";
import { safeParseJson } from "../utils.js";
import { CONFIG_DIR, ensureDir } from "../utils.js";

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

export type SkillHubActor = {
  employeeId: string;
  name?: string | null;
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
  publishedAt: string;
  updatedAt: string;
  latestVersion: string;
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
  installedVersion?: string;
  updateAvailable: boolean;
  flags: SkillHubWarningFlags;
};

export type SkillHubDetail = SkillHubListEntry & {
  examplePrompts: string[];
  versions: SkillHubVersionRecord[];
};

type PublishPreparedSkill = {
  displayName: string;
  summary: string;
  sourceDir: string;
  requestedVersion?: string;
  flags: SkillHubWarningFlags;
  examplePrompts: string[];
  cleanupDir?: string;
};

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

function normalizeSkillHubMetadata(value: SkillHubMetadata | Record<string, unknown>): SkillHubMetadata {
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
    publishedAt: String(raw.publishedAt ?? ""),
    updatedAt: String(raw.updatedAt ?? ""),
    latestVersion: String(raw.latestVersion ?? ""),
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

function toSlug(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return ascii || `skill-${randomUUID().slice(0, 8)}`;
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

function chooseNextVersion(existing: SkillHubMetadata | null, requestedVersion?: string): string {
  const requested = requestedVersion?.trim();
  if (!existing) {
    if (requested && parseSemver(requested)) {
      return requested;
    }
    return "1.0.0";
  }
  if (requested && parseSemver(requested) && compareSemver(requested, existing.latestVersion) > 0) {
    return requested;
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
      const value = await readJsonFile<Record<string, unknown> | null>(path.join(METADATA_ROOT, entry), null);
      return value ? normalizeSkillHubMetadata(value) : null;
    }),
  );
  return entries.filter((entry): entry is SkillHubMetadata => Boolean(entry)).toSorted((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
}

async function readWorkspaceInstallState(workspaceDir: string): Promise<SkillHubInstallState> {
  return await readJsonFile<SkillHubInstallState>(resolveWorkspaceInstallStatePath(workspaceDir), {
    skills: {},
  });
}

async function writeWorkspaceInstallState(workspaceDir: string, state: SkillHubInstallState) {
  await writeJsonFile(resolveWorkspaceInstallStatePath(workspaceDir), state);
}

async function writeSkillHubMetadata(metadata: SkillHubMetadata) {
  const normalized = normalizeSkillHubMetadata(metadata);
  await writeJsonFile(resolveSkillHubMetadataPath(normalized.slug), normalized);
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

function requestedVersionFromFrontmatter(frontmatter: ParsedSkillFrontmatter): string | undefined {
  const value = frontmatter.version?.trim();
  return value && parseSemver(value) ? value : undefined;
}

function summaryFromEntry(entry: SkillEntry): string {
  return trimSummary(entry.skill.description);
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
  const frontmatter =
    readSkillFrontmatterSafe({
      rootDir: match.skill.baseDir,
      filePath: match.skill.filePath,
    }) ?? {};
  return {
    displayName: match.skill.name,
    summary: summaryFromEntry(match),
    sourceDir: match.skill.baseDir,
    requestedVersion: requestedVersionFromFrontmatter(frontmatter),
    flags: await scanSkillTree(match.skill.baseDir),
    examplePrompts: sanitizeExamplePrompts(params.examplePrompts),
  };
}

async function detectSingleExtractedSkillDir(extractedRoot: string): Promise<string> {
  const entries = await fsp.readdir(extractedRoot, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (dirs.length !== 1) {
    throw new Error("skill package must contain exactly one top-level folder");
  }
  const skillDir = path.join(extractedRoot, dirs[0]!.name);
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
    const loaded = loadWorkspaceSkillEntries(extractDir, {});
    const match = loaded.find((entry) => path.resolve(entry.skill.baseDir) === path.resolve(skillDir));
    if (!match) {
      throw new Error("could not read skill metadata from uploaded package");
    }
    const frontmatter =
      readSkillFrontmatterSafe({
        rootDir: match.skill.baseDir,
        filePath: match.skill.filePath,
      }) ?? {};
    return {
      displayName: match.skill.name,
      summary: summaryFromEntry(match),
      sourceDir: skillDir,
      requestedVersion: requestedVersionFromFrontmatter(frontmatter),
      flags: await scanSkillTree(skillDir),
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

async function publishPreparedSkill(params: {
  actor: SkillHubActor;
  prepared: PublishPreparedSkill;
}): Promise<{ slug: string; version: string; created: boolean }> {
  await ensureSkillHubDirs();
  const slug = toSlug(params.prepared.displayName);
  const existing = await readSkillHubMetadata(slug);
  if (existing && existing.displayName !== params.prepared.displayName) {
    throw new Error(`slug conflict for ${params.prepared.displayName}`);
  }
  if (existing && existing.uploader.employeeId !== params.actor.employeeId) {
    throw new Error("only the original uploader can publish a new version of this skill");
  }
  const version = chooseNextVersion(existing, params.prepared.requestedVersion);
  const versionDir = resolveSkillHubVersionDir(slug, version);
  await copySkillDirectory(params.prepared.sourceDir, versionDir);
  const nowIso = new Date().toISOString();
  const metadata: SkillHubMetadata = existing
    ? {
        ...existing,
        summary: params.prepared.summary,
        updatedAt: nowIso,
        latestVersion: version,
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
        publishedAt: nowIso,
        updatedAt: nowIso,
        latestVersion: version,
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
  return {
    slug,
    version,
    created: !existing,
  };
}

export async function publishWorkspaceSkillToHub(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  actor: SkillHubActor;
  skillName: string;
  examplePrompts?: string[];
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
  });
}

export async function uploadSkillPackageToHub(params: {
  actor: SkillHubActor;
  filename: string;
  contentBase64: string;
  examplePrompts?: string[];
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
    });
  } finally {
    if (prepared.cleanupDir) {
      await removeDirIfExists(prepared.cleanupDir);
    }
  }
}

async function readLikesState(slug: string): Promise<SkillHubLikesState> {
  await ensureSkillHubDirs();
  return await readJsonFile<SkillHubLikesState>(resolveLikesStatePath(slug), { actors: {} });
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
  return {
    slug: params.metadata.slug,
    displayName: params.metadata.displayName,
    summary: params.metadata.summary,
    uploaderName: params.metadata.uploader.name ?? params.metadata.uploader.employeeId,
    uploaderEmployeeId: params.metadata.uploader.employeeId,
    latestVersion: params.metadata.latestVersion,
    publishedAt: params.metadata.publishedAt,
    updatedAt: params.metadata.updatedAt,
    installCount: params.metadata.stats.installCount,
    installerCount: params.metadata.stats.installerCount,
    likeCount: params.metadata.engagement.likeCount,
    hidden: params.metadata.hidden,
    uploadedByYou: params.metadata.uploader.employeeId === params.actor.employeeId,
    likedByYou: hasActorLiked(likesState, params.actor),
    installed: Boolean(installed),
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
  const entries = (await Promise.all(
    all.map((metadata) => mapMetadataToListEntry({ metadata, actor: params.actor, installState })),
  ))
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
        if (b.installCount !== a.installCount) {return b.installCount - a.installCount;}
        break;
      case "likes":
        if (b.likeCount !== a.likeCount) {return b.likeCount - a.likeCount;}
        break;
      case "az":
        return a.displayName.localeCompare(b.displayName);
      case "recent":
      default:
        if (b.updatedAt !== a.updatedAt) {return b.updatedAt.localeCompare(a.updatedAt);}
        break;
    }
    return a.displayName.localeCompare(b.displayName);
  });
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
      const state = await readJsonFile<SkillHubInstallState>(fullPath, { skills: {} });
      if (state.skills[slug]) {
        count += 1;
      }
    }
  }
  await walk(stateDir);
  return count;
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
  if (compareSemver(metadata.latestVersion, state.skills[params.slug]!.installedVersion) <= 0) {
    return {
      slug: params.slug,
      version: state.skills[params.slug]!.installedVersion,
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

export async function hideSkillFromHub(params: {
  slug: string;
  actor: SkillHubActor;
}) {
  const metadata = await readSkillHubMetadata(params.slug);
  if (!metadata) {
    throw new Error(`skill not found: ${params.slug}`);
  }
  if (metadata.uploader.employeeId !== params.actor.employeeId) {
    throw new Error("only the uploader can hide this skill");
  }
  metadata.hidden = true;
  metadata.updatedAt = new Date().toISOString();
  await writeSkillHubMetadata(metadata);
  await appendEventLog("hides.ndjson", {
    ts: metadata.updatedAt,
    slug: params.slug,
    actor: params.actor,
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
  if (metadata.uploader.employeeId !== params.actor.employeeId) {
    throw new Error("only the uploader can edit example prompts");
  }
  metadata.presentation.examplePrompts = sanitizeExamplePrompts(params.examplePrompts);
  metadata.updatedAt = new Date().toISOString();
  await writeSkillHubMetadata(metadata);
  await appendEventLog("example-prompts.ndjson", {
    ts: metadata.updatedAt,
    slug: params.slug,
    actor: params.actor,
    count: metadata.presentation.examplePrompts.length,
  });
  return {
    slug: params.slug,
    examplePrompts: metadata.presentation.examplePrompts,
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
    return source === "openclaw-workspace" && (entry.skill.name === params.skillKey || entry.metadata?.skillKey === params.skillKey);
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
  return {
    employeeId,
    name: params.employee?.name?.trim() || undefined,
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
    if (value.displayName === params.skillName || path.resolve(value.installedPath) === path.resolve(params.baseDir)) {
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
}): string {
  if (params.created) {
    return `Published to Skill Hub: ${params.slug}`;
  }
  return `Updated in Skill Hub: ${params.slug} -> v${params.version}`;
}

export function formatSkillHubError(err: unknown): string {
  return formatErrorMessage(err);
}
