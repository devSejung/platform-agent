import { beforeEach, describe, expect, it } from "vitest";
import {
  getMemorySyncMockCalls,
  resetMemoryToolMockState,
  setMemoryBackend,
  setMemorySearchImpl,
} from "../../../test/helpers/memory-tool-manager-mock.js";
import {
  createMemorySearchToolOrThrow,
  expectUnavailableMemorySearchDetails,
} from "./tools.test-helpers.js";

describe("memory_search unavailable payloads", () => {
  beforeEach(() => {
    resetMemoryToolMockState({ searchImpl: async () => [] });
  });

  it("returns explicit unavailable metadata for quota failures", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("openai embeddings failed: 429 insufficient_quota");
    });

    const tool = createMemorySearchToolOrThrow();
    const result = await tool.execute("quota", { query: "hello" });
    expectUnavailableMemorySearchDetails(result.details, {
      error: "openai embeddings failed: 429 insufficient_quota",
      warning: "Memory search is unavailable because the embedding provider quota is exhausted.",
      action: "Top up or switch embedding provider, then retry memory_search.",
    });
  });

  it("returns explicit unavailable metadata for non-quota failures", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("embedding provider timeout");
    });

    const tool = createMemorySearchToolOrThrow();
    const result = await tool.execute("generic", { query: "hello" });
    expectUnavailableMemorySearchDetails(result.details, {
      error: "embedding provider timeout",
      warning: "Memory search is unavailable due to an embedding/provider error.",
      action: "Check embedding provider configuration and retry memory_search.",
    });
  });

  it("retries zero-hit builtin searches after a bootstrap sync", async () => {
    let searchCalls = 0;
    setMemorySearchImpl(async () => {
      searchCalls += 1;
      if (searchCalls === 1) {
        return [];
      }
      return [
        {
          path: "MEMORY.md",
          startLine: 1,
          endLine: 1,
          score: 0.9,
          snippet: "Thread-hidden codename: ORBIT-22.",
          source: "memory" as const,
        },
      ];
    });

    const tool = createMemorySearchToolOrThrow();
    const result = await tool.execute("zero-hit-bootstrap", {
      query: "hidden thread codename",
    });

    expect((result.details as { results?: Array<{ path: string }> }).results?.[0]?.path).toBe(
      "MEMORY.md",
    );
    expect(searchCalls).toBe(2);
    expect(getMemorySyncMockCalls()).toBe(1);
  });

  it("does not force sync for zero-hit long-lived qmd searches", async () => {
    setMemoryBackend("qmd");
    let searchCalls = 0;
    setMemorySearchImpl(async () => {
      searchCalls += 1;
      return [];
    });

    const tool = createMemorySearchToolOrThrow({
      config: {
        agents: { list: [{ id: "main", default: true }] },
        memory: { backend: "qmd", citations: "off" },
      },
    });
    const result = await tool.execute("zero-hit-qmd", {
      query: "hidden thread codename",
    });

    expect((result.details as { results?: Array<unknown> }).results).toEqual([]);
    expect(searchCalls).toBe(1);
    expect(getMemorySyncMockCalls()).toBe(0);
  });

  it("keeps the zero-hit bootstrap retry for one-shot qmd searches", async () => {
    setMemoryBackend("qmd");
    let searchCalls = 0;
    setMemorySearchImpl(async () => {
      searchCalls += 1;
      if (searchCalls === 1) {
        return [];
      }
      return [
        {
          path: "MEMORY.md",
          startLine: 1,
          endLine: 1,
          score: 0.9,
          snippet: "Thread-hidden codename: ORBIT-22.",
          source: "memory" as const,
        },
      ];
    });

    const tool = createMemorySearchToolOrThrow({
      config: {
        agents: { list: [{ id: "main", default: true }] },
        memory: { backend: "qmd", citations: "off" },
      },
      oneShotCliRun: true,
    });
    const result = await tool.execute("zero-hit-qmd-cli", {
      query: "hidden thread codename",
    });

    expect((result.details as { results?: Array<{ path: string }> }).results?.[0]?.path).toBe(
      "MEMORY.md",
    );
    expect(searchCalls).toBe(2);
    expect(getMemorySyncMockCalls()).toBe(1);
  });
});
