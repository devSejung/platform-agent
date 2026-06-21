import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawPackageRootSync } from "./infra/openclaw-root.js";
import { normalizeOptionalString } from "./shared/string-coerce.js";
import { VERSION } from "./version.js";

const PLATFORMCLAW_RELEASE_DIR = path.join("docs", "platformclaw", "releases");
const PLATFORMCLAW_RELEASE_INDEX = "index.json";
const DEFAULT_PLATFORMCLAW_PRODUCT_NAME = "PlatformClaw";
const RELEASE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;

export type PlatformClawReleaseSummary = {
  version: string;
  date: string;
  title: string;
  path: string;
};

export type PlatformClawReleaseIndex = {
  name: string;
  latest: string;
  releases: PlatformClawReleaseSummary[];
};

export type PlatformClawReleaseInfo = {
  name: string;
  version: string;
  baseName: string;
  baseVersion: string;
  releaseNotesPath: string;
};

type RawReleaseSummary = Partial<Record<keyof PlatformClawReleaseSummary, unknown>>;
type RawReleaseIndex = {
  name?: unknown;
  latest?: unknown;
  releases?: unknown;
};

function findPackageRoot(): string | null {
  return resolveOpenClawPackageRootSync({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });
}

function normalizeReleasePath(value: unknown): string | null {
  const releasePath = normalizeOptionalString(value);
  if (!releasePath || !releasePath.startsWith(`${PLATFORMCLAW_RELEASE_DIR}/`)) {
    return null;
  }
  const normalized = path.posix.normalize(releasePath.replaceAll(path.sep, "/"));
  if (!normalized.startsWith(`${PLATFORMCLAW_RELEASE_DIR}/`) || !normalized.endsWith(".md")) {
    return null;
  }
  return normalized;
}

function normalizeReleaseSummary(raw: unknown): PlatformClawReleaseSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as RawReleaseSummary;
  const version = normalizeOptionalString(value.version);
  const date = normalizeOptionalString(value.date);
  const title = normalizeOptionalString(value.title);
  const releasePath = normalizeReleasePath(value.path);
  if (
    !version ||
    !RELEASE_VERSION_PATTERN.test(version) ||
    !date ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !title ||
    !releasePath
  ) {
    return null;
  }
  if (releasePath !== `${PLATFORMCLAW_RELEASE_DIR}/${version}.md`) {
    return null;
  }
  return { version, date, title, path: releasePath };
}

function parseReleaseIndex(raw: unknown): PlatformClawReleaseIndex | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as RawReleaseIndex;
  const name = normalizeOptionalString(value.name) ?? DEFAULT_PLATFORMCLAW_PRODUCT_NAME;
  const latest = normalizeOptionalString(value.latest);
  if (!latest || !RELEASE_VERSION_PATTERN.test(latest) || !Array.isArray(value.releases)) {
    return null;
  }
  const releases: PlatformClawReleaseSummary[] = [];
  const versions = new Set<string>();
  for (const candidate of value.releases) {
    const release = normalizeReleaseSummary(candidate);
    if (!release || versions.has(release.version)) {
      continue;
    }
    versions.add(release.version);
    releases.push(release);
  }
  if (!versions.has(latest)) {
    return null;
  }
  return { name, latest, releases };
}

export function readPlatformClawReleaseIndex(): PlatformClawReleaseIndex | null {
  const root = findPackageRoot();
  if (!root) {
    return null;
  }
  try {
    const raw = fs.readFileSync(
      path.join(root, PLATFORMCLAW_RELEASE_DIR, PLATFORMCLAW_RELEASE_INDEX),
      "utf8",
    );
    return parseReleaseIndex(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function resolvePlatformClawReleaseInfo(
  env: NodeJS.ProcessEnv = process.env,
): PlatformClawReleaseInfo {
  const index = readPlatformClawReleaseIndex();
  const latestRelease = index?.releases.find((release) => release.version === index.latest);
  return {
    name:
      normalizeOptionalString(env.PLATFORMCLAW_PRODUCT_NAME) ??
      index?.name ??
      DEFAULT_PLATFORMCLAW_PRODUCT_NAME,
    version: normalizeOptionalString(env.PLATFORMCLAW_VERSION) ?? index?.latest ?? VERSION,
    baseName: "OpenClaw",
    baseVersion: VERSION,
    releaseNotesPath:
      latestRelease?.path ?? path.join(PLATFORMCLAW_RELEASE_DIR, `${index?.latest ?? VERSION}.md`),
  };
}

export function readPlatformClawReleaseNotes(version?: string): string | null {
  const root = findPackageRoot();
  const index = readPlatformClawReleaseIndex();
  if (!root || !index) {
    return null;
  }
  const selectedVersion = normalizeOptionalString(version) ?? index.latest;
  const release = index.releases.find((entry) => entry.version === selectedVersion);
  if (!release) {
    return null;
  }
  const releasesRoot = path.resolve(root, PLATFORMCLAW_RELEASE_DIR);
  const releaseNotesPath = path.resolve(root, release.path);
  if (!releaseNotesPath.startsWith(`${releasesRoot}${path.sep}`)) {
    return null;
  }
  try {
    return fs.readFileSync(releaseNotesPath, "utf8");
  } catch {
    return null;
  }
}

export function readLatestPlatformClawReleaseNotes(): string | null {
  return readPlatformClawReleaseNotes();
}
