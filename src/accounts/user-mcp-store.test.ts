import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionEmployeeAccount } from "./account-provisioning.js";
import { resetPlatformClawDatabaseForTests } from "./db.js";
import {
  authorizeUserMcpToolCall,
  createUserMcpServer,
  deleteUserMcpServer,
  getUserMcpAdminPolicy,
  getUserMcpServer,
  listUserMcpServers,
  resolveUserMcpRuntimeServers,
  setUserMcpAdminPolicy,
  updateUserMcpServer,
} from "./user-mcp-store.js";

describe("user MCP store", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-user-mcp-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
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
    delete process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("isolates CRUD by authenticated owner", () => {
    const a = createUserMcpServer({
      ownerUserId: "user-a",
      input: {
        name: "A server",
        transport: "streamable-http",
        config: { url: "https://example.com/mcp" },
        toolPolicy: { mode: "allowlist", tools: ["search"] },
      },
    });
    const b = createUserMcpServer({
      ownerUserId: "user-b",
      input: { name: "B server", transport: "sse", config: { url: "https://example.org/sse" } },
    });

    expect(listUserMcpServers("user-a").map((server) => server.id)).toEqual([a.id]);
    expect(listUserMcpServers("user-b").map((server) => server.id)).toEqual([b.id]);
    expect(getUserMcpServer("user-a", b.id)).toBeNull();
    expect(
      updateUserMcpServer({ ownerUserId: "user-a", serverId: b.id, input: { name: "stolen" } }),
    ).toBeNull();
    expect(deleteUserMcpServer("user-a", b.id)).toBe(false);
    expect(
      authorizeUserMcpToolCall({ ownerUserId: "user-a", serverId: a.id, toolName: "search" }),
    ).toBe(true);
    expect(
      authorizeUserMcpToolCall({ ownerUserId: "user-a", serverId: a.id, toolName: "delete" }),
    ).toBe(false);
  });

  it("blocks private, credential-bearing, and secret-query remote URLs", () => {
    const create = (url: string) =>
      createUserMcpServer({
        ownerUserId: "user-a",
        input: { name: url, transport: "streamable-http", config: { url } },
      });
    expect(() => create("http://127.0.0.1/mcp")).toThrow("blocked_by_policy");
    expect(() => create("https://user:pass@example.com/mcp")).toThrow("invalid_url");
    expect(() => create("https://example.com/mcp?api_key=secret")).toThrow("invalid_url");
  });

  it("keeps stdio blocked until an administrator supplies a constrained template", () => {
    const stdioInput = {
      name: "stdio",
      transport: "stdio",
      config: { templateId: "approved", args: ["--safe"], env: { LOCALE: "ko" } },
    };
    expect(() => createUserMcpServer({ ownerUserId: "user-a", input: stdioInput })).toThrow(
      "command_not_allowed",
    );

    setUserMcpAdminPolicy({
      actorUserId: "admin",
      policy: {
        ...getUserMcpAdminPolicy(),
        stdioTemplates: [
          {
            id: "approved",
            label: "Approved",
            command: "mcp-approved",
            allowedArgs: ["--safe"],
            allowedEnv: ["LOCALE"],
          },
        ],
      },
    });
    const server = createUserMcpServer({ ownerUserId: "user-a", input: stdioInput });
    const runtime = resolveUserMcpRuntimeServers("user-a") as Record<
      string,
      Record<string, unknown>
    >;
    expect(runtime[`user_${server.id.replaceAll("-", "_")}`]).toMatchObject({
      command: "mcp-approved",
      args: ["--safe"],
      env: { LOCALE: "ko" },
    });
    expect(() =>
      updateUserMcpServer({
        ownerUserId: "user-a",
        serverId: server.id,
        input: { config: { templateId: "approved", env: { API_TOKEN: "secret" } } },
      }),
    ).toThrow("secret_env_not_supported");
  });
});
