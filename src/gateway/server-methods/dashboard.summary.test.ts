import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSummaryResult } from "../../shared/dashboard-types.js";

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: {
      list: [
        { id: "main", name: "Main Agent" },
        { id: "ops", name: "Ops Agent" },
      ],
    },
    session: {},
  })),
}));

vi.mock("../session-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../session-utils.js")>("../session-utils.js");
  return {
    ...actual,
    loadCombinedSessionStoreForGateway: vi.fn(() => ({
      storePath: "(multiple)",
      store: {
        "agent:main:alice-main": {
          sessionId: "alice-main",
          updatedAt: Date.parse("2026-06-24T09:00:00Z"),
          origin: { accountId: "alice", label: "Alice" },
        },
        "agent:ops:bob-ops": {
          sessionId: "bob-ops",
          updatedAt: Date.parse("2026-06-24T10:00:00Z"),
          origin: { accountId: "bob", label: "Bob" },
        },
      },
    })),
  };
});

vi.mock("../../accounts/account-store.js", () => ({
  resolveAccountIdByEmployeeId: vi.fn((employeeId: string) =>
    employeeId === "default" ? "alice" : employeeId,
  ),
  resolveAccountIdByAlias: vi.fn((params: { aliasType?: string; aliasValue?: string }) =>
    (params.aliasType === "agent_id" && params.aliasValue === "main") ||
    (params.aliasType === "agent_id" && params.aliasValue === "alice.agent")
      ? "alice"
      : null,
  ),
  resolveAccountDisplayName: vi.fn((accountId: string) =>
    accountId === "alice" ? "Alice Kim" : accountId === "bob" ? "Bob Lee" : null,
  ),
  listAccountMembershipSummaries: vi.fn((accountId: string) =>
    accountId === "alice"
      ? [
          {
            scopeType: "part",
            scopeId: "p-platform",
            scopeName: "Platform",
            parentGroupId: "g-eng",
            parentGroupName: "Engineering",
            groupRole: "member",
            archived: false,
          },
        ]
      : [],
  ),
}));

vi.mock("../../accounts/group-store.js", () => ({
  isAdminAccount: vi.fn((accountId: string) => accountId === "admin"),
}));

vi.mock("../../infra/session-cost-usage.js", async () => {
  const actual = await vi.importActual<typeof import("../../infra/session-cost-usage.js")>(
    "../../infra/session-cost-usage.js",
  );
  return {
    ...actual,
    discoverAllSessions: vi.fn(async (params?: { agentId?: string }) => {
      if (params?.agentId === "main") {
        return [
          {
            sessionId: "alice-main",
            sessionFile: "/tmp/agents/main/alice-main.jsonl",
            mtime: Date.parse("2026-06-24T09:00:00Z"),
            firstUserMessage: "hello",
          },
        ];
      }
      if (params?.agentId === "ops") {
        return [
          {
            sessionId: "bob-ops",
            sessionFile: "/tmp/agents/ops/bob-ops.jsonl",
            mtime: Date.parse("2026-06-24T10:00:00Z"),
            firstUserMessage: "hi",
          },
        ];
      }
      return [];
    }),
    loadSessionCostSummary: vi.fn(async (params: { sessionId?: string }) => {
      if (params.sessionId === "alice-main") {
        return {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 400,
          totalCost: 0,
          inputCost: 0,
          outputCost: 0,
          cacheReadCost: 0,
          cacheWriteCost: 0,
          missingCostEntries: 0,
          firstActivity: Date.parse("2026-06-24T09:00:00Z"),
          lastActivity: Date.parse("2026-06-24T09:30:00Z"),
          dailyBreakdown: [{ date: "2026-06-24", tokens: 400, cost: 0 }],
          dailyModelUsage: [
            {
              date: "2026-06-24",
              provider: "openai",
              model: "gpt-5",
              tokens: 400,
              cost: 0,
              count: 2,
            },
          ],
          activityDates: ["2026-06-24"],
          modelUsage: [
            {
              provider: "openai",
              model: "gpt-5",
              count: 2,
              totals: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 400,
                totalCost: 0,
                inputCost: 0,
                outputCost: 0,
                cacheReadCost: 0,
                cacheWriteCost: 0,
                missingCostEntries: 0,
              },
            },
          ],
        };
      }
      return {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 900,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        cacheReadCost: 0,
        cacheWriteCost: 0,
        missingCostEntries: 0,
        firstActivity: Date.parse("2026-06-24T10:00:00Z"),
        lastActivity: Date.parse("2026-06-24T10:20:00Z"),
        dailyBreakdown: [{ date: "2026-06-24", tokens: 900, cost: 0 }],
        dailyModelUsage: [
          {
            date: "2026-06-24",
            provider: "openai",
            model: "gpt-5",
            tokens: 900,
            cost: 0,
            count: 4,
          },
        ],
        activityDates: ["2026-06-24"],
        modelUsage: [
          {
            provider: "openai",
            model: "gpt-5",
            count: 4,
            totals: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 900,
              totalCost: 0,
              inputCost: 0,
              outputCost: 0,
              cacheReadCost: 0,
              cacheWriteCost: 0,
              missingCostEntries: 0,
            },
          },
        ],
      };
    }),
    loadSessionUsageTimeSeries: vi.fn(async (params: { sessionId?: string }) => {
      const now = new Date();
      const hour = params.sessionId === "alice-main" ? 9 : 10;
      const timestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour).getTime();
      const totalTokens = params.sessionId === "alice-main" ? 400 : 900;
      return {
        sessionId: params.sessionId,
        points: [
          {
            timestamp,
            input: totalTokens,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens,
            cost: 0,
            cumulativeTokens: totalTokens,
            cumulativeCost: 0,
          },
        ],
      };
    }),
  };
});

