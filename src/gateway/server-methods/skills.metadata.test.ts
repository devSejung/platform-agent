import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provisionEmployeeAccount } from "../../accounts/account-provisioning.js";
import { resetPlatformClawDatabaseForTests } from "../../accounts/db.js";

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function createRespond() {
  return vi.fn();
}

describe("skillhub metadata and hard-delete gateway handlers", () => {
  let tempDir = "";

  afterEach(async () => {
    resetPlatformClawDatabaseForTests();
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("allows admins to edit metadata and hard-delete without changing uploader or owner", async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gateway-skill-metadata-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "admin";

    const workspaceRoot = path.join(tempDir, "workspaces");
    const { writeConfigFile } = await import("../../config/config.js");
    await writeConfigFile({
      agents: {
        defaults: {
          workspace: workspaceRoot,
        },
      },
    });
    const { skillsHandlers } = await import("./skills.js");

    const config = {
      agents: {
        defaults: {
          workspace: workspaceRoot,
        },
      },
    };
    provisionEmployeeAccount({
      config,
      employeeId: "owner",
      email: "owner@example.com",
      name: "Owner",
      department: "Platform",
      agentId: "owner",
    });
    provisionEmployeeAccount({
      config,
      employeeId: "admin",
      email: "admin@example.com",
      name: "Admin",
      department: "Platform",
      agentId: "admin",
    });

    const metadataPath = path.join(tempDir, "skill-hub", "metadata", "demo-skill.json");
    const installedSkillPath = path.join(
      workspaceRoot,
      "owner",
      "skills",
      "demo-skill",
      "SKILL.md",
    );
    const installStatePath = path.join(workspaceRoot, "owner", ".skill-hub-installed.json");
    await fs.mkdir(path.dirname(installedSkillPath), { recursive: true });
    await fs.writeFile(installedSkillPath, "# Demo Skill\n", "utf8");
    await writeJson(installStatePath, {
      skills: {
        "demo-skill": {
          slug: "demo-skill",
          displayName: "Demo Skill",
          installedVersion: "1.0.0",
          source: "hub",
          installedAt: "2026-05-21T00:00:00.000Z",
          updatedAt: "2026-05-21T00:00:00.000Z",
          installedPath: path.dirname(installedSkillPath),
        },
      },
    });
    await writeJson(metadataPath, {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Existing metadata",
      uploader: { employeeId: "owner", name: "Owner" },
      owner: { accountId: "owner", name: "Owner" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: ["old prompt"] },
      engagement: { likeCount: 0 },
      versions: [
        {
          version: "1.0.0",
          uploadedBy: { employeeId: "owner", name: "Owner" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.0.0",
        },
      ],
    });

    let respond = createRespond();
    await skillsHandlers["skillhub.metadata.update"]({
      params: {
        slug: "demo-skill",
        summary: "Admin updated summary",
        examplePrompts: ["first prompt", "second prompt"],
      },
      respond,
      client: {
        connect: { role: "employee" },
        internal: { employee: { employeeId: "admin", agentId: "admin", name: "Admin" } },
      },
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        slug: "demo-skill",
        message: "Skill metadata updated.",
      }),
      undefined,
    );

    const updated = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      summary: string;
      hidden: boolean;
      uploader: { employeeId: string };
      owner: { accountId: string };
      presentation: { examplePrompts: string[] };
    };
    expect(updated.summary).toBe("Admin updated summary");
    expect(updated.presentation.examplePrompts).toEqual(["first prompt", "second prompt"]);
    expect(updated.hidden).toBe(false);
    expect(updated.uploader.employeeId).toBe("owner");
    expect(updated.owner.accountId).toBe("owner");

    respond = createRespond();
    await skillsHandlers["skillhub.hardDelete"]({
      params: {
        slug: "demo-skill",
      },
      respond,
      client: {
        connect: { role: "employee" },
        internal: { employee: { employeeId: "admin", agentId: "admin", name: "Admin" } },
      },
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        slug: "demo-skill",
        message: "Deleted from Skill Hub: demo-skill",
      }),
      undefined,
    );
    await expect(fs.access(metadataPath)).rejects.toThrow();
    const installState = JSON.parse(await fs.readFile(installStatePath, "utf8")) as {
      skills: Record<string, unknown>;
    };
    expect(installState.skills).not.toHaveProperty("demo-skill");
    await expect(fs.access(installedSkillPath)).resolves.toBeUndefined();
  });
});
