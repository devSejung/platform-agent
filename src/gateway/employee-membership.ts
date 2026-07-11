import type { IncomingMessage, ServerResponse } from "node:http";
import { getPlatformClawDatabase } from "../accounts/db.js";
import {
  getLatestGroupJoinRequestForAccount,
  getGroupDetail,
  listGroupEntries,
  upsertGroupJoinRequest,
} from "../accounts/group-store.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import {
  EMPLOYEE_GROUP_JOIN_REQUEST_PATH,
  EMPLOYEE_MEMBERSHIP_GROUPS_PATH,
  EMPLOYEE_MEMBERSHIP_PATH,
  type EmployeeMembershipGroupOption,
  type EmployeeMembershipInvalidReason,
  type EmployeeGroupJoinRequestSaveResponse,
  type EmployeeMembershipPartOption,
  type EmployeeMembershipPendingRequest,
  type EmployeeMembershipStatusResponse,
} from "./employee-ui-contract.js";
import { readEmployeeSession } from "./employee-web-auth.js";

type MembershipSnapshot = {
  hasMembership: boolean;
  groupId: string | null;
  groupName: string | null;
  partId: string | null;
  partName: string | null;
  valid: boolean;
  reason: EmployeeMembershipInvalidReason | null;
  membershipStatus: EmployeeMembershipStatusResponse["membership_status"];
  pendingRequest: EmployeeMembershipPendingRequest | null;
};

