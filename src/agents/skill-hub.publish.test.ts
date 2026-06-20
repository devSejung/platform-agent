import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function writeSkill(workspaceDir: string, name: string, body = "initial") {
  const skillDir = path.join(workspaceDir, "skills", name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    ["---", `name: ${name}`, `description: ${name} description`, "---", "", body].join("\n"),
    "utf8",
  );
  return skillDir;
}

async function writeMetadata(
  stateDir: string,
  params: {
    slug: string;
    displayName: string;
    owner?: string;
    checksum?: string;
  },
) {
  const metadataPath = path.join(stateDir, "skill-hub", "metadata", `${params.slug}.json`);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        slug: params.slug,
        displayName: params.displayName,
        summary: "Existing metadata",
        uploader: { employeeId: params.owner ?? "" },
        owner: { accountId: params.owner ?? "" },
        publishedAt: "2026-06-10T00:00:00.000Z",
        updatedAt: "2026-06-10T00:00:00.000Z",
        latestVersion: "1.0.0",
        ...(params.checksum ? { contentChecksum: params.checksum } : {}),
        hidden: false,
        flags: { hasHiddenFiles: false, hasExecutableFiles: false },
        stats: { installCount: 0, installerCount: 0 },
        presentation: { examplePrompts: [] },
        engagement: { likeCount: 0 },
        versions: [],
      },
      null,
      2,
    ),
    "utf8",
  );
  return metadataPath;
}

