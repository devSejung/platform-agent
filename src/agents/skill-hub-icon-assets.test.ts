import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeAndStoreSkillHubIcon,
  readSkillHubIconAsset,
  SKILL_HUB_ICON_MAX_BYTES,
} from "./skill-hub-icon-assets.js";

describe("Skill Hub icon assets", () => {
  let rootDir = "";

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-hub-icons-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("normalizes PNG input to a content-addressed transparent 256px asset", async () => {
    const input = await sharp({
      create: { width: 80, height: 40, channels: 4, background: "#16877a" },
    })
      .png()
      .toBuffer();
    const first = await normalizeAndStoreSkillHubIcon({
      data: input,
      mimeType: "image/png",
      rootDir,
    });
    const second = await normalizeAndStoreSkillHubIcon({
      data: input,
      mimeType: "image/png",
      rootDir,
    });

    expect(first.assetId).toMatch(/^[a-f0-9]{64}$/);
    expect(second.assetId).toBe(first.assetId);
    const stored = await readSkillHubIconAsset({ assetId: first.assetId, rootDir });
    expect(stored).toEqual(first.data);
    await expect(sharp(stored!).metadata()).resolves.toMatchObject({
      format: "png",
      width: 256,
      height: 256,
      hasAlpha: true,
    });
    expect(await fs.readdir(rootDir)).toEqual([`${first.assetId}.png`]);
  });

  it("rejects MIME spoofing, corrupt PNGs, oversized files, and oversized dimensions", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#fff" },
    })
      .jpeg()
      .toBuffer();
    await expect(
      normalizeAndStoreSkillHubIcon({ data: jpeg, mimeType: "image/png", rootDir }),
    ).rejects.toThrow("not a PNG");
    await expect(
      normalizeAndStoreSkillHubIcon({
        data: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from("broken"),
        ]),
        mimeType: "image/png",
        rootDir,
      }),
    ).rejects.toThrow("not a valid PNG");
    await expect(
      normalizeAndStoreSkillHubIcon({
        data: Buffer.alloc(SKILL_HUB_ICON_MAX_BYTES + 1),
        mimeType: "image/png",
        rootDir,
      }),
    ).rejects.toThrow("256 KB");
    const tooWide = await sharp({
      create: { width: 1025, height: 1, channels: 4, background: "#fff" },
    })
      .png()
      .toBuffer();
    await expect(
      normalizeAndStoreSkillHubIcon({ data: tooWide, mimeType: "image/png", rootDir }),
    ).rejects.toThrow("between 1 and 1024");
  });

  it("does not resolve malformed asset ids or traversal input", async () => {
    await expect(readSkillHubIconAsset({ assetId: "../secret", rootDir })).resolves.toBeNull();
    await expect(readSkillHubIconAsset({ assetId: "a".repeat(63), rootDir })).resolves.toBeNull();
  });
});
