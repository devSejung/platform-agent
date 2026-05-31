import type { GatewayClient } from "../gateway/server-methods/types.js";
import { getAccountById } from "./account-store.js";
import { canManageGroupScope, isAdminAccount, type GroupScopeType } from "./group-store.js";

export function resolveRequesterAccountId(client: GatewayClient | null | undefined): string | null {
  const employeeId = client?.internal?.employee?.employeeId?.trim();
  return employeeId || null;
}

export function requireRequesterAccountId(client: GatewayClient | null | undefined): string {
  const accountId = resolveRequesterAccountId(client);
  if (!accountId) {
    throw new Error("employee account context required");
  }
  return accountId;
}

export function requireAdminAccount(client: GatewayClient | null | undefined): string {
  const accountId = requireRequesterAccountId(client);
  if (!isAdminAccount(accountId)) {
    throw new Error("admin access required");
  }
  return accountId;
}

export function requesterHasLeaderScope(client: GatewayClient | null | undefined): boolean {
  const accountId = resolveRequesterAccountId(client);
  if (!accountId) {
    return false;
  }
  const account = getAccountById(accountId);
  if (!account || account.status !== "active") {
    return false;
  }
  return true;
}

export function canRequesterManageScope(
  client: GatewayClient | null | undefined,
  scopeType: GroupScopeType,
  scopeId: string,
): boolean {
  const accountId = resolveRequesterAccountId(client);
  if (!accountId) {
    return false;
  }
  return canManageGroupScope({ accountId, scopeType, scopeId });
}
