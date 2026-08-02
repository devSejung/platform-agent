import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { provisionEmployeeAccount } from "../accounts/account-provisioning.js";
import { resetPlatformClawDatabaseForTests } from "../accounts/db.js";
import {
  createUserMcpServer,
  getUserMcpAdminPolicy,
  setUserMcpAdminPolicy,
  updateUserMcpServer,
} from "../accounts/user-mcp-store.js";
import { cleanupBundleMcpHarness, startSseProbeServer } from "./pi-bundle-mcp-test-harness.js";
import {
  __testing,
  disposeUserMcpRuntimes,
  getOrCreateSessionMcpRuntime,
  materializeBundleMcpToolsForRun,
} from "./pi-bundle-mcp-tools.js";

describe("user MCP runtime isolation", () => {
  let tempDir = "";

  beforeEach(async () => {
    vi.useRealTimers();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-user-mcp-runtime-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS = "admin";
    for (const employeeId of ["admin", "user-a", "user-b"]) {
      provisionEmployeeAccount({
        config: { agents: { defaults: { workspace: path.join(tempDir, "workspaces") } } },
        employeeId,
        agentId: `${employeeId}-agent`,
      });
    }
    setUserMcpAdminPolicy({
      actorUserId: "admin",
      policy: { ...getUserMcpAdminPolicy(), allowPrivateNetwork: true },
    });
  });

  afterEach(async () => {
    await __testing.resetSessionMcpRuntimeManager();
    await cleanupBundleMcpHarness();
    resetPlatformClawDatabaseForTests();
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("isolates clients/catalogs by owner and rechecks policy at invocation", async () => {
    const sse = await startSseProbeServer();
    try {
      const aServer = createUserMcpServer({
        ownerUserId: "user-a",
        input: {
          name: "A",
          transport: "sse",
          config: { url: `http://127.0.0.1:${sse.port}/sse` },
          toolPolicy: { mode: "allowlist", tools: ["sse_probe"] },
        },
      });
      createUserMcpServer({
        ownerUserId: "user-b",
        input: {
          name: "B",
          transport: "sse",
          config: { url: `http://127.0.0.1:${sse.port}/sse` },
        },
      });
      const runtimeA = await getOrCreateSessionMcpRuntime({
        sessionId: "session-a",
        workspaceDir: tempDir,
        userScope: { ownerUserId: "user-a", agentId: "user-a-agent" },
      });
      const runtimeB = await getOrCreateSessionMcpRuntime({
        sessionId: "session-b",
        workspaceDir: tempDir,
        userScope: { ownerUserId: "user-b", agentId: "user-b-agent" },
      });
      expect(runtimeA).not.toBe(runtimeB);
      expect(runtimeA.scopeIdentity).toBe("user-a:user-a-agent");
      expect(runtimeB.scopeIdentity).toBe("user-b:user-b-agent");

      const toolsA = await materializeBundleMcpToolsForRun({ runtime: runtimeA });
      expect(toolsA.tools).toHaveLength(1);
      const result = await toolsA.tools[0].execute("call", {}, undefined, undefined);
      expect(result.content[0]).toMatchObject({ type: "text" });
      expect((result.content[0] as { text: string }).text).toContain("FROM-SSE");
      expect((result.content[0] as { text: string }).text).toContain("EXTERNAL_UNTRUSTED_CONTENT");

      updateUserMcpServer({
        ownerUserId: "user-a",
        serverId: aServer.id,
        input: { enabled: false },
      });
      await expect(
        toolsA.tools[0].execute("call-disabled", {}, undefined, undefined),
      ).rejects.toThrow("blocked_by_policy");
    } finally {
      await __testing.resetSessionMcpRuntimeManager();
      await sse.close();
    }
  });

  it("invalidates only the selected user's runtimes", async () => {
    await getOrCreateSessionMcpRuntime({
      sessionId: "session-a",
      workspaceDir: tempDir,
      userScope: { ownerUserId: "user-a", agentId: "user-a-agent" },
    });
    await getOrCreateSessionMcpRuntime({
      sessionId: "session-b",
      workspaceDir: tempDir,
      userScope: { ownerUserId: "user-b", agentId: "user-b-agent" },
    });
    await disposeUserMcpRuntimes("user-a");
    expect(__testing.getCachedSessionIds()).toEqual(["session-b"]);
  });
});
