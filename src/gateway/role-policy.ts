import { isNodeRoleMethod } from "./method-scopes.js";

const EMPLOYEE_ROLE_METHODS = new Set([
  "health",
  "chat.history",
  "chat.send",
  "chat.abort",
  "models.list",
  "skills.status",
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
