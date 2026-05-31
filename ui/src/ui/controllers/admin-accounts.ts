import type { GatewayBrowserClient } from "../gateway.ts";
import type { GroupScopeOption } from "./groups.ts";

export type AdminAccountMembership = {
  scopeType: "group" | "part";
  scopeId: string;
  scopeName: string;
  parentGroupId: string | null;
  parentGroupName: string | null;
  groupRole: "member" | "leader";
  archived: boolean;
};

export type AdminAccountEntry = {
  accountId: string;
  employeeId: string;
  displayName: string;
  email: string | null;
  department: string | null;
  globalRole: "member" | "admin";
  status: "active" | "disabled";
  lastLoginAt: string | null;
  groups: string[];
};

export type AdminAccountDetail = AdminAccountEntry & {
  memberships: AdminAccountMembership[];
};

type AdminAccountsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  adminAccountsLoading: boolean;
  adminAccountsEntries: AdminAccountEntry[];
  adminAccountsError: string | null;
  adminAccountsQuery: string;
  adminAccountDetailLoading: boolean;
  adminAccountDetail: AdminAccountDetail | null;
  adminAccountDetailError: string | null;
  adminAccountDetailAccountId: string | null;
  adminAccountMessage: { kind: "success" | "error"; text: string } | null;
  groupsScopeOptions: GroupScopeOption[];
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function loadAdminAccounts(state: AdminAccountsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.adminAccountsLoading = true;
  state.adminAccountsError = null;
  try {
    const result = await state.client.request<{ entries: AdminAccountEntry[] }>("admin.accounts.list", {
      query: state.adminAccountsQuery.trim() || undefined,
    });
    state.adminAccountsEntries = result?.entries ?? [];
  } catch (err) {
    state.adminAccountsError = getErrorMessage(err);
  } finally {
    state.adminAccountsLoading = false;
  }
}

export async function loadAdminAccountDetail(state: AdminAccountsState, accountId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.adminAccountDetailAccountId = accountId;
  state.adminAccountDetailLoading = true;
  state.adminAccountDetailError = null;
  try {
    const result = await state.client.request<{ detail: AdminAccountDetail | null }>("admin.accounts.detail", {
      accountId,
    });
    if (state.adminAccountDetailAccountId !== accountId) {
      return;
    }
    state.adminAccountDetail = result?.detail ?? null;
  } catch (err) {
    if (state.adminAccountDetailAccountId === accountId) {
      state.adminAccountDetailError = getErrorMessage(err);
    }
  } finally {
    if (state.adminAccountDetailAccountId === accountId) {
      state.adminAccountDetailLoading = false;
    }
  }
}

export async function updateAdminAccountRoleAction(
  state: AdminAccountsState,
  params: { accountId: string; globalRole: "member" | "admin" },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.adminAccountMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("admin.accounts.role.update", params);
    state.adminAccountMessage = { kind: "success", text: result.message };
    await Promise.all([
      loadAdminAccounts(state),
      state.adminAccountDetailAccountId === params.accountId
        ? loadAdminAccountDetail(state, params.accountId)
        : Promise.resolve(),
    ]);
  } catch (err) {
    state.adminAccountMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}
