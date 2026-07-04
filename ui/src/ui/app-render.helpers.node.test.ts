import { afterEach, describe, expect, it, vi } from "vitest";
const { refreshChatMock, refreshChatAvatarMock, loadChatHistoryMock, loadSessionsMock } =
  vi.hoisted(() => ({
    refreshChatMock: vi.fn(),
    refreshChatAvatarMock: vi.fn(),
    loadChatHistoryMock: vi.fn(),
    loadSessionsMock: vi.fn(),
  }));

vi.mock("./app-chat.ts", () => ({
  refreshChat: refreshChatMock,
  refreshChatAvatar: refreshChatAvatarMock,
}));

vi.mock("./controllers/chat.ts", () => ({
  loadChatHistory: loadChatHistoryMock,
}));

vi.mock("./controllers/sessions.ts", () => ({
  loadSessions: loadSessionsMock,
}));
import {
  hasUnsentQueuedChatMessages,
  isCronSessionKey,
  parseSessionKey,
  resolveSidebarChatSessionKey,
  resolveSessionDisplayName,
  switchChatSession,
} from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import type { SessionsListResult } from "./types.ts";

type SessionRow = SessionsListResult["sessions"][number];

function row(overrides: Partial<SessionRow> & { key: string }): SessionRow {
  return { kind: "direct", updatedAt: 0, ...overrides };
}

function createSwitchState(overrides: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === "chat.history") {
      return { messages: [], thinkingLevel: null };
    }
    if (method === "sessions.list") {
      return {
        ts: 0,
        path: "",
        count: 0,
        defaults: { modelProvider: null, model: null, contextTokens: null },
        sessions: [],
      };
    }
    return {};
  });
  const state = {
    client: { request },
    connected: true,
    sessionKey: "session-a",
    chatMessage: "draft",
    chatStream: "partial",
    chatStreamStartedAt: 123,
    chatRunId: "run-a",
    chatQueue: [],
    chatSendDrafts: { "run-a": { message: "draft", attachments: [] } },
    chatSendFailures: {},
    chatMessages: [],
    chatThinkingLevel: null,
    chatLoading: false,
    settings: { sessionKey: "session-a", lastActiveSessionKey: "session-a" },
    applySettings: vi.fn(function applySettings(this: { settings: unknown }, next: unknown) {
      this.settings = next;
    }),
    loadAssistantIdentity: vi.fn(),
    resetToolStream: vi.fn(),
    resetChatScroll: vi.fn(),
    ...overrides,
  } as never;
  return { state, request };
}

function getQueuedMessageDialog() {
  return document.querySelector<HTMLElement>(".chat-session-leave-confirm");
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  document.querySelectorAll(".chat-session-leave-confirm").forEach((el) => el.remove());
});

describe("resolveSidebarChatSessionKey", () => {
  it("keeps employee chat pinned to the employee agent main session", () => {
    expect(
      resolveSidebarChatSessionKey({
        employeeMode: true,
        employeeProfile: { agentId: "minji" },
        sessionKey: "agent:eon:main",
        settings: { lastActiveSessionKey: "agent:eon:main" },
        hello: {
          snapshot: {
            sessionDefaults: {
              mainSessionKey: "main",
              mainKey: "main",
            },
          },
        },
      } as never),
    ).toBe("agent:minji:main");
  });

  it("uses gateway defaults for control mode", () => {
    expect(
      resolveSidebarChatSessionKey({
        employeeMode: false,
        employeeProfile: { agentId: null },
        sessionKey: "agent:minji:main",
        settings: { lastActiveSessionKey: "agent:minji:main" },
        hello: {
          snapshot: {
            sessionDefaults: {
              mainSessionKey: "main",
              mainKey: "main",
            },
          },
        },
      } as never),
    ).toBe("main");
  });
});

