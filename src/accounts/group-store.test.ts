import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionEmployeeAccount } from "./account-provisioning.js";
import {
  addGroupMembership,
  archiveGroupScope,
  canManageGroupScope,
  createGroup,
  createPart,
  getGroupDetail,
  approveGroupJoinRequest,
  listGroupScopeOptions,
  listGroupEntries,
  listVisibleGroupJoinRequests,
  removeGroupMembership,
  restoreGroupScope,
  upsertGroupJoinRequest,
} from "./group-store.js";
import { getPlatformClawDatabase } from "./db.js";
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

  it("approves join requests with a part membership only", async () => {
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

    const request = upsertGroupJoinRequest({
      accountId: "member",
      groupId: group.id,
      partId: part.id,
    });
    approveGroupJoinRequest({
      actorAccountId: "eon",
      requestId: request.id,
    });

    const { db } = getPlatformClawDatabase();
    const memberships = db
      .prepare(
        `SELECT scope_type, scope_id, group_role
           FROM group_memberships
          WHERE account_id = ?
          ORDER BY scope_type, scope_id`,
      )
      .all("member") as Array<{ scope_type: string; scope_id: string; group_role: string }>;

    expect(memberships).toEqual([
      {
        scope_type: "part",
        scope_id: part.id,
        group_role: "member",
      },
    ]);
  });

  it("limits part leaders to reviewing join requests for their own part", async () => {
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

    for (const employeeId of ["eon", "part_leader", "member_a", "member_b"] as const) {
      provisionEmployeeAccount({
        config,
        employeeId,
        email: `${employeeId}@example.com`,
        name: employeeId,
        department: "Platform",
        agentId: employeeId,
      });
    }

    const group = createGroup({
      actorAccountId: "eon",
      name: "Platform",
      description: "Platform group",
    });
    const partA = createPart({
      actorAccountId: "eon",
      groupId: group.id,
      name: "Part A",
      description: "Part A",
    });
    const partB = createPart({
      actorAccountId: "eon",
      groupId: group.id,
      name: "Part B",
      description: "Part B",
    });

    addGroupMembership({
      actorAccountId: "eon",
      targetAccountId: "part_leader",
      scopeType: "part",
      scopeId: partA.id,
      groupRole: "leader",
    });

    const requestA = upsertGroupJoinRequest({
      accountId: "member_a",
      groupId: group.id,
      partId: partA.id,
    });
    const requestB = upsertGroupJoinRequest({
      accountId: "member_b",
      groupId: group.id,
      partId: partB.id,
    });

    const visible = listVisibleGroupJoinRequests({
      actorAccountId: "part_leader",
    });
    expect(visible.map((entry) => entry.id)).toEqual([requestA.id]);

    approveGroupJoinRequest({
      actorAccountId: "part_leader",
      requestId: requestA.id,
    });
    expect(() =>
      approveGroupJoinRequest({
        actorAccountId: "part_leader",
        requestId: requestB.id,
      }),
    ).toThrow("not allowed to review this join request");
  });

  it("allows group leaders to assign part leaders within their group", async () => {
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

    for (const employeeId of ["eon", "group_leader", "part_leader"] as const) {
      provisionEmployeeAccount({
        config,
        employeeId,
        email: `${employeeId}@example.com`,
        name: employeeId,
        department: "Platform",
        agentId: employeeId,
      });
    }

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
      targetAccountId: "group_leader",
      scopeType: "group",
      scopeId: group.id,
      groupRole: "leader",
    });

    addGroupMembership({
      actorAccountId: "group_leader",
      targetAccountId: "part_leader",
      scopeType: "part",
      scopeId: part.id,
      groupRole: "leader",
    });

    const { db } = getPlatformClawDatabase();
    const membership = db
      .prepare(
        `SELECT scope_type, scope_id, group_role
           FROM group_memberships
          WHERE account_id = ? AND scope_id = ?`,
      )
      .get("part_leader", part.id) as
      | { scope_type: string; scope_id: string; group_role: string }
      | undefined;
    expect(membership).toEqual({
      scope_type: "part",
      scope_id: part.id,
      group_role: "leader",
    });

    expect(
      listGroupScopeOptions({
        actorAccountId: "group_leader",
      }).map((entry) => entry.label),
    ).toEqual(["Platform", "Platform / Agents"]);
  });

  it("does not let part leaders promote other part leaders", async () => {
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

    for (const employeeId of ["eon", "part_leader", "member"] as const) {
      provisionEmployeeAccount({
        config,
        employeeId,
        email: `${employeeId}@example.com`,
        name: employeeId,
        department: "Platform",
        agentId: employeeId,
      });
    }

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
      targetAccountId: "part_leader",
      scopeType: "part",
      scopeId: part.id,
      groupRole: "leader",
    });

    expect(() =>
      addGroupMembership({
        actorAccountId: "part_leader",
        targetAccountId: "member",
        scopeType: "part",
        scopeId: part.id,
        groupRole: "leader",
      }),
    ).toThrow("leaders can only add members");

    expect(
      listGroupScopeOptions({
        actorAccountId: "part_leader",
      }).map((entry) => entry.label),
    ).toEqual(["Platform / Agents"]);
  });

  it("lets admins restore archived groups", async () => {
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

    for (const employeeId of ["eon", "member"] as const) {
      provisionEmployeeAccount({
        config,
        employeeId,
        email: `${employeeId}@example.com`,
        name: employeeId,
        department: "Platform",
        agentId: employeeId,
      });
    }

    const group = createGroup({
      actorAccountId: "eon",
      name: "Platform",
      description: "Platform group",
    });

    archiveGroupScope({
      actorAccountId: "eon",
      scopeId: group.id,
    });
    expect(
      listGroupEntries({
        actorAccountId: "eon",
        includeArchived: true,
      })[0]?.archivedAt,
    ).not.toBeNull();

    expect(() =>
      restoreGroupScope({
        actorAccountId: "member",
        scopeId: group.id,
      }),
    ).toThrow("only admins can restore groups or parts");

    restoreGroupScope({
      actorAccountId: "eon",
      scopeId: group.id,
    });

    expect(
      listGroupEntries({
        actorAccountId: "eon",
        includeArchived: true,
      })[0]?.archivedAt,
    ).toBeNull();
  });
});
