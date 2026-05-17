import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { loadConfig } from "../config/config.js";
import {
  normalizeAgentId,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
} from "../routing/session-key.js";
import { ErrorCodes, errorShape } from "./protocol/index.js";
import type { GatewayClient, RespondFn } from "./server-methods/types.js";

export function getEmployeeAgentId(client: GatewayClient | null | undefined): string | null {
  const agentId = client?.internal?.employee?.agentId;
  return typeof agentId === "string" && agentId.trim() ? normalizeAgentId(agentId) : null;
}

export function isEmployeeClient(client: GatewayClient | null | undefined): boolean {
  return client?.connect?.role === "employee" && Boolean(getEmployeeAgentId(client));
}

export function resolveSessionAgentId(sessionKey: string): string {
  const parsed = parseAgentSessionKey(sessionKey);
  if (parsed?.agentId) {
    return normalizeAgentId(parsed.agentId);
  }
  return normalizeAgentId(resolveAgentIdFromSessionKey(sessionKey));
}

export function enforceEmployeeAgent(
  client: GatewayClient | null | undefined,
  agentId: string | null | undefined,
  respond: RespondFn,
  label = "agent",
): boolean {
  const employeeAgentId = getEmployeeAgentId(client);
  if (!employeeAgentId || !agentId) {
    return true;
  }
  if (normalizeAgentId(agentId) === employeeAgentId) {
    return true;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `employee access denied for ${label}`),
  );
  return false;
}

export function enforceEmployeeSessionKey(
  client: GatewayClient | null | undefined,
  sessionKey: string | null | undefined,
  respond: RespondFn,
  label = "session",
): boolean {
  const employeeAgentId = getEmployeeAgentId(client);
  const session = typeof sessionKey === "string" ? sessionKey.trim() : "";
  if (!employeeAgentId || !session) {
    return true;
  }
  if (resolveSessionAgentId(session) === employeeAgentId) {
    return true;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, `employee access denied for ${label}`),
  );
  return false;
}

export function filterEmployeeSessionRows<T extends { key?: string | null }>(
  client: GatewayClient | null | undefined,
  rows: readonly T[],
): T[] {
  const employeeAgentId = getEmployeeAgentId(client);
  if (!employeeAgentId) {
    return [...rows];
  }
  return rows.filter((row) => {
    const key = typeof row.key === "string" ? row.key.trim() : "";
    return key ? resolveSessionAgentId(key) === employeeAgentId : false;
  });
}

export function filterEmployeeCronJobs<
  T extends { agentId?: string | null; sessionKey?: string | null },
>(client: GatewayClient | null | undefined, jobs: readonly T[]): T[] {
  const employeeAgentId = getEmployeeAgentId(client);
  if (!employeeAgentId) {
    return [...jobs];
  }
  const defaultAgentId = resolveDefaultAgentId(loadConfig());
  return jobs.filter((job) => {
    const session = typeof job.sessionKey === "string" ? job.sessionKey.trim() : "";
    if (session) {
      return resolveSessionAgentId(session) === employeeAgentId;
    }
    const jobAgentId =
      typeof job.agentId === "string" && job.agentId.trim()
        ? normalizeAgentId(job.agentId)
        : normalizeAgentId(defaultAgentId);
    return jobAgentId === employeeAgentId;
  });
}

export function enforceEmployeeCronJob(
  client: GatewayClient | null | undefined,
  job: { agentId?: string | null; sessionKey?: string | null } | null | undefined,
  respond: RespondFn,
): boolean {
  if (!job) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "cron job not found"));
    return false;
  }
  const session = typeof job.sessionKey === "string" ? job.sessionKey.trim() : "";
  if (session) {
    return enforceEmployeeSessionKey(client, session, respond, "cron job");
  }
  const defaultAgentId = resolveDefaultAgentId(loadConfig());
  return enforceEmployeeAgent(
    client,
    (typeof job.agentId === "string" && job.agentId.trim()) || defaultAgentId,
    respond,
    "cron job",
  );
}
