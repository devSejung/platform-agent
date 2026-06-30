/* @vitest-environment jsdom */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHost } from "./app-chat.ts";

const { setLastActiveSessionKeyMock } = vi.hoisted(() => ({
  setLastActiveSessionKeyMock: vi.fn(),
}));

vi.mock("./app-settings.ts", () => ({
  setLastActiveSessionKey: (...args: unknown[]) => setLastActiveSessionKeyMock(...args),
}));

let handleSendChat: typeof import("./app-chat.ts").handleSendChat;
let handleAbortChat: typeof import("./app-chat.ts").handleAbortChat;
let hasAbortableSessionRun: typeof import("./app-chat.ts").hasAbortableSessionRun;
let refreshChat: typeof import("./app-chat.ts").refreshChat;
let refreshChatAvatar: typeof import("./app-chat.ts").refreshChatAvatar;
let clearPendingQueueItemsForRun: typeof import("./app-chat.ts").clearPendingQueueItemsForRun;
let retryFailedChatMessage: typeof import("./app-chat.ts").retryFailedChatMessage;
let resolveChatRetryRunId: typeof import("./app-chat.ts").resolveChatRetryRunId;

async function loadChatHelpers(params?: { reload?: boolean }): Promise<void> {
  if (params?.reload) {
    vi.resetModules();
  }
  ({
    handleSendChat,
    handleAbortChat,
    hasAbortableSessionRun,
    refreshChat,
    refreshChatAvatar,
    clearPendingQueueItemsForRun,
    retryFailedChatMessage,
    resolveChatRetryRunId,
  } = await import("./app-chat.ts"));
}

