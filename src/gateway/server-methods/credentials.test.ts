import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provisionEmployeeAccount } from "../../accounts/account-provisioning.js";
import { resetPlatformClawDatabaseForTests } from "../../accounts/db.js";
import { credentialHandlers } from "./credentials.js";

function createRespond() {
  return vi.fn();
}

function employeeClient(employeeId: string) {
  return {
    connect: { role: "employee" },
    internal: { employee: { employeeId, agentId: employeeId } },
  };
}

describe("credential gateway handlers", () => {
  let tempDir = "";

  afterEach(async () => {
    resetPlatformClawDatabaseForTests();
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS;
    delete process.env.PLATFORMCLAW_MASTER_KEY;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("lets admins manage definitions and employees manage only their own encrypted credentials", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-credential-handlers-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "eon";
    process.env.PLATFORMCLAW_MASTER_KEY = randomBytes(32).toString("base64");
    const config = {
      agents: {
        defaults: {
          workspace: path.join(tempDir, "workspaces"),
        },
      },
    };
    provisionEmployeeAccount({
      config,
      employeeId: "eon",
      email: "eon@example.com",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    });
    provisionEmployeeAccount({
      config,
      employeeId: "user-a",
      email: "user-a@example.com",
      name: "User A",
      department: "Platform",
      agentId: "user-a",
    });

    let respond = createRespond();
    await credentialHandlers["credentials.status"]({
      params: {},
      respond,
      client: employeeClient("user-a"),
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        encryptionReady: true,
        keyName: "PLATFORMCLAW_MASTER_KEY",
        message: null,
      }),
      undefined,
    );

    respond = createRespond();
    await credentialHandlers["credentials.definitions.upsert"]({
      params: {
        key: "jira.default",
        label: "Jira Token",
        type: "jira_token",
        description: "Jira 작업용 토큰",
        descriptionEn: "Token used for Jira actions.",
        usageHint: "Jira 이슈 생성 Skill",
        ownerPolicy: "account",
        rotationDays: 90,
        required: true,
      },
      respond,
      client: employeeClient("eon"),
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        definition: expect.objectContaining({
          key: "jira.default",
          descriptionEn: "Token used for Jira actions.",
          usageHint: "Jira 이슈 생성 Skill",
        }),
      }),
      undefined,
    );

    respond = createRespond();
    await credentialHandlers["credentials.upsert"]({
      params: {
        definitionKey: "jira.default",
        value: "jira-secret-token",
      },
      respond,
      client: employeeClient("user-a"),
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        ok: true,
        credential: expect.objectContaining({
          definitionKey: "jira.default",
          ownerType: "account",
          ownerId: "user-a",
        }),
      }),
      undefined,
    );
    expect(JSON.stringify(respond.mock.calls)).not.toContain("jira-secret-token");

    respond = createRespond();
    await credentialHandlers["credentials.list"]({
      params: {},
      respond,
      client: employeeClient("user-a"),
    } as never);
    const listPayload = respond.mock.calls[0]?.[1] as { entries: unknown[] };
    expect(listPayload.entries).toHaveLength(1);
    expect(JSON.stringify(listPayload)).not.toContain("jira-secret-token");

    respond = createRespond();
    await credentialHandlers["credentials.revoke"]({
      params: { definitionKey: "jira.default" },
      respond,
      client: employeeClient("user-a"),
    } as never);
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);

    respond = createRespond();
    await credentialHandlers["credentials.list"]({
      params: {},
      respond,
      client: employeeClient("user-a"),
    } as never);
    expect((respond.mock.calls[0]?.[1] as { entries: unknown[] }).entries).toEqual([]);

    respond = createRespond();
    await credentialHandlers["credentials.definitions.delete"]({
      params: { key: "jira.default" },
      respond,
      client: employeeClient("eon"),
    } as never);
    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined);

    respond = createRespond();
    await credentialHandlers["credentials.definitions.list"]({
      params: {},
      respond,
      client: employeeClient("user-a"),
    } as never);
    expect((respond.mock.calls[0]?.[1] as { entries: unknown[] }).entries).toEqual([]);
  });

  it("rejects definition writes from non-admin employees", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-credential-handlers-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "eon";
    const config = { agents: { defaults: { workspace: path.join(tempDir, "workspaces") } } };
    provisionEmployeeAccount({
      config,
      employeeId: "user-a",
      agentId: "user-a",
    });

    const respond = createRespond();
    await credentialHandlers["credentials.definitions.upsert"]({
      params: {
        key: "jira.default",
        label: "Jira Token",
        type: "jira_token",
      },
      respond,
      client: employeeClient("user-a"),
    } as never);

    expect(respond.mock.calls[0]?.[0]).toBe(false);
    expect(JSON.stringify(respond.mock.calls[0]?.[2])).toContain("admin access required");
  });

  it("reports missing encryption key without returning secret material", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-credential-handlers-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    delete process.env.PLATFORMCLAW_MASTER_KEY;
    const config = { agents: { defaults: { workspace: path.join(tempDir, "workspaces") } } };
    provisionEmployeeAccount({
      config,
      employeeId: "user-a",
      agentId: "user-a",
    });

    const respond = createRespond();
    await credentialHandlers["credentials.status"]({
      params: {},
      respond,
      client: employeeClient("user-a"),
    } as never);

    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        encryptionReady: false,
        keyName: "PLATFORMCLAW_MASTER_KEY",
      }),
      undefined,
    );
    expect(JSON.stringify(respond.mock.calls)).not.toContain("base64:");
  });
});
