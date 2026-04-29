import type { GatewayBrowserClient } from "../gateway.ts";

export type EmployeeHeartbeatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  debugHeartbeat: unknown;
  lastError: string | null;
};

export async function loadEmployeeHeartbeat(state: EmployeeHeartbeatState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const [heartbeat, config] = await Promise.all([
      state.client.request("last-heartbeat", {}),
      state.client.request("heartbeat.summary.get", {}),
    ]);
    state.debugHeartbeat =
      heartbeat && typeof heartbeat === "object"
        ? { ...heartbeat, config }
        : { config };
    state.lastError = null;
  } catch (err) {
    state.lastError = String(err);
  }
}