function makeHost(overrides?: Partial<ChatHost>): ChatHost {
  return {
    client: null,
    chatMessages: [],
    chatStream: null,
    connected: true,
    chatMessage: "",
    chatAttachments: [],
    chatQueue: [],
    chatSendDrafts: {},
    chatSendFailures: {},
    chatRunId: null,
    chatSending: false,
    lastError: null,
    sessionKey: "agent:main",
    basePath: "",
    hello: null,
    chatAvatarUrl: null,
    chatModelOverrides: {},
    chatModelsLoading: false,
    chatModelCatalog: [],
    refreshSessionsAfterChat: new Set<string>(),
    updateComplete: Promise.resolve(),
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("refreshChatAvatar", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a route-relative avatar endpoint before basePath bootstrap finishes", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ avatarUrl: "/avatar/main" }),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main" });
    await refreshChatAvatar(host);

    expect(fetchMock).toHaveBeenCalledWith(
      "avatar/main?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(host.chatAvatarUrl).toBe("/avatar/main");
  });

  it("keeps mounted dashboard avatar endpoints under the normalized base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "/openclaw/", sessionKey: "agent:ops:main" });
    await refreshChatAvatar(host);

    expect(fetchMock).toHaveBeenCalledWith(
      "/openclaw/avatar/ops?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(host.chatAvatarUrl).toBeNull();
  });

  it("ignores stale avatar responses after switching sessions", async () => {
    const mainRequest = createDeferred<{ avatarUrl?: string }>();
    const opsRequest = createDeferred<{ avatarUrl?: string }>();
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url === "avatar/main?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => mainRequest.promise,
        });
      }
      if (url === "avatar/ops?meta=1") {
        return Promise.resolve({
          ok: true,
          json: async () => opsRequest.promise,
        });
      }
      throw new Error(`Unexpected avatar URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const host = makeHost({ basePath: "", sessionKey: "agent:main:main" });

    const firstRefresh = refreshChatAvatar(host);
    host.sessionKey = "agent:ops:main";
    const secondRefresh = refreshChatAvatar(host);

    mainRequest.resolve({ avatarUrl: "/avatar/main" });
    await firstRefresh;
    expect(host.chatAvatarUrl).toBeNull();

    opsRequest.resolve({ avatarUrl: "/avatar/ops" });
    await secondRefresh;

    expect(host.chatAvatarUrl).toBe("/avatar/ops");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "avatar/main?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "avatar/ops?meta=1",
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("refreshChat", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits for chat history without blocking on slow surrounding refreshes", async () => {
    const request = vi.fn((method: string) => {
      if (method === "chat.history") {
        return Promise.resolve({
          messages: [{ role: "assistant", content: [{ type: "text", text: "loaded" }] }],
          thinkingLevel: null,
        });
      }
      if (method === "sessions.list" || method === "models.list") {
        return new Promise<unknown>(() => {});
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    vi.stubGlobal("fetch", vi.fn(() => new Promise<unknown>(() => {})) as unknown as typeof fetch);
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "agent:main:main",
      sessionsCheckpointItemsByKey: {},
    } as Partial<ChatHost>);

    await refreshChat(host, { scheduleScroll: false });

    expect(request).toHaveBeenCalledWith("chat.history", {
      sessionKey: "agent:main:main",
      limit: 200,
    });
    expect(host.chatMessages).toEqual([
      { role: "assistant", content: [{ type: "text", text: "loaded" }] },
    ]);
  });
});

describe("hasAbortableSessionRun", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  it("treats an active session row as abortable after the local run id is gone", () => {
    const host = makeHost({
      chatRunId: null,
      sessionKey: "agent:main:main",
      sessionsResult: {
        ts: Date.now(),
        path: "/tmp/sessions.json",
        count: 1,
        defaults: {
          model: null,
          modelProvider: null,
          contextTokens: null,
        },
        sessions: [
          {
            key: "agent:main:main",
            kind: "direct",
            updatedAt: Date.now(),
            hasActiveRun: true,
          },
        ],
      },
    });

    expect(hasAbortableSessionRun(host)).toBe(true);
  });

  it("queues a session-scoped abort while disconnected when the session has an active run", async () => {
    const host = makeHost({
      connected: false,
      chatMessage: "stop",
      chatRunId: null,
      sessionKey: "agent:main:main",
      sessionsResult: {
        ts: Date.now(),
        path: "/tmp/sessions.json",
        count: 1,
        defaults: {
          model: null,
          modelProvider: null,
          contextTokens: null,
        },
        sessions: [
          {
            key: "agent:main:main",
            kind: "direct",
            updatedAt: Date.now(),
            hasActiveRun: true,
          },
        ],
      },
    });

    await handleAbortChat(host);

    expect(host.chatMessage).toBe("");
    expect(host.pendingAbort).toEqual({
      runId: null,
      sessionKey: "agent:main:main",
    });
  });
});

describe("handleSendChat", () => {
  beforeAll(async () => {
    await loadChatHelpers();
  });

  beforeEach(() => {
    setLastActiveSessionKeyMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("./chat/slash-command-executor.ts");
  });

  it("keeps slash-command model changes in sync with the chat header cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      }) as unknown as typeof fetch,
    );
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "sessions.patch") {
        return {
          ok: true,
          key: "main",
          resolved: {
            modelProvider: "openai",
            model: "gpt-5-mini",
          },
        };
      }
      if (method === "chat.history") {
        return { messages: [], thinkingLevel: null };
      }
      if (method === "sessions.list") {
        return {
          ts: 0,
          path: "",
          count: 0,
          defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
          sessions: [],
        };
      }
      if (method === "models.list") {
        return {
          models: [{ id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai" }],
        };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    const onSlashAction = vi.fn();
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      sessionKey: "main",
      chatMessage: "/model gpt-5-mini",
      onSlashAction,
    });

    await handleSendChat(host);

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: "gpt-5-mini",
    });
    expect(host.chatModelOverrides.main).toEqual({
      kind: "qualified",
      value: "openai/gpt-5-mini",
    });
    expect(onSlashAction).toHaveBeenCalledWith("refresh-tools-effective");
  });

  it("shows a visible pending item for /steer on the active run", async () => {
    vi.doMock("./chat/slash-command-executor.ts", async () => {
      const actual = await vi.importActual<typeof import("./chat/slash-command-executor.ts")>(
        "./chat/slash-command-executor.ts",
      );
      return {
        ...actual,
        executeSlashCommand: vi.fn(async () => ({
          content: "Steered.",
          pendingCurrentRun: true,
        })),
      };
    });
    await loadChatHelpers({ reload: true });

    const host = makeHost({
      client: { request: vi.fn() } as unknown as ChatHost["client"],
      chatRunId: "run-1",
      chatMessage: "/steer tighten the plan",
    });

    await handleSendChat(host);

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        text: "/steer tighten the plan",
        pendingRunId: "run-1",
      }),
    ]);
  });

  it("removes pending steer indicators when the run finishes", async () => {
    const host = makeHost({
      chatQueue: [
        {
          id: "pending",
          text: "/steer tighten the plan",
          createdAt: 1,
          pendingRunId: "run-1",
        },
        {
          id: "queued",
          text: "follow up",
          createdAt: 2,
        },
      ],
    });

    clearPendingQueueItemsForRun(host, "run-1");

    expect(host.chatQueue).toEqual([
      expect.objectContaining({
        id: "queued",
        text: "follow up",
      }),
    ]);
  });

  it("uses a new key for a terminal runtime failure and replaces the existing user bubble", async () => {
    const request = vi.fn().mockResolvedValue({ runId: "accepted", status: "ok" });
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          __openclaw: { kind: "outbound", runId: "failed-run" },
        },
      ],
      chatSendDrafts: {
        "failed-run": { message: "hello", attachments: [] },
      },
      chatSendFailures: {
        "failed-run": {
          runId: "failed-run",
          message: "hello",
          attachments: [],
          code: "timeout",
          title: "AI 서버가 제한 시간 내에 응답하지 않았습니다.",
          detail: "일시적인 사용량 증가 또는 네트워크 지연일 수 있습니다.",
          retryable: true,
          phase: "run",
          retrying: false,
        },
      },
    });

    await retryFailedChatMessage(host, "failed-run");

    expect(request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({
        message: "hello",
        idempotencyKey: expect.any(String),
      }),
    );
    expect(host.chatMessages).toHaveLength(1);
    expect(host.chatSendFailures["failed-run"]).toBeUndefined();
    expect(host.chatRunId).not.toBe("failed-run");
  });

  it.each(["network", "timeout"] as const)(
    "reuses the original idempotency key for submit-stage %s because server receipt is uncertain",
    async (code) => {
      const request = vi.fn().mockResolvedValue({ runId: "failed-run", status: "in_flight" });
      const failure = {
        runId: "failed-run",
        message: "hello",
        attachments: [],
        code,
        title: "Temporary failure",
        detail: "Try again.",
        retryable: true,
        phase: "submit" as const,
        retrying: false,
      };
      const host = makeHost({
        client: { request } as unknown as ChatHost["client"],
        chatMessages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }],
            __openclaw: { kind: "outbound", runId: "failed-run" },
          },
        ],
        chatSendDrafts: {
          "failed-run": { message: "hello", attachments: [] },
        },
        chatSendFailures: { "failed-run": failure },
      });

      expect(resolveChatRetryRunId(failure)).toBe("failed-run");
      await retryFailedChatMessage(host, "failed-run");

      expect(request).toHaveBeenCalledWith(
        "chat.send",
        expect.objectContaining({ idempotencyKey: "failed-run" }),
      );
      expect(host.chatMessages).toHaveLength(1);
      expect(host.chatSendFailures).toEqual({});
    },
  );

  it.each(["timeout", "overloaded", "rate_limit"] as const)(
    "uses a new key for terminal runtime %s because the original key returns a cached error",
    (code) => {
      const nextRunId = resolveChatRetryRunId({
        runId: "failed-run",
        message: "hello",
        attachments: [],
        code,
        title: "Terminal failure",
        detail: "Try again.",
        retryable: true,
        phase: "run",
        retrying: false,
      });

      expect(nextRunId).not.toBe("failed-run");
    },
  );

  it("keeps one user bubble and never accumulates assistant Error messages across retries", async () => {
    const request = vi.fn().mockRejectedValue(new Error("gateway request timeout for chat.send"));
    const host = makeHost({
      client: { request } as unknown as ChatHost["client"],
      chatMessages: [
        {
          role: "user",
          content: [{ type: "text", text: "hello" }],
          __openclaw: { kind: "outbound", runId: "failed-run" },
        },
      ],
      chatSendDrafts: {
        "failed-run": { message: "hello", attachments: [] },
      },
      chatSendFailures: {
        "failed-run": {
          runId: "failed-run",
          message: "hello",
          attachments: [],
          code: "timeout",
          title: "Timed out",
          detail: "Try again.",
          retryable: true,
          phase: "run",
          retrying: false,
        },
      },
    });

    await retryFailedChatMessage(host, "failed-run");
    const nextFailure = Object.values(host.chatSendFailures)[0];
    await retryFailedChatMessage(host, nextFailure.runId);

    expect(host.chatMessages).toHaveLength(1);
    expect((host.chatMessages[0] as { role?: string }).role).toBe("user");
    expect(
      host.chatMessages.some(
        (message) => (message as { role?: string } | null)?.role === "assistant",
      ),
    ).toBe(false);
    expect(Object.keys(host.chatSendFailures)).toHaveLength(1);
  });
});

afterAll(() => {
  vi.doUnmock("./app-settings.ts");
  vi.resetModules();
});
