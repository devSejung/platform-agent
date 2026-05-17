import { describe, expect, it, vi } from "vitest";
import { filterEmployeeCronJobs } from "./employee-access.js";
import type { GatewayClient } from "./server-methods/types.js";

vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({ agents: { defaults: {} } })),
}));

function employeeClient(agentId: string): GatewayClient {
  return {
    connect: { role: "employee" },
    internal: { employee: { agentId } },
  } as unknown as GatewayClient;
}

describe("employee cron access", () => {
  it("allows cron jobs whose saved origin session belongs to the employee agent", () => {
    const jobs = [
      { id: "own-room", sessionKey: "agent:eon:knox:room:dev" },
      { id: "other-room", sessionKey: "agent:minji:knox:room:dev" },
    ];

    expect(filterEmployeeCronJobs(employeeClient("eon"), jobs).map((job) => job.id)).toEqual([
      "own-room",
    ]);
  });
});
