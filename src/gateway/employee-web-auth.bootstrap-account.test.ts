import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signEmployeeSessionToken } from "./employee-auth.js";
import { handleEmployeeBootstrapRequest } from "./employee-web-auth.js";
import { makeMockHttpResponse } from "./test-http-response.js";
import { resetPlatformClawDatabaseForTests } from "../accounts/db.js";

describe("handleEmployeeBootstrapRequest account summary", () => {
  let tempDir = "";

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

  it("returns account summary and provisions legacy session users into the account store", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-bootstrap-account-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-test-secret";
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "eon";
    const token = signEmployeeSessionToken(
      {
        employeeId: "eon",
        name: "Eon",
        department: "Platform",
        agentId: "eon",
        sessionKey: "agent:eon:main",
        iat: 1_700_000_000,
        exp: 1_900_000_000,
      },
      process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET,
    );

    const { res, end } = makeMockHttpResponse();
    const handled = handleEmployeeBootstrapRequest(
      {
        url: "/auth/me",
        method: "GET",
        headers: {
          cookie: `openclaw_employee_session=${encodeURIComponent(token)}`,
        },
      } as IncomingMessage,
      res,
      {
        agents: {
          defaults: {
            workspace: path.join(tempDir, "workspaces"),
          },
        },
      },
      "ws://127.0.0.1:19001",
    );

    expect(handled).toBe(true);
    const payload = JSON.parse(String(end.mock.calls[0]?.[0] ?? "")) as {
      authenticated: boolean;
      account?: {
        accountId: string;
        globalRole: string;
        groupCount: number;
        partCount: number;
        topLevelGroupNames: string[];
        hasAdminAccess: boolean;
        hasLeaderScope: boolean;
      };
    };
    expect(payload.authenticated).toBe(true);
    expect(payload.account).toEqual({
      accountId: "eon",
      globalRole: "admin",
      groupCount: 0,
      partCount: 0,
      topLevelGroupNames: [],
      hasAdminAccess: true,
      hasLeaderScope: false,
    });
  });
});
