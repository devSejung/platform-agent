import fs from "node:fs";
import path from "node:path";
import { resolveOpenClawPackageRootSync } from "./infra/openclaw-root.js";
import { normalizeOptionalString } from "./shared/string-coerce.js";
import { VERSION } from "./version.js";

const PLATFORMCLAW_RELEASE_DIR = path.join("docs", "platformclaw", "releases");
const PLATFORMCLAW_RELEASE_INDEX = "latest.json";
const DEFAULT_PLATFORMCLAW_PRODUCT_NAME = "PlatformClaw";

export type PlatformClawReleaseInfo = {
  name: string;
  version: string;
  baseName: string;
  baseVersion: string;
  releaseNotesPath: string;
};

type RawPlatformClawReleaseInfo = Partial<PlatformClawReleaseInfo>;

function findPackageRoot(): string | null {
  return resolveOpenClawPackageRootSync({
    moduleUrl: import.meta.url,
    argv1: process.argv[1],
    cwd: process.cwd(),
  });
}

function readReleaseIndex(root: string | null): RawPlatformClawReleaseInfo | null {
  if (!root) {
    return null;
  }
  try {
    const raw = fs.readFileSync(
      path.join(root, PLATFORMCLAW_RELEASE_DIR, PLATFORMCLAW_RELEASE_INDEX),
      "utf8",
    );
    const parsed = JSON.parse(raw) as RawPlatformClawReleaseInfo;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveReleaseNotesPath(raw: RawPlatformClawReleaseInfo | null): string {
  const releaseNotesPath = normalizeOptionalString(raw?.releaseNotesPath);
  return releaseNotesPath && releaseNotesPath.startsWith(`${PLATFORMCLAW_RELEASE_DIR}/`)
    ? releaseNotesPath
    : path.join(PLATFORMCLAW_RELEASE_DIR, "latest.md");
}

export function resolvePlatformClawReleaseInfo(
  env: NodeJS.ProcessEnv = process.env,
): PlatformClawReleaseInfo {
  const root = findPackageRoot();
  const raw = readReleaseIndex(root);
  const baseVersion = normalizeOptionalString(raw?.baseVersion) ?? VERSION;
  return {
    name:
      normalizeOptionalString(env.PLATFORMCLAW_PRODUCT_NAME) ??
      normalizeOptionalString(raw?.name) ??
      DEFAULT_PLATFORMCLAW_PRODUCT_NAME,
    version:
      normalizeOptionalString(env.PLATFORMCLAW_VERSION) ??
      normalizeOptionalString(raw?.version) ??
      VERSION,
    baseName: normalizeOptionalString(raw?.baseName) ?? "OpenClaw",
    baseVersion,
    releaseNotesPath: resolveReleaseNotesPath(raw),
  };
}

export function readLatestPlatformClawReleaseNotes(): string | null {
  const root = findPackageRoot();
  if (!root) {
    return null;
  }
  const info = resolvePlatformClawReleaseInfo();
  const releaseNotesPath = path.resolve(root, info.releaseNotesPath);
  const releasesRoot = path.resolve(root, PLATFORMCLAW_RELEASE_DIR);
  if (
    !releaseNotesPath.startsWith(`${releasesRoot}${path.sep}`) &&
    releaseNotesPath !== releasesRoot
  ) {
    return null;
  }
  try {
    return fs.readFileSync(releaseNotesPath, "utf8");
  } catch {
    return null;
  }
}