type MembershipBody = {
  group_id?: unknown;
  part_id?: unknown;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function toStatusResponse(snapshot: MembershipSnapshot): EmployeeMembershipStatusResponse {
  return {
    has_membership: snapshot.hasMembership,
    has_valid_membership: snapshot.valid,
    reason: snapshot.reason,
    membership_status: snapshot.membershipStatus,
    group_id: snapshot.groupId,
    group_name: snapshot.groupName,
    part_id: snapshot.partId,
    part_name: snapshot.partName,
    pending_request: snapshot.pendingRequest,
  };
}

function listActiveGroups(accountId: string, env: NodeJS.ProcessEnv): EmployeeMembershipGroupOption[] {
  return listGroupEntries({
    actorAccountId: accountId,
    env,
  }).map((entry) => ({
    id: entry.id,
    name: entry.name,
  }));
}

function listActiveParts(
  accountId: string,
  groupId: string,
  env: NodeJS.ProcessEnv,
): EmployeeMembershipPartOption[] {
  const detail = getGroupDetail({
    actorAccountId: accountId,
    groupId,
    env,
  });
  if (!detail) {
    return [];
  }
  return detail.parts.map((part) => ({
    id: part.id,
    name: part.name,
    group_id: groupId,
  }));
}

function resolveEmployeeMembership(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): MembershipSnapshot {
  const { db } = getPlatformClawDatabase(env);
  const groupRows = db
    .prepare(
      `SELECT gm.scope_id AS scope_id,
              g.name AS scope_name,
              g.archived_at AS archived_at
         FROM group_memberships gm
         LEFT JOIN groups g ON g.id = gm.scope_id
        WHERE gm.account_id = ?
          AND gm.scope_type = 'group'
        ORDER BY gm.updated_at DESC, gm.created_at DESC`,
    )
    .all(accountId) as Array<{
    scope_id: string;
    scope_name: string | null;
    archived_at: string | null;
  }>;
  const partRows = db
    .prepare(
      `SELECT gm.scope_id AS scope_id,
              g.name AS scope_name,
              g.parent_group_id AS parent_group_id,
              g.archived_at AS archived_at,
              parent.name AS parent_group_name,
              parent.archived_at AS parent_group_archived_at
         FROM group_memberships gm
         LEFT JOIN groups g ON g.id = gm.scope_id
         LEFT JOIN groups parent ON parent.id = g.parent_group_id
        WHERE gm.account_id = ?
          AND gm.scope_type = 'part'
        ORDER BY gm.updated_at DESC, gm.created_at DESC`,
    )
    .all(accountId) as Array<{
    scope_id: string;
    scope_name: string | null;
    parent_group_id: string | null;
    archived_at: string | null;
    parent_group_name: string | null;
    parent_group_archived_at: string | null;
  }>;

  const hasMembership = groupRows.length > 0 || partRows.length > 0;
  const activeGroups = groupRows.filter(
    (row) => normalizeOptionalString(row.scope_name) && !normalizeOptionalString(row.archived_at),
  );
  const activeParts = partRows.filter(
    (row) => normalizeOptionalString(row.scope_name) && !normalizeOptionalString(row.archived_at),
  );
  const activeGroupById = new Map(
    activeGroups.map((row) => [
      row.scope_id,
      {
        id: row.scope_id,
        name: normalizeOptionalString(row.scope_name) ?? null,
      },
    ]),
  );

  for (const partRow of activeParts) {
    const parentGroupId = normalizeOptionalString(partRow.parent_group_id);
    if (!parentGroupId) {
      continue;
    }
    const parentGroupName = normalizeOptionalString(partRow.parent_group_name);
    if (parentGroupName && !normalizeOptionalString(partRow.parent_group_archived_at)) {
      return {
        hasMembership,
        groupId: parentGroupId,
        groupName: parentGroupName,
        partId: partRow.scope_id,
        partName: normalizeOptionalString(partRow.scope_name) ?? null,
        valid: true,
        reason: null,
        membershipStatus: "approved",
        pendingRequest: null,
      };
    }
    const parentGroup = activeGroupById.get(parentGroupId);
    if (parentGroup) {
      return {
        hasMembership,
        groupId: parentGroup.id,
        groupName: parentGroup.name,
        partId: partRow.scope_id,
        partName: normalizeOptionalString(partRow.scope_name) ?? null,
        valid: true,
        reason: null,
        membershipStatus: "approved",
        pendingRequest: null,
      };
    }
  }

  for (const partRow of activeParts) {
    const parentGroupId = normalizeOptionalString(partRow.parent_group_id);
    if (!parentGroupId) {
      continue;
    }
    const parentGroupRow =
      groupRows.find((groupRow) => groupRow.scope_id === parentGroupId) ??
      (normalizeOptionalString(partRow.parent_group_name)
        ? {
            scope_id: parentGroupId,
            scope_name: partRow.parent_group_name,
            archived_at: partRow.parent_group_archived_at,
          }
        : undefined);
    if (parentGroupRow && normalizeOptionalString(parentGroupRow.scope_name)) {
      return {
        hasMembership,
        groupId: parentGroupRow.scope_id,
        groupName: normalizeOptionalString(parentGroupRow.scope_name) ?? null,
        partId: partRow.scope_id,
        partName: normalizeOptionalString(partRow.scope_name) ?? null,
        valid: true,
        reason: null,
        membershipStatus: "approved",
        pendingRequest: null,
      };
    }
  }

  const firstActiveGroup = activeGroups[0];
  if (firstActiveGroup) {
    return {
      hasMembership,
      groupId: firstActiveGroup.scope_id,
      groupName: normalizeOptionalString(firstActiveGroup.scope_name) ?? null,
      partId: null,
      partName: null,
      valid: true,
      reason: null,
      membershipStatus: "approved",
      pendingRequest: null,
    };
  }

  const latestRequest = getLatestGroupJoinRequestForAccount(accountId, env);
  const pendingRequest =
    latestRequest?.status === "pending" || latestRequest?.status === "rejected"
      ? {
          request_id: latestRequest.id,
          group_id: latestRequest.groupId,
          group_name: latestRequest.groupName,
          part_id: latestRequest.partId,
          part_name: latestRequest.partName,
          status: latestRequest.status,
          requested_at: latestRequest.requestedAt,
          reviewed_at: latestRequest.reviewedAt,
          review_comment: latestRequest.reviewComment,
        }
      : null;

  const firstGroup = groupRows[0];
  const firstPart = partRows[0];
  if (!hasMembership) {
    return {
      hasMembership: false,
      groupId: null,
      groupName: null,
      partId: null,
      partName: null,
      valid: false,
      reason: "NOT_REGISTERED",
      membershipStatus: pendingRequest?.status ?? "none",
      pendingRequest,
    };
  }
  if (!firstGroup) {
    if (firstPart && normalizeOptionalString(firstPart.scope_name) && !normalizeOptionalString(firstPart.archived_at)) {
      return {
        hasMembership: true,
        groupId: normalizeOptionalString(firstPart.parent_group_id) ?? null,
        groupName: null,
        partId: firstPart.scope_id,
        partName: normalizeOptionalString(firstPart.scope_name) ?? null,
        valid: false,
        reason: normalizeOptionalString(firstPart.parent_group_id) ? "GROUP_INVALID" : "GROUP_MISSING",
        membershipStatus: pendingRequest?.status ?? "none",
        pendingRequest,
      };
    }
    return {
      hasMembership: true,
      groupId: null,
      groupName: null,
      partId: firstPart?.scope_id ?? null,
      partName: normalizeOptionalString(firstPart?.scope_name) ?? null,
      valid: false,
      reason: "GROUP_MISSING",
      membershipStatus: pendingRequest?.status ?? "none",
      pendingRequest,
    };
  }
  if (!normalizeOptionalString(firstGroup.scope_name) || normalizeOptionalString(firstGroup.archived_at)) {
    return {
      hasMembership: true,
      groupId: firstGroup.scope_id,
      groupName: normalizeOptionalString(firstGroup.scope_name) ?? null,
      partId: firstPart?.scope_id ?? null,
      partName: normalizeOptionalString(firstPart?.scope_name) ?? null,
      valid: false,
      reason: "GROUP_INVALID",
      membershipStatus: pendingRequest?.status ?? "none",
      pendingRequest,
    };
  }
  if (!firstPart) {
    return {
      hasMembership: true,
      groupId: firstGroup.scope_id,
      groupName: normalizeOptionalString(firstGroup.scope_name) ?? null,
      partId: null,
      partName: null,
      valid: false,
      reason: "PART_MISSING",
      membershipStatus: pendingRequest?.status ?? "none",
      pendingRequest,
    };
  }
  if (!normalizeOptionalString(firstPart.scope_name) || normalizeOptionalString(firstPart.archived_at)) {
    return {
      hasMembership: true,
      groupId: firstGroup.scope_id,
      groupName: normalizeOptionalString(firstGroup.scope_name) ?? null,
      partId: firstPart.scope_id,
      partName: normalizeOptionalString(firstPart.scope_name) ?? null,
      valid: false,
      reason: "PART_INVALID",
      membershipStatus: pendingRequest?.status ?? "none",
      pendingRequest,
    };
  }
  return {
    hasMembership: true,
    groupId: firstGroup.scope_id,
    groupName: normalizeOptionalString(firstGroup.scope_name) ?? null,
    partId: firstPart.scope_id,
    partName: normalizeOptionalString(firstPart.scope_name) ?? null,
    valid: false,
    reason: firstPart.parent_group_id ? "PART_GROUP_MISMATCH" : "PART_INVALID",
    membershipStatus: pendingRequest?.status ?? "none",
    pendingRequest,
  };
}

function saveEmployeeJoinRequest(params: {
  accountId: string;
  groupId: string;
  partId: string;
  env?: NodeJS.ProcessEnv;
}): EmployeeGroupJoinRequestSaveResponse {
  const request = upsertGroupJoinRequest(params);
  return {
    success: true,
    request_id: request.id,
    status: "pending",
    group_id: request.groupId,
    part_id: request.partId,
  };
}

export async function handleEmployeeMembershipHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  readJsonBody: (
    req: IncomingMessage,
    maxBytes: number,
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  const session = readEmployeeSession(params.req);
  if (
    url.pathname !== EMPLOYEE_MEMBERSHIP_PATH &&
    url.pathname !== EMPLOYEE_GROUP_JOIN_REQUEST_PATH &&
    url.pathname !== EMPLOYEE_MEMBERSHIP_GROUPS_PATH &&
    !url.pathname.startsWith(`${EMPLOYEE_MEMBERSHIP_GROUPS_PATH}/`)
  ) {
    return false;
  }
  if (!session) {
    sendJson(params.res, 401, { error: "employee sign-in required" });
    return true;
  }
  const accountId = session.employeeId;
  try {
    if (url.pathname === EMPLOYEE_MEMBERSHIP_PATH) {
      const method = (params.req.method ?? "GET").toUpperCase();
      if (method === "GET") {
        sendJson(params.res, 200, toStatusResponse(resolveEmployeeMembership(accountId)));
        return true;
      }
      if (method !== "POST") {
        params.res.setHeader("Allow", "GET, POST");
        sendJson(params.res, 405, { error: "Method Not Allowed" });
        return true;
      }
    }

    if (url.pathname === EMPLOYEE_MEMBERSHIP_PATH || url.pathname === EMPLOYEE_GROUP_JOIN_REQUEST_PATH) {
      const method = (params.req.method ?? "POST").toUpperCase();
      if (method !== "POST") {
        params.res.setHeader("Allow", url.pathname === EMPLOYEE_MEMBERSHIP_PATH ? "GET, POST" : "POST");
        sendJson(params.res, 405, { error: "Method Not Allowed" });
        return true;
      }
      const parsedBody = await params.readJsonBody(params.req, 8 * 1024);
      if (!parsedBody.ok || !parsedBody.value || typeof parsedBody.value !== "object") {
        sendJson(params.res, 400, {
          error: parsedBody.ok ? "invalid membership payload" : parsedBody.error,
        });
        return true;
      }
      const body = parsedBody.value as MembershipBody;
      const groupId = normalizeOptionalString(body.group_id);
      const partId = normalizeOptionalString(body.part_id);
      if (!groupId || !partId) {
        sendJson(params.res, 400, { error: "group_id and part_id are required" });
        return true;
      }
      sendJson(params.res, 200, saveEmployeeJoinRequest({ accountId, groupId, partId }));
      return true;
    }

    if (url.pathname === EMPLOYEE_MEMBERSHIP_GROUPS_PATH) {
      const method = (params.req.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        params.res.setHeader("Allow", "GET");
        sendJson(params.res, 405, { error: "Method Not Allowed" });
        return true;
      }
      sendJson(params.res, 200, {
        groups: listActiveGroups(accountId, process.env),
      });
      return true;
    }

    const method = (params.req.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      params.res.setHeader("Allow", "GET");
      sendJson(params.res, 405, { error: "Method Not Allowed" });
      return true;
    }
    const match = /^\/employee\/groups\/([^/]+)\/parts$/.exec(url.pathname);
    if (!match?.[1]) {
      return false;
    }
    const groupId = decodeURIComponent(match[1]);
    sendJson(params.res, 200, {
      parts: listActiveParts(accountId, groupId, process.env),
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "membership request failed";
    const status =
      message.includes("not belong")
        ? 409
        : message.includes("required") || message.includes("selected")
          ? 400
          : 500;
    sendJson(params.res, status, { error: message });
    return true;
  }
}

export { resolveEmployeeMembership };
