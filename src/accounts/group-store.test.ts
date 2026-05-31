import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionEmployeeAccount } from "./account-provisioning.js";
import {
  addGroupMembership,
  canManageGroupScope,
  createGroup,
  createPart,
  getGroupDetail,
  removeGroupMembership,
} from "./group-store.js";
import { resetPlatformClawDatabaseForTests } from "./db.js";

describe("group store", () => {
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

  it("lets a group leader manage membership in child parts without duplicating memberships", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-groups-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "eon";
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
      employeeId: "leader",
      email: "leader@example.com",
      name: "Leader",
      department: "Platform",
      agentId: "leader",
    });
    provisionEmployeeAccount({
      config,
      employeeId: "member",
      email: "member@example.com",
      name: "Member",
      department: "Platform",
      agentId: "member",
    });

    const group = createGroup({
      actorAccountId: "eon",
      name: "Platform",
      description: "Platform group",
    });
    const part = createPart({
      actorAccountId: "eon",
      groupId: group.id,
      name: "Agents",
      description: "Agents part",
    });

    addGroupMembership({
      actorAccountId: "eon",
      targetAccountId: "leader",
      scopeType: "group",
      scopeId: group.id,
      groupRole: "leader",
    });

    expect(
      canManageGroupScope({
        accountId: "leader",
        scopeType: "part",
        scopeId: part.id,
      }),
    ).toBe(true);

    addGroupMembership({
      actorAccountId: "leader",
      targetAccountId: "member",
      scopeType: "part",
      scopeId: part.id,
      groupRole: "member",
    });

    const detail = getGroupDetail({
      actorAccountId: "leader",
      groupId: group.id,
    });
    expect(detail?.members).toHaveLength(1);
    expect(detail?.members[0]?.accountId).toBe("leader");
    expect(detail?.parts[0]?.members.map((entry) => entry.accountId)).toEqual(["member"]);
  });

  it("prevents a non-admin leader from removing themselves from a managed scope", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-groups-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "eon";
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
      employeeId: "leader",
      email: "leader@example.com",
      name: "Leader",
      department: "Platform",
      agentId: "leader",
    });

    const group = createGroup({
      actorAccountId: "eon",
      name: "Research",
      description: "Research group",
    });
    addGroupMembership({
      actorAccountId: "eon",
      targetAccountId: "leader",
      scopeType: "group",
      scopeId: group.id,
      groupRole: "leader",
    });

    expect(() =>
      removeGroupMembership({
        actorAccountId: "leader",
        targetAccountId: "leader",
        scopeType: "group",
        scopeId: group.id,
      }),
    ).toThrow("leaders cannot remove themselves from managed scopes");
  });
});