describe("chat session switch queued-message guard", () => {
  it("treats normal queued messages as unsent but excludes pending run indicators", () => {
    expect(
      hasUnsentQueuedChatMessages([
        { id: "queued", text: "follow up", createdAt: 1 },
        { id: "pending", text: "/steer tighten", createdAt: 2, pendingRunId: "run-a" },
      ]),
    ).toBe(true);
    expect(
      hasUnsentQueuedChatMessages([
        { id: "pending", text: "/steer tighten", createdAt: 2, pendingRunId: "run-a" },
      ]),
    ).toBe(false);
  });

  it("opens a custom dialog instead of native confirm for unsent queued messages", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    const { state } = createSwitchState({
      chatQueue: [{ id: "queued", text: "follow up", createdAt: 1 }],
    });

    const result = switchChatSession(state, "session-b");
    const dialog = getQueuedMessageDialog();

    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.textContent).toContain("전송 대기 중인 메시지가 있습니다");
    expect(dialog?.textContent).toContain("다른 대화로 이동하면 이 메시지는 전송되지 않습니다");
    expect(nativeConfirm).not.toHaveBeenCalled();

    dialog?.querySelector<HTMLButtonElement>("button")?.click();
    expect(await result).toBe(false);
  });

  it("cancels session switch and preserves queued message when the user rejects discard", async () => {
    const { state } = createSwitchState({
      chatQueue: [{ id: "queued", text: "follow up", createdAt: 1 }],
    });

    const result = switchChatSession(state, "session-b");
    getQueuedMessageDialog()
      ?.querySelectorAll<HTMLButtonElement>("button")
      .item(0)
      .click();

    expect(await result).toBe(false);
    expect((state as { sessionKey: string }).sessionKey).toBe("session-a");
    expect((state as { chatQueue: unknown[] }).chatQueue).toHaveLength(1);
    expect((state as { chatRunId: string | null }).chatRunId).toBe("run-a");
    expect((state as { chatStream: string | null }).chatStream).toBe("partial");
  });

  it("switches sessions and explicitly discards queued messages when the user confirms", async () => {
    const { state } = createSwitchState({
      chatQueue: [{ id: "queued", text: "follow up", createdAt: 1 }],
    });

    const result = switchChatSession(state, "session-b");
    getQueuedMessageDialog()
      ?.querySelectorAll<HTMLButtonElement>("button")
      .item(1)
      .click();

    expect(await result).toBe(true);
    expect((state as { sessionKey: string }).sessionKey).toBe("session-b");
    expect((state as { chatQueue: unknown[] }).chatQueue).toEqual([]);
    expect((state as { chatRunId: string | null }).chatRunId).toBeNull();
    expect((state as { chatStream: string | null }).chatStream).toBeNull();
  });

  it("does not warn for /steer pending indicators even though session switch cleanup removes them", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    const { state } = createSwitchState({
      chatQueue: [{ id: "pending", text: "/steer tighten", createdAt: 1, pendingRunId: "run-a" }],
    });

    expect(await switchChatSession(state, "session-b")).toBe(true);

    expect(getQueuedMessageDialog()).toBeNull();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect((state as { sessionKey: string }).sessionKey).toBe("session-b");
    expect((state as { chatQueue: unknown[] }).chatQueue).toEqual([]);
  });
});

/* ================================================================
 *  parseSessionKey – low-level key → type / fallback mapping
 * ================================================================ */

describe("parseSessionKey", () => {
  it("identifies main session (bare 'main')", () => {
    expect(parseSessionKey("main")).toEqual({ prefix: "", fallbackName: "Main Session" });
  });

  it("identifies main session (agent:main:main)", () => {
    expect(parseSessionKey("agent:main:main")).toEqual({
      prefix: "",
      fallbackName: "Main Session",
    });
  });

  it("identifies subagent sessions", () => {
    expect(parseSessionKey("agent:main:subagent:18abfefe-1fa6-43cb-8ba8-ebdc9b43e253")).toEqual({
      prefix: "Subagent:",
      fallbackName: "Subagent:",
    });
  });

  it("identifies cron sessions", () => {
    expect(parseSessionKey("agent:main:cron:daily-briefing-uuid")).toEqual({
      prefix: "Cron:",
      fallbackName: "Cron Job:",
    });
    expect(parseSessionKey("cron:daily-briefing-uuid")).toEqual({
      prefix: "Cron:",
      fallbackName: "Cron Job:",
    });
  });

  it("identifies direct chat with known channel", () => {
    expect(parseSessionKey("agent:main:bluebubbles:direct:+19257864429")).toEqual({
      prefix: "",
      fallbackName: "iMessage · +19257864429",
    });
  });

  it("identifies direct chat with telegram", () => {
    expect(parseSessionKey("agent:main:telegram:direct:user123")).toEqual({
      prefix: "",
      fallbackName: "Telegram · user123",
    });
  });

  it("identifies group chat with known channel", () => {
    expect(parseSessionKey("agent:main:discord:group:guild-chan")).toEqual({
      prefix: "",
      fallbackName: "Discord Group",
    });
  });

  it("capitalises unknown channels in direct/group patterns", () => {
    expect(parseSessionKey("agent:main:mychannel:direct:user1")).toEqual({
      prefix: "",
      fallbackName: "Mychannel · user1",
    });
  });

  it("identifies channel-prefixed legacy keys", () => {
    expect(parseSessionKey("bluebubbles:g-agent-main-bluebubbles-direct-+19257864429")).toEqual({
      prefix: "",
      fallbackName: "iMessage Session",
    });
    expect(parseSessionKey("discord:123:456")).toEqual({
      prefix: "",
      fallbackName: "Discord Session",
    });
  });

  it("handles bare channel name as key", () => {
    expect(parseSessionKey("telegram")).toEqual({
      prefix: "",
      fallbackName: "Telegram Session",
    });
  });

  it("returns raw key for unknown patterns", () => {
    expect(parseSessionKey("something-unknown")).toEqual({
      prefix: "",
      fallbackName: "something-unknown",
    });
  });
});

