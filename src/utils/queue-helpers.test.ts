import { describe, expect, it } from "vitest";
import {
  applyQueueRuntimeSettings,
  buildQueueSummaryPrompt,
  clearQueueSummaryState,
  drainCollectItemIfNeeded,
  drainNextQueueItem,
  previewQueueSummaryPrompt,
  removeQueuedItemsByRef,
} from "./queue-helpers.js";

describe("applyQueueRuntimeSettings", () => {
  it("updates runtime queue settings with normalization", () => {
    const target = {
      mode: "followup" as const,
      debounceMs: 1000,
      cap: 20,
      dropPolicy: "summarize" as const,
    };

    applyQueueRuntimeSettings({
      target,
      settings: {
        mode: "collect",
        debounceMs: -12,
        cap: 9.8,
        dropPolicy: "new",
      },
    });

    expect(target).toEqual({
      mode: "collect",
      debounceMs: 0,
      cap: 9,
      dropPolicy: "new",
    });
  });

  it("keeps existing values when optional settings are missing/invalid", () => {
    const target = {
      mode: "followup" as const,
      debounceMs: 1000,
      cap: 20,
      dropPolicy: "summarize" as const,
    };

    applyQueueRuntimeSettings({
      target,
      settings: {
        mode: "queue",
        cap: 0,
      },
    });

    expect(target).toEqual({
      mode: "queue",
      debounceMs: 1000,
      cap: 20,
      dropPolicy: "summarize",
    });
  });
});

describe("queue summary helpers", () => {
  it("previewQueueSummaryPrompt does not mutate state", () => {
    const state = {
      dropPolicy: "summarize" as const,
      droppedCount: 2,
      summaryLines: ["first", "second"],
    };

    const prompt = previewQueueSummaryPrompt({
      state,
      noun: "message",
    });

    expect(prompt).toContain("[Queue overflow] Dropped 2 messages due to cap.");
    expect(prompt).toContain("first");
    expect(state).toEqual({
      dropPolicy: "summarize",
      droppedCount: 2,
      summaryLines: ["first", "second"],
    });
  });

  it("buildQueueSummaryPrompt clears state after rendering", () => {
    const state = {
      dropPolicy: "summarize" as const,
      droppedCount: 1,
      summaryLines: ["line"],
    };

    const prompt = buildQueueSummaryPrompt({
      state,
      noun: "announce",
    });

    expect(prompt).toContain("[Queue overflow] Dropped 1 announce due to cap.");
    expect(state).toEqual({
      dropPolicy: "summarize",
      droppedCount: 0,
      summaryLines: [],
    });
  });

  it("clearQueueSummaryState resets summary counters", () => {
    const state = {
      dropPolicy: "summarize" as const,
      droppedCount: 5,
      summaryLines: ["a", "b"],
    };
    clearQueueSummaryState(state);
    expect(state.droppedCount).toBe(0);
    expect(state.summaryLines).toEqual([]);
  });
});

describe("drainCollectItemIfNeeded", () => {
  it("removes queued items by object reference only", () => {
    const selected = { id: "same" };
    const sameShape = { id: "same" };
    const other = { id: "other" };
    const items = [selected, sameShape, other];

    removeQueuedItemsByRef(items, [selected]);

    expect(items).toEqual([sameShape, other]);
  });

  it("removes one queued entry for each processed duplicate reference", () => {
    const shared = { id: "shared" };
    const other = { id: "other" };
    const items = [shared, other, shared];

    removeQueuedItemsByRef(items, [shared]);
    expect(items).toEqual([other, shared]);

    removeQueuedItemsByRef(items, [shared]);
    expect(items).toEqual([other]);
  });

  it("preserves queued item order after ref removal", () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const third = { id: "third" };
    const fourth = { id: "fourth" };
    const items = [first, second, third, fourth];

    removeQueuedItemsByRef(items, [second, fourth]);

    expect(items).toEqual([first, third]);
  });

  it("removes only the drained item when the queue front changes during the run", async () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const items = [first, second];

    const result = await drainNextQueueItem(items, async () => {
      items.shift();
    });

    expect(result).toBe(true);
    expect(items).toEqual([second]);
  });

  it("keeps the queue unchanged when draining fails", async () => {
    const first = { id: "first" };
    const second = { id: "second" };
    const items = [first, second];

    await expect(
      drainNextQueueItem(items, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(items).toEqual([first, second]);
  });

  it("skips when neither force mode nor cross-channel routing is active", async () => {
    const seen: number[] = [];
    const items = [1];

    const result = await drainCollectItemIfNeeded({
      forceIndividualCollect: false,
      isCrossChannel: false,
      items,
      run: async (item) => {
        seen.push(item);
      },
    });

    expect(result).toBe("skipped");
    expect(seen).toEqual([]);
    expect(items).toEqual([1]);
  });

  it("drains one item in force mode", async () => {
    const seen: number[] = [];
    const items = [1, 2];

    const result = await drainCollectItemIfNeeded({
      forceIndividualCollect: true,
      isCrossChannel: false,
      items,
      run: async (item) => {
        seen.push(item);
      },
    });

    expect(result).toBe("drained");
    expect(seen).toEqual([1]);
    expect(items).toEqual([2]);
  });

  it("switches to force mode and returns empty when cross-channel with no queued item", async () => {
    let forced = false;

    const result = await drainCollectItemIfNeeded({
      forceIndividualCollect: false,
      isCrossChannel: true,
      setForceIndividualCollect: (next) => {
        forced = next;
      },
      items: [],
      run: async () => {},
    });

    expect(result).toBe("empty");
    expect(forced).toBe(true);
  });
});
