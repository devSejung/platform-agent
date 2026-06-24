import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  DashboardRange,
  DashboardSortBy,
  DashboardSortDir,
  DashboardSummaryResult,
} from "../types.ts";

export type DashboardState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  dashboardLoading: boolean;
  dashboardError: string | null;
  dashboardRange: DashboardRange;
  dashboardResult: DashboardSummaryResult | null;
  dashboardSortBy: DashboardSortBy;
  dashboardSortDir: DashboardSortDir;
};

const requestVersions = new WeakMap<object, number>();

function toErrorMessage(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return "dashboard request failed";
}

export async function loadDashboard(state: DashboardState) {
  if (!state.client || !state.connected) {
    return;
  }
  const requestVersion = (requestVersions.get(state) ?? 0) + 1;
  requestVersions.set(state, requestVersion);
  const range = state.dashboardRange;
  const sortBy = state.dashboardSortBy;
  const sortDir = state.dashboardSortDir;
  state.dashboardLoading = true;
  state.dashboardError = null;
  try {
    const result = await state.client.request<DashboardSummaryResult>("dashboard.summary", {
      range,
      sortBy,
      sortDir,
    });
    if (requestVersions.get(state) === requestVersion) {
      state.dashboardResult = result ?? null;
    }
  } catch (err) {
    if (requestVersions.get(state) === requestVersion) {
      state.dashboardError = toErrorMessage(err);
    }
  } finally {
    if (requestVersions.get(state) === requestVersion) {
      state.dashboardLoading = false;
    }
  }
}
