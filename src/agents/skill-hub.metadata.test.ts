import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

describe("skill hub metadata compatibility", () => {
  let stateDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    vi.resetModules();
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-hub-meta-"));
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-hub-workspace-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("fills defaults for existing metadata files without likes or example prompts", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Existing metadata",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      versions: [
        {
          version: "1.0.0",
          uploadedBy: { employeeId: "agent-demo", name: "Demo" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.0.0",
        },
      ],
    });

    const { getSkillHubDetail, listSkillHubEntries } = await import("./skill-hub.js");
    const actor = { employeeId: "agent-demo", name: "Demo" };
    const entries = await listSkillHubEntries({ workspaceDir, actor });
    const detail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });

    expect(entries[0]?.likeCount).toBe(0);
    expect(entries[0]?.likedByYou).toBe(false);
    expect(detail?.examplePrompts).toEqual([]);
  });

  it("toggles likes per actor and updates aggregate count", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Existing metadata",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: [] },
      engagement: { likeCount: 0 },
      versions: [
        {
          version: "1.0.0",
          uploadedBy: { employeeId: "agent-demo", name: "Demo" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.0.0",
        },
      ],
    });

    const { getSkillHubDetail, toggleSkillHubLike } = await import("./skill-hub.js");
    const actor = { employeeId: "agent-a", name: "A" };

    const liked = await toggleSkillHubLike({ slug: "demo-skill", actor });
    expect(liked.liked).toBe(true);
    expect(liked.likeCount).toBe(1);

    let detail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });
    expect(detail?.likedByYou).toBe(true);
    expect(detail?.likeCount).toBe(1);

    const unliked = await toggleSkillHubLike({ slug: "demo-skill", actor });
    expect(unliked.liked).toBe(false);
    expect(unliked.likeCount).toBe(0);

    detail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });
    expect(detail?.likedByYou).toBe(false);
    expect(detail?.likeCount).toBe(0);
  });

  it("allows only the uploader to edit example prompts", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Existing metadata",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: [] },
      engagement: { likeCount: 0 },
      versions: [
        {
          version: "1.0.0",
          uploadedBy: { employeeId: "agent-demo", name: "Demo" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.0.0",
        },
      ],
    });

    const { getSkillHubDetail, updateSkillHubExamplePrompts } = await import("./skill-hub.js");

    await expect(
      updateSkillHubExamplePrompts({
        slug: "demo-skill",
        actor: { employeeId: "agent-other", name: "Other" },
        examplePrompts: ["one"],
      }),
    ).rejects.toThrow("only the uploader can edit example prompts");

    await updateSkillHubExamplePrompts({
      slug: "demo-skill",
      actor: { employeeId: "agent-demo", name: "Demo" },
      examplePrompts: ["prompt one", "prompt two", "", "ignored"],
    });

    const detail = await getSkillHubDetail({
      workspaceDir,
      actor: { employeeId: "agent-demo", name: "Demo" },
      slug: "demo-skill",
    });
    expect(detail?.examplePrompts).toEqual(["prompt one", "prompt two", "ignored"]);
  });
});
