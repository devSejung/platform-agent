import { isNodeRoleMethod } from "./method-scopes.js";

const EMPLOYEE_ROLE_METHODS = new Set([
  "health",
  "chat.history",
  "chat.send",
  "chat.abort",
  "dashboard.summary",
  "models.list",
  "skills.status",
  "skills.delete",
  "skillhub.list",
  "skillhub.workspacePublish.list",
  "skillhub.detail",
  "skillhub.publish",
  "skillhub.upload",
  "skillhub.icons.audit",
  "skillhub.icons.gc",
  "skillhub.install",
  "skillhub.update",
  "skillhub.like",
  "skillhub.examplePrompts.update",
  "skillhub.metadata.update",
  "skillhub.presentation.update",
  "skillhub.transferOwnership",
  "skillhub.hardDelete",
  "skillhub.hide",
  "skillhub.visibility.update",
  "skillhub.delete",
  "accounts.search",
  "groups.list",
  "groups.detail",
  "groups.scopes.list",
  "groups.create",
  "groups.part.create",
  "groups.update",
  "groups.part.update",
  "groups.members.add",
  "groups.members.remove",
  "groups.archive",
  "groups.joinRequests.list",
  "groups.joinRequests.pendingCount",
  "groups.joinRequests.approve",
  "groups.joinRequests.reject",
  "admin.accounts.list",
  "admin.accounts.detail",
  "admin.accounts.role.update",
  "cron.list",
  "cron.status",
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.run",
  "cron.runs",
  "sessions.list",
  "sessions.subscribe",
  "sessions.unsubscribe",
  "sessions.messages.subscribe",
  "sessions.messages.unsubscribe",
  "sessions.preview",
  "sessions.resolve",
  "sessions.create",
  "sessions.patch",
  "sessions.delete",
  "sessions.compact",
  "sessions.send",
  "sessions.steer",
  "sessions.abort",
  "last-heartbeat",
  "heartbeat.summary.get",
  "set-heartbeats",
  "agent.identity.get",
]);

export const GATEWAY_ROLES = ["operator", "node", "employee"] as const;

export type GatewayRole = (typeof GATEWAY_ROLES)[number];

export function parseGatewayRole(roleRaw: unknown): GatewayRole | null {
  if (roleRaw === "operator" || roleRaw === "node" || roleRaw === "employee") {
    return roleRaw;
  }
  return null;
}

export function roleCanSkipDeviceIdentity(role: GatewayRole, sharedAuthOk: boolean): boolean {
  return role === "operator" && sharedAuthOk;
}

export function isRoleAuthorizedForMethod(role: GatewayRole, method: string): boolean {
  if (isNodeRoleMethod(method)) {
    return role === "node";
  }
  if (role === "employee") {
    return EMPLOYEE_ROLE_METHODS.has(method);
  }
  return role === "operator";
}
