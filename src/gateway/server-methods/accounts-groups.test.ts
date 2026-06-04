import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { provisionEmployeeAccount } from "../../accounts/account-provisioning.js";
import { resetPlatformClawDatabaseForTests } from "../../accounts/db.js";
import { accountGroupHandlers } from "./accounts-groups.js";

function createRespond() {
  return vi.fn();
}

describe("accounts/groups gateway handlers", () => {
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

  it("creates groups and parts, manages memberships, and archives through gateway handlers", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gateway-groups-"));
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

    const adminClient = {
      connect: { role: "employee" },
      internal: { employee: { employeeId: "eon", agentId: "eon" } },
    };
    const leaderClient = {
      connect: { role: "employee" },
      internal: { employee: { employeeId: "leader", agentId: "leader" } },
    };

    let respond = createRespond();
    await accountGroupHandlers["groups.create"]({
      params: { name: "Platform", description: "Platform group" },
      respond,
      client: adminClient,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, message: expect.stringContaining("Created group Platform") }),
      undefined,
    );

    respond = createRespond();
    await accountGroupHandlers["groups.list"]({
      params: {},
      respond,
      client: adminClient,
    } as never);
    const listPayload = respond.mock.calls[0]?.[1] as { entries: Array<{ id: string; name: string }> };
    expect(listPayload.entries).toHaveLength(1);
    const groupId = listPayload.entries[0]!.id;

    respond = createRespond();
    await accountGroupHandlers["groups.part.create"]({
      params: { groupId, name: "Agents", description: "Agents part" },
      respond,
      client: adminClient,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, message: expect.stringContaining("Created part Agents") }),
      undefined,
    );

    respond = createRespond();
    await accountGroupHandlers["groups.scopes.list"]({
      params: {},
      respond,
      client: adminClient,
    } as never);
    const scopePayload = respond.mock.calls[0]?.[1] as {
      entries: Array<{ scopeId: string; scopeType: "group" | "part"; label: string }>;
    };
    const partScope = scopePayload.entries.find((entry) => entry.scopeType === "part");
    expect(partScope?.label).toContain("Platform / Agents");

    respond = createRespond();
    await accountGroupHandlers["groups.update"]({
      params: { groupId, name: "Platform Core", description: "Core platform group" },
      respond,
      client: adminClient,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, message: "Updated group Platform Core" }),
      undefined,
    );

    respond = createRespond();
    await accountGroupHandlers["groups.part.update"]({
      params: { partId: partScope!.scopeId, name: "Automation", description: "Automation part" },
      respond,
      client: adminClient,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, message: "Updated part Automation" }),
      undefined,
    );

    respond = createRespond();
    await accountGroupHandlers["groups.members.add"]({
      params: { scopeType: "group", scopeId: groupId, accountId: "leader", groupRole: "leader" },
      respond,
      client: adminClient,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, message: "Member added." }),
      undefined,
    );

    respond = createRespond();
    await accountGroupHandlers["groups.members.add"]({
      params: { scopeType: "part", scopeId: partScope!.scopeId, accountId: "member" },
      respond,
      client: leaderClient,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, message: "Member added." }),
      undefined,
    );

    respond = createRespond();
    await accountGroupHandlers["groups.detail"]({
      params: { groupId },
      respond,
      client: adminClient,
    } as never);
    const detailPayload = respond.mock.calls[0]?.[1] as {
      detail: {
        group: { name: string };
        members: Array<{ accountId: string }>;
        parts: Array<{ id: string; name: string; members: Array<{ accountId: string }> }>;
      };
    };
    expect(detailPayload.detail.group.name).toBe("Platform Core");
    expect(detailPayload.detail.members.map((entry) => entry.accountId)).toEqual(["leader"]);
    expect(detailPayload.detail.parts[0]?.name).toBe("Automation");
    expect(detailPayload.detail.parts[0]?.members.map((entry) => entry.accountId)).toEqual(["member"]);

    respond = createRespond();
    await accountGroupHandlers["groups.members.remove"]({
      params: { scopeType: "part", scopeId: partScope!.scopeId, accountId: "member" },
      respond,
      client: leaderClient,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, message: "Member removed." }),
      undefined,
    );

    respond = createRespond();
    await accountGroupHandlers["groups.archive"]({
      params: { scopeId: partScope!.scopeId },
      respond,
      client: adminClient,
    } as never);
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ ok: true, message: expect.stringContaining("Archived Automation") }),
      undefined,
    );

    respond = createRespond();
    await accountGroupHandlers["admin.accounts.list"]({
      params: {},
      respond,
      client: adminClient,
    } as never);
    const accountsPayload = respond.mock.calls[0]?.[1] as { entries: Array<{ accountId: string }> };
    expect(accountsPayload.entries.some((entry) => entry.accountId === "leader")).toBe(true);
  });
});
