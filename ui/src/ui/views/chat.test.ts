/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { getSafeLocalStorage } from "../../local-storage.ts";
import { renderChatSessionSelect } from "../app-render.helpers.ts";
import type { AppViewState } from "../app-view-state.ts";
import {
  createModelCatalog,
  createSessionsListResult,
  DEEPSEEK_CHAT_MODEL,
  DEFAULT_CHAT_MODEL_CATALOG,
} from "../chat-model.test-helpers.ts";
import { SKIP_DELETE_CONFIRM_KEY } from "../chat/grouped-render.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { GatewaySessionRow, ModelCatalogEntry, SessionsListResult } from "../types.ts";
import { __test, renderChat, type ChatProps } from "./chat.ts";
import { renderOverview, type OverviewProps } from "./overview.ts";

function readDeleteConfirmPreference(): string | null {
  try {
    return getSafeLocalStorage()?.getItem(SKIP_DELETE_CONFIRM_KEY) ?? null;
  } catch {
    return null;
  }
}

function clearDeleteConfirmPreference(): void {
  try {
    getSafeLocalStorage()?.removeItem(SKIP_DELETE_CONFIRM_KEY);
  } catch {
    /* noop */
  }
}

function restoreDeleteConfirmPreference(value: string | null): void {
  try {
    if (value === null) {
      getSafeLocalStorage()?.removeItem(SKIP_DELETE_CONFIRM_KEY);
      return;
    }
    getSafeLocalStorage()?.setItem(SKIP_DELETE_CONFIRM_KEY, value);
  } catch {
    /* noop */
  }
}

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { modelProvider: null, model: null, contextTokens: null },
    sessions: [],
  };
}

function createChatHeaderState(
  overrides: {
    model?: string | null;
    modelProvider?: string | null;
    thinkingLevel?: string | null;
    models?: ModelCatalogEntry[];
    omitSessionFromList?: boolean;
  } = {},
): { state: AppViewState; request: ReturnType<typeof vi.fn> } {
  let currentModel = overrides.model ?? null;
  let currentModelProvider = overrides.modelProvider ?? (currentModel ? "openai" : null);
  let currentThinkingLevel = overrides.thinkingLevel ?? null;
  const omitSessionFromList = overrides.omitSessionFromList ?? false;
  const catalog = overrides.models ?? createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG);
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "sessions.patch") {
      const nextModel = (params.model as string | null | undefined) ?? null;
      const nextThinkingLevel = params.thinkingLevel as string | null | undefined;
      if ("thinkingLevel" in params) {
        currentThinkingLevel = nextThinkingLevel ?? null;
      }
      if (!nextModel) {
        currentModel = null;
        currentModelProvider = null;
      } else {
        const normalized = nextModel.trim();
        const slashIndex = normalized.indexOf("/");
        if (slashIndex > 0) {
          currentModelProvider = normalized.slice(0, slashIndex);
          currentModel = normalized.slice(slashIndex + 1);
        } else {
          currentModel = normalized;
          const matchingProviders = catalog
            .filter((entry) => entry.id === normalized)
            .map((entry) => entry.provider)
            .filter(Boolean);
          currentModelProvider =
            matchingProviders.length === 1 ? matchingProviders[0] : currentModelProvider;
        }
      }
      return { ok: true, key: "main" };
    }
    if (method === "chat.history") {
      return { messages: [], thinkingLevel: null };
    }
    if (method === "sessions.list") {
      const result = createSessionsListResult({
        model: currentModel,
        modelProvider: currentModelProvider,
        omitSessionFromList,
      });
      if (result.sessions[0]) {
        result.sessions[0].thinkingLevel = currentThinkingLevel ?? undefined;
      }
      return result;
    }
    if (method === "models.list") {
      return { models: catalog };
    }
    if (method === "tools.effective") {
      return {
        agentId: "main",
        profile: "coding",
        groups: [],
      };
    }
    throw new Error(`Unexpected request: ${method}`);
  });
  const state = {
    sessionKey: "main",
    connected: true,
    sessionsHideCron: true,
    sessionsResult: (() => {
      const result = createSessionsListResult({
        model: currentModel,
        modelProvider: currentModelProvider,
        omitSessionFromList,
      });
      if (result.sessions[0]) {
        result.sessions[0].thinkingLevel = currentThinkingLevel ?? undefined;
      }
      return result;
    })(),
    chatModelOverrides: {},
    chatModelCatalog: catalog,
    chatModelsLoading: false,
    client: { request } as unknown as GatewayBrowserClient,
    settings: {
      gatewayUrl: "",
      token: "",
      locale: "en",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "dark",
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
      borderRadius: 50,
      chatFocusMode: false,
      chatShowThinking: false,
    },
    chatMessage: "",
    chatStream: null,
    chatStreamStartedAt: null,
    chatRunId: null,
    chatQueue: [],
    chatMessages: [],
    chatLoading: false,
    chatThinkingLevel: null,
    lastError: null,
    chatAvatarUrl: null,
    basePath: "",
    hello: null,
    agentsList: null,
    agentsPanel: "overview",
    agentsSelectedId: null,
    toolsEffectiveLoading: false,
    toolsEffectiveLoadingKey: null,
    toolsEffectiveResultKey: null,
    toolsEffectiveError: null,
    toolsEffectiveResult: null,
    applySettings(next: AppViewState["settings"]) {
      state.settings = next;
    },
    loadAssistantIdentity: vi.fn(),
    resetToolStream: vi.fn(),
    resetChatScroll: vi.fn(),
  } as unknown as AppViewState & {
    client: GatewayBrowserClient;
    settings: AppViewState["settings"];
  };
  return { state, request };
}

function flushTasks() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function createSessionsResultFromRows(rows: GatewaySessionRow[]): SessionsListResult {
  return {
    ts: Date.now(),
    path: "",
    count: rows.length,
    defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
    sessions: rows,
  };
}

function getChatModelSelect(container: Element): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(
    'select[data-chat-model-select="true"]',
  );
  expect(select).not.toBeNull();
  return select!;
}

function withDocumentLang<T>(lang: string, run: () => T): T {
  const previous = document.documentElement.lang;
  document.documentElement.lang = lang;
  try {
    return run();
  } finally {
    document.documentElement.lang = previous;
  }
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    showToolCalls: true,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    agentsList: null,
    currentAgentId: "",
    onAgentChange: () => undefined,
    ...overrides,
  };
}

function expectLiveRunStatusAndMascotPhase(
  container: HTMLElement,
  bannerPhase: string,
  mascotPhase: string = bannerPhase,
) {
  const status = container.querySelector(`.live-run-status[data-phase='${bannerPhase}']`);
  expect(status).not.toBeNull();
  const mascot = status?.querySelector(".employee-crab-mascot-wrap");
  expect(mascot).not.toBeNull();
  expect(mascot?.getAttribute("data-phase")).toBe(mascotPhase);
  return status;
}

