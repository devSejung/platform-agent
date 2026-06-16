import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePreferredOpenClawTmpDir } from "../infra/tmp-openclaw-dir.js";
import { materializeAssistantArtifacts } from "./assistant-artifacts.js";

const tempDirs: string[] = [];

async function makeTempWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-assistant-artifacts-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("materializeAssistantArtifacts", () => {
  it("copies workspace image media into generated artifact attachments", async () => {
    const workspaceDir = await makeTempWorkspace();
    const sourcePath = path.join(workspaceDir, "plot.png");
    await fs.writeFile(sourcePath, Buffer.from("not-real-png"));

    const result = await materializeAssistantArtifacts({
      mediaUrls: ["./plot.png"],
      workspaceDir,
      now: new Date("2026-06-16T00:00:00.000Z"),
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      type: "image",
      fileName: "plot.png",
      mimeType: "image/png",
      sizeBytes: 12,
      promptMode: "workspace",
    });
    expect(result.attachments[0]?.workspacePath).toMatch(
      /^outbox\/generated-artifacts\/2026-06-16\/plot-[a-f0-9]{8}\.png$/,
    );
    expect(result.contentBlocks[0]).toMatchObject({
      type: "attachment",
      attachmentType: "image",
      fileName: "plot.png",
      workspacePath: result.attachments[0]?.workspacePath,
    });
    await expect(
      fs.readFile(path.join(workspaceDir, result.attachments[0]!.workspacePath), "utf-8"),
    ).resolves.toBe("not-real-png");
  });

  it("does not expose local files outside the workspace", async () => {
    const workspaceDir = await makeTempWorkspace();
    const outsideDir = await makeTempWorkspace();
    const outsidePath = path.join(outsideDir, "secret.png");
    await fs.writeFile(outsidePath, "secret");

    const result = await materializeAssistantArtifacts({
      mediaUrls: [outsidePath],
      workspaceDir,
      now: new Date("2026-06-16T00:00:00.000Z"),
    });

    expect(result.attachments).toEqual([]);
    expect(result.contentBlocks).toEqual([]);
  });

  it("blocks hidden workspace path segments", async () => {
    const workspaceDir = await makeTempWorkspace();
    const hiddenDir = path.join(workspaceDir, ".config");
    await fs.mkdir(hiddenDir, { recursive: true });
    await fs.writeFile(path.join(hiddenDir, "report.png"), "hidden");

    const result = await materializeAssistantArtifacts({
      mediaUrls: [path.join(hiddenDir, "report.png")],
      workspaceDir,
      now: new Date("2026-06-16T00:00:00.000Z"),
    });

    expect(result.attachments).toEqual([]);
    expect(result.contentBlocks).toEqual([]);
  });

  it("blocks sensitive filenames and key/certificate extensions", async () => {
    const workspaceDir = await makeTempWorkspace();
    await fs.writeFile(path.join(workspaceDir, "api-token-report.txt"), "token");
    await fs.writeFile(path.join(workspaceDir, "report.pem"), "key");

    const result = await materializeAssistantArtifacts({
      mediaUrls: ["api-token-report.txt", "report.pem"],
      workspaceDir,
      now: new Date("2026-06-16T00:00:00.000Z"),
    });

    expect(result.attachments).toEqual([]);
    expect(result.contentBlocks).toEqual([]);
  });

  it("blocks workspace symlink escapes", async () => {
    const workspaceDir = await makeTempWorkspace();
    const outsideDir = await makeTempWorkspace();
    const outsidePath = path.join(outsideDir, "plot.png");
    const linkPath = path.join(workspaceDir, "plot.png");
    await fs.writeFile(outsidePath, "outside");
    await fs.symlink(outsidePath, linkPath);

    const result = await materializeAssistantArtifacts({
      mediaUrls: ["plot.png"],
      workspaceDir,
      now: new Date("2026-06-16T00:00:00.000Z"),
    });

    expect(result.attachments).toEqual([]);
    expect(result.contentBlocks).toEqual([]);
  });

  it("copies managed global media into workspace artifacts", async () => {
    const workspaceDir = await makeTempWorkspace();
    const stateDir = await makeTempWorkspace();
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
    const sourceDir = path.join(stateDir, "media", "tool-image-generation");
    await fs.mkdir(sourceDir, { recursive: true });
    const sourcePath = path.join(sourceDir, "generated.png");
    await fs.writeFile(sourcePath, "generated");

    const result = await materializeAssistantArtifacts({
      mediaUrls: [sourcePath],
      workspaceDir,
      now: new Date("2026-06-16T00:00:00.000Z"),
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      type: "image",
      fileName: "generated.png",
      mimeType: "image/png",
    });
    await expect(
      fs.readFile(path.join(workspaceDir, result.attachments[0]!.workspacePath), "utf-8"),
    ).resolves.toBe("generated");
  });

  it("copies files from the OpenClaw tmp media root into workspace artifacts", async () => {
    const workspaceDir = await makeTempWorkspace();
    const tmpRoot = resolvePreferredOpenClawTmpDir();
    await fs.mkdir(tmpRoot, { recursive: true });
    const sourcePath = path.join(tmpRoot, `generated-${process.pid}.png`);
    await fs.writeFile(sourcePath, "tmp-generated");

    try {
      const result = await materializeAssistantArtifacts({
        mediaUrls: [sourcePath],
        workspaceDir,
        now: new Date("2026-06-16T00:00:00.000Z"),
      });

      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0]).toMatchObject({
        type: "image",
        fileName: path.basename(sourcePath),
        mimeType: "image/png",
      });
      await expect(
        fs.readFile(path.join(workspaceDir, result.attachments[0]!.workspacePath), "utf-8"),
      ).resolves.toBe("tmp-generated");
    } finally {
      await fs.rm(sourcePath, { force: true });
    }
  });
});
