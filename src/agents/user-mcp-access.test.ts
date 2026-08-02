import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { provisionEmployeeAccount } from "../accounts/account-provisioning.js";
import { resetPlatformClawDatabaseForTests } from "../accounts/db.js";
import { decideUserMcpAccess } from "./user-mcp-access.js";

describe("user MCP personal session access", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-user-mcp-access-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
    for (const employeeId of ["user-a", "user-b"]) {
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
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("allows only the matching owner in web personal sessions and Knox DMs", () => {
    expect(
      decideUserMcpAccess({
        requesterUserId: "user-a",
        agentId: "user-a-agent",
        conversationType: "direct",
        channel: "webchat",
        trigger: "user",
      }),
    ).toMatchObject({ allowed: true, ownerUserId: "user-a", reason: "personal_session" });
    expect(
      decideUserMcpAccess({
        requesterUserId: "user-a",
        agentId: "user-a-agent",
        conversationType: "dm",
        channel: "knox",
        trigger: "user",
      }).allowed,
    ).toBe(true);
    expect(
      decideUserMcpAccess({
        requesterUserId: "user-b",
        agentId: "user-a-agent",
        conversationType: "direct",
        channel: "webchat",
      }).reason,
    ).toBe("agent_not_owned");
  });

  it.each([
    [
      { agentId: "user-a-agent", conversationType: "direct", channel: "webchat" },
      "missing_requester",
    ],
    [
      {
        requesterUserId: "user-a",
        agentId: "user-a-agent",
        conversationType: "room",
        channel: "knox",
      },
      "group_conversation",
    ],
    [
      {
        requesterUserId: "user-a",
        agentId: "user-a-agent",
        conversationType: "direct",
        channel: "webchat",
        trigger: "cron",
      },
      "shared_session",
    ],
    [
      {
        requesterUserId: "user-a",
        agentId: "missing",
        conversationType: "direct",
        channel: "webchat",
      },
      "system_agent",
    ],
  ] as const)("blocks unsafe context %#", (context, reason) => {
    expect(decideUserMcpAccess(context)).toMatchObject({ allowed: false, reason });
  });
});
