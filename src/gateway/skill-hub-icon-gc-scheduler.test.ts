import { describe, expect, it, vi } from "vitest";
import { startSkillHubIconGcScheduler } from "./skill-hub-icon-gc-scheduler.js";

describe("Skill Hub icon GC scheduler", () => {
  it("is disabled by default", () => {
    const setTimer = vi.fn() as unknown as typeof setTimeout;
    const stop = startSkillHubIconGcScheduler({ env: {}, setTimer });
    expect(setTimer).not.toHaveBeenCalled();
    stop();
  });

  it("delays the first run and skips deletion when metadata reads fail", async () => {
    let scheduled: (() => void) | undefined;
    const runGc = vi.fn();
    const warn = vi.fn();
    const stop = startSkillHubIconGcScheduler({
      env: {
        SKILL_HUB_ICON_GC_ENABLED: "true",
        SKILL_HUB_ICON_GC_INITIAL_DELAY_MS: "1234",
      },
      log: { info: vi.fn(), warn },
      loadReferencedAssetIds: async () => {
        throw new Error("metadata unavailable");
      },
      runGc,
      setTimer: ((callback: () => void, delay?: number) => {
        if (!scheduled) {
          expect(delay).toBe(1234);
          scheduled = callback;
        }
        return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimer: vi.fn(),
    });
    scheduled?.();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("skipped")));
    expect(runGc).not.toHaveBeenCalled();
    stop();
  });

  it("uses the shared GC helper when enabled", async () => {
    let scheduled: (() => void) | undefined;
    const runGc = vi.fn().mockResolvedValue({
      deletedAssetIds: ["a".repeat(64)],
      orphanAssets: [],
      missingAssetIds: [],
    });
    const stop = startSkillHubIconGcScheduler({
      env: { SKILL_HUB_ICON_GC_ENABLED: "true" },
      log: { info: vi.fn(), warn: vi.fn() },
      loadReferencedAssetIds: async () => ["b".repeat(64)],
      runGc,
      setTimer: ((callback: () => void) => {
        scheduled ??= callback;
        return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
      }) as typeof setTimeout,
      clearTimer: vi.fn(),
    });
    scheduled?.();
    await vi.waitFor(() =>
      expect(runGc).toHaveBeenCalledWith({
        referencedAssetIds: ["b".repeat(64)],
        dryRun: false,
        graceDays: 14,
      }),
    );
    stop();
  });
});
