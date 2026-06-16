import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createAssistantArtifactTool } from "./assistant-artifact-tool.js";

async function withTempWorkspace<T>(run: (workspaceDir: string) => Promise<T>): Promise<T> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-artifact-tool-"));
  try {
    return await run(workspaceDir);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

describe("createAssistantArtifactTool", () => {
  it("returns an explicit assistant artifact delivery marker for a local file", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const filePath = path.join(workspaceDir, "plot.png");
      await fs.writeFile(filePath, "not really png");
      const tool = createAssistantArtifactTool({ workspaceDir });

      const result = await tool.execute("artifact-1", {
        path: "plot.png",
        caption: "그래프야.",
        kind: "image",
      });

      expect(result.content).toEqual([
        { type: "text", text: "Attached artifact: plot.png\n그래프야." },
      ]);
      expect(result.details).toMatchObject({
        artifactDelivery: true,
        path: filePath,
        fileName: "plot.png",
        caption: "그래프야.",
        kind: "image",
        sizeBytes: 14,
        media: { mediaUrl: filePath },
      });
    });
  });

  it("rejects remote URLs because artifact delivery must materialize local files", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const tool = createAssistantArtifactTool({ workspaceDir });
      await expect(
        tool.execute("artifact-1", { path: "https://example.com/a.png" }),
      ).rejects.toThrow("path must be a local or workspace file path");
    });
  });

  it("rejects arbitrary local files outside approved artifact roots", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-artifact-outside-"));
      try {
        const outsideFile = path.join(outsideDir, "secret.txt");
        await fs.writeFile(outsideFile, "secret");
        const tool = createAssistantArtifactTool({ workspaceDir });

        await expect(tool.execute("artifact-1", { path: outsideFile })).rejects.toThrow(
          "artifact path must be inside the workspace or managed media roots",
        );
      } finally {
        await fs.rm(outsideDir, { recursive: true, force: true });
      }
    });
  });
});