import { usageHandlers } from "./usage.js";

async function runDashboardSummary(
  params: Record<string, unknown>,
  client?: Record<string, unknown>,
) {
  const respond = vi.fn();
  await usageHandlers["dashboard.summary"]({
    respond,
    params,
    client,
  } as unknown as Parameters<(typeof usageHandlers)["dashboard.summary"]>[0]);
  return respond;
}

describe("dashboard.summary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { range: "today", expectedPoints: 24 },
    { range: "7d", expectedPoints: 7 },
    { range: "30d", expectedPoints: 30 },
    { range: "total", expectedPoints: 1 },
  ] as const)("returns safe aggregate data for %s", async ({ range, expectedPoints }) => {
    const respond = await runDashboardSummary(
      { range },
      {
        connect: { role: "employee", scopes: [] },
        internal: { employee: { employeeId: "member", agentId: "main" } },
      },
    );

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    const result = respond.mock.calls[0]?.[1] as DashboardSummaryResult;
    expect(result.range).toBe(range);
    expect(result.timeSeries).toHaveLength(expectedPoints);
    expect(result.summary.totalTokens).toBe(1300);
    expect(result.agentUsage[0]).not.toHaveProperty("totalCost");
    expect(result.agentUsage[0]).not.toHaveProperty("input");
    expect(result.agentUsage[0]).not.toHaveProperty("output");
  });

  it("prefers agent alias resolution before employee fallback", async () => {
    const respond = await runDashboardSummary(
      { range: "7d" },
      {
        connect: { role: "employee", scopes: [] },
        internal: { employee: { employeeId: "member", agentId: "alice_agent" } },
      },
    );

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    const result = respond.mock.calls[0]?.[1] as DashboardSummaryResult;
    const aliceRow = result.agentUsage.find((row) => row.name === "Alice Kim");
    expect(aliceRow?.part).toBe("Platform");
  });

  it("buckets today's tokens by their actual usage timestamp", async () => {
    const respond = await runDashboardSummary(
      { range: "today" },
      {
        connect: { role: "employee", scopes: [] },
        internal: { employee: { employeeId: "member", agentId: "main" } },
      },
    );

    const result = respond.mock.calls[0]?.[1] as DashboardSummaryResult;
    expect(result.timeSeries.find((point) => point.label === "09")).toMatchObject({
      apiCalls: 1,
      totalTokens: 400,
    });
    expect(result.timeSeries.find((point) => point.label === "10")).toMatchObject({
      apiCalls: 1,
      totalTokens: 900,
    });
    expect(result.timeSeries.reduce((sum, point) => sum + point.totalTokens, 0)).toBe(1300);
  });

  it("allows employees to load aggregate usage without sort controls", async () => {
    const respond = await runDashboardSummary(
      { range: "7d", sortBy: "name", sortDir: "asc" },
      {
        connect: { role: "employee", scopes: [] },
        internal: { employee: { employeeId: "member", agentId: "main" } },
      },
    );

    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    const result = respond.mock.calls[0]?.[1] as DashboardSummaryResult;
    expect(result.canSort).toBe(false);
    expect(result.summary).toEqual({
      activeAgents: 2,
      sessions: 2,
      apiCalls: 6,
      totalTokens: 1300,
    });
    expect(result.agentUsage[0]).toMatchObject({
      name: "Bob Lee",
      part: "Unassigned",
      totalTokens: 900,
    });
    expect(result.agentUsage[0]).not.toHaveProperty("totalCost");
  });

  it("allows sorting for operators and admin employees", async () => {
    const operatorRespond = await runDashboardSummary(
      { range: "7d", sortBy: "name", sortDir: "asc" },
      {
        connect: { role: "operator", scopes: ["operator.read"] },
      },
    );
    const operatorResult = operatorRespond.mock.calls[0]?.[1] as {
      canSort: boolean;
      agentUsage: Array<{ name: string }>;
    };
    expect(operatorResult.canSort).toBe(true);
    expect(operatorResult.agentUsage.map((row) => row.name)).toEqual(["Alice Kim", "Bob Lee"]);

    const adminEmployeeRespond = await runDashboardSummary(
      { range: "7d", sortBy: "name", sortDir: "asc" },
      {
        connect: { role: "employee", scopes: [] },
        internal: { employee: { employeeId: "admin", agentId: "main" } },
      },
    );
    const adminEmployeeResult = adminEmployeeRespond.mock.calls[0]?.[1] as {
      canSort: boolean;
      agentUsage: Array<{ name: string }>;
    };
    expect(adminEmployeeResult.canSort).toBe(true);
    expect(adminEmployeeResult.agentUsage.map((row) => row.name)).toEqual(["Alice Kim", "Bob Lee"]);
  });
});