function createOverviewProps(overrides: Partial<OverviewProps> = {}): OverviewProps {
  return {
    connected: false,
    hello: null,
    settings: {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
      borderRadius: 50,
      locale: "en",
    },
    password: "",
    lastError: null,
    lastErrorCode: null,
    presenceCount: 0,
    sessionsCount: null,
    cronEnabled: null,
    cronNext: null,
    lastChannelsRefresh: null,
    warnQueryToken: false,
    usageResult: null,
    sessionsResult: null,
    skillsReport: null,
    cronJobs: [],
    cronStatus: null,
    attentionItems: [],
    eventLog: [],
    overviewLogLines: [],
    showGatewayToken: false,
    showGatewayPassword: false,
    onSettingsChange: () => undefined,
    onPasswordChange: () => undefined,
    onSessionKeyChange: () => undefined,
    onToggleGatewayTokenVisibility: () => undefined,
    onToggleGatewayPasswordVisibility: () => undefined,
    onConnect: () => undefined,
    onRefresh: () => undefined,
    onNavigate: () => undefined,
    onRefreshLogs: () => undefined,
    ...overrides,
  };
}

describe("chat view", () => {
  it("renders a localized failure on the matching message and retries that run", () => {
    const onRetrySend = vi.fn();
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          employeeMode: true,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "보고서 요약해줘" }],
              timestamp: 1,
              __openclaw: { kind: "outbound", runId: "run-timeout" },
            },
          ],
          sendFailures: {
            "run-timeout": {
              runId: "run-timeout",
              message: "보고서 요약해줘",
              attachments: [],
              code: "timeout",
              title: "AI 서버가 제한 시간 내에 응답하지 않았습니다.",
              detail: "일시적인 사용량 증가 또는 네트워크 지연일 수 있습니다.",
              retryable: true,
              phase: "run",
              retrying: false,
            },
          },
          onRetrySend,
        }),
      ),
      container,
    );

    expect(container.querySelector(".chat-send-failure")?.textContent).toContain(
      "AI 서버가 제한 시간 내에 응답하지 않았습니다.",
    );
    const retry = container.querySelector<HTMLButtonElement>(".chat-send-failure__retry");
    expect(retry?.textContent?.trim()).toBe("다시 시도");
    retry?.click();
    expect(onRetrySend).toHaveBeenCalledWith("run-timeout");
  });

  it("renders queued follow-up status through the live run status bar", () => {
    withDocumentLang("en", () => {
      const container = document.createElement("div");
      render(
        renderChat(
          createProps({
            queue: [{ id: "q1", text: "follow up", createdAt: 1 }],
            runPhaseStatus: {
              phase: "queued",
              runId: "run-phase-1",
              startedAt: 1_000,
              endedAt: null,
            },
          }),
        ),
        container,
      );

      const status = container.querySelector(".live-run-status[data-phase='queued']");
      expect(status).not.toBeNull();
      expect(status?.textContent).toContain("Pending follow-up");
      expect(status?.textContent).toContain(
        "This follow-up request will start after the current run completes.",
      );
      expect(status?.textContent).toContain("1 queued");
    });
  });

  it("renders the status banner from LiveRunViewState title body tone and kind", () => {
    withDocumentLang("en", () => {
      const container = document.createElement("div");
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(20_000);
      render(renderChat(createProps({ sending: true, streamStartedAt: 8_000 })), container);

      const status = expectLiveRunStatusAndMascotPhase(container, "sending");
      expect(status?.className).toContain("live-run-status--normal");
      expect(status?.querySelector(".live-run-status__title")?.textContent).toBe("Sending request");
      expect(status?.querySelector(".live-run-status__body")?.textContent).toBe(
        "The browser is handing this message to the gateway.",
      );
      expect(status?.querySelector(".live-run-status__phase")?.textContent).toBe("sending");
      expect(status?.querySelector(".live-run-status__meta")?.textContent).toContain(
        "00:12 elapsed",
      );
      nowSpy.mockRestore();
    });
  });

  it("keeps waiting banner and mascot phases aligned", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: true,
          stream: null,
          streamStartedAt: Date.now() - 1_000,
        }),
      ),
      container,
    );

    expectLiveRunStatusAndMascotPhase(container, "waiting");
  });

  it("keeps streaming banner and mascot phases aligned", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          stream: "Assistant output",
          streamStartedAt: Date.now() - 1_000,
        }),
      ),
      container,
    );

    expectLiveRunStatusAndMascotPhase(container, "streaming");
  });

  it("keeps legacy deriveLiveRunStatus compatible for rollback", () => {
    withDocumentLang("en", () => {
      const status = __test.deriveLiveRunStatus(
        createProps({
          stream: "Assistant output",
          streamStartedAt: 1_000,
        }),
      );

      expect(status).toMatchObject({
        phase: "streaming",
        tone: "normal",
        title: "Writing response",
        body: "Assistant output is arriving. The final message will settle when the run completes.",
        mascotPhase: "streaming",
      });
    });
  });

  it("renders queued messages as compact pending user bubbles", () => {
    const onQueueRemove = vi.fn();
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          queue: [
            { id: "q1", text: "ㅎㅎ", createdAt: 1 },
            { id: "q2", text: "/steer 더 짧게", createdAt: 2, pendingRunId: "run-1" },
          ],
          onQueueRemove,
        }),
      ),
      container,
    );

    const queue = container.querySelector(".chat-queue");
    expect(queue).not.toBeNull();
    expect(queue?.textContent).toContain("전송 대기 중 (2)");
    expect(queue?.textContent).toContain("현재 응답이 끝나면 자동으로 전송됩니다.");
    expect(queue?.querySelectorAll(".chat-queue__item.chat-line.user")).toHaveLength(2);
    expect(queue?.querySelector(".chat-queue__bubble.chat-bubble")?.textContent).toContain("ㅎㅎ");

    const cancel = queue?.querySelector<HTMLButtonElement>(".chat-queue__remove");
    expect(cancel?.textContent?.trim()).toBe("취소");
    expect(cancel?.getAttribute("aria-label")).toBe("전송 대기 취소");
    expect(cancel?.getAttribute("title")).toBe("전송 대기 취소");
    cancel?.click();
    expect(onQueueRemove).toHaveBeenCalledWith("q1");
  });

  it("renders memory flushing as a compaction status in Korean through the live run status bar", () => {
    withDocumentLang("ko-KR", () => {
      const container = document.createElement("div");
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12_000);
      render(
        renderChat(
          createProps({
            runPhaseStatus: {
              phase: "memory_flushing",
              runId: "run-phase-2",
              startedAt: 8_000,
              endedAt: null,
            },
          }),
        ),
        container,
      );

      const status = expectLiveRunStatusAndMascotPhase(container, "compacting");
      expect(status?.className).toContain("live-run-status--compaction");
      expect(status?.textContent).toContain("기억 정리 중");
      expect(status?.textContent).toContain("응답 전 필요한 기억을 정리하고 있습니다.");
      expect(status?.textContent).toContain("00:04 elapsed");
      nowSpy.mockRestore();
    });
  });

  it("prioritizes failed run phase over stale active compaction", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(60_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "active",
            runId: "run-1",
            startedAt: 1_000,
            completedAt: null,
          },
          runPhaseStatus: {
            phase: "failed",
            runId: "run-phase-1",
            startedAt: 1_000,
            endedAt: 6_000,
            elapsedMs: 5_000,
            failedCode: "run_failed",
          },
        }),
      ),
      container,
    );

    const status = expectLiveRunStatusAndMascotPhase(container, "terminal", "attention");
    expect(status?.textContent).toContain("Response failed.");
    expect(status?.textContent).toContain("00:05 elapsed");
    expect(status?.textContent).not.toContain("Compacting context");
    expect(
      status?.querySelector(".employee-crab-mascot-wrap")?.getAttribute("data-phase"),
    ).not.toBe("compacting");
    nowSpy.mockRestore();
  });

  it("prioritizes aborted run phase over waiting or compacting status", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(40_000);
    render(
      renderChat(
        createProps({
          canAbort: true,
          compactionStatus: {
            phase: "active",
            runId: "run-1",
            startedAt: 1_000,
            completedAt: null,
          },
          runPhaseStatus: {
            phase: "aborted",
            runId: "run-phase-1",
            startedAt: 1_000,
            endedAt: 4_000,
            elapsedMs: 3_000,
            abortedCode: "aborted_by_user",
          },
        }),
      ),
      container,
    );

    const status = expectLiveRunStatusAndMascotPhase(container, "terminal", "attention");
    expect(status?.textContent).toContain("Response stopped.");
    expect(status?.textContent).toContain("00:03 elapsed");
    expect(status?.textContent).not.toContain("Preparing response");
    expect(status?.textContent).not.toContain("Compacting context");
    expect(
      status?.querySelector(".employee-crab-mascot-wrap")?.getAttribute("data-phase"),
    ).not.toBe("waiting");
    expect(
      status?.querySelector(".employee-crab-mascot-wrap")?.getAttribute("data-phase"),
    ).not.toBe("compacting");
    nowSpy.mockRestore();
  });

  it("prioritizes terminal timeout over elapsed-only waiting status", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(120_000);
    render(
      renderChat(
        createProps({
          canAbort: true,
          streamStartedAt: 1_000,
          runPhaseStatus: {
            phase: "failed",
            runId: "run-phase-1",
            startedAt: 1_000,
            endedAt: 61_000,
            elapsedMs: 60_000,
            failedCode: "timeout",
          },
        }),
      ),
      container,
    );

    const status = expectLiveRunStatusAndMascotPhase(container, "terminal", "attention");
    expect(status?.textContent).toContain("The AI server did not respond in time.");
    expect(status?.textContent).toContain("01:00 elapsed");
    expect(status?.textContent).not.toContain("Waiting for model response");
    nowSpy.mockRestore();
  });

  it("renders preflight compaction token reduction metadata in Korean", () => {
    withDocumentLang("ko-KR", () => {
      const container = document.createElement("div");
      render(
        renderChat(
          createProps({
            compactionStatus: {
              phase: "complete",
              runId: "run-phase-3",
              startedAt: 1_000,
              completedAt: 2_000,
              tokensBefore: 120_000,
              tokensAfter: 45_000,
            },
            runPhaseStatus: {
              phase: "preflight_compacting",
              runId: "run-phase-3",
              startedAt: 1_000,
              endedAt: null,
            },
          }),
        ),
        container,
      );

      const status = container.querySelector(".live-run-status[data-phase='compacting']");
      expect(status).not.toBeNull();
      expect(status?.textContent).toContain("대화 정리 중");
      expect(status?.textContent).toContain("120k -> 45k");
      expect(status?.textContent).toContain("63% 감소");
    });
  });

  it("renders running-prep status before the first stream chunk arrives", () => {
    withDocumentLang("en", () => {
      const container = document.createElement("div");
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(25_000);
      render(
        renderChat(
          createProps({
            runPhaseStatus: {
              phase: "running",
              runId: "run-phase-4",
              startedAt: 20_000,
              endedAt: null,
            },
          }),
        ),
        container,
      );

      const status = container.querySelector(".live-run-status[data-phase='waiting']");
      expect(status).not.toBeNull();
      expect(status?.textContent).toContain("Preparing response");
      expect(status?.textContent).toContain("The assistant is preparing the response.");
      expect(status?.textContent).toContain("00:05 elapsed");
      nowSpy.mockRestore();
    });
  });

  it("shows persistent context usage from fresh totalTokens below the warning threshold", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 757_300,
                totalTokens: 46_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("23% context used");
    expect(container.textContent).toContain("46k / 200k");
    expect(container.textContent).not.toContain("757.3k / 200k");
    expect(container.querySelector(".context-notice--usage")).not.toBeNull();
    expect(container.querySelector(".context-notice__meter")).not.toBeNull();
    expect(container.querySelector(".context-notice__icon")).toBeNull();
  });

  it("uses totalTokens for the context notice detail when current usage is high", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 757_300,
                totalTokens: 190_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("95% context used");
    expect(container.textContent).toContain("190k / 200k");
    expect(container.textContent).not.toContain("757.3k / 200k");
    expect(container.querySelector(".context-notice--warning")).not.toBeNull();
  });

  it("hides the context notice when totalTokens is missing even if inputTokens is high", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 500_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("context used");
  });

  it("hides the context notice when totalTokens is marked stale", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                totalTokens: 190_000,
                totalTokensFresh: false,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("context used");
    expect(container.textContent).not.toContain("190k / 200k");
  });

  it("deduplicates relay-labeled assistant copies by source message id", () => {
    const items = __test.buildChatItems(
      createProps({
        messages: [
          {
            __openclaw: { id: "reply-1" },
            role: "assistant",
            content: [{ type: "text", text: "Agent There it is." }],
            senderLabel: "Agent",
            timestamp: 1,
          },
          {
            __openclaw: { id: "reply-1" },
            role: "assistant",
            content: [{ type: "text", text: "There it is." }],
            timestamp: 2,
          },
        ],
      }),
    );

    expect(items).toHaveLength(1);
    const group = items[0];
    expect(group.kind).toBe("group");
    if (group.kind !== "group") {
      return;
    }
    expect(group.senderLabel).toBeNull();
    expect(group.messages).toHaveLength(1);
    expect(group.messages[0].message).toMatchObject({
      content: [{ type: "text", text: "There it is." }],
    });
  });

  it("keeps same-id user relay copies separate so sender identity is preserved", () => {
    const items = __test.buildChatItems(
      createProps({
        messages: [
          {
            __openclaw: { id: "user-1" },
            role: "user",
            content: [{ type: "text", text: "Alice hello" }],
            senderLabel: "Alice",
            timestamp: 1,
          },
          {
            __openclaw: { id: "user-1" },
            role: "user",
            content: [{ type: "text", text: "hello" }],
            timestamp: 2,
          },
        ],
      }),
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => (item.kind === "group" ? item.senderLabel : null))).toEqual([
      "Alice",
      null,
    ]);
  });

  it("uses the assistant avatar URL for the welcome state when the identity avatar is only initials", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: "/avatar/main",
        }),
      ),
      container,
    );

    const welcomeImage = container.querySelector<HTMLImageElement>(".agent-chat__welcome > img");
    expect(welcomeImage).not.toBeNull();
    expect(welcomeImage?.getAttribute("src")).toBe("/avatar/main");
  });

  it("falls back to the bundled logo in the welcome state when the assistant avatar is not a URL", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
        }),
      ),
      container,
    );

    const welcomeImage = container.querySelector<HTMLImageElement>(".agent-chat__welcome > img");
    const logoImage = container.querySelector<HTMLImageElement>(
      ".agent-chat__welcome .agent-chat__avatar--logo img",
    );
    expect(welcomeImage).toBeNull();
    expect(logoImage).not.toBeNull();
    expect(logoImage?.getAttribute("src")).toBe("/favicon.svg");
  });

  it("keeps the welcome logo fallback under the mounted base path", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
          basePath: "/openclaw/",
        }),
      ),
      container,
    );

    const logoImage = container.querySelector<HTMLImageElement>(
      ".agent-chat__welcome .agent-chat__avatar--logo img",
    );
    expect(logoImage).not.toBeNull();
    expect(logoImage?.getAttribute("src")).toBe("/openclaw/favicon.svg");
  });

  it("keeps grouped assistant avatar fallbacks under the mounted base path", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
          basePath: "/openclaw/",
          messages: [
            {
              role: "assistant",
              content: "hello",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    const groupedLogo = container.querySelector<HTMLImageElement>(
      ".chat-group.assistant .chat-avatar--logo",
    );
    expect(groupedLogo).not.toBeNull();
    expect(groupedLogo?.getAttribute("src")).toBe("/openclaw/favicon.svg");
  });

  it("keeps the persisted overview locale selected before i18n hydration finishes", async () => {
    const container = document.createElement("div");
    const props = createOverviewProps({
      settings: {
        ...createOverviewProps().settings,
        locale: "zh-CN",
      },
    });

    getSafeLocalStorage()?.clear();
    await i18n.setLocale("en");

    render(renderOverview(props), container);
    await Promise.resolve();

    let select = container.querySelector<HTMLSelectElement>("select");
    expect(i18n.getLocale()).toBe("en");
    expect(select?.value).toBe("zh-CN");
    expect(select?.selectedOptions[0]?.textContent?.trim()).toBe("简体中文 (Simplified Chinese)");

    await i18n.setLocale("zh-CN");
    render(renderOverview(props), container);
    await Promise.resolve();

    select = container.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("zh-CN");
    expect(select?.selectedOptions[0]?.textContent?.trim()).toBe("简体中文 (简体中文)");

    await i18n.setLocale("en");
  });

  it("renders compacting state through the live run status bar", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "active",
            runId: "run-1",
            startedAt: 8_000,
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const status = expectLiveRunStatusAndMascotPhase(container, "compacting");
    expect(status?.textContent).toContain("Compacting context");
    nowSpy.mockRestore();
  });

  it("prioritizes active compaction over stale stream and tool status", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(12_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "active",
            runId: "run-1",
            startedAt: 9_000,
            completedAt: null,
          },
          stream: "partial assistant output",
          toolMessages: [{ role: "tool", content: "tool output" }],
        }),
      ),
      container,
    );

    const status = expectLiveRunStatusAndMascotPhase(container, "compacting");
    expect(status?.className).toContain("live-run-status--compaction");
    expect(status?.textContent).toContain("Compacting context");
    expect(status?.textContent).not.toContain("Writing response");
    expect(status?.textContent).not.toContain("Running tools");
    nowSpy.mockRestore();
  });

  it("renders incomplete compaction as informational compaction status", () => {
    withDocumentLang("ko-KR", () => {
      const container = document.createElement("div");
      render(
        renderChat(
          createProps({
            compactionStatus: {
              phase: "incomplete",
              runId: "run-1",
              startedAt: 1_000,
              completedAt: 4_000,
            },
          }),
        ),
        container,
      );

      const status = expectLiveRunStatusAndMascotPhase(container, "compacting", "attention");
      expect(status?.className).toContain("live-run-status--compaction");
      expect(status?.className).not.toContain("danger");
      expect(status?.textContent).toContain("대화 정리를 완료하지 못했습니다.");
      expect(status?.textContent).toContain("응답은 계속 진행될 수 있습니다.");
      expect(status?.textContent).toContain("00:03 elapsed");
    });
  });

  it("prioritizes terminal failure over incomplete compaction", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "incomplete",
            runId: "run-1",
            startedAt: 1_000,
            completedAt: 4_000,
          },
          runPhaseStatus: {
            phase: "failed",
            runId: "run-1",
            startedAt: 1_000,
            endedAt: 5_000,
            failedCode: "run_failed",
          },
        }),
      ),
      container,
    );

    const status = expectLiveRunStatusAndMascotPhase(container, "terminal", "attention");
    expect(status?.textContent).toContain("Response failed.");
    expect(status?.textContent).not.toContain("Conversation cleanup was incomplete.");
  });

  it("prioritizes streaming over incomplete compaction", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          stream: "The answer is arriving.",
          streamStartedAt: 5_000,
          compactionStatus: {
            phase: "incomplete",
            runId: "run-1",
            startedAt: 1_000,
            completedAt: 4_000,
          },
        }),
      ),
      container,
    );

    const status = expectLiveRunStatusAndMascotPhase(container, "streaming");
    expect(status?.textContent).toContain("Writing response");
    expect(status?.textContent).not.toContain("Conversation cleanup was incomplete.");
  });

  it("does not change Stop or composer policy for incomplete compaction", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: true,
          canSend: true,
          draft: "follow up",
          onAbort: vi.fn(),
          onSend: vi.fn(),
          compactionStatus: {
            phase: "incomplete",
            runId: "run-1",
            startedAt: 1_000,
            completedAt: 4_000,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector('button[title="Stop"]')).not.toBeNull();
    expect(container.querySelector('button[title="Queue"]')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(false);
  });

  it("prioritizes streaming over stale active compaction", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          stream: "The answer is arriving.",
          streamStartedAt: 8_000,
          compactionStatus: {
            phase: "active",
            runId: "run-1",
            startedAt: 2_000,
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const status = expectLiveRunStatusAndMascotPhase(container, "streaming");
    expect(status?.textContent).toContain("Writing response");
    expect(status?.textContent).not.toContain("Compacting context");
    nowSpy.mockRestore();
  });

  it.each([
    {
      elapsedMs: 2_000,
      expected: "Long conversation context is being organized.",
    },
    {
      elapsedMs: 5_000,
      expected: "Organizing earlier conversation so the response can continue.",
    },
    {
      elapsedMs: 12_000,
      expected: "The conversation is long, so compaction is taking a little longer.",
    },
    {
      elapsedMs: 65_000,
      expected: "This is taking longer than expected. Please keep this tab open.",
    },
  ])("updates runtime compaction copy after $elapsedMs ms", ({ elapsedMs, expected }) => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "active",
            runId: "run-1",
            startedAt: 100_000 - elapsedMs,
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const status = container.querySelector(".live-run-status[data-phase='compacting']");
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain(expected);
    nowSpy.mockRestore();
  });

  it("renders retry-pending compaction state through the live run status bar", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(125_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "retrying",
            runId: "run-1",
            startedAt: 5_000,
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const status = container.querySelector(".live-run-status[data-phase='retrying']");
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain("Resuming response");
    nowSpy.mockRestore();
  });

  it("does not render a separate completion indicator after compaction", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "complete",
            runId: "run-1",
            startedAt: 900,
            completedAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--complete");
    expect(indicator).toBeNull();
    nowSpy.mockRestore();
  });

  it("hides stale compaction completion indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "complete",
            runId: "run-1",
            startedAt: 0,
            completedAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator")).toBeNull();
    nowSpy.mockRestore();
  });

  it("renders fallback indicator shortly after fallback event", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            selected: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
            active: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: ["fireworks/accounts/fireworks/routers/kimi-k2p5-turbo: rate limit"],
            occurredAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--fallback");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Fallback active: deepinfra/moonshotai/Kimi-K2.5");
    nowSpy.mockRestore();
  });

  it("hides stale fallback indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(20_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            selected: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
            active: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: [],
            occurredAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator--fallback")).toBeNull();
    nowSpy.mockRestore();
  });

  it("renders fallback-cleared indicator shortly after transition", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            phase: "cleared",
            selected: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
            active: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
            previous: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: [],
            occurredAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--fallback-cleared");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain(
      "Fallback cleared: fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
    );
    nowSpy.mockRestore();
  });

  it("shows a stop button when aborting is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          sending: true,
          onAbort,
        }),
      ),
      container,
    );

    const stopButton = container.querySelector<HTMLButtonElement>('button[title="Stop"]');
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("New session");
  });

  it("shows a stop button when aborting is available without an active stream", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: true,
          sending: false,
          stream: null,
          onAbort: vi.fn(),
        }),
      ),
      container,
    );

    const stopButton = container.querySelector<HTMLButtonElement>('button[title="Stop"]');
    const queueButton = container.querySelector<HTMLButtonElement>('button[title="Queue"]');
    expect(stopButton).not.toBeNull();
    expect(queueButton).not.toBeNull();
    expect(container.textContent).not.toContain("New session");
  });

  it.each([
    {
      phase: "waiting",
      overrides: {
        canAbort: true,
        stream: null,
      },
    },
    {
      phase: "streaming",
      overrides: {
        canAbort: true,
        stream: "Assistant output",
      },
    },
    {
      phase: "compacting",
      overrides: {
        canAbort: true,
        compactionStatus: {
          phase: "active" as const,
          runId: "run-1",
          startedAt: 1_000,
          completedAt: null,
        },
      },
    },
    {
      phase: "tool",
      overrides: {
        canAbort: true,
        toolMessages: [{ role: "tool", content: "tool output" }],
      },
    },
    {
      phase: "retrying",
      overrides: {
        canAbort: true,
        compactionStatus: {
          phase: "retrying" as const,
          runId: "run-1",
          startedAt: 1_000,
          completedAt: null,
        },
      },
    },
  ])("shows Stop for an abortable $phase live run", ({ phase, overrides }) => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          ...overrides,
          onAbort: vi.fn(),
        }),
      ),
      container,
    );

    expect(container.querySelector(`.live-run-status[data-phase='${phase}']`)).not.toBeNull();
    expect(container.querySelector('button[title="Stop"]')).not.toBeNull();
    expect(container.querySelector('button[title="Queue"]')).not.toBeNull();
  });

  it.each([
    {
      state: "failed terminal",
      overrides: {
        canAbort: true,
        runPhaseStatus: {
          phase: "failed" as const,
          runId: "run-1",
          startedAt: 1_000,
          endedAt: 2_000,
          failedCode: "run_failed",
        },
      },
      expectedPhase: "terminal",
    },
    {
      state: "aborted terminal",
      overrides: {
        canAbort: true,
        runPhaseStatus: {
          phase: "aborted" as const,
          runId: "run-1",
          startedAt: 1_000,
          endedAt: 2_000,
          abortedCode: "aborted_by_user",
        },
      },
      expectedPhase: "terminal",
    },
    {
      state: "disconnected terminal",
      overrides: {
        connected: false,
        canAbort: true,
      },
      expectedPhase: "terminal",
    },
    {
      state: "queued-only",
      overrides: {
        canAbort: true,
        queue: [{ id: "q1", text: "follow up", createdAt: 1 }],
        runPhaseStatus: {
          phase: "queued" as const,
          runId: "run-1",
          startedAt: 1_000,
          endedAt: null,
        },
      },
      expectedPhase: "queued",
    },
  ])("hides Stop for $state view state", ({ overrides, expectedPhase }) => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          ...overrides,
          onAbort: vi.fn(),
        }),
      ),
      container,
    );

    expect(
      container.querySelector(`.live-run-status[data-phase='${expectedPhase}']`),
    ).not.toBeNull();
    expect(container.querySelector('button[title="Stop"]')).toBeNull();
  });

  it.each([
    {
      condition: "canAbort is false",
      overrides: {
        canAbort: false,
        stream: "Assistant output",
        onAbort: vi.fn(),
      },
      expectedTitle: "Send",
    },
    {
      condition: "onAbort is missing",
      overrides: {
        canAbort: true,
        stream: "Assistant output",
        onAbort: undefined,
      },
      expectedTitle: "Queue",
    },
  ])("hides Stop for an active run when $condition", ({ overrides, expectedTitle }) => {
    const container = document.createElement("div");
    render(renderChat(createProps(overrides)), container);

    expect(container.querySelector(".live-run-status[data-phase='streaming']")).not.toBeNull();
    expect(container.querySelector('button[title="Stop"]')).toBeNull();
    expect(container.querySelector(`button[title="${expectedTitle}"]`)).not.toBeNull();
  });

  it("keeps the existing Queue button policy when terminal state filters out Stop", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: true,
          onAbort: vi.fn(),
          runPhaseStatus: {
            phase: "failed",
            runId: "run-1",
            startedAt: 1_000,
            endedAt: 2_000,
            failedCode: "run_failed",
          },
        }),
      ),
      container,
    );

    const queueButton = container.querySelector<HTMLButtonElement>('button[title="Queue"]');
    expect(queueButton).not.toBeNull();
    expect(queueButton?.disabled).toBe(false);
  });

  it("keeps Stop and Queue as independent actions during an active run", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    const onSend = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          draft: "follow up",
          onAbort,
          onSend,
        }),
      ),
      container,
    );

    container.querySelector<HTMLButtonElement>('button[title="Stop"]')?.click();
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();

    container.querySelector<HTMLButtonElement>('button[title="Queue"]')?.click();
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("keeps idle input enabled with an enabled Send action", () => {
    const container = document.createElement("div");
    render(renderChat(createProps()), container);

    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[title="Send"]')?.disabled).toBe(
      false,
    );
  });

  it("disables the input and Send action while disconnected", () => {
    const container = document.createElement("div");
    render(renderChat(createProps({ connected: false, canSend: false })), container);

    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('button[title="Send"]')?.disabled).toBe(true);
  });

  it("keeps Queue label visible but disables submit while sending", () => {
    const container = document.createElement("div");
    render(renderChat(createProps({ sending: true })), container);

    const queueButton = container.querySelector<HTMLButtonElement>('button[title="Queue"]');
    expect(queueButton).not.toBeNull();
    expect(queueButton?.disabled).toBe(true);
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(false);
  });

  it.each(["failed", "aborted"] as const)(
    "uses transport busy state for Queue after terminal %s",
    (phase) => {
      const container = document.createElement("div");
      render(
        renderChat(
          createProps({
            canAbort: true,
            onAbort: vi.fn(),
            runPhaseStatus: {
              phase,
              runId: "run-1",
              startedAt: 1_000,
              endedAt: 2_000,
            },
          }),
        ),
        container,
      );

      expect(container.querySelector(".live-run-status[data-phase='terminal']")).not.toBeNull();
      expect(container.querySelector('button[title="Stop"]')).toBeNull();
      expect(container.querySelector('button[title="Queue"]')).not.toBeNull();
    },
  );

  it.each(["failed", "aborted"] as const)(
    "returns to Send after terminal %s transport state is cleared",
    (phase) => {
      const container = document.createElement("div");
      render(
        renderChat(
          createProps({
            canAbort: false,
            runPhaseStatus: {
              phase,
              runId: "run-1",
              startedAt: 1_000,
              endedAt: 2_000,
            },
          }),
        ),
        container,
      );

      expect(container.querySelector(".live-run-status[data-phase='terminal']")).not.toBeNull();
      expect(container.querySelector('button[title="Send"]')).not.toBeNull();
      expect(container.querySelector('button[title="Queue"]')).toBeNull();
    },
  );

  it("uses Send for queued-only state when no transport run is active", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          queue: [{ id: "q1", text: "follow up", createdAt: 1 }],
          runPhaseStatus: {
            phase: "queued",
            runId: "run-1",
            startedAt: 1_000,
            endedAt: null,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".live-run-status[data-phase='queued']")).not.toBeNull();
    expect(container.querySelector('button[title="Send"]')).not.toBeNull();
    expect(container.querySelector('button[title="Queue"]')).toBeNull();
  });

  it("blocks button and Enter submission during upload while keeping input editable", () => {
    const container = document.createElement("div");
    const onSend = vi.fn();
    render(
      renderChat(
        createProps({
          draft: "send after upload",
          canSend: false,
          attachments: [
            {
              id: "upload-1",
              kind: "file",
              fileName: "report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 100,
              status: "uploading",
              progress: 50,
            },
          ],
          onSend,
        }),
      ),
      container,
    );

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    const sendButton = container.querySelector<HTMLButtonElement>('button[title="Send"]');
    expect(textarea?.disabled).toBe(false);
    expect(sendButton?.disabled).toBe(true);

    sendButton?.click();
    textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("uses the same enabled policy for button and Enter submission", () => {
    const container = document.createElement("div");
    const onSend = vi.fn();
    render(renderChat(createProps({ draft: "hello", onSend })), container);

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onSend).toHaveBeenCalledTimes(1);

    container.querySelector<HTMLButtonElement>('button[title="Send"]')?.click();
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("keeps Shift+Enter as a newline action without submitting", () => {
    const container = document.createElement("div");
    const onSend = vi.fn();
    render(renderChat(createProps({ draft: "hello", onSend })), container);

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    container.querySelector<HTMLTextAreaElement>("textarea")?.dispatchEvent(event);

    expect(onSend).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not submit Enter while IME composition is active", () => {
    const container = document.createElement("div");
    const onSend = vi.fn();
    render(renderChat(createProps({ draft: "안녕", onSend })), container);

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    container.querySelector<HTMLTextAreaElement>("textarea")?.dispatchEvent(event);

    expect(onSend).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not force textarea resize during IME composition", () => {
    const container = document.createElement("div");
    const onDraftChange = vi.fn();
    render(renderChat(createProps({ draft: "", onDraftChange })), container);

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea).not.toBeNull();
    textarea!.style.height = "42px";
    textarea!.value = "ㅎ";
    textarea!.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    textarea!.value = "하";
    textarea!.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));

    expect(textarea!.style.height).toBe("42px");
    expect(onDraftChange).toHaveBeenLastCalledWith("하");
  });

  it("shows a new session button when aborting is unavailable", () => {
    const container = document.createElement("div");
    const onNewSession = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: false,
          onNewSession,
        }),
      ),
      container,
    );

    const newSessionButton = container.querySelector<HTMLButtonElement>(
      'button[title="New session"]',
    );
    expect(newSessionButton).not.toBeUndefined();
    newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Stop");
  });

  it("shows sender labels from sanitized gateway messages instead of generic You", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "hello from topic",
              senderLabel: "Iris",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    const senderLabels = Array.from(container.querySelectorAll(".chat-sender-name")).map((node) =>
      node.textContent?.trim(),
    );
    expect(senderLabels).toContain("Iris");
    expect(senderLabels).not.toContain("You");
  });

  it("keeps consecutive user messages from different senders in separate groups", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "first",
              senderLabel: "Iris",
              timestamp: 1000,
            },
            {
              role: "user",
              content: "second",
              senderLabel: "Joaquin De Rojas",
              timestamp: 1001,
            },
          ],
        }),
      ),
      container,
    );

    const groups = container.querySelectorAll(".chat-group.user");
    expect(groups).toHaveLength(2);
    const senderLabels = Array.from(container.querySelectorAll(".chat-sender-name")).map((node) =>
      node.textContent?.trim(),
    );
    expect(senderLabels).toContain("Iris");
    expect(senderLabels).toContain("Joaquin De Rojas");
  });

  it("opens delete confirm on the left for user messages", () => {
    const originalPreference = readDeleteConfirmPreference();
    clearDeleteConfirmPreference();
    const container = document.createElement("div");
    try {
      render(
        renderChat(
          createProps({
            messages: [
              {
                role: "user",
                content: "hello from user",
                timestamp: 1000,
              },
            ],
          }),
        ),
        container,
      );

      const deleteButton = container.querySelector<HTMLButtonElement>(
        ".chat-group.user .chat-group-delete",
      );
      expect(deleteButton).not.toBeNull();
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const confirm = container.querySelector<HTMLElement>(".chat-group.user .chat-delete-confirm");
      expect(confirm).not.toBeNull();
      expect(confirm?.classList.contains("chat-delete-confirm--left")).toBe(true);
    } finally {
      restoreDeleteConfirmPreference(originalPreference);
    }
  });

  it("opens delete confirm on the right for assistant messages", () => {
    const originalPreference = readDeleteConfirmPreference();
    clearDeleteConfirmPreference();
    const container = document.createElement("div");
    try {
      render(
        renderChat(
          createProps({
            messages: [
              {
                role: "assistant",
                content: "hello from assistant",
                timestamp: 1000,
              },
            ],
          }),
        ),
        container,
      );

      const deleteButton = container.querySelector<HTMLButtonElement>(
        ".chat-group.assistant .chat-group-delete",
      );
      expect(deleteButton).not.toBeNull();
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const confirm = container.querySelector<HTMLElement>(
        ".chat-group.assistant .chat-delete-confirm",
      );
      expect(confirm).not.toBeNull();
      expect(confirm?.classList.contains("chat-delete-confirm--right")).toBe(true);
    } finally {
      restoreDeleteConfirmPreference(originalPreference);
    }
  });

  it("renders delete confirm with the expected safe structure", () => {
    const originalPreference = readDeleteConfirmPreference();
    clearDeleteConfirmPreference();
    const container = document.createElement("div");
    try {
      render(
        renderChat(
          createProps({
            messages: [
              {
                role: "assistant",
                content: "hello from assistant",
                timestamp: 1000,
              },
            ],
          }),
        ),
        container,
      );

      const deleteButton = container.querySelector<HTMLButtonElement>(
        ".chat-group.assistant .chat-group-delete",
      );
      expect(deleteButton).not.toBeNull();
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const confirm = container.querySelector<HTMLElement>(
        ".chat-group.assistant .chat-delete-confirm",
      );
      expect(confirm?.querySelector(".chat-delete-confirm__text")?.textContent).toBe(
        "Delete this message?",
      );
      expect(confirm?.querySelector(".chat-delete-confirm__remember span")?.textContent).toBe(
        "Don't ask again",
      );
      expect(confirm?.querySelector<HTMLButtonElement>(".chat-delete-confirm__cancel")?.type).toBe(
        "button",
      );
      expect(confirm?.querySelector<HTMLButtonElement>(".chat-delete-confirm__yes")?.type).toBe(
        "button",
      );
      expect(confirm?.querySelector<HTMLInputElement>(".chat-delete-confirm__check")?.type).toBe(
        "checkbox",
      );
    } finally {
      restoreDeleteConfirmPreference(originalPreference);
    }
  });

  it("patches the current session model from the chat header picker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState();
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("");

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: "openai/gpt-5-mini",
    });
    expect(request).not.toHaveBeenCalledWith("chat.history", expect.anything());
    expect(state.sessionsResult?.sessions[0]?.model).toBe("gpt-5-mini");
    expect(state.sessionsResult?.sessions[0]?.modelProvider).toBe("openai");
    vi.unstubAllGlobals();
  });

  it("shows the default thinking level in the chat header picker", async () => {
    const { state } = createChatHeaderState({
      model: "gpt-5",
      modelProvider: "openai",
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const thinkingSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-thinking-select="true"]',
    );
    expect(thinkingSelect).not.toBeNull();
    expect(thinkingSelect?.value).toBe("");
    expect(thinkingSelect?.options[0]?.textContent?.trim()).toBe("Default (off)");
  });

  it("patches the current session thinking level from the chat header picker", async () => {
    const { state, request } = createChatHeaderState({
      model: "gpt-5",
      modelProvider: "openai",
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const thinkingSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-thinking-select="true"]',
    );
    expect(thinkingSelect).not.toBeNull();

    thinkingSelect!.value = "off";
    thinkingSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      thinkingLevel: "off",
    });
    expect(state.sessionsResult?.sessions[0]?.thinkingLevel).toBe("off");
  });

  it("clears the session thinking override back to the default thinking level", async () => {
    const { state, request } = createChatHeaderState({
      model: "gpt-5",
      modelProvider: "openai",
      thinkingLevel: "high",
    });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const thinkingSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-thinking-select="true"]',
    );
    expect(thinkingSelect).not.toBeNull();
    expect(thinkingSelect?.value).toBe("high");

    thinkingSelect!.value = "";
    thinkingSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      thinkingLevel: null,
    });
    expect(state.sessionsResult?.sessions[0]?.thinkingLevel).toBeUndefined();
  });

  it("reloads effective tools after a chat-header model switch for the active tools panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState();
    state.agentsPanel = "tools";
    state.agentsSelectedId = "main";
    state.toolsEffectiveResultKey = "main:main";
    state.toolsEffectiveResult = {
      agentId: "main",
      profile: "coding",
      groups: [],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("tools.effective", {
      agentId: "main",
      sessionKey: "main",
    });
    expect(state.toolsEffectiveResultKey).toBe("main:main:model=openai/gpt-5-mini");
    vi.unstubAllGlobals();
  });

  it("clears the session model override back to the default model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state, request } = createChatHeaderState({ model: "gpt-5-mini" });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("openai/gpt-5-mini");

    modelSelect!.value = "";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "main",
      model: null,
    });
    expect(state.sessionsResult?.sessions[0]?.model).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("disables the chat header model picker while a run is active", () => {
    const { state } = createChatHeaderState();
    state.chatRunId = "run-123";
    state.chatStream = "Working";
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.disabled).toBe(true);
  });

  it("shows live run status while sending", () => {
    const container = document.createElement("div");
    render(
      renderChat(createProps({ sending: true, streamStartedAt: Date.now() - 12_000 })),
      container,
    );
    expect(container.querySelector(".live-run-status")).not.toBeNull();
    expect(container.textContent).toContain("Sending request");
  });

  it("shows live waiting status after the request is accepted and before streaming starts", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          canAbort: true,
          stream: null,
          sending: false,
          streamStartedAt: Date.now() - 7_000,
        }),
      ),
      container,
    );
    expect(container.querySelector('.live-run-status[data-phase="waiting"]')).not.toBeNull();
    expect(container.textContent).toContain("Preparing response");
  });

  it("shows a timeout-specific failure callout", () => {
    const container = document.createElement("div");
    render(renderChat(createProps({ error: "provider timeout after 60000ms" })), container);
    expect(container.textContent).toContain("Request failed. Timed out.");
  });

  it("keeps the selected model visible when the active session is absent from sessions.list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
      } satisfies Partial<Response>),
    );
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();

    modelSelect!.value = "openai/gpt-5-mini";
    modelSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();
    render(renderChatSessionSelect(state), container);

    const rerendered = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(rerendered?.value).toBe("openai/gpt-5-mini");
    vi.unstubAllGlobals();
  });

  it("keeps the selected model visible after switching away and back to a session", async () => {
    const sessionA = "agent:main:session-a";
    const sessionB = "agent:main:session-b";
    const catalog = createModelCatalog(...DEFAULT_CHAT_MODEL_CATALOG, {
      id: "claude-opus-4.5",
      name: "Claude Opus 4.5",
      provider: "bedrock",
    });
    const { state } = createChatHeaderState({ models: catalog });
    let rows: GatewaySessionRow[] = [
      { key: sessionA, kind: "direct", label: "Session A", updatedAt: 2 },
      { key: sessionB, kind: "direct", label: "Session B", updatedAt: 1 },
    ];
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "sessions.patch") {
        const key = typeof params.key === "string" ? params.key : "";
        const nextModel = typeof params.model === "string" ? params.model.trim() : "";
        rows = rows.map((row) => {
          if (row.key !== key) {
            return row;
          }
          const nextRow: GatewaySessionRow = { ...row };
          if (!nextModel) {
            delete nextRow.model;
            delete nextRow.modelProvider;
            return nextRow;
          }
          const slashIndex = nextModel.indexOf("/");
          if (slashIndex > 0) {
            nextRow.modelProvider = nextModel.slice(0, slashIndex);
            nextRow.model = nextModel.slice(slashIndex + 1);
          } else {
            delete nextRow.modelProvider;
            nextRow.model = nextModel;
          }
          return nextRow;
        });
        return { ok: true, key };
      }
      if (method === "sessions.list") {
        return createSessionsResultFromRows(rows);
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "tools.effective") {
        return { agentId: "main", profile: "coding", groups: [] };
      }
      throw new Error(`Unexpected request: ${method}`);
    });
    state.client = { request } as unknown as GatewayBrowserClient;
    state.sessionKey = sessionA;
    state.settings.sessionKey = sessionA;
    state.sessionsResult = createSessionsResultFromRows(rows);
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = getChatModelSelect(container);
    expect(modelSelect.value).toBe("");

    modelSelect.value = "bedrock/claude-opus-4.5";
    modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await flushTasks();

    state.sessionKey = sessionB;
    state.settings.sessionKey = sessionB;
    render(renderChatSessionSelect(state), container);
    expect(getChatModelSelect(container).value).toBe("");

    state.sessionKey = sessionA;
    state.settings.sessionKey = sessionA;
    render(renderChatSessionSelect(state), container);

    expect(getChatModelSelect(container).value).toBe("bedrock/claude-opus-4.5");
  });

  it("normalizes cached bare /model overrides to the matching catalog option", () => {
    const { state } = createChatHeaderState();
    state.chatModelOverrides = { main: { kind: "raw", value: "gpt-5-mini" } };

    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect).not.toBeNull();
    expect(modelSelect?.value).toBe("openai/gpt-5-mini");

    const optionValues = Array.from(modelSelect?.querySelectorAll("option") ?? []).map(
      (option) => option.value,
    );
    expect(optionValues).toContain("openai/gpt-5-mini");
    expect(optionValues).not.toContain("gpt-5-mini");
  });

  it("prefers the catalog provider when the active session reports a stale provider", () => {
    const { state } = createChatHeaderState({
      model: "deepseek-chat",
      modelProvider: "zai",
      models: createModelCatalog(DEEPSEEK_CHAT_MODEL),
    });

    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect?.value).toBe("deepseek/deepseek-chat");
  });

  it("falls back to the server-qualified session model when catalog lookup fails", () => {
    const { state } = createChatHeaderState({
      model: "gpt-5-mini",
      models: [],
    });

    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const modelSelect = container.querySelector<HTMLSelectElement>(
      'select[data-chat-model-select="true"]',
    );
    expect(modelSelect?.value).toBe("openai/gpt-5-mini");

    const optionValues = Array.from(modelSelect?.querySelectorAll("option") ?? []).map(
      (option) => option.value,
    );
    expect(optionValues).toContain("openai/gpt-5-mini");
    expect(optionValues).not.toContain("gpt-5-mini");
  });

  it("prefers the session label over displayName in the grouped chat session selector", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b";
    state.settings.sessionKey = state.sessionKey;
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 1,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: state.sessionKey,
          kind: "direct",
          updatedAt: null,
          label: "cron-config-check",
          displayName: "webchat:g-agent-main-subagent-4f2146de-887b-4176-9abe-91140082959b",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain("Subagent: cron-config-check");
    expect(labels).not.toContain(state.sessionKey);
    expect(labels).not.toContain(
      "subagent:4f2146de-887b-4176-9abe-91140082959b · webchat:g-agent-main-subagent-4f2146de-887b-4176-9abe-91140082959b",
    );
  });

  it("keeps a unique scoped fallback when the current grouped session is missing from sessions.list", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b";
    state.settings.sessionKey = state.sessionKey;
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain("subagent:4f2146de-887b-4176-9abe-91140082959b");
    expect(labels).not.toContain("Subagent:");
  });

  it("keeps a unique scoped fallback when a grouped session row has no label or displayName", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b";
    state.settings.sessionKey = state.sessionKey;
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 1,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: state.sessionKey,
          kind: "direct",
          updatedAt: null,
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain("subagent:4f2146de-887b-4176-9abe-91140082959b");
    expect(labels).not.toContain("Subagent:");
  });

  it("disambiguates duplicate grouped labels with the scoped key suffix", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b";
    state.settings.sessionKey = state.sessionKey;
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 2,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "agent:main:subagent:4f2146de-887b-4176-9abe-91140082959b",
          kind: "direct",
          updatedAt: null,
          label: "cron-config-check",
        },
        {
          key: "agent:main:subagent:6fb8b84b-c31f-410f-b7df-1553c82e43c9",
          kind: "direct",
          updatedAt: null,
          label: "cron-config-check",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain(
      "Subagent: cron-config-check · subagent:4f2146de-887b-4176-9abe-91140082959b",
    );
    expect(labels).toContain(
      "Subagent: cron-config-check · subagent:6fb8b84b-c31f-410f-b7df-1553c82e43c9",
    );
    expect(labels).not.toContain("Subagent: cron-config-check");
  });

  it("prefixes duplicate agent session labels with the agent name", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:alpha:main";
    state.settings.sessionKey = state.sessionKey;
    state.agentsList = {
      defaultId: "alpha",
      mainKey: "agent:alpha:main",
      scope: "all",
      agents: [
        { id: "alpha", name: "Deep Chat" },
        { id: "beta", name: "Coding" },
      ],
    };
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 2,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "agent:alpha:main",
          kind: "direct",
          updatedAt: null,
        },
        {
          key: "agent:beta:main",
          kind: "direct",
          updatedAt: null,
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels).toContain("Deep Chat (alpha) / main");
    expect(labels).toContain("Coding (beta) / main");
    expect(labels).not.toContain("main");
  });

  it("keeps agent-prefixed labels unique when a custom label already matches the prefix", () => {
    const { state } = createChatHeaderState({ omitSessionFromList: true });
    state.sessionKey = "agent:alpha:main";
    state.settings.sessionKey = state.sessionKey;
    state.agentsList = {
      defaultId: "alpha",
      mainKey: "agent:alpha:main",
      scope: "all",
      agents: [
        { id: "alpha", name: "Deep Chat" },
        { id: "beta", name: "Coding" },
      ],
    };
    state.sessionsResult = {
      ts: 0,
      path: "",
      count: 3,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "agent:alpha:main",
          kind: "direct",
          updatedAt: null,
        },
        {
          key: "agent:beta:main",
          kind: "direct",
          updatedAt: null,
        },
        {
          key: "agent:alpha:named-main",
          kind: "direct",
          updatedAt: null,
          label: "Deep Chat (alpha) / main",
        },
      ],
    };
    const container = document.createElement("div");
    render(renderChatSessionSelect(state), container);

    const [sessionSelect] = Array.from(container.querySelectorAll<HTMLSelectElement>("select"));
    const labels = Array.from(sessionSelect?.querySelectorAll("option") ?? []).map((option) =>
      option.textContent?.trim(),
    );

    expect(labels.filter((label) => label === "Deep Chat (alpha) / main")).toHaveLength(1);
    expect(labels).toContain("Deep Chat (alpha) / main · named-main");
    expect(labels).toContain("Coding (beta) / main");
  });
});