/* ================================================================
 *  resolveSessionDisplayName – full resolution with row data
 * ================================================================ */

describe("resolveSessionDisplayName", () => {
  // ── Key-only fallbacks (no row) ──────────────────

  it("returns 'Main Session' for agent:main:main key", () => {
    expect(resolveSessionDisplayName("agent:main:main")).toBe("Main Session");
  });

  it("returns 'Main Session' for bare 'main' key", () => {
    expect(resolveSessionDisplayName("main")).toBe("Main Session");
  });

  it("returns 'Subagent:' for subagent key without row", () => {
    expect(resolveSessionDisplayName("agent:main:subagent:abc-123")).toBe("Subagent:");
  });

  it("returns 'Cron Job:' for cron key without row", () => {
    expect(resolveSessionDisplayName("agent:main:cron:abc-123")).toBe("Cron Job:");
  });

  it("parses direct chat key with channel", () => {
    expect(resolveSessionDisplayName("agent:main:bluebubbles:direct:+19257864429")).toBe(
      "iMessage · +19257864429",
    );
  });

  it("parses channel-prefixed legacy key", () => {
    expect(resolveSessionDisplayName("discord:123:456")).toBe("Discord Session");
  });

  it("returns raw key for unknown patterns", () => {
    expect(resolveSessionDisplayName("something-custom")).toBe("something-custom");
  });

  // ── With row data (label / displayName) ──────────

  it("returns parsed fallback when row has no label or displayName", () => {
    expect(resolveSessionDisplayName("agent:main:main", row({ key: "agent:main:main" }))).toBe(
      "Main Session",
    );
  });

  it("returns parsed fallback when displayName matches key", () => {
    expect(resolveSessionDisplayName("mykey", row({ key: "mykey", displayName: "mykey" }))).toBe(
      "mykey",
    );
  });

  it("returns parsed fallback when label matches key", () => {
    expect(resolveSessionDisplayName("mykey", row({ key: "mykey", label: "mykey" }))).toBe("mykey");
  });

  it("uses label alone when available", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", label: "General" }),
      ),
    ).toBe("General");
  });

  it("falls back to displayName when label is absent", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat" }),
      ),
    ).toBe("My Chat");
  });

  it("prefers label over displayName when both are present", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat", label: "General" }),
      ),
    ).toBe("General");
  });

  it("ignores whitespace-only label and falls back to displayName", () => {
    expect(
      resolveSessionDisplayName(
        "discord:123:456",
        row({ key: "discord:123:456", displayName: "My Chat", label: "   " }),
      ),
    ).toBe("My Chat");
  });

  it("uses parsed fallback when whitespace-only label and no displayName", () => {
    expect(
      resolveSessionDisplayName("discord:123:456", row({ key: "discord:123:456", label: "   " })),
    ).toBe("Discord Session");
  });

  it("trims label and displayName", () => {
    expect(resolveSessionDisplayName("k", row({ key: "k", label: "  General  " }))).toBe("General");
    expect(resolveSessionDisplayName("k", row({ key: "k", displayName: "  My Chat  " }))).toBe(
      "My Chat",
    );
  });

  // ── Type prefixes applied to labels / displayNames ──

  it("prefixes subagent label with Subagent:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", label: "maintainer-v2" }),
      ),
    ).toBe("Subagent: maintainer-v2");
  });

  it("prefixes subagent displayName with Subagent:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", displayName: "Task Runner" }),
      ),
    ).toBe("Subagent: Task Runner");
  });

  it("prefixes cron label with Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", label: "daily-briefing" }),
      ),
    ).toBe("Cron: daily-briefing");
  });

  it("prefixes cron displayName with Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", displayName: "Nightly Sync" }),
      ),
    ).toBe("Cron: Nightly Sync");
  });

  it("does not double-prefix cron labels that already include Cron:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:cron:abc-123",
        row({ key: "agent:main:cron:abc-123", label: "Cron: Nightly Sync" }),
      ),
    ).toBe("Cron: Nightly Sync");
  });

  it("does not double-prefix subagent display names that already include Subagent:", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:subagent:abc-123",
        row({ key: "agent:main:subagent:abc-123", displayName: "Subagent: Runner" }),
      ),
    ).toBe("Subagent: Runner");
  });

  it("does not prefix non-typed sessions with labels", () => {
    expect(
      resolveSessionDisplayName(
        "agent:main:bluebubbles:direct:+19257864429",
        row({ key: "agent:main:bluebubbles:direct:+19257864429", label: "Tyler" }),
      ),
    ).toBe("Tyler");
  });
});

