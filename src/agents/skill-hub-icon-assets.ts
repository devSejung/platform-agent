import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { CONFIG_DIR, ensureDir } from "../utils.js";

const fsp = fs.promises;
let iconAssetsQueue: Promise<void> = Promise.resolve();

export const SKILL_HUB_ICON_MAX_BYTES = 256 * 1024;
export const SKILL_HUB_ICON_MAX_DIMENSION = 1024;
export const SKILL_HUB_ICON_OUTPUT_DIMENSION = 256;
export const SKILL_HUB_ICON_MIME_TYPE = "image/png";
export const SKILL_HUB_ICON_ASSET_ID_PATTERN = /^[a-f0-9]{64}$/;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function getSkillHubIconAssetsRoot(): string {
  return path.join(CONFIG_DIR, "skill-hub", "assets", "icons");
}

export function isSkillHubIconAssetId(value: unknown): value is string {
  return typeof value === "string" && SKILL_HUB_ICON_ASSET_ID_PATTERN.test(value);
}

export async function withSkillHubIconAssetsLock<T>(task: () => Promise<T>): Promise<T> {
  const previous = iconAssetsQueue;
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  iconAssetsQueue = previous.then(() => current);
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function resolveAssetPath(assetId: string, rootDir: string): string {
  if (!isSkillHubIconAssetId(assetId)) {
    throw new Error("invalid Skill Hub icon asset id");
  }
  return path.join(rootDir, `${assetId}.png`);
}

export async function normalizeAndStoreSkillHubIcon(params: {
  data: Buffer;
  mimeType: string;
  rootDir?: string;
}): Promise<{ assetId: string; data: Buffer }> {
  if (params.mimeType !== SKILL_HUB_ICON_MIME_TYPE) {
    throw new Error("Skill Hub icons must be PNG files");
  }
  if (params.data.length === 0) {
    throw new Error("Skill Hub icon is empty");
  }
  if (params.data.length > SKILL_HUB_ICON_MAX_BYTES) {
    throw new Error("Skill Hub icon exceeds the 256 KB limit");
  }
  if (!params.data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("Skill Hub icon content is not a PNG file");
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(params.data, { failOn: "error" }).metadata();
  } catch {
    throw new Error("Skill Hub icon is not a valid PNG file");
  }
  if (
    metadata.format !== "png" ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > SKILL_HUB_ICON_MAX_DIMENSION ||
    metadata.height > SKILL_HUB_ICON_MAX_DIMENSION
  ) {
    throw new Error("Skill Hub icon dimensions must be between 1 and 1024 pixels");
  }

  let normalized: Buffer;
  try {
    normalized = await sharp(params.data, { failOn: "error" })
      .rotate()
      .resize(SKILL_HUB_ICON_OUTPUT_DIMENSION, SKILL_HUB_ICON_OUTPUT_DIMENSION, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toBuffer();
  } catch {
    throw new Error("Skill Hub icon could not be normalized");
  }

  const assetId = createHash("sha256").update(normalized).digest("hex");
  const rootDir = params.rootDir ?? getSkillHubIconAssetsRoot();
  const assetPath = resolveAssetPath(assetId, rootDir);
  await ensureDir(rootDir);
  try {
    await fsp.access(assetPath);
  } catch {
    const temporaryPath = path.join(rootDir, `.${assetId}.${randomUUID()}.tmp`);
    try {
      await fsp.writeFile(temporaryPath, normalized, { flag: "wx" });
      await fsp.rename(temporaryPath, assetPath);
    } finally {
      await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    }
  }
  return { assetId, data: normalized };
}

export async function readSkillHubIconAsset(params: {
  assetId: string;
  rootDir?: string;
}): Promise<Buffer | null> {
  const rootDir = params.rootDir ?? getSkillHubIconAssetsRoot();
  let assetPath: string;
  try {
    assetPath = resolveAssetPath(params.assetId, rootDir);
  } catch {
    return null;
  }
  try {
    return await fsp.readFile(assetPath);
  } catch {
    return null;
  }
}
