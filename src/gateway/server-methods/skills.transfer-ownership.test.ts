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

describe("skillhub.transferOwnership gateway handler", () => {
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

  it("transfers ownership for the current owner and enforces admin reason requirement", async () => {
    vi.resetModules();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gateway-skill-transfer-"));
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
      employeeId: "target",
      email: "target@example.com",
      name: "Target",
      department: "Platform",
      agentId: "target",
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
      presentation: { examplePrompts: [] },
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
    await skillsHandlers["skillhub.transferOwnership"]({
      params: {
        slug: "demo-skill",
        targetAccountId: "target",
      },
      respond,
      client: {
        connect: { role: "employee" },
        internal: { employee: { employeeId: "owner", agentId: "owner", name: "Owner" } },
      },
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        slug: "demo-skill",
        message: expect.stringContaining("Ownership transferred to Target"),
      }),
      undefined,
    );

    const updated = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      owner: { accountId: string; name?: string };
      updatedAt: string;
    };
    expect(updated.owner.accountId).toBe("target");
    expect(updated.updatedAt).toBe("2026-05-21T00:00:00.000Z");

    respond = createRespond();
    await skillsHandlers["skillhub.transferOwnership"]({
      params: {
        slug: "demo-skill",
        targetAccountId: "owner",
      },
      respond,
      client: {
        connect: { role: "employee" },
        internal: { employee: { employeeId: "admin", agentId: "admin", name: "Admin" } },
      },
    } as never);
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: expect.stringContaining("admins must provide a transfer reason"),
      }),
    );
  });
});
