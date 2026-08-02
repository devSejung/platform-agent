import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionEmployeeAccount } from "../accounts/account-provisioning.js";
import { resetPlatformClawDatabaseForTests } from "../accounts/db.js";
import { signEmployeeSessionToken } from "./employee-auth.js";
import { handleEmployeeUserMcpHttpRequest } from "./employee-user-mcp.js";
import { makeMockHttpResponse } from "./test-http-response.js";

describe("employee user MCP HTTP API", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-user-mcp-http-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "test-secret";
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "admin";
    for (const employeeId of ["admin", "user-a", "user-b"]) {
      provisionEmployeeAccount({
        config: { agents: { defaults: { workspace: path.join(tempDir, "workspaces") } } },
        employeeId,
        agentId: `${employeeId}-agent`,
      });
    }
  });

  afterEach(async () => {
    resetPlatformClawDatabaseForTests();
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET;
    delete process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function request(employeeId: string, url: string, method: string, body?: unknown) {
    const token = signEmployeeSessionToken({ employeeId, agentId: `${employeeId}-agent` });
    const { res, end } = makeMockHttpResponse();
    return handleEmployeeUserMcpHttpRequest({
      req: {
        url,
        method,
        headers: { cookie: `openclaw_employee_session=${encodeURIComponent(token)}` },
      } as IncomingMessage,
      res,
      readJsonBody: async () => ({ ok: true as const, value: body }),
    }).then(() => ({ status: res.statusCode, body: JSON.parse(String(end.mock.calls[0]?.[0])) }));
  }

  it("derives ownership from the employee session and isolates reads", async () => {
    const created = await request("user-a", "/api/user/mcp-servers", "POST", {
      name: "A",
      transport: "streamable-http",
      config: { url: "https://example.com/mcp" },
    });
    expect(created.status).toBe(201);
    const serverId = created.body.server.id as string;

    const aList = await request("user-a", "/api/user/mcp-servers", "GET");
    const bList = await request("user-b", "/api/user/mcp-servers", "GET");
    expect(aList.body.servers.map((server: { id: string }) => server.id)).toEqual([serverId]);
    expect(bList.body.servers).toEqual([]);
    expect((await request("user-b", `/api/user/mcp-servers/${serverId}`, "GET")).status).toBe(404);
    expect(
      (await request("user-b", `/api/user/mcp-servers/${serverId}`, "PATCH", { name: "stolen" }))
        .status,
    ).toBe(404);
    expect((await request("user-b", `/api/user/mcp-servers/${serverId}`, "DELETE")).status).toBe(
      404,
    );
  });

  it("exposes only redacted summaries to admins and supports forced disable", async () => {
    const created = await request("user-a", "/api/user/mcp-servers", "POST", {
      name: "Remote",
      transport: "sse",
      config: { url: "https://example.com/mcp?safe=value" },
    });
    const serverId = created.body.server.id as string;
    const listed = await request("admin", "/api/admin/mcp-servers", "GET");
    expect(listed.body.servers).toEqual([
      expect.objectContaining({
        id: serverId,
        ownerUserId: "user-a",
        targetSummary: "example.com",
      }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain("safe=value");
    expect(
      (
        await request("admin", `/api/admin/mcp-servers/${serverId}`, "PATCH", {
          forcedDisabled: true,
        })
      ).status,
    ).toBe(200);
    const detail = await request("user-a", `/api/user/mcp-servers/${serverId}`, "GET");
    expect(detail.body.server).toMatchObject({ forcedDisabled: true, status: "blocked_by_policy" });
    const audit = await request("admin", "/api/admin/mcp-audit", "GET");
    expect(audit.body.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "user_mcp.created", targetId: serverId }),
        expect.objectContaining({ eventType: "user_mcp.force_disabled", targetId: serverId }),
      ]),
    );
    expect(JSON.stringify(audit.body)).not.toContain("safe=value");
    expect((await request("user-a", "/api/admin/mcp-audit", "GET")).status).toBe(403);
  });
});
