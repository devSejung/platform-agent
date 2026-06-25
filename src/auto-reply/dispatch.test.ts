import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import type { ReplyDispatcher } from "./reply/reply-dispatcher.js";
import { buildTestCtx } from "./reply/test-ctx.js";

type DispatchReplyFromConfigFn =
  typeof import("./reply/dispatch-from-config.js").dispatchReplyFromConfig;
type FinalizeInboundContextFn = typeof import("./reply/inbound-context.js").finalizeInboundContext;
type CreateReplyDispatcherWithTypingFn =
  typeof import("./reply/reply-dispatcher.js").createReplyDispatcherWithTyping;

const hoisted = vi.hoisted(() => ({
  dispatchReplyFromConfigMock: vi.fn(),
  finalizeInboundContextMock: vi.fn((ctx: unknown, _opts?: unknown) => ctx),
  createReplyDispatcherWithTypingMock: vi.fn(),
  resolveSessionAgentIdMock: vi.fn(() => "agent-main"),
  resolveAgentWorkspaceDirMock: vi.fn(() => "/tmp/workspace"),
  installSkillFromHubMock: vi.fn(),
  updateSkillFromHubMock: vi.fn(),
  deleteSkillFromWorkspaceMock: vi.fn(),
  listSkillHubEntriesMock: vi.fn(),
}));

vi.mock("./reply/dispatch-from-config.js", () => ({
  dispatchReplyFromConfig: (...args: Parameters<DispatchReplyFromConfigFn>) =>
    hoisted.dispatchReplyFromConfigMock(...args),
}));

vi.mock("./reply/inbound-context.js", () => ({
  finalizeInboundContext: (...args: Parameters<FinalizeInboundContextFn>) =>
    hoisted.finalizeInboundContextMock(...args),
}));

vi.mock("./reply/reply-dispatcher.js", async () => {
  const actual = await vi.importActual<typeof import("./reply/reply-dispatcher.js")>(
    "./reply/reply-dispatcher.js",
  );
  return {
    ...actual,
    createReplyDispatcherWithTyping: (...args: Parameters<CreateReplyDispatcherWithTypingFn>) =>
      hoisted.createReplyDispatcherWithTypingMock(...args),
  };
});

vi.mock("../agents/agent-scope.js", () => ({
  resolveSessionAgentId: () => hoisted.resolveSessionAgentIdMock(),
  resolveAgentWorkspaceDir: () => hoisted.resolveAgentWorkspaceDirMock(),
}));

