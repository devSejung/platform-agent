import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionEmployeeAccount } from "./account-provisioning.js";
import {
  buildAccountSummary,
  getAccountById,
  resolveInitialAdminEmployeeIds,
} from "./account-store.js";
import { resetPlatformClawDatabaseForTests, resolvePlatformClawSqlitePath } from "./db.js";

describe("account provisioning", () => {
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

  it("defaults initial admin seed to test_admin and eon", () => {
    expect(resolveInitialAdminEmployeeIds()).toEqual(new Set(["test_admin", "eon"]));
  });

  it("provisions seeded admins and builds account summary", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-account-test-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "test_admin,eon";

    const result = provisionEmployeeAccount({
      config: {
        agents: {
          defaults: {
            workspace: path.join(tempDir, "workspaces"),
          },
        },
      },
      employeeId: "eon",
      email: "eon@example.com",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    });

    expect(result.account.globalRole).toBe("admin");
    expect(getAccountById("eon")).toMatchObject({
      id: "eon",
      employeeId: "eon",
      email: "eon@example.com",
      displayName: "Eon",
      department: "Platform",
      globalRole: "admin",
      status: "active",
    });
    expect(buildAccountSummary("eon")).toEqual({
      accountId: "eon",
      globalRole: "admin",
      groupCount: 0,
      partCount: 0,
      topLevelGroupNames: [],
      hasAdminAccess: true,
      hasLeaderScope: false,
    });
    expect(resolvePlatformClawSqlitePath()).toBe(path.join(tempDir, "platformclaw.sqlite"));
  });
});
