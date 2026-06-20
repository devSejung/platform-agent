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

  it("installs and updates a hub skill while refreshing the workspace snapshot", async () => {
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

    const { installSkillFromHub, updateSkillFromHub } = await import("./skill-hub.js");
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

    const nextVersion = "1.0.1";
    const nextVersionDir = path.join(
      stateDir,
      "skill-hub",
      "registry",
      "skills",
      slug,
      nextVersion,
    );
    await fs.mkdir(nextVersionDir, { recursive: true });
    await fs.writeFile(
      path.join(nextVersionDir, "SKILL.md"),
      [
        "---",
        "name: Jira Ticket Summarizer",
        "description: Updated Jira ticket summary",
        "---",
      ].join("\n"),
      "utf8",
    );
    const metadataPath = path.join(stateDir, "skill-hub", "metadata", `${slug}.json`);
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      latestVersion: string;
      updatedAt: string;
      versions: Array<{
        version: string;
        uploadedBy: { employeeId: string; name?: string };
        uploadedAt: string;
        path: string;
      }>;
    };
    metadata.latestVersion = nextVersion;
    metadata.updatedAt = "2026-05-22T00:00:00.000Z";
    metadata.versions.push({
      version: nextVersion,
      uploadedBy: { employeeId: "emp-1", name: "Eon" },
      uploadedAt: "2026-05-22T00:00:00.000Z",
      path: `registry/skills/${slug}/${nextVersion}`,
    });
    await writeJson(metadataPath, metadata);

    await expect(
      updateSkillFromHub({
        workspaceDir,
        actor: { employeeId: "emp-2", name: "User" },
        slug,
      }),
    ).resolves.toMatchObject({ version: nextVersion, updated: true });
    await expect(
      fs.readFile(path.join(workspaceDir, "skills", slug, "SKILL.md"), "utf8"),
    ).resolves.toContain("Updated Jira ticket summary");
    expect(bumpSkillsSnapshotVersionMock).toHaveBeenCalledTimes(2);
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