describe("isCronSessionKey", () => {
  it("returns true for cron: prefixed keys", () => {
    expect(isCronSessionKey("cron:abc-123")).toBe(true);
    expect(isCronSessionKey("cron:weekly-agent-roundtable")).toBe(true);
    expect(isCronSessionKey("agent:main:cron:abc-123")).toBe(true);
    expect(isCronSessionKey("agent:main:cron:abc-123:run:run-1")).toBe(true);
  });

  it("returns false for non-cron keys", () => {
    expect(isCronSessionKey("main")).toBe(false);
    expect(isCronSessionKey("discord:group:eng")).toBe(false);
    expect(isCronSessionKey("agent:main:slack:cron:job:run:uuid")).toBe(false);
  });
});

describe("switchChatSession", () => {
  it("refreshes the chat avatar after clearing session-scoped state", async () => {
    const settings: AppViewState["settings"] = {
      gatewayUrl: "",
      token: "",
      locale: "en",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "dark",
      splitRatio: 0.6,
      navWidth: 280,
      navCollapsed: false,
      navGroupsCollapsed: {},
      borderRadius: 50,
      chatFocusMode: false,
      chatShowThinking: false,
      chatShowToolCalls: true,
    };
    const state = {
      sessionKey: "main",
      chatMessage: "draft",
      chatAttachments: [{ mimeType: "image/png", dataUrl: "data:image/png;base64,AAA" }],
      chatMessages: [{ role: "assistant", content: "old" }],
      chatToolMessages: [{ id: "tool-1" }],
      chatStreamSegments: [{ text: "segment", ts: 1 }],
      chatThinkingLevel: "high",
      chatStream: "stream",
      lastError: "oops",
      compactionStatus: { phase: "active" },
      runPhaseStatus: {
        phase: "running",
        runId: "run-1",
        startedAt: 1,
        endedAt: null,
      },
      fallbackStatus: { phase: "active" },
      chatAvatarUrl: "/avatar/old",
      chatQueue: [],
      chatRunId: "run-1",
      chatStreamStartedAt: 1,
      settings,
      applySettings(next: typeof settings) {
        state.settings = next;
      },
      loadAssistantIdentity: vi.fn(),
      resetToolStream: vi.fn(),
      resetChatScroll: vi.fn(),
    } as unknown as AppViewState;

    refreshChatAvatarMock.mockResolvedValue(undefined);
    loadChatHistoryMock.mockResolvedValue(undefined);
    loadSessionsMock.mockResolvedValue(undefined);

    await switchChatSession(state, "agent:main:test-b");
    await Promise.resolve();

    expect(state.runPhaseStatus).toBeNull();
    expect(refreshChatAvatarMock).toHaveBeenCalledWith(state);
    expect(loadChatHistoryMock).toHaveBeenCalledWith(state);
    expect(loadSessionsMock).toHaveBeenCalledWith(state, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: true,
      includeUnknown: true,
    });
  });
});
