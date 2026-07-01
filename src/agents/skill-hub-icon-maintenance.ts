import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  getSkillHubIconAssetsRoot,
  isSkillHubIconAssetId,
  withSkillHubIconAssetsLock,
} from "./skill-hub-icon-assets.js";

const fsp = fs.promises;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SkillHubIconAssetIssue = {
  filename: string;
  reason: "invalid_filename" | "hash_mismatch" | "invalid_png";
  assetId?: string;
};

export type SkillHubIconOrphan = {
  assetId: string;
  filename: string;
  modifiedAt: string;
  ageMs: number;
  sizeBytes: number;
};

export type SkillHubIconAuditResult = {
  referencedAssetIds: string[];
  invalidReferencedAssetIds: string[];
  assetCount: number;
  orphanAssets: SkillHubIconOrphan[];
  missingAssetIds: string[];
  issues: SkillHubIconAssetIssue[];
};

export type SkillHubIconGcResult = SkillHubIconAuditResult & {
  dryRun: boolean;
  graceDays: number;
  deleteCandidates: SkillHubIconOrphan[];
  deletedAssetIds: string[];
};

async function isValidPng(data: Buffer): Promise<boolean> {
  try {
    const metadata = await sharp(data, { failOn: "error" }).metadata();
    return metadata.format === "png" && Boolean(metadata.width && metadata.height);
  } catch {
    return false;
  }
}

export async function auditSkillHubIconAssets(params: {
  referencedAssetIds: Iterable<string>;
  rootDir?: string;
  nowMs?: number;
}): Promise<SkillHubIconAuditResult> {
  const rootDir = params.rootDir ?? getSkillHubIconAssetsRoot();
  const nowMs = params.nowMs ?? Date.now();
  const rawReferencedAssetIds = [...new Set(params.referencedAssetIds)];
  const referencedAssetIds = rawReferencedAssetIds.filter(isSkillHubIconAssetId).toSorted();
  const invalidReferencedAssetIds = rawReferencedAssetIds
    .filter((assetId) => !isSkillHubIconAssetId(assetId))
    .map((assetId) => String(assetId))
    .toSorted((left, right) => left.localeCompare(right));
  const existingAssetIds = new Set<string>();
  const orphanAssets: SkillHubIconOrphan[] = [];
  const issues: SkillHubIconAssetIssue[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        referencedAssetIds,
        invalidReferencedAssetIds,
        assetCount: 0,
        orphanAssets: [],
        missingAssetIds: referencedAssetIds,
        issues: [],
      };
    }
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      issues.push({ filename: entry.name, reason: "invalid_filename" });
      continue;
    }
    const match = /^([a-f0-9]{64})\.png$/.exec(entry.name);
    if (!match || !isSkillHubIconAssetId(match[1])) {
      issues.push({ filename: entry.name, reason: "invalid_filename" });
      continue;
    }
    const assetId = match[1];
    existingAssetIds.add(assetId);
    const assetPath = path.join(rootDir, entry.name);
    const [data, stat] = await Promise.all([fsp.readFile(assetPath), fsp.stat(assetPath)]);
    if (createHash("sha256").update(data).digest("hex") !== assetId) {
      issues.push({ filename: entry.name, assetId, reason: "hash_mismatch" });
    }
    if (!(await isValidPng(data))) {
      issues.push({ filename: entry.name, assetId, reason: "invalid_png" });
    }
    if (!referencedAssetIds.includes(assetId)) {
      orphanAssets.push({
        assetId,
        filename: entry.name,
        modifiedAt: stat.mtime.toISOString(),
        ageMs: Math.max(0, nowMs - stat.mtimeMs),
        sizeBytes: stat.size,
      });
    }
  }

  return {
    referencedAssetIds,
    invalidReferencedAssetIds,
    assetCount: existingAssetIds.size,
    orphanAssets: orphanAssets.toSorted((a, b) => a.assetId.localeCompare(b.assetId)),
    missingAssetIds: referencedAssetIds.filter((assetId) => !existingAssetIds.has(assetId)),
    issues,
  };
}

export async function garbageCollectSkillHubIconAssets(params: {
  referencedAssetIds: Iterable<string>;
  rootDir?: string;
  dryRun?: boolean;
  graceDays?: number;
  nowMs?: number;
}): Promise<SkillHubIconGcResult> {
  return await withSkillHubIconAssetsLock(async () => {
    const dryRun = params.dryRun ?? true;
    const graceDays = params.graceDays ?? 14;
    if (!Number.isFinite(graceDays) || graceDays < 0) {
      throw new Error("Skill Hub icon GC graceDays must be a non-negative number");
    }
    const rootDir = params.rootDir ?? getSkillHubIconAssetsRoot();
    const audit = await auditSkillHubIconAssets(params);
    const graceMs = graceDays * DAY_MS;
    const deleteCandidates = audit.orphanAssets.filter((asset) => asset.ageMs >= graceMs);
    const referenced = new Set(audit.referencedAssetIds);
    const deletedAssetIds: string[] = [];
    if (!dryRun) {
      for (const candidate of deleteCandidates) {
        if (referenced.has(candidate.assetId)) {
          continue;
        }
        await fsp.unlink(path.join(rootDir, candidate.filename));
        deletedAssetIds.push(candidate.assetId);
      }
    }
    return { ...audit, dryRun, graceDays, deleteCandidates, deletedAssetIds };
  });
}

export function skillHubIconGcDefaults(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  graceDays: number;
  intervalDays: number;
  initialDelayMs: number;
} {
  const parsePositive = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    enabled: env.SKILL_HUB_ICON_GC_ENABLED?.trim().toLowerCase() === "true",
    graceDays: parsePositive(env.SKILL_HUB_ICON_GC_GRACE_DAYS, 14),
    intervalDays: parsePositive(env.SKILL_HUB_ICON_GC_INTERVAL_DAYS, 7),
    initialDelayMs: parsePositive(env.SKILL_HUB_ICON_GC_INITIAL_DELAY_MS, 60 * 60 * 1000),
  };
}
