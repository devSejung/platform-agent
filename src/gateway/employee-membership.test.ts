import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionEmployeeAccount } from "../accounts/account-provisioning.js";
import { resetPlatformClawDatabaseForTests } from "../accounts/db.js";
import {
  addGroupMembership,
  createGroup,
  createPart,
  rejectGroupJoinRequest,
} from "../accounts/group-store.js";
import { signEmployeeSessionToken } from "./employee-auth.js";
import { handleEmployeeMembershipHttpRequest } from "./employee-membership.js";
import { makeMockHttpResponse } from "./test-http-response.js";

function createEmployeeRequest(
  url: string,
  method: string,
  token: string,
): IncomingMessage {
  return {
    url,
    method,
    headers: {
      cookie: `openclaw_employee_session=${encodeURIComponent(token)}`,
    },
  } as IncomingMessage;
}

describe("employee membership bootstrap", () => {
  let tempDir = "";

  function createConfig() {
    return {
      agents: {
        defaults: {
          workspace: path.join(tempDir, "workspaces"),
        },
      },
    };
  }

  afterEach(async () => {
    resetPlatformClawDatabaseForTests();
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET;
    delete process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("reports missing membership until an approved membership exists", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-membership-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-membership-secret";
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "admin";
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    });
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "admin",
      name: "Admin",
      department: "Platform",
      agentId: "admin",
    });
    const group = createGroup({
      actorAccountId: "admin",
      name: "Platform",
    });
    const part = createPart({
      actorAccountId: "admin",
      groupId: group.id,
      name: "SoC Verification",
    });
    const token = signEmployeeSessionToken({
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
      sessionKey: "agent:eon:main",
      iat: 1_700_000_000,
      exp: 1_900_000_000,
    });

    const first = makeMockHttpResponse();
    await handleEmployeeMembershipHttpRequest({
      req: createEmployeeRequest("/employee/membership", "GET", token),
      res: first.res,
      readJsonBody: async () => ({ ok: false, error: "unused" }),
    });
    expect(JSON.parse(String(first.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      has_membership: false,
      has_valid_membership: false,
      reason: "NOT_REGISTERED",
      membership_status: "none",
      group_id: null,
      group_name: null,
      part_id: null,
      part_name: null,
      pending_request: null,
    });

    const save = makeMockHttpResponse();
    await handleEmployeeMembershipHttpRequest({
      req: createEmployeeRequest("/employee/group-join-request", "POST", token),
      res: save.res,
      readJsonBody: async () => ({
        ok: true,
        value: {
          group_id: group.id,
          part_id: part.id,
        },
      }),
    });
    expect(JSON.parse(String(save.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      success: true,
      request_id: expect.any(String),
      status: "pending",
      group_id: group.id,
      part_id: part.id,
    });

    const second = makeMockHttpResponse();
    await handleEmployeeMembershipHttpRequest({
      req: createEmployeeRequest("/employee/membership", "GET", token),
      res: second.res,
      readJsonBody: async () => ({ ok: false, error: "unused" }),
    });
    expect(JSON.parse(String(second.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      has_membership: false,
      has_valid_membership: false,
      reason: "NOT_REGISTERED",
      membership_status: "pending",
      group_id: null,
      group_name: null,
      part_id: null,
      part_name: null,
      pending_request: {
        request_id: expect.any(String),
        group_id: group.id,
        group_name: "Platform",
        part_id: part.id,
        part_name: "SoC Verification",
        status: "pending",
        requested_at: expect.any(String),
        reviewed_at: null,
        review_comment: null,
      },
    });
  });

  it("rejects parts that do not belong to the selected group", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-membership-invalid-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-membership-secret";
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "admin";
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    });
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "admin",
      name: "Admin",
      department: "Platform",
      agentId: "admin",
    });
    const firstGroup = createGroup({
      actorAccountId: "admin",
      name: "Platform",
    });
    const secondGroup = createGroup({
      actorAccountId: "admin",
      name: "Infra",
    });
    const part = createPart({
      actorAccountId: "admin",
      groupId: secondGroup.id,
      name: "SRE",
    });
    const token = signEmployeeSessionToken({
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
      sessionKey: "agent:eon:main",
      iat: 1_700_000_000,
      exp: 1_900_000_000,
    });

    const save = makeMockHttpResponse();
    await handleEmployeeMembershipHttpRequest({
      req: createEmployeeRequest("/employee/group-join-request", "POST", token),
      res: save.res,
      readJsonBody: async () => ({
        ok: true,
        value: {
          group_id: firstGroup.id,
          part_id: part.id,
        },
      }),
    });

    expect(save.res.statusCode).toBe(409);
    expect(JSON.parse(String(save.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      error: "selected part does not belong to the selected group",
    });
  });

  it("treats an approved part membership as valid without a duplicate group membership", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-membership-part-only-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-membership-secret";
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "admin";
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    });
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "admin",
      name: "Admin",
      department: "Platform",
      agentId: "admin",
    });
    const group = createGroup({
      actorAccountId: "admin",
      name: "Platform",
    });
    const part = createPart({
      actorAccountId: "admin",
      groupId: group.id,
      name: "SoC Verification",
    });
    addGroupMembership({
      actorAccountId: "admin",
      targetAccountId: "eon",
      scopeType: "part",
      scopeId: part.id,
      groupRole: "member",
    });
    const token = signEmployeeSessionToken({
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
      sessionKey: "agent:eon:main",
      iat: 1_700_000_000,
      exp: 1_900_000_000,
    });

    const status = makeMockHttpResponse();
    await handleEmployeeMembershipHttpRequest({
      req: createEmployeeRequest("/employee/membership", "GET", token),
      res: status.res,
      readJsonBody: async () => ({ ok: false, error: "unused" }),
    });
    expect(JSON.parse(String(status.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      has_membership: true,
      has_valid_membership: true,
      reason: null,
      membership_status: "approved",
      group_id: group.id,
      group_name: "Platform",
      part_id: part.id,
      part_name: "SoC Verification",
      pending_request: null,
    });
  });

  it("treats an active group membership as valid even without a part membership", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-membership-group-only-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-membership-secret";
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "admin";
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "leader",
      name: "Leader",
      department: "Platform",
      agentId: "leader",
    });
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "admin",
      name: "Admin",
      department: "Platform",
      agentId: "admin",
    });
    const group = createGroup({
      actorAccountId: "admin",
      name: "Platform",
    });
    addGroupMembership({
      actorAccountId: "admin",
      targetAccountId: "leader",
      scopeType: "group",
      scopeId: group.id,
      groupRole: "leader",
    });
    const token = signEmployeeSessionToken({
      employeeId: "leader",
      name: "Leader",
      department: "Platform",
      agentId: "leader",
      sessionKey: "agent:leader:main",
      iat: 1_700_000_000,
      exp: 1_900_000_000,
    });

    const status = makeMockHttpResponse();
    await handleEmployeeMembershipHttpRequest({
      req: createEmployeeRequest("/employee/membership", "GET", token),
      res: status.res,
      readJsonBody: async () => ({ ok: false, error: "unused" }),
    });
    expect(JSON.parse(String(status.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      has_membership: true,
      has_valid_membership: true,
      reason: null,
      membership_status: "approved",
      group_id: group.id,
      group_name: "Platform",
      part_id: null,
      part_name: null,
      pending_request: null,
    });
  });

  it("reports rejected join requests so employees can understand why bootstrap reopened", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-membership-rejected-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-membership-secret";
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "admin";
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    });
    provisionEmployeeAccount({
      config: createConfig(),
      employeeId: "admin",
      name: "Admin",
      department: "Platform",
      agentId: "admin",
    });
    const group = createGroup({
      actorAccountId: "admin",
      name: "Platform",
    });
    const part = createPart({
      actorAccountId: "admin",
      groupId: group.id,
      name: "SoC Verification",
    });
    const token = signEmployeeSessionToken({
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
      sessionKey: "agent:eon:main",
      iat: 1_700_000_000,
      exp: 1_900_000_000,
    });

    const save = makeMockHttpResponse();
    await handleEmployeeMembershipHttpRequest({
      req: createEmployeeRequest("/employee/group-join-request", "POST", token),
      res: save.res,
      readJsonBody: async () => ({
        ok: true,
        value: {
          group_id: group.id,
          part_id: part.id,
        },
      }),
    });
    const created = JSON.parse(String(save.end.mock.calls[0]?.[0] ?? ""));
    rejectGroupJoinRequest({
      actorAccountId: "admin",
      requestId: created.request_id,
    });

    const status = makeMockHttpResponse();
    await handleEmployeeMembershipHttpRequest({
      req: createEmployeeRequest("/employee/membership", "GET", token),
      res: status.res,
      readJsonBody: async () => ({ ok: false, error: "unused" }),
    });
    expect(JSON.parse(String(status.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      has_membership: false,
      has_valid_membership: false,
      reason: "NOT_REGISTERED",
      membership_status: "rejected",
      group_id: null,
      group_name: null,
      part_id: null,
      part_name: null,
      pending_request: {
        request_id: created.request_id,
        group_id: group.id,
        group_name: "Platform",
        part_id: part.id,
        part_name: "SoC Verification",
        status: "rejected",
        requested_at: expect.any(String),
        reviewed_at: expect.any(String),
        review_comment: null,
      },
    });
  });
});
