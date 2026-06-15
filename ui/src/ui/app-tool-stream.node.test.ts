import { beforeAll, describe, expect, it, vi } from "vitest";
import { handleAgentEvent, type FallbackStatus, type ToolStreamEntry } from "./app-tool-stream.ts";

type ToolStreamHost = Parameters<typeof handleAgentEvent>[0];
type MutableHost = ToolStreamHost & {
  compactionStatus?: unknown;
  runPhaseStatus?: unknown;
  compactionClearTimer?: number | null;
  compactionRefreshTimer?: number | null;
  fallbackStatus?: FallbackStatus | null;
  fallbackClearTimer?: number | null;
  requestUpdate?: () => void;
};

function createHost(overrides?: Partial<MutableHost>): MutableHost {
  return {
    sessionKey: "main",
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    chatStreamSegments: [],
    toolStreamById: new Map<string, ToolStreamEntry>(),
    toolStreamOrder: [],
    chatToolMessages: [],
    toolStreamSyncTimer: null,
    compactionStatus: null,
    compactionClearTimer: null,
    compactionRefreshTimer: null,
    fallbackStatus: null,
    fallbackClearTimer: null,
    requestUpdate: vi.fn(),
    ...overrides,
  };
}

describe("app-tool-stream fallback lifecycle handling", () => {
  beforeAll(() => {
    const globalWithWindow = globalThis as typeof globalThis & {
      window?: Window & typeof globalThis;
    };
    if (!globalWithWindow.window) {
      globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
    }
  });

  it("accepts session-scoped fallback lifecycle events when no run is active", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
        reasonSummary: "rate limit",
      },
    });

    expect(host.fallbackStatus?.selected).toBe(
      "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
    );
    expect(host.fallbackStatus?.active).toBe("deepinfra/moonshotai/Kimi-K2.5");
    expect(host.fallbackStatus?.reason).toBe("rate limit");
    vi.useRealTimers();
  });

  it("rejects idle fallback lifecycle events for other sessions", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "agent:other:main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus).toBeNull();
    vi.useRealTimers();
  });

  it("auto-clears fallback status after toast duration", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
        activeProvider: "deepinfra",
        activeModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus).not.toBeNull();
    vi.advanceTimersByTime(7_999);
    expect(host.fallbackStatus).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.fallbackStatus).toBeNull();
    vi.useRealTimers();
  });

  it("builds previous fallback label from provider + model on fallback_cleared", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "fallback_cleared",
        selectedProvider: "fireworks",
        selectedModel: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
        activeProvider: "fireworks",
        activeModel: "fireworks/accounts/fireworks/routers/kimi-k2p5-turbo",
        previousActiveProvider: "deepinfra",
        previousActiveModel: "moonshotai/Kimi-K2.5",
      },
    });

    expect(host.fallbackStatus?.phase).toBe("cleared");
    expect(host.fallbackStatus?.previous).toBe("deepinfra/moonshotai/Kimi-K2.5");
    vi.useRealTimers();
  });

  it("keeps compaction in retry-pending state until the matching lifecycle end", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "start" },
    });

    expect(host.compactionStatus).toEqual({
      phase: "active",
      runId: "run-1",
      startedAt: expect.any(Number),
      completedAt: null,
    });
    expect(host.compactionRefreshTimer).not.toBeNull();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "end", willRetry: true, completed: true },
    });

    expect(host.compactionStatus).toEqual({
      phase: "retrying",
      runId: "run-1",
      startedAt: expect.any(Number),
      completedAt: null,
    });
    expect(host.compactionClearTimer).toBeNull();
    expect(host.compactionRefreshTimer).not.toBeNull();

    handleAgentEvent(host, {
      runId: "run-2",
      seq: 3,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "end" },
    });

    expect(host.compactionStatus).toEqual({
      phase: "retrying",
      runId: "run-1",
      startedAt: expect.any(Number),
      completedAt: null,
    });

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 4,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "end" },
    });

    expect(host.compactionStatus).toEqual({
      phase: "complete",
      runId: "run-1",
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
    });
    expect(host.compactionClearTimer).not.toBeNull();
    expect(host.compactionRefreshTimer).toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(host.compactionStatus).toBeNull();
    expect(host.compactionClearTimer).toBeNull();
    expect(host.compactionRefreshTimer).toBeNull();

    vi.useRealTimers();
  });

  it("clears retry-pending compaction on lifecycle error without showing completion", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "start" },
    });

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "end", willRetry: true, completed: true },
    });

    expect(host.compactionStatus).toEqual({
      phase: "retrying",
      runId: "run-1",
      startedAt: expect.any(Number),
      completedAt: null,
    });

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 3,
      stream: "lifecycle",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "error", error: "boom" },
    });

    expect(host.compactionStatus).toBeNull();
    expect(host.compactionClearTimer).toBeNull();
    expect(host.compactionRefreshTimer).toBeNull();

    vi.useRealTimers();
  });

  it("keeps completed false compaction as incomplete before clearing it", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "start" },
    });

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "end", willRetry: true, completed: false },
    });

    expect(host.compactionStatus).toEqual({
      phase: "incomplete",
      runId: "run-1",
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
    });
    expect(host.compactionClearTimer).not.toBeNull();
    expect(host.compactionRefreshTimer).toBeNull();

    vi.advanceTimersByTime(4_999);
    expect(host.compactionStatus).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(host.compactionStatus).toBeNull();
    expect(host.compactionClearTimer).toBeNull();
    expect(host.compactionRefreshTimer).toBeNull();

    vi.useRealTimers();
  });

  it.each([
    {
      outcome: "success",
      completed: false,
      expectedPhase: "complete",
    },
    {
      outcome: "incomplete",
      completed: true,
      expectedPhase: "incomplete",
    },
    {
      outcome: "cancelled",
      completed: true,
      expectedPhase: "incomplete",
    },
  ])(
    "prefers additive $outcome outcome over legacy completed=$completed",
    ({ outcome, completed, expectedPhase }) => {
      vi.useFakeTimers();
      const host = createHost();

      handleAgentEvent(host, {
        runId: "run-1",
        seq: 1,
        stream: "compaction",
        ts: Date.now(),
        sessionKey: "main",
        data: { phase: "start", trigger: "runtime" },
      });
      handleAgentEvent(host, {
        runId: "run-1",
        seq: 2,
        stream: "compaction",
        ts: Date.now(),
        sessionKey: "main",
        data: {
          phase: "end",
          completed,
          outcome,
          trigger: "runtime",
          futureField: "ignored",
        },
      });

      expect(host.compactionStatus).toEqual(
        expect.objectContaining({ phase: expectedPhase, runId: "run-1" }),
      );
      vi.useRealTimers();
    },
  );

  it("falls back to completed when outcome is absent or unknown", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "start" },
    });
    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "end", completed: true, outcome: "future_outcome" },
    });

    expect(host.compactionStatus).toEqual(
      expect.objectContaining({ phase: "complete", runId: "run-1" }),
    );
    vi.useRealTimers();
  });

  it("replaces incomplete with the normal complete flow when a later success arrives", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "start" },
    });
    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "end", completed: false },
    });
    expect(host.compactionStatus).toEqual(
      expect.objectContaining({ phase: "incomplete", runId: "run-1" }),
    );

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 3,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "end",
        completed: true,
        tokensBefore: 120_000,
        tokensAfter: 45_000,
      },
    });

    expect(host.compactionStatus).toEqual({
      phase: "complete",
      runId: "run-1",
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      tokensBefore: 120_000,
      tokensAfter: 45_000,
    });
    expect(host.compactionClearTimer).not.toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(host.compactionStatus).toBeNull();
    vi.useRealTimers();
  });

  it("preserves token metadata for normal compaction success", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: { phase: "start" },
    });
    handleAgentEvent(host, {
      runId: "run-1",
      seq: 2,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "main",
      data: {
        phase: "end",
        completed: true,
        tokensBefore: 120_000,
        tokensAfter: 45_000,
      },
    });

    expect(host.compactionStatus).toEqual({
      phase: "complete",
      runId: "run-1",
      startedAt: expect.any(Number),
      completedAt: expect.any(Number),
      tokensBefore: 120_000,
      tokensAfter: 45_000,
    });
    expect(host.compactionClearTimer).not.toBeNull();
    expect(host.compactionRefreshTimer).toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(host.compactionStatus).toBeNull();
    vi.useRealTimers();
  });

  it("ignores compaction events for other sessions while idle", () => {
    vi.useFakeTimers();
    const host = createHost();

    handleAgentEvent(host, {
      runId: "run-1",
      seq: 1,
      stream: "compaction",
      ts: Date.now(),
      sessionKey: "agent:other:main",
      data: { phase: "start" },
    });

    expect(host.compactionStatus).toBeNull();
    expect(host.compactionRefreshTimer).toBeNull();
    vi.useRealTimers();
  });
});
