import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditSkillHubIconAssets,
  garbageCollectSkillHubIconAssets,
} from "./skill-hub-icon-maintenance.js";

const tempDirs: string[] = [];

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skillhub-icon-gc-"));
  tempDirs.push(dir);
  return dir;
}

async function png() {
  return await sharp({
    create: { width: 16, height: 16, channels: 4, background: "transparent" },
  })
    .png()
    .toBuffer();
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("Skill Hub icon asset maintenance", () => {
  it("audits referenced, orphaned, missing, invalid, corrupt, and mismatched assets", async () => {
    const rootDir = await tempDir();
    const valid = await png();
    const referencedId = createHash("sha256").update(valid).digest("hex");
    await fs.writeFile(path.join(rootDir, `${referencedId}.png`), valid);

    const corrupt = Buffer.from("not a png");
    const corruptId = createHash("sha256").update(corrupt).digest("hex");
    await fs.writeFile(path.join(rootDir, `${corruptId}.png`), corrupt);
    const mismatchedId = "a".repeat(64);
    await fs.writeFile(path.join(rootDir, `${mismatchedId}.png`), valid);
    await fs.writeFile(path.join(rootDir, "not-an-asset.png"), valid);

    const missingId = "b".repeat(64);
    const audit = await auditSkillHubIconAssets({
      rootDir,
      referencedAssetIds: [referencedId, missingId, "invalid-reference"],
    });

    expect(audit.assetCount).toBe(3);
    expect(audit.missingAssetIds).toEqual([missingId]);
    expect(audit.invalidReferencedAssetIds).toEqual(["invalid-reference"]);
    expect(audit.orphanAssets.map((asset) => asset.assetId)).toEqual([corruptId, mismatchedId]);
    expect(audit.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filename: "not-an-asset.png", reason: "invalid_filename" }),
        expect.objectContaining({ assetId: corruptId, reason: "invalid_png" }),
        expect.objectContaining({ assetId: mismatchedId, reason: "hash_mismatch" }),
      ]),
    );
  });

  it("keeps referenced and grace-period assets, dry-runs by default, then deletes old orphans", async () => {
    const rootDir = await tempDir();
    const oldData = await png();
    const oldId = createHash("sha256").update(oldData).digest("hex");
    const oldPath = path.join(rootDir, `${oldId}.png`);
    await fs.writeFile(oldPath, oldData);
    const nowMs = Date.UTC(2026, 5, 20);
    const oldMs = nowMs - 15 * 24 * 60 * 60 * 1000;
    await fs.utimes(oldPath, oldMs / 1000, oldMs / 1000);

    const recentData = await sharp({
      create: { width: 8, height: 8, channels: 4, background: "red" },
    })
      .png()
      .toBuffer();
    const recentId = createHash("sha256").update(recentData).digest("hex");
    await fs.writeFile(path.join(rootDir, `${recentId}.png`), recentData);

    const dryRun = await garbageCollectSkillHubIconAssets({
      rootDir,
      referencedAssetIds: [],
      graceDays: 14,
      nowMs,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.deleteCandidates.map((asset) => asset.assetId)).toEqual([oldId]);
    await expect(fs.access(oldPath)).resolves.toBeUndefined();

    const deleted = await garbageCollectSkillHubIconAssets({
      rootDir,
      referencedAssetIds: [],
      dryRun: false,
      graceDays: 14,
      nowMs,
    });
    expect(deleted.deletedAssetIds).toEqual([oldId]);
    await expect(fs.access(oldPath)).rejects.toThrow();
    await expect(fs.access(path.join(rootDir, `${recentId}.png`))).resolves.toBeUndefined();
  });

  it("treats a missing asset directory as an empty audit", async () => {
    const rootDir = path.join(await tempDir(), "missing");
    const missingId = "c".repeat(64);
    await expect(
      auditSkillHubIconAssets({ rootDir, referencedAssetIds: [missingId] }),
    ).resolves.toMatchObject({ assetCount: 0, orphanAssets: [], missingAssetIds: [missingId] });
  });
});