describe("skill hub workspace publishing", () => {
  let stateDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    vi.resetModules();
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-hub-publish-state-"));
    workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "openclaw-skill-hub-publish-workspace-"),
    );
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("computes a deterministic checksum and ignores runtime artifacts", async () => {
    const skillDir = await writeSkill(workspaceDir, "demo-skill");
    const { computeSkillDirectoryChecksum } = await import("./skill-hub.js");
    const initial = await computeSkillDirectoryChecksum(skillDir);

    await fs.mkdir(path.join(skillDir, "node_modules", "ignored"), { recursive: true });
    await fs.writeFile(path.join(skillDir, "node_modules", "ignored", "index.js"), "ignored");
    await fs.writeFile(path.join(skillDir, "debug.log"), "ignored");
    const ignoredChanges = await computeSkillDirectoryChecksum(skillDir);
    expect(ignoredChanges).toBe(initial);

    await fs.writeFile(path.join(skillDir, "docs.md"), "included");
    const includedChange = await computeSkillDirectoryChecksum(skillDir);
    expect(includedChange).not.toBe(initial);
  });

  it("classifies new, owner update, up-to-date, and non-owner skills", async () => {
    const skillDir = await writeSkill(workspaceDir, "demo-skill");
    const { computeSkillDirectoryChecksum, listWorkspacePublishEntries } =
      await import("./skill-hub.js");
    const checksum = await computeSkillDirectoryChecksum(skillDir);

    let entries = await listWorkspacePublishEntries({
      workspaceDir,
      actor: { employeeId: "owner" },
    });
    expect(entries[0]?.state).toBe("new_local_skill");

    const metadataPath = await writeMetadata(stateDir, {
      slug: "demo-skill",
      displayName: "demo-skill",
      owner: "owner",
    });
    entries = await listWorkspacePublishEntries({
      workspaceDir,
      actor: { employeeId: "owner" },
    });
    expect(entries[0]?.state).toBe("update_available_from_local");

    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.contentChecksum = checksum;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");
    entries = await listWorkspacePublishEntries({
      workspaceDir,
      actor: { employeeId: "owner" },
    });
    expect(entries[0]?.state).toBe("up_to_date");

    entries = await listWorkspacePublishEntries({
      workspaceDir,
      actor: { employeeId: "other" },
    });
    expect(entries[0]?.state).toBe("existing_skill_non_owner");
  });

  it("keeps hub-installed workspace skills visible and blocks symlinks", async () => {
    const skillDir = await writeSkill(workspaceDir, "installed-skill");
    await fs.writeFile(
      path.join(workspaceDir, ".skill-hub-installed.json"),
      JSON.stringify({
        skills: {
          "installed-skill": {
            slug: "installed-skill",
            displayName: "installed-skill",
            installedVersion: "1.0.0",
            source: "hub",
            installedAt: "2026-06-10T00:00:00.000Z",
            updatedAt: "2026-06-10T00:00:00.000Z",
            installedPath: skillDir,
          },
        },
      }),
      "utf8",
    );
    await writeMetadata(stateDir, {
      slug: "installed-skill",
      displayName: "installed-skill",
      owner: "other",
    });
    const { listWorkspacePublishEntries } = await import("./skill-hub.js");
    let entries = await listWorkspacePublishEntries({
      workspaceDir,
      actor: { employeeId: "owner" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      installedFromHub: true,
      state: "existing_skill_non_owner",
    });

    await fs.symlink(path.join(skillDir, "SKILL.md"), path.join(skillDir, "linked-skill.md"));
    entries = await listWorkspacePublishEntries({
      workspaceDir,
      actor: { employeeId: "owner" },
    });
    expect(entries[0]?.state).toBe("conflict_or_unknown");
    expect(entries[0]?.reason).toContain("심볼릭 링크");
  });

  it("creates, no-ops, updates, and rejects a non-owner without using SKILL.md version", async () => {
    const skillDir = await writeSkill(workspaceDir, "demo-skill");
    const { computeSkillDirectoryChecksum, publishWorkspaceSkillToHub } =
      await import("./skill-hub.js");
    const actor = { employeeId: "owner", name: "Owner" };
    const initialChecksum = await computeSkillDirectoryChecksum(skillDir);
    const created = await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "demo-skill",
      intent: "create",
      expectedLocalChecksum: initialChecksum,
    });
    expect(created).toMatchObject({ version: "1.0.0", created: true, noOp: false });

    const noOp = await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "demo-skill",
      intent: "update",
      expectedSlug: "demo-skill",
      expectedLocalChecksum: initialChecksum,
      expectedHubChecksum: initialChecksum,
    });
    expect(noOp).toMatchObject({ version: "1.0.0", created: false, noOp: true });

    await fs.writeFile(path.join(skillDir, "docs.md"), "changed", "utf8");
    const changedChecksum = await computeSkillDirectoryChecksum(skillDir);
    const updated = await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "demo-skill",
      intent: "update",
      expectedSlug: "demo-skill",
      expectedLocalChecksum: changedChecksum,
      expectedHubChecksum: initialChecksum,
    });
    expect(updated).toMatchObject({ version: "1.0.1", created: false, noOp: false });

    await expect(
      publishWorkspaceSkillToHub({
        workspaceDir,
        actor: { employeeId: "other" },
        skillName: "demo-skill",
        intent: "update",
        expectedSlug: "demo-skill",
        expectedLocalChecksum: changedChecksum,
        expectedHubChecksum: changedChecksum,
      }),
    ).rejects.toThrow("only the current skill owner");
  });

  it("rejects stale workspace publish requests and versions executable flag changes", async () => {
    const skillDir = await writeSkill(workspaceDir, "flag-skill");
    const scriptPath = path.join(skillDir, "run.sh");
    await fs.writeFile(scriptPath, "#!/bin/sh\nexit 0\n", { encoding: "utf8", mode: 0o644 });
    const { computeSkillDirectoryChecksum, publishWorkspaceSkillToHub } =
      await import("./skill-hub.js");
    const actor = { employeeId: "owner", name: "Owner" };
    const initialChecksum = await computeSkillDirectoryChecksum(skillDir);

    const created = await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "flag-skill",
      intent: "create",
      expectedLocalChecksum: initialChecksum,
    });
    expect(created).toMatchObject({ version: "1.0.0", noOp: false });

    await fs.writeFile(path.join(skillDir, "changed.md"), "changed", "utf8");
    await expect(
      publishWorkspaceSkillToHub({
        workspaceDir,
        actor,
        skillName: "flag-skill",
        intent: "update",
        expectedSlug: "flag-skill",
        expectedLocalChecksum: initialChecksum,
        expectedHubChecksum: initialChecksum,
      }),
    ).rejects.toThrow("로컬 스킬 내용이 변경되었습니다");

    await fs.rm(path.join(skillDir, "changed.md"));
    await fs.chmod(scriptPath, 0o755);
    const executableChecksum = await computeSkillDirectoryChecksum(skillDir);
    expect(executableChecksum).toBe(initialChecksum);

    const updated = await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "flag-skill",
      intent: "update",
      expectedSlug: "flag-skill",
      expectedLocalChecksum: executableChecksum,
      expectedHubChecksum: initialChecksum,
    });
    expect(updated).toMatchObject({ version: "1.0.1", noOp: false });

    const repeated = await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "flag-skill",
      intent: "update",
      expectedSlug: "flag-skill",
      expectedLocalChecksum: executableChecksum,
      expectedHubChecksum: initialChecksum,
    });
    expect(repeated).toMatchObject({ version: "1.0.1", noOp: true });

    const metadataPath = path.join(stateDir, "skill-hub", "metadata", "flag-skill.json");
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as Record<string, unknown>;
    metadata.contentChecksum = "changed-by-another-request";
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    await expect(
      publishWorkspaceSkillToHub({
        workspaceDir,
        actor,
        skillName: "flag-skill",
        intent: "update",
        expectedSlug: "flag-skill",
        expectedLocalChecksum: executableChecksum,
        expectedHubChecksum: initialChecksum,
      }),
    ).rejects.toThrow("Hub 스킬이 변경되었습니다");
  });

  it("applies the same checksum and ownership policy to .skill uploads", async () => {
    const makeArchive = async (body: string) => {
      const zip = new JSZip();
      zip.file(
        "package-skill/SKILL.md",
        ["---", "name: package-skill", "description: Package skill", "---", "", body].join("\n"),
      );
      return (await zip.generateAsync({ type: "nodebuffer" })).toString("base64");
    };
    const { uploadSkillPackageToHub } = await import("./skill-hub.js");
    const actor = { employeeId: "owner", name: "Owner" };

    const created = await uploadSkillPackageToHub({
      actor,
      filename: "package-skill.skill",
      contentBase64: await makeArchive("initial"),
    });
    expect(created).toMatchObject({ version: "1.0.0", created: true, noOp: false });

    const noOp = await uploadSkillPackageToHub({
      actor,
      filename: "package-skill.skill",
      contentBase64: await makeArchive("initial"),
      expectedHubChecksum: JSON.parse(
        await fs.readFile(
          path.join(stateDir, "skill-hub", "metadata", "package-skill.json"),
          "utf8",
        ),
      ).contentChecksum as string,
    });
    expect(noOp).toMatchObject({ version: "1.0.0", noOp: true });

    const updated = await uploadSkillPackageToHub({
      actor,
      filename: "package-skill.skill",
      contentBase64: await makeArchive("changed"),
      expectedHubChecksum: JSON.parse(
        await fs.readFile(
          path.join(stateDir, "skill-hub", "metadata", "package-skill.json"),
          "utf8",
        ),
      ).contentChecksum as string,
    });
    expect(updated).toMatchObject({ version: "1.0.1", noOp: false });

    await expect(
      uploadSkillPackageToHub({
        actor: { employeeId: "other" },
        filename: "package-skill.skill",
        contentBase64: await makeArchive("other change"),
      }),
    ).rejects.toThrow("only the current skill owner");
  });

  it("commits workspace presentation metadata without bumping an unchanged content version", async () => {
    const skillDir = await writeSkill(workspaceDir, "presented-skill");
    const icon = await sharp({
      create: { width: 20, height: 20, channels: 4, background: "blue" },
    })
      .png()
      .toBuffer();
    const { computeSkillDirectoryChecksum, publishWorkspaceSkillToHub } =
      await import("./skill-hub.js");
    const checksum = await computeSkillDirectoryChecksum(skillDir);
    const actor = { employeeId: "owner", name: "Owner" };
    await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "presented-skill",
      intent: "create",
      expectedLocalChecksum: checksum,
    });
    const metadataPath = path.join(stateDir, "skill-hub", "metadata", "presented-skill.json");
    const before = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      latestVersion: string;
      updatedAt: string;
      contentChecksum: string;
    };

    const result = await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "presented-skill",
      intent: "update",
      expectedSlug: "presented-skill",
      expectedLocalChecksum: checksum,
      expectedHubChecksum: checksum,
      presentation: {
        displayName: "Presented Skill",
        displayDescription: "A concise listing description",
        category: "utility",
        iconUpload: { mimeType: "image/png", dataBase64: icon.toString("base64") },
      },
    });
    expect(result).toMatchObject({
      version: "1.0.0",
      noOp: true,
      presentationUpdated: true,
    });
    const after = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      latestVersion: string;
      updatedAt: string;
      contentChecksum: string;
      presentation: {
        displayName: string;
        displayDescription: string;
        category: string;
        icon: { assetId: string };
        revision: number;
        updatedAt: string;
      };
    };
    expect(after).toMatchObject({
      latestVersion: before.latestVersion,
      updatedAt: before.updatedAt,
      contentChecksum: before.contentChecksum,
      presentation: {
        displayName: "Presented Skill",
        displayDescription: "A concise listing description",
        category: "utility",
        revision: 1,
      },
    });
    expect(after.presentation.icon.assetId).toMatch(/^[a-f0-9]{64}$/);
    expect(after.presentation.updatedAt).not.toBe(before.updatedAt);
    await expect(
      fs.access(
        path.join(
          stateDir,
          "skill-hub",
          "assets",
          "icons",
          `${after.presentation.icon.assetId}.png`,
        ),
      ),
    ).resolves.toBeUndefined();

    await publishWorkspaceSkillToHub({
      workspaceDir,
      actor,
      skillName: "presented-skill",
      intent: "update",
      expectedSlug: "presented-skill",
      expectedLocalChecksum: checksum,
      expectedHubChecksum: checksum,
      presentation: { displayName: null, displayDescription: null, category: null },
    });
    const cleared = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      latestVersion: string;
      updatedAt: string;
      presentation: Record<string, unknown>;
    };
    expect(cleared.latestVersion).toBe("1.0.0");
    expect(cleared.updatedAt).toBe(before.updatedAt);
    expect(cleared.presentation).not.toHaveProperty("displayName");
    expect(cleared.presentation).not.toHaveProperty("displayDescription");
    expect(cleared.presentation).not.toHaveProperty("category");
  });

  it("stores upload presentation metadata and rejects invalid drafts before publishing", async () => {
    const makeArchive = async (name: string) => {
      const zip = new JSZip();
      zip.file(
        `${name}/SKILL.md`,
        ["---", `name: ${name}`, `description: ${name} source`, "---"].join("\n"),
      );
      return (await zip.generateAsync({ type: "nodebuffer" })).toString("base64");
    };
    const { uploadSkillPackageToHub } = await import("./skill-hub.js");
    await uploadSkillPackageToHub({
      actor: { employeeId: "owner" },
      filename: "upload-presented.skill",
      contentBase64: await makeArchive("upload-presented"),
      presentation: {
        displayName: "Upload Presented",
        displayDescription: "Uploaded with listing metadata",
        category: "knowledge",
      },
    });
    const stored = JSON.parse(
      await fs.readFile(
        path.join(stateDir, "skill-hub", "metadata", "upload-presented.json"),
        "utf8",
      ),
    ) as { presentation: Record<string, unknown> };
    expect(stored.presentation).toMatchObject({
      displayName: "Upload Presented",
      displayDescription: "Uploaded with listing metadata",
      category: "knowledge",
    });

    await expect(
      uploadSkillPackageToHub({
        actor: { employeeId: "owner" },
        filename: "invalid-presentation.skill",
        contentBase64: await makeArchive("invalid-presentation"),
        presentation: { category: "invalid" as "other" },
      }),
    ).rejects.toThrow("invalid skill category");
    await expect(
      fs.access(path.join(stateDir, "skill-hub", "metadata", "invalid-presentation.json")),
    ).rejects.toThrow();
    await expect(
      uploadSkillPackageToHub({
        actor: { employeeId: "owner" },
        filename: "invalid-length.skill",
        contentBase64: await makeArchive("invalid-length"),
        presentation: { displayName: "x".repeat(81) },
      }),
    ).rejects.toThrow("displayName must be 80 characters or fewer");
  });

  it("hard-deletes Hub identity and allows the retained local skill to be published again", async () => {
    const skillDir = await writeSkill(workspaceDir, "cleanup-skill");
    const {
      computeSkillDirectoryChecksum,
      deleteSkillFromHub,
      getSkillHubOverview,
      listWorkspacePublishEntries,
      publishWorkspaceSkillToHub,
    } = await import("./skill-hub.js");
    const owner = { employeeId: "owner", name: "Owner" };
    const checksum = await computeSkillDirectoryChecksum(skillDir);

    await publishWorkspaceSkillToHub({
      workspaceDir,
      actor: owner,
      skillName: "cleanup-skill",
      intent: "create",
      expectedLocalChecksum: checksum,
    });

    await expect(
      deleteSkillFromHub({
        slug: "cleanup-skill",
        actor: { employeeId: "other" },
      }),
    ).rejects.toThrow("only the skill owner or an admin");

    await deleteSkillFromHub({
      slug: "cleanup-skill",
      actor: { employeeId: "admin", globalRole: "admin" },
    });

    const entries = await listWorkspacePublishEntries({ workspaceDir, actor: owner });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      skillName: "cleanup-skill",
      state: "new_local_skill",
      actionLabel: "발행",
      disabled: false,
    });
    await expect(fs.access(path.join(skillDir, "SKILL.md"))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(stateDir, "skill-hub", "metadata", "cleanup-skill.json")),
    ).rejects.toThrow();
    await expect(
      fs.access(path.join(stateDir, "skill-hub", "registry", "skills", "cleanup-skill")),
    ).rejects.toThrow();

    const overview = await getSkillHubOverview({ workspaceDir, actor: owner });
    expect(overview.sharedSkillCount).toBe(0);
    expect(overview.localSkillCount).toBe(1);
    expect(overview.recentUpdates).toEqual([]);
  });
});
