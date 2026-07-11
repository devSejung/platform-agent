import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPlatformClawDatabaseForTests } from "../../accounts/db.js";
import { SQLiteCredentialService } from "../../credentials/index.js";
import { writeSkill } from "../skills.e2e-test-helpers.js";
import { preflightSkillCredentials } from "./credential-preflight.js";

describe("preflightSkillCredentials", () => {
  let tempDir = "";
  let envSnapshot: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-skill-credential-"));
    envSnapshot = { ...process.env };
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.PLATFORMCLAW_MASTER_KEY = randomBytes(32).toString("base64");
  });

  afterEach(async () => {
    resetPlatformClawDatabaseForTests();
    process.env = envSnapshot;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function writeJiraSkill() {
    const skillDir = path.join(tempDir, "skills", "jira-writer");
    await writeSkill({
      dir: skillDir,
      name: "jira-writer",
      description: "Write Jira issues",
      metadata: '{ "openclaw": { "requires": { "credentials": ["jira.default"] } } }',
      body: "# Jira writer\n",
    });
    const scriptPath = path.join(skillDir, "jira.py");
    await fs.writeFile(scriptPath, "print('jira')\n", "utf-8");
    return { skillDir, scriptPath };
  }

  it("does nothing when the command does not reference a credential-gated skill", async () => {
    await writeJiraSkill();

    await expect(
      preflightSkillCredentials({
        command: "echo ok",
        workdir: tempDir,
        workspaceDir: tempDir,
        accountId: "user-a",
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("blocks a matched skill when the current account is missing the declared credential", async () => {
    const { scriptPath } = await writeJiraSkill();

    const result = await preflightSkillCredentials({
      command: `python ${scriptPath}`,
      workdir: tempDir,
      workspaceDir: tempDir,
      accountId: "user-a",
    });

    expect(result).toMatchObject({
      ok: false,
      skillName: "jira-writer",
      missingCredentials: ["jira.default"],
    });
    expect(result.ok === false ? result.message : "").toContain("Credentials tab");
  });

  it("passes a matched skill when the current account has the declared credential", async () => {
    const { scriptPath } = await writeJiraSkill();
    const service = new SQLiteCredentialService();
    await service.createDefinition({
      key: "jira.default",
      label: "Jira Token",
      type: "api_token",
      ownerPolicy: "account",
    });
    await service.upsertCredential({
      definitionKey: "jira.default",
      ownerType: "account",
      ownerId: "user-a",
      value: "jira-secret-token",
    });

    await expect(
      preflightSkillCredentials({
        command: `python ${scriptPath}`,
        workdir: tempDir,
        workspaceDir: tempDir,
        accountId: "user-a",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
