import {
  resolveAccountIdByAlias,
  resolveAccountIdByEmployeeId,
} from "../accounts/account-store.js";

export type UserMcpAccessContext = {
  requesterUserId?: string;
  agentId?: string;
  conversationType?: "dm" | "direct" | "room" | "group" | "unknown";
  channel?: string;
  trigger?: "cron" | "heartbeat" | "manual" | "memory" | "overflow" | "user";
};

export type UserMcpAccessDecision = {
  allowed: boolean;
  ownerUserId?: string;
  reason:
    | "personal_session"
    | "missing_requester"
    | "agent_not_owned"
    | "shared_session"
    | "group_conversation"
    | "system_agent"
    | "unknown_session";
};

function resolveRequesterAccountId(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return resolveAccountIdByEmployeeId(normalized) ?? normalized;
}

export function decideUserMcpAccess(context: UserMcpAccessContext): UserMcpAccessDecision {
  if (context.trigger && context.trigger !== "user") {
    return { allowed: false, reason: "shared_session" };
  }
  if (context.conversationType === "room" || context.conversationType === "group") {
    return { allowed: false, reason: "group_conversation" };
  }
  if (context.conversationType !== "dm" && context.conversationType !== "direct") {
    return { allowed: false, reason: "unknown_session" };
  }
  const requesterUserId = resolveRequesterAccountId(context.requesterUserId);
  if (!requesterUserId) {
    return { allowed: false, reason: "missing_requester" };
  }
  const agentId = context.agentId?.trim();
  if (!agentId) {
    return { allowed: false, reason: "system_agent" };
  }
  const ownerUserId = resolveAccountIdByAlias({ aliasType: "agent_id", aliasValue: agentId });
  if (!ownerUserId) {
    return { allowed: false, reason: "system_agent" };
  }
  if (ownerUserId !== requesterUserId) {
    return { allowed: false, reason: "agent_not_owned" };
  }
  if (context.channel !== "webchat" && context.channel !== "knox") {
    return { allowed: false, reason: "unknown_session" };
  }
  return { allowed: true, ownerUserId, reason: "personal_session" };
}
