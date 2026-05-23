import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { bumpSkillsSnapshotVersionMock } = vi.hoisted(() => ({
  bumpSkillsSnapshotVersionMock: vi.fn(),
}));

vi.mock("./skills/refresh.js", () => ({
  bumpSkillsSnapshotVersion: (...args: unknown[]) => bumpSkillsSnapshotVersionMock(...args),
}));

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

describe("skill hub snapshot refresh", () => {
  let stateDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-hub-state-"));
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-hub-workspace-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("bumps the workspace skills snapshot after installing a hub skill", async () => {
    const slug = "jira-ticket-summarizer";
    const version = "1.0.0";
    const versionDir = path.join(stateDir, "skill-hub", "registry", "skills", slug, version);
    await fs.mkdir(versionDir, { recursive: true });
    await fs.writeFile(
      path.join(versionDir, "SKILL.md"),
      ["---", "name: Jira Ticket Summarizer", "description: Summarizes Jira tickets", "---"].join(
        "\n",
      ),
      "utf8",
    );
    await writeJson(path.join(stateDir, "skill-hub", "metadata", `${slug}.json`), {
      slug,
      displayName: "Jira Ticket Summarizer",
      summary: "Summarizes Jira tickets",
      uploader: { employeeId: "emp-1", name: "Eon" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: version,
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      versions: [
        {
          version,
          uploadedBy: { employeeId: "emp-1", name: "Eon" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: `registry/skills/${slug}/${version}`,
        },
      ],
    });

    const { installSkillFromHub } = await import("./skill-hub.js");
    await installSkillFromHub({
      workspaceDir,
      actor: { employeeId: "emp-2", name: "User" },
      slug,
    });

    expect(bumpSkillsSnapshotVersionMock).toHaveBeenCalledWith({
      workspaceDir,
      reason: "manual",
      changedPath: path.join(workspaceDir, "skills", slug, "SKILL.md"),
    });
  });

  it("bumps the workspace skills snapshot after deleting a workspace-local skill", async () => {
    const localSkillDir = path.join(workspaceDir, "skills", "local-skill");
    await fs.mkdir(localSkillDir, { recursive: true });
    await fs.writeFile(
      path.join(localSkillDir, "SKILL.md"),
      ["---", "name: Local Skill", "description: Local workspace skill", "---"].join("\n"),
      "utf8",
    );

    const { deleteSkillFromWorkspace } = await import("./skill-hub.js");
    await deleteSkillFromWorkspace({
      workspaceDir,
      skillKey: "Local Skill",
      config: {},
    });

    expect(bumpSkillsSnapshotVersionMock).toHaveBeenCalledWith({
      workspaceDir,
      reason: "manual",
      changedPath: path.join(localSkillDir, "SKILL.md"),
    });
  });
});
