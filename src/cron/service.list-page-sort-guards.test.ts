import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMockCronStateForJobs } from "./service.test-harness.js";
import { listPage } from "./service/ops.js";
import type { CronJob } from "./types.js";

function createBaseJob(overrides?: Partial<CronJob>): CronJob {
  return {
    id: "job-1",
    name: "job",
    enabled: true,
    schedule: { kind: "cron", expr: "*/5 * * * *", tz: "UTC" },
    sessionTarget: "main",
    wakeMode: "now",
    payload: { kind: "systemEvent", text: "tick" },
    state: { nextRunAtMs: Date.parse("2026-02-27T15:30:00.000Z") },
    createdAtMs: Date.parse("2026-02-27T15:00:00.000Z"),
    updatedAtMs: Date.parse("2026-02-27T15:05:00.000Z"),
    ...overrides,
  };
}

describe("cron listPage sort guards", () => {
  it("does not throw when sorting by name with malformed name fields", async () => {
    const jobs = [
      createBaseJob({ id: "job-a", name: undefined as unknown as string }),
      createBaseJob({ id: "job-b", name: "beta" }),
    ];
    const state = createMockCronStateForJobs({ jobs });

    const page = await listPage(state, { sortBy: "name", sortDir: "asc" });
    expect(page.jobs).toHaveLength(2);
  });

  it("does not throw when tie-break sorting encounters missing ids", async () => {
    const nextRunAtMs = Date.parse("2026-02-27T15:30:00.000Z");
    const jobs = [
      createBaseJob({
        id: undefined as unknown as string,
        name: "alpha",
        state: { nextRunAtMs },
      }),
      createBaseJob({
        id: undefined as unknown as string,
        name: "alpha",
        state: { nextRunAtMs },
      }),
    ];
    const state = createMockCronStateForJobs({ jobs });

    const page = await listPage(state, { sortBy: "nextRunAtMs", sortDir: "asc" });
    expect(page.jobs).toHaveLength(2);
  });

  it("applies schedule kind and last run status filters before pagination", async () => {
    const jobs = [
      createBaseJob({
        id: "cron-ok",
        schedule: { kind: "cron", expr: "0 * * * *" },
        state: { nextRunAtMs: 4_102_444_800_000, lastRunStatus: "ok" },
      }),
      createBaseJob({
        id: "every-error",
        schedule: { kind: "every", everyMs: 60_000 },
        state: { nextRunAtMs: 4_102_444_800_000, lastRunStatus: "error" },
      }),
      createBaseJob({
        id: "cron-unknown",
        schedule: { kind: "cron", expr: "5 * * * *" },
        state: { nextRunAtMs: 4_102_444_800_000 },
      }),
    ];
    const state = createMockCronStateForJobs({ jobs });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-cron-list-page-"));
    try {
      state.deps.storePath = path.join(dir, "cron", "jobs.json");
      const page = await listPage(state, {
        includeDisabled: true,
        scheduleKind: "cron",
        lastRunStatus: "unknown",
      });

      expect(page.jobs.map((job) => job.id)).toEqual(["cron-unknown"]);
      expect(page.total).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