vi.mock("../agents/skill-hub.js", () => ({
  installSkillFromHub: (...args: unknown[]) => hoisted.installSkillFromHubMock(...args),
  updateSkillFromHub: (...args: unknown[]) => hoisted.updateSkillFromHubMock(...args),
  deleteSkillFromWorkspace: (...args: unknown[]) => hoisted.deleteSkillFromWorkspaceMock(...args),
  listSkillHubEntries: (...args: unknown[]) => hoisted.listSkillHubEntriesMock(...args),
  resolveSkillHubActor: ({
    employee,
    fallbackAgentId,
  }: {
    employee?: { employeeId?: string; name?: string };
    fallbackAgentId: string;
  }) => ({
    employeeId: employee?.employeeId ?? fallbackAgentId,
    name: employee?.name,
  }),
  formatSkillHubInstallMessage: (slug: string) => `Skill installed: ${slug}`,
  formatSkillHubUpdateMessage: (slug: string, version: string) =>
    `Skill updated: ${slug} -> v${version}`,
  formatSkillHubDeleteMessage: (slug: string) => `Skill deleted from workspace: ${slug}`,
  formatSkillHubError: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const {
  dispatchInboundMessage,
  dispatchInboundMessageWithBufferedDispatcher,
  withReplyDispatcher,
} = await import("./dispatch.js");

beforeEach(() => {
  vi.clearAllMocks();
});

function createDispatcher(record: string[]): ReplyDispatcher {
  return {
    sendToolResult: () => true,
    sendBlockReply: () => true,
    sendFinalReply: () => true,
    getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
    getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
    markComplete: () => {
      record.push("markComplete");
    },
    waitForIdle: async () => {
      record.push("waitForIdle");
    },
  };
}

describe("withReplyDispatcher", () => {
  it("intercepts strict /skillhub install commands before normal reply dispatch", async () => {
    const sendFinalReply = vi.fn(() => true);
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply,
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "/skillhub install jira-ticket-summarizer",
        CommandBody: "/skillhub install jira-ticket-summarizer",
        SessionKey: "main",
        SenderId: "emp-1",
        SenderName: "Eon",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ignored" }),
    });

    expect(hoisted.installSkillFromHubMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      actor: { employeeId: "emp-1", name: "Eon" },
      slug: "jira-ticket-summarizer",
    });
    expect(hoisted.dispatchReplyFromConfigMock).not.toHaveBeenCalled();
    expect(sendFinalReply).toHaveBeenCalledWith({
      text: "Skill installed: jira-ticket-summarizer",
    });
  });

  it("does not intercept non-strict /skillhub text", async () => {
    const dispatcher = createDispatcher([]);
    hoisted.dispatchReplyFromConfigMock.mockResolvedValueOnce({ text: "ok" });

    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "please run /skillhub install jira-ticket-summarizer later",
        SessionKey: "main",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ok" }),
    });

    expect(hoisted.installSkillFromHubMock).not.toHaveBeenCalled();
    expect(hoisted.dispatchReplyFromConfigMock).toHaveBeenCalledTimes(1);
  });

  it("intercepts /skillhub from CommandBody even when Body has wrapper text", async () => {
    const sendFinalReply = vi.fn(() => true);
    const dispatcher = {
      sendToolResult: vi.fn(() => true),
      sendBlockReply: vi.fn(() => true),
      sendFinalReply,
      getQueuedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 1 })),
      getFailedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "[그룹방에서 온 메세지입니다]\n사용자정보: eon\n/skillhub install jira-ticket-summarizer",
        CommandBody: "/skillhub install jira-ticket-summarizer",
        SessionKey: "main",
        SenderId: "emp-1",
        SenderName: "Eon",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ignored" }),
    });

    expect(hoisted.installSkillFromHubMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      actor: { employeeId: "emp-1", name: "Eon" },
      slug: "jira-ticket-summarizer",
    });
    expect(hoisted.dispatchReplyFromConfigMock).not.toHaveBeenCalled();
    expect(sendFinalReply).toHaveBeenCalledWith({
      text: "Skill installed: jira-ticket-summarizer",
    });
  });

  it("dispatchInboundMessage owns dispatcher lifecycle", async () => {
    const order: string[] = [];
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply: () => {
        order.push("sendFinalReply");
        return true;
      },
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: () => {
        order.push("markComplete");
      },
      waitForIdle: async () => {
        order.push("waitForIdle");
      },
    } satisfies ReplyDispatcher;
    hoisted.dispatchReplyFromConfigMock.mockImplementationOnce(async ({ dispatcher }) => {
      dispatcher.sendFinalReply({ text: "ok" });
      return { text: "ok" };
    });

    await dispatchInboundMessage({
      ctx: buildTestCtx(),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ok" }),
    });

    expect(order).toEqual(["sendFinalReply", "markComplete", "waitForIdle"]);
  });

  it("intercepts /skillhub help before normal reply dispatch", async () => {
    const sendFinalReply = vi.fn(() => true);
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply,
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "/skillhub help",
        CommandBody: "/skillhub help",
        SessionKey: "main",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ignored" }),
    });

    expect(hoisted.dispatchReplyFromConfigMock).not.toHaveBeenCalled();
    expect(sendFinalReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("# Skill Hub Commands"),
      }),
    );
  });

  it("renders Korean help for /skillhub help ko", async () => {
    const sendFinalReply = vi.fn(() => true);
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply,
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "/skillhub help ko",
        CommandBody: "/skillhub help ko",
        SessionKey: "main",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ignored" }),
    });

    expect(sendFinalReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("# Skill Hub 명령어"),
      }),
    );
    expect(sendFinalReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("/skillhub installed"),
      }),
    );
  });

  it("intercepts /skillhub list and formats a markdown table", async () => {
    hoisted.listSkillHubEntriesMock.mockResolvedValueOnce([
      {
        slug: "ufs-spec",
        presentation: {
          category: "knowledge",
          displayName: "UFS Spec",
          displayDescription: "Reference answers for JEDEC UFS questions.",
        },
      },
    ]);
    const sendFinalReply = vi.fn(() => true);
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply,
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "/skillhub list knowledge",
        CommandBody: "/skillhub list knowledge",
        SessionKey: "main",
        SenderId: "emp-1",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ignored" }),
    });

    expect(hoisted.listSkillHubEntriesMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      actor: { employeeId: "emp-1", name: undefined },
      scope: "discover",
      sort: "az",
      category: "knowledge",
    });
    expect(sendFinalReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("| Name | Slug | Description |"),
      }),
    );
    expect(sendFinalReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("`ufs-spec`"),
      }),
    );
  });

  it("intercepts /skillhub installed and queries installed scope", async () => {
    hoisted.listSkillHubEntriesMock.mockResolvedValueOnce([
      {
        slug: "ufs-spec",
        presentation: {
          category: "knowledge",
          displayName: "UFS Spec",
          displayDescription: "Reference answers for JEDEC UFS questions.",
        },
      },
    ]);
    const sendFinalReply = vi.fn(() => true);
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply,
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "/skillhub installed",
        CommandBody: "/skillhub installed",
        SessionKey: "main",
        SenderId: "emp-1",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ignored" }),
    });

    expect(hoisted.listSkillHubEntriesMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      actor: { employeeId: "emp-1", name: undefined },
      scope: "installed",
      sort: "az",
      category: "all",
    });
    expect(sendFinalReply).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("# Installed Skill Hub Skills"),
      }),
    );
  });

  it("falls back to CommandBody when BodyForCommands contains wrapped room text", async () => {
    hoisted.listSkillHubEntriesMock.mockResolvedValueOnce([]);
    const sendFinalReply = vi.fn(() => true);
    const dispatcher = {
      sendToolResult: () => true,
      sendBlockReply: () => true,
      sendFinalReply,
      getQueuedCounts: () => ({ tool: 0, block: 0, final: 1 }),
      getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => {}),
    } satisfies ReplyDispatcher;

    await dispatchInboundMessage({
      ctx: buildTestCtx({
        Body: "[그룹방에서 온 메세지입니다]\n사용자정보: eon\n/skillhub list all",
        BodyForCommands: "[그룹방에서 온 메세지입니다]\n사용자정보: eon\n/skillhub list all",
        CommandBody: "/skillhub list all",
        SessionKey: "main",
        SenderId: "emp-1",
      }),
      cfg: {} as OpenClawConfig,
      dispatcher,
      replyResolver: async () => ({ text: "ignored" }),
    });

    expect(hoisted.dispatchReplyFromConfigMock).not.toHaveBeenCalled();
    expect(hoisted.listSkillHubEntriesMock).toHaveBeenCalledWith({
      workspaceDir: "/tmp/workspace",
      actor: { employeeId: "emp-1", name: undefined },
      scope: "discover",
      sort: "az",
      category: "all",
    });
  });

  it("always marks complete and waits for idle after success", async () => {
    const order: string[] = [];
    const dispatcher = createDispatcher(order);

    const result = await withReplyDispatcher({
      dispatcher,
      run: async () => {
        order.push("run");
        return "ok";
      },
      onSettled: () => {
        order.push("onSettled");
      },
    });

    expect(result).toBe("ok");
    expect(order).toEqual(["run", "markComplete", "waitForIdle", "onSettled"]);
  });

  it("still drains dispatcher after run throws", async () => {
    const order: string[] = [];
    const dispatcher = createDispatcher(order);
    const onSettled = vi.fn(() => {
      order.push("onSettled");
    });

    await expect(
      withReplyDispatcher({
        dispatcher,
        run: async () => {
          order.push("run");
          throw new Error("boom");
        },
        onSettled,
      }),
    ).rejects.toThrow("boom");

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["run", "markComplete", "waitForIdle", "onSettled"]);
  });

  it("dispatchInboundMessageWithBufferedDispatcher cleans up typing after a resolver starts it", async () => {
    const typing = {
      onReplyStart: vi.fn(async () => {}),
      startTypingLoop: vi.fn(async () => {}),
      startTypingOnText: vi.fn(async () => {}),
      refreshTypingTtl: vi.fn(),
      isActive: vi.fn(() => true),
      markRunComplete: vi.fn(),
      markDispatchIdle: vi.fn(),
      cleanup: vi.fn(),
    };
    hoisted.createReplyDispatcherWithTypingMock.mockReturnValueOnce({
      dispatcher: createDispatcher([]),
      replyOptions: {},
      markDispatchIdle: typing.markDispatchIdle,
      markRunComplete: typing.markRunComplete,
    });
    hoisted.dispatchReplyFromConfigMock.mockResolvedValueOnce({ text: "ok" });

    await dispatchInboundMessageWithBufferedDispatcher({
      ctx: buildTestCtx(),
      cfg: {} as OpenClawConfig,
      dispatcherOptions: {
        deliver: async () => undefined,
      },
      replyResolver: async (_ctx, opts) => {
        opts?.onTypingController?.(typing);
        return { text: "ok" };
      },
    });

    expect(typing.markRunComplete).toHaveBeenCalledTimes(1);
    expect(typing.markDispatchIdle).toHaveBeenCalled();
  });
});
