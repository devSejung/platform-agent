import { describe, expect, it } from "vitest";
import type { DashboardSummaryResult } from "../types.ts";
import { loadDashboard, type DashboardState } from "./dashboard.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function result(range: DashboardSummaryResult["range"]): DashboardSummaryResult {
  return {
    canSort: false,
    range,
    generatedAt: 0,
    summary: { activeAgents: 0, sessions: 0, apiCalls: 0, totalTokens: 0 },
    timeSeries: [],
    agentUsage: [],
    partUsage: [],
  };
}

describe("loadDashboard", () => {
  it("keeps the newest result when range requests finish out of order", async () => {
    const first = deferred<DashboardSummaryResult>();
    const second = deferred<DashboardSummaryResult>();
    const requests: Array<{ range: string }> = [];
    const client = {
      request: (_method: string, params: { range: string }) => {
        requests.push(params);
        return params.range === "7d" ? first.promise : second.promise;
      },
    };
    const state = {
      client,
      connected: true,
      dashboardLoading: false,
      dashboardError: null,
      dashboardRange: "7d",
      dashboardResult: null,
      dashboardSortBy: "totalTokens",
      dashboardSortDir: "desc",
    } as unknown as DashboardState;

    const firstLoad = loadDashboard(state);
    state.dashboardRange = "30d";
    const secondLoad = loadDashboard(state);

    second.resolve(result("30d"));
    await secondLoad;
    first.resolve(result("7d"));
    await firstLoad;

    expect(requests.map((request) => request.range)).toEqual(["7d", "30d"]);
    expect(state.dashboardResult?.range).toBe("30d");
    expect(state.dashboardLoading).toBe(false);
  });
});
