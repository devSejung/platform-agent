import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPlatformClawDatabase, resetPlatformClawDatabaseForTests } from "../accounts/db.js";
import { SQLiteCredentialService } from "./sqlite-credential-service.js";

describe("SQLiteCredentialService", () => {
  let tempDir = "";
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-credentials-test-"));
    env = {
      OPENCLAW_STATE_DIR: tempDir,
      PLATFORMCLAW_MASTER_KEY: randomBytes(32).toString("base64"),
    };
  });

  afterEach(async () => {
    resetPlatformClawDatabaseForTests();
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("creates definitions and stores encrypted credential values", async () => {
    const service = new SQLiteCredentialService({ env });
    const definition = await service.createDefinition({
      key: "jira.default",
      label: "Jira Token",
      type: "jira_token",
      description: "Jira API token",
      descriptionEn: "Jira API token for English users",
      ownerPolicy: "mixed",
      rotationDays: 90,
      required: true,
    });

    expect(definition).toMatchObject({
      key: "jira.default",
      label: "Jira Token",
      type: "jira_token",
      description: "Jira API token",
      descriptionEn: "Jira API token for English users",
      ownerPolicy: "mixed",
      rotationDays: 90,
      required: true,
    });

    const metadata = await service.upsertCredential({
      definitionKey: "jira.default",
      ownerType: "account",
      ownerId: "user-a",
      value: "jira-secret-token",
    });

    expect(metadata).toMatchObject({
      definitionKey: "jira.default",
      ownerType: "account",
      ownerId: "user-a",
      type: "jira_token",
      revokedAt: null,
    });

    const { db } = getPlatformClawDatabase(env);
    const row = db
      .prepare(`SELECT encrypted_value FROM credentials WHERE id = ?`)
      .get(metadata.id) as { encrypted_value: string };
    expect(row.encrypted_value).not.toContain("jira-secret-token");

    const resolved = await service.getCredential({
      definitionKey: "jira.default",
      scope: { ownerType: "account", ownerId: "user-a" },
    });
    expect(resolved.value).toBe("jira-secret-token");
    expect(resolved.lastUsedAt).toEqual(expect.any(String));
  });

  it("keeps credential owners separated by scope", async () => {
    const service = new SQLiteCredentialService({ env });
    await service.createDefinition({
      key: "jira.default",
      label: "Jira Token",
      type: "jira_token",
      ownerPolicy: "mixed",
    });
    await service.upsertCredential({
      definitionKey: "jira.default",
      ownerType: "account",
      ownerId: "user-a",
      value: "token-a",
    });
    await service.upsertCredential({
      definitionKey: "jira.default",
      ownerType: "account",
      ownerId: "user-b",
      value: "token-b",
    });

    await expect(
      service.getCredential({
        definitionKey: "jira.default",
        scope: { ownerType: "account", ownerId: "user-c" },
      }),
    ).rejects.toThrow("Credential was not found");
    await expect(
      service.getCredential({
        definitionKey: "jira.default",
        scope: { ownerType: "account", ownerId: "user-a" },
      }),
    ).resolves.toMatchObject({ value: "token-a" });
    await expect(
      service.getCredential({
        definitionKey: "jira.default",
        scope: { ownerType: "account", ownerId: "user-b" },
      }),
    ).resolves.toMatchObject({ value: "token-b" });
  });

  it("archives credential definitions without deleting stored rows", async () => {
    const service = new SQLiteCredentialService({ env });
    await service.createDefinition({
      key: "jira.default",
      label: "Jira Token",
      type: "jira_token",
      ownerPolicy: "account",
    });
    await service.upsertCredential({
      definitionKey: "jira.default",
      ownerType: "account",
      ownerId: "user-a",
      value: "token-a",
    });

    await service.archiveDefinition("jira.default");

    await expect(service.listDefinitions()).resolves.toEqual([]);
    await expect(
      service.listCredentials({ ownerType: "account", ownerId: "user-a" }),
    ).resolves.toEqual([]);
    const { db } = getPlatformClawDatabase(env);
    const row = db.prepare(`SELECT archived_at FROM credential_definitions`).get() as {
      archived_at: string | null;
    };
    expect(row.archived_at).toEqual(expect.any(String));
  });

  it("enforces owner policy", async () => {
    const service = new SQLiteCredentialService({ env });
    await service.createDefinition({
      key: "mail.default",
      label: "Mail App Password",
      type: "mail_app_password",
      ownerPolicy: "account",
    });

    await expect(
      service.upsertCredential({
        definitionKey: "mail.default",
        ownerType: "room",
        ownerId: "group-123",
        value: "mail-secret",
      }),
    ).rejects.toThrow('does not allow "room" scope');
  });

  it("rejects invalid expiration timestamps", async () => {
    const service = new SQLiteCredentialService({ env });
    await service.createDefinition({
      key: "internal.api",
      label: "Internal API",
      type: "api_token",
      ownerPolicy: "account",
    });

    await expect(
      service.upsertCredential({
        definitionKey: "internal.api",
        ownerType: "account",
        ownerId: "user-a",
        value: "api-token",
        expiresAt: "not-a-date",
      }),
    ).rejects.toThrow("expiresAt must be a valid timestamp");
  });

  it("revokes and expires credentials", async () => {
    const service = new SQLiteCredentialService({ env });
    await service.createDefinition({
      key: "github.default",
      label: "GitHub PAT",
      type: "api_token",
      ownerPolicy: "account",
    });
    await service.upsertCredential({
      definitionKey: "github.default",
      ownerType: "account",
      ownerId: "user-a",
      value: "expired-token",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });

    await expect(
      service.getCredential({
        definitionKey: "github.default",
        scope: { ownerType: "account", ownerId: "user-a" },
      }),
    ).rejects.toThrow("expired");

    await service.upsertCredential({
      definitionKey: "github.default",
      ownerType: "account",
      ownerId: "user-a",
      value: "fresh-token",
    });
    await service.revokeCredential({
      definitionKey: "github.default",
      scope: { ownerType: "account", ownerId: "user-a" },
    });

    await expect(
      service.getCredential({
        definitionKey: "github.default",
        scope: { ownerType: "account", ownerId: "user-a" },
      }),
    ).rejects.toThrow("Credential was not found");
  });

  it("grants and revokes skill credential permissions", async () => {
    const service = new SQLiteCredentialService({ env });
    await service.createDefinition({
      key: "jira.default",
      label: "Jira Token",
      type: "jira_token",
      ownerPolicy: "account",
    });

    await expect(
      service.hasCredentialGrant({
        definitionKey: "jira.default",
        skillId: "jira",
        permission: "jira.write",
      }),
    ).resolves.toBe(false);

    const grant = await service.grantCredential({
      definitionKey: "jira.default",
      skillId: "jira",
      permission: "jira.write",
      grantedByAccountId: "admin-1",
    });
    expect(grant).toMatchObject({
      definitionKey: "jira.default",
      skillId: "jira",
      permission: "jira.write",
      grantedByAccountId: "admin-1",
      revokedAt: null,
    });
    await expect(
      service.hasCredentialGrant({
        definitionKey: "jira.default",
        skillId: "jira",
        permission: "jira.write",
      }),
    ).resolves.toBe(true);

    await service.revokeCredentialGrant({
      definitionKey: "jira.default",
      skillId: "jira",
      permission: "jira.write",
    });
    await expect(
      service.hasCredentialGrant({
        definitionKey: "jira.default",
        skillId: "jira",
        permission: "jira.write",
      }),
    ).resolves.toBe(false);
  });
});
