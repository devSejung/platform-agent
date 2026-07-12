import { describe, expect, it } from "vitest";
import {
  buildExecCredentialRuntimeContext,
  resolveExecCredentialRuntimeContext,
} from "./exec-runtime-context.js";

describe("buildExecCredentialRuntimeContext", () => {
  it("builds account-scoped context from runtime-owned exec defaults", () => {
    expect(
      buildExecCredentialRuntimeContext({
        runId: "run-1",
        agentId: "jira",
        sessionKey: "agent:jira:main",
        messageProvider: "web",
        accountId: "account-1",
      }),
    ).toMatchObject({
      runId: "run-1",
      skillId: "jira",
      effectiveOwnerType: "account",
      effectiveOwnerId: "account-1",
    });
  });

  it("denies group-like sessions for personal credentials", () => {
    expect(
      buildExecCredentialRuntimeContext({
        runId: "run-1",
        agentId: "jira",
        sessionKey: "agent:jira:knox:channel:room-1",
        accountId: "account-1",
      }),
    ).toBeNull();
  });

  it("denies group-like room ids even when the session key is generic", () => {
    expect(
      buildExecCredentialRuntimeContext({
        runId: "run-1",
        agentId: "jira",
        sessionKey: "agent:jira:main",
        currentChannelId: "group-chatroom-1",
        accountId: "account-1",
      }),
    ).toBeNull();
  });

  it("reports why runtime context cannot be built", () => {
    expect(
      resolveExecCredentialRuntimeContext({
        runId: "run-1",
        accountId: "",
      }),
    ).toEqual({ ok: false, reason: "missing_account" });

    expect(
      resolveExecCredentialRuntimeContext({
        runId: "run-1",
        accountId: "account-1",
        currentChannelId: "group-room-1",
      }),
    ).toEqual({ ok: false, reason: "group_channel" });
  });
});
