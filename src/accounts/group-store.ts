import { randomUUID } from "node:crypto";
import { getAccountById } from "./account-store.js";
import { getPlatformClawDatabase } from "./db.js";

export type GroupScopeType = "group" | "part";
export type GroupScopedRole = "member" | "leader";

export type GroupScopeRecord = {
  id: string;
  name: string;
  description: string | null;
  scopeType: GroupScopeType;
  parentGroupId: string | null;
  parentGroupName: string | null;
  groupLevel: 1 | 2;
  createdByAccountId: string;
  ownerAccountId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type GroupMembershipEntry = {
  accountId: string;
  displayName: string;
  email: string | null;
  department: string | null;
  groupRole: GroupScopedRole;
};

export type GroupListEntry = GroupScopeRecord & {
  partCount: number;
  memberCount: number;
  leaderCount: number;
  canManageMembers: boolean;
  canEditMetadata: boolean;
  canCreatePart: boolean;
  canArchive: boolean;
};

export type GroupDetail = {
  group: GroupListEntry;
  members: GroupMembershipEntry[];
  parts: Array<GroupListEntry & { members: GroupMembershipEntry[] }>;
};

export type GroupScopeOption = {
  scopeType: GroupScopeType;
  scopeId: string;
  label: string;
  archived: boolean;
};

export type GroupJoinRequestStatus = "pending" | "approved" | "rejected";

export type GroupJoinRequestEntry = {
  id: string;
  accountId: string;
  employeeId: string;
  displayName: string;
  email: string | null;
  department: string | null;
  groupId: string;
  groupName: string;
  partId: string;
  partName: string;
  status: GroupJoinRequestStatus;
  requestedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedByAccountId: string | null;
  reviewComment: string | null;
};

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  created_by_account_id: string;
  owner_account_id: string;
  parent_group_id: string | null;
  parent_group_name?: string | null;
  group_level: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type GroupJoinRequestRow = {
  id: string;
  account_id: string;
  employee_id: string;
  display_name: string | null;
  email: string | null;
  department: string | null;
  group_id: string;
  group_name: string | null;
  group_archived_at: string | null;
  part_id: string;
  part_name: string | null;
  part_archived_at: string | null;
  part_parent_group_id: string | null;
  status: GroupJoinRequestStatus;
  requested_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by_account_id: string | null;
  review_comment: string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function rowToScopeRecord(row: GroupRow): GroupScopeRecord {
  return {
    id: row.id,
    name: row.name,
    description: trimOrNull(row.description),
    scopeType: row.group_level === 1 ? "group" : "part",
    parentGroupId: trimOrNull(row.parent_group_id),
    parentGroupName: trimOrNull(row.parent_group_name),
    groupLevel: row.group_level === 1 ? 1 : 2,
    createdByAccountId: row.created_by_account_id,
    ownerAccountId: row.owner_account_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: trimOrNull(row.archived_at),
  };
}

function rowToJoinRequestEntry(row: GroupJoinRequestRow): GroupJoinRequestEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    employeeId: row.employee_id,
    displayName: trimOrNull(row.display_name) ?? row.employee_id,
    email: row.email,
    department: row.department,
    groupId: row.group_id,
    groupName: trimOrNull(row.group_name) ?? "Group",
    partId: row.part_id,
    partName: trimOrNull(row.part_name) ?? "Part",
    status: row.status,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    reviewedAt: trimOrNull(row.reviewed_at),
    reviewedByAccountId: trimOrNull(row.reviewed_by_account_id),
    reviewComment: trimOrNull(row.review_comment),
  };
}

function appendAuditEvent(params: {
  actorAccountId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  payload?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO audit_events (
       id, actor_account_id, event_type, target_type, target_id, payload_json, created_at
     ) VALUES (
       @id, @actor_account_id, @event_type, @target_type, @target_id, @payload_json, @created_at
     )`,
  ).run({
    id: randomUUID(),
    actor_account_id: params.actorAccountId,
    event_type: params.eventType,
    target_type: params.targetType,
    target_id: params.targetId,
    payload_json: params.payload ? JSON.stringify(params.payload) : null,
    created_at: new Date().toISOString(),
  });
}

export function isAdminAccount(accountId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return getAccountById(accountId, env)?.globalRole === "admin";
}

export function getGroupScopeById(
  scopeId: string,
  env: NodeJS.ProcessEnv = process.env,
): GroupScopeRecord | null {
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(
      `SELECT g.id,
              g.name,
              g.description,
              g.created_by_account_id,
              g.owner_account_id,
              g.parent_group_id,
              parent.name AS parent_group_name,
              g.group_level,
              g.created_at,
              g.updated_at,
              g.archived_at
         FROM groups g
         LEFT JOIN groups parent ON parent.id = g.parent_group_id
        WHERE g.id = ?`,
    )
    .get(scopeId) as GroupRow | undefined;
  return row ? rowToScopeRecord(row) : null;
}

export function isLeaderForScope(params: {
  accountId: string;
  scopeType: GroupScopeType;
  scopeId: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  if (params.scopeType === "group") {
    const row = db
      .prepare(
        `SELECT 1 AS found
           FROM group_memberships
          WHERE account_id = ?
            AND scope_type = 'group'
            AND scope_id = ?
            AND group_role = 'leader'
          LIMIT 1`,
      )
      .get(params.accountId, params.scopeId) as { found?: number } | undefined;
    return row?.found === 1;
  }
  const row = db
    .prepare(
      `SELECT 1 AS found
         FROM groups part
         LEFT JOIN group_memberships direct
           ON direct.account_id = @account_id
          AND direct.scope_type = 'part'
          AND direct.scope_id = part.id
          AND direct.group_role = 'leader'
         LEFT JOIN group_memberships inherited
           ON inherited.account_id = @account_id
          AND inherited.scope_type = 'group'
          AND inherited.scope_id = part.parent_group_id
          AND inherited.group_role = 'leader'
        WHERE part.id = @scope_id
          AND (direct.account_id IS NOT NULL OR inherited.account_id IS NOT NULL)
        LIMIT 1`,
    )
    .get({
      account_id: params.accountId,
      scope_id: params.scopeId,
    }) as { found?: number } | undefined;
  return row?.found === 1;
}

export function canManageGroupScope(params: {
  accountId: string;
  scopeType: GroupScopeType;
  scopeId: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  return isAdminAccount(params.accountId, params.env) || isLeaderForScope(params);
}

function canReviewJoinRequestForGroup(
  actorAccountId: string,
  groupId: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isAdminAccount(actorAccountId, env) ||
    isLeaderForScope({
      accountId: actorAccountId,
      scopeType: "group",
      scopeId: groupId,
      env,
    })
  );
}

function listMembersForScope(
  scopeType: GroupScopeType,
  scopeId: string,
  env: NodeJS.ProcessEnv = process.env,
): GroupMembershipEntry[] {
  const { db } = getPlatformClawDatabase(env);
  const rows = db
    .prepare(
      `SELECT a.id AS account_id,
              a.employee_id,
              a.email,
              a.display_name,
              a.department,
              gm.group_role
         FROM group_memberships gm
         JOIN accounts a ON a.id = gm.account_id
        WHERE gm.scope_type = ?
          AND gm.scope_id = ?
        ORDER BY
          CASE gm.group_role WHEN 'leader' THEN 0 ELSE 1 END,
          COALESCE(a.display_name, a.employee_id) COLLATE NOCASE ASC`,
    )
    .all(scopeType, scopeId) as Array<{
    account_id: string;
    employee_id: string;
    email: string | null;
    display_name: string | null;
    department: string | null;
    group_role: GroupScopedRole;
  }>;
  return rows.map((row) => ({
    accountId: row.account_id,
    displayName: trimOrNull(row.display_name) ?? row.employee_id,
    email: row.email,
    department: row.department,
    groupRole: row.group_role,
  }));
}

function countParts(groupId: string, env: NodeJS.ProcessEnv = process.env): number {
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM groups
        WHERE parent_group_id = ?`,
    )
    .get(groupId) as { count?: number | bigint } | undefined;
  return typeof row?.count === "bigint" ? Number(row.count) : (row?.count ?? 0);
}

function countMembers(
  scopeType: GroupScopeType,
  scopeId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN group_role = 'leader' THEN 1 ELSE 0 END) AS leader_count
         FROM group_memberships
        WHERE scope_type = ?
          AND scope_id = ?`,
    )
    .get(scopeType, scopeId) as
    | { count?: number | bigint; leader_count?: number | bigint }
    | undefined;
  return {
    count: typeof row?.count === "bigint" ? Number(row.count) : (row?.count ?? 0),
    leaderCount:
      typeof row?.leader_count === "bigint" ? Number(row.leader_count) : (row?.leader_count ?? 0),
  };
}

function assertGroupNameAvailable(params: {
  name: string;
  excludeId?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(
      `SELECT id
         FROM groups
        WHERE group_level = 1
          AND lower(name) = lower(@name)
          AND (@exclude_id IS NULL OR id != @exclude_id)
        LIMIT 1`,
    )
    .get({
      name: params.name,
      exclude_id: trimOrNull(params.excludeId),
    }) as { id?: string } | undefined;
  if (row?.id) {
    throw new Error("group name already exists");
  }
}

function assertPartNameAvailable(params: {
  groupId: string;
  name: string;
  excludeId?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(
      `SELECT id
         FROM groups
        WHERE group_level = 2
          AND parent_group_id = @group_id
          AND lower(name) = lower(@name)
          AND (@exclude_id IS NULL OR id != @exclude_id)
        LIMIT 1`,
    )
    .get({
      group_id: params.groupId,
      name: params.name,
      exclude_id: trimOrNull(params.excludeId),
    }) as { id?: string } | undefined;
  if (row?.id) {
    throw new Error("part name already exists in this group");
  }
}

function toGroupListEntry(
  row: GroupRow,
  actorAccountId: string,
  env: NodeJS.ProcessEnv = process.env,
): GroupListEntry {
  const scope = rowToScopeRecord(row);
  const memberCounts = countMembers(scope.scopeType, scope.id, env);
  return {
    ...scope,
    partCount: scope.scopeType === "group" ? countParts(scope.id, env) : 0,
    memberCount: memberCounts.count,
    leaderCount: memberCounts.leaderCount,
    canManageMembers: canManageGroupScope({
      accountId: actorAccountId,
      scopeType: scope.scopeType,
      scopeId: scope.id,
      env,
    }),
    canEditMetadata: isAdminAccount(actorAccountId, env),
    canCreatePart: scope.scopeType === "group" && isAdminAccount(actorAccountId, env),
    canArchive: isAdminAccount(actorAccountId, env),
  };
}

export function listGroupEntries(params: {
  actorAccountId: string;
  includeArchived?: boolean;
  env?: NodeJS.ProcessEnv;
}): GroupListEntry[] {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  const rows = db
    .prepare(
      `SELECT id,
              name,
              description,
              created_by_account_id,
              owner_account_id,
              parent_group_id,
              NULL AS parent_group_name,
              group_level,
              created_at,
              updated_at,
              archived_at
         FROM groups
        WHERE group_level = 1
          AND (@include_archived = 1 OR archived_at IS NULL)
        ORDER BY archived_at IS NOT NULL ASC, name COLLATE NOCASE ASC`,
    )
    .all({ include_archived: params.includeArchived ? 1 : 0 }) as GroupRow[];
  return rows.map((row) => toGroupListEntry(row, params.actorAccountId, env));
}

export function getGroupDetail(params: {
  actorAccountId: string;
  groupId: string;
  includeArchived?: boolean;
  env?: NodeJS.ProcessEnv;
}): GroupDetail | null {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  const groupRow = db
    .prepare(
      `SELECT id,
              name,
              description,
              created_by_account_id,
              owner_account_id,
              parent_group_id,
              NULL AS parent_group_name,
              group_level,
              created_at,
              updated_at,
              archived_at
         FROM groups
        WHERE id = ?
          AND group_level = 1
          AND (? = 1 OR archived_at IS NULL)`,
    )
    .get(params.groupId, params.includeArchived ? 1 : 0) as GroupRow | undefined;
  if (!groupRow) {
    return null;
  }
  const partRows = db
    .prepare(
      `SELECT child.id,
              child.name,
              child.description,
              child.created_by_account_id,
              child.owner_account_id,
              child.parent_group_id,
              parent.name AS parent_group_name,
              child.group_level,
              child.created_at,
              child.updated_at,
              child.archived_at
         FROM groups child
         JOIN groups parent ON parent.id = child.parent_group_id
        WHERE child.parent_group_id = ?
          AND child.group_level = 2
          AND (? = 1 OR child.archived_at IS NULL)
        ORDER BY child.archived_at IS NOT NULL ASC, child.name COLLATE NOCASE ASC`,
    )
    .all(params.groupId, params.includeArchived ? 1 : 0) as GroupRow[];
  return {
    group: toGroupListEntry(groupRow, params.actorAccountId, env),
    members: listMembersForScope("group", params.groupId, env),
    parts: partRows.map((row) => ({
      ...toGroupListEntry(row, params.actorAccountId, env),
      members: listMembersForScope("part", row.id, env),
    })),
  };
}

export function listGroupScopeOptions(params: {
  includeArchived?: boolean;
  env?: NodeJS.ProcessEnv;
}): GroupScopeOption[] {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  const rows = db
    .prepare(
      `SELECT g.id,
              g.name,
              g.group_level,
              g.archived_at,
              parent.name AS parent_group_name
         FROM groups g
         LEFT JOIN groups parent ON parent.id = g.parent_group_id
        WHERE (? = 1 OR g.archived_at IS NULL)
        ORDER BY g.group_level ASC, COALESCE(parent.name, g.name) COLLATE NOCASE ASC, g.name COLLATE NOCASE ASC`,
    )
    .all(params.includeArchived ? 1 : 0) as Array<{
    id: string;
    name: string;
    group_level: number;
    archived_at: string | null;
    parent_group_name: string | null;
  }>;
  return rows.map((row) => ({
    scopeType: row.group_level === 1 ? "group" : "part",
    scopeId: row.id,
    label: row.group_level === 1 ? row.name : `${row.parent_group_name ?? "Group"} / ${row.name}`,
    archived: Boolean(trimOrNull(row.archived_at)),
  }));
}

export function createGroup(params: {
  actorAccountId: string;
  name: string;
  description?: string | null;
  env?: NodeJS.ProcessEnv;
}): GroupScopeRecord {
  const env = params.env ?? process.env;
  if (!isAdminAccount(params.actorAccountId, env)) {
    throw new Error("only admins can create groups");
  }
  const name = trimOrNull(params.name);
  if (!name) {
    throw new Error("group name is required");
  }
  assertGroupNameAvailable({ name, env });
  const now = new Date().toISOString();
  const id = randomUUID();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO groups (
       id, name, description, created_by_account_id, owner_account_id,
       parent_group_id, group_level, created_at, updated_at, archived_at
     ) VALUES (
       @id, @name, @description, @created_by_account_id, @owner_account_id,
       NULL, 1, @created_at, @updated_at, NULL
     )`,
  ).run({
    id,
    name,
    description: trimOrNull(params.description),
    created_by_account_id: params.actorAccountId,
    owner_account_id: params.actorAccountId,
    created_at: now,
    updated_at: now,
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: "group.created",
    targetType: "group",
    targetId: id,
    payload: { name },
    env,
  });
  return getGroupScopeById(id, env)!;
}

export function createPart(params: {
  actorAccountId: string;
  groupId: string;
  name: string;
  description?: string | null;
  env?: NodeJS.ProcessEnv;
}): GroupScopeRecord {
  const env = params.env ?? process.env;
  if (!isAdminAccount(params.actorAccountId, env)) {
    throw new Error("only admins can create parts");
  }
  const parent = getGroupScopeById(params.groupId, env);
  if (!parent || parent.scopeType !== "group") {
    throw new Error("parent group not found");
  }
  const name = trimOrNull(params.name);
  if (!name) {
    throw new Error("part name is required");
  }
  assertPartNameAvailable({ groupId: parent.id, name, env });
  const now = new Date().toISOString();
  const id = randomUUID();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO groups (
       id, name, description, created_by_account_id, owner_account_id,
       parent_group_id, group_level, created_at, updated_at, archived_at
     ) VALUES (
       @id, @name, @description, @created_by_account_id, @owner_account_id,
       @parent_group_id, 2, @created_at, @updated_at, NULL
     )`,
  ).run({
    id,
    name,
    description: trimOrNull(params.description),
    created_by_account_id: params.actorAccountId,
    owner_account_id: params.actorAccountId,
    parent_group_id: parent.id,
    created_at: now,
    updated_at: now,
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: "part.created",
    targetType: "part",
    targetId: id,
    payload: { name, groupId: parent.id },
    env,
  });
  return getGroupScopeById(id, env)!;
}

export function updateGroup(params: {
  actorAccountId: string;
  groupId: string;
  name: string;
  description?: string | null;
  env?: NodeJS.ProcessEnv;
}): GroupScopeRecord {
  const env = params.env ?? process.env;
  if (!isAdminAccount(params.actorAccountId, env)) {
    throw new Error("only admins can edit groups");
  }
  const scope = getGroupScopeById(params.groupId, env);
  if (!scope || scope.scopeType !== "group") {
    throw new Error("group not found");
  }
  const name = trimOrNull(params.name);
  if (!name) {
    throw new Error("group name is required");
  }
  assertGroupNameAvailable({ name, excludeId: scope.id, env });
  const description = trimOrNull(params.description);
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `UPDATE groups
        SET name = @name,
            description = @description,
            updated_at = @updated_at
      WHERE id = @id`,
  ).run({
    id: scope.id,
    name,
    description,
    updated_at: now,
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: "group.updated",
    targetType: "group",
    targetId: scope.id,
    payload: {
      previousName: scope.name,
      nextName: name,
      previousDescription: scope.description,
      nextDescription: description,
    },
    env,
  });
  return getGroupScopeById(scope.id, env)!;
}

export function updatePart(params: {
  actorAccountId: string;
  partId: string;
  name: string;
  description?: string | null;
  env?: NodeJS.ProcessEnv;
}): GroupScopeRecord {
  const env = params.env ?? process.env;
  if (!isAdminAccount(params.actorAccountId, env)) {
    throw new Error("only admins can edit parts");
  }
  const scope = getGroupScopeById(params.partId, env);
  if (!scope || scope.scopeType !== "part" || !scope.parentGroupId) {
    throw new Error("part not found");
  }
  const name = trimOrNull(params.name);
  if (!name) {
    throw new Error("part name is required");
  }
  assertPartNameAvailable({
    groupId: scope.parentGroupId,
    name,
    excludeId: scope.id,
    env,
  });
  const description = trimOrNull(params.description);
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `UPDATE groups
        SET name = @name,
            description = @description,
            updated_at = @updated_at
      WHERE id = @id`,
  ).run({
    id: scope.id,
    name,
    description,
    updated_at: now,
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: "part.updated",
    targetType: "part",
    targetId: scope.id,
    payload: {
      groupId: scope.parentGroupId,
      previousName: scope.name,
      nextName: name,
      previousDescription: scope.description,
      nextDescription: description,
    },
    env,
  });
  return getGroupScopeById(scope.id, env)!;
}

export function addGroupMembership(params: {
  actorAccountId: string;
  targetAccountId: string;
  scopeType: GroupScopeType;
  scopeId: string;
  groupRole?: GroupScopedRole;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const scope = getGroupScopeById(params.scopeId, env);
  if (!scope || scope.scopeType !== params.scopeType) {
    throw new Error("group scope not found");
  }
  if (scope.archivedAt) {
    throw new Error("cannot add members to archived groups or parts");
  }
  const target = getAccountById(params.targetAccountId, env);
  if (!target || target.status !== "active") {
    throw new Error("target account not found");
  }
  const actorIsAdmin = isAdminAccount(params.actorAccountId, env);
  if (
    !actorIsAdmin &&
    !canManageGroupScope({
      accountId: params.actorAccountId,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      env,
    })
  ) {
    throw new Error("not allowed to manage memberships for this scope");
  }
  const requestedRole = params.groupRole ?? "member";
  if (!actorIsAdmin && requestedRole !== "member") {
    throw new Error("leaders can only add members");
  }
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO group_memberships (scope_type, scope_id, account_id, group_role, created_at, updated_at)
     VALUES (@scope_type, @scope_id, @account_id, @group_role, @created_at, @updated_at)
     ON CONFLICT(scope_type, scope_id, account_id) DO UPDATE SET
       group_role = excluded.group_role,
       updated_at = excluded.updated_at`,
  ).run({
    scope_type: params.scopeType,
    scope_id: params.scopeId,
    account_id: params.targetAccountId,
    group_role: requestedRole,
    created_at: now,
    updated_at: now,
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: "membership.added",
    targetType: params.scopeType,
    targetId: params.scopeId,
    payload: {
      targetAccountId: params.targetAccountId,
      groupRole: requestedRole,
    },
    env,
  });
}

export function removeGroupMembership(params: {
  actorAccountId: string;
  targetAccountId: string;
  scopeType: GroupScopeType;
  scopeId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const scope = getGroupScopeById(params.scopeId, env);
  if (!scope || scope.scopeType !== params.scopeType) {
    throw new Error("group scope not found");
  }
  const actorIsAdmin = isAdminAccount(params.actorAccountId, env);
  if (
    !actorIsAdmin &&
    !canManageGroupScope({
      accountId: params.actorAccountId,
      scopeType: params.scopeType,
      scopeId: params.scopeId,
      env,
    })
  ) {
    throw new Error("not allowed to manage memberships for this scope");
  }
  if (!actorIsAdmin && params.actorAccountId === params.targetAccountId) {
    throw new Error("leaders cannot remove themselves from managed scopes");
  }
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `DELETE FROM group_memberships
      WHERE scope_type = @scope_type
        AND scope_id = @scope_id
        AND account_id = @account_id`,
  ).run({
    scope_type: params.scopeType,
    scope_id: params.scopeId,
    account_id: params.targetAccountId,
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: "membership.removed",
    targetType: params.scopeType,
    targetId: params.scopeId,
    payload: { targetAccountId: params.targetAccountId },
    env,
  });
}

export function archiveGroupScope(params: {
  actorAccountId: string;
  scopeId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  if (!isAdminAccount(params.actorAccountId, env)) {
    throw new Error("only admins can archive groups or parts");
  }
  const scope = getGroupScopeById(params.scopeId, env);
  if (!scope) {
    throw new Error("group scope not found");
  }
  if (scope.archivedAt) {
    return scope;
  }
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `UPDATE groups
        SET archived_at = @archived_at,
            updated_at = @updated_at
      WHERE id = @id`,
  ).run({
    id: params.scopeId,
    archived_at: now,
    updated_at: now,
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: scope.scopeType === "group" ? "group.archived" : "part.archived",
    targetType: scope.scopeType,
    targetId: scope.id,
    env,
  });
  return getGroupScopeById(params.scopeId, env)!;
}

export function resolveManageableGroupSummary(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): { groupCount: number; partCount: number } {
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(
      `SELECT
          SUM(CASE WHEN gm.scope_type = 'group' AND gm.group_role = 'leader' THEN 1 ELSE 0 END) AS group_count,
          SUM(CASE WHEN gm.scope_type = 'part' AND gm.group_role = 'leader' THEN 1 ELSE 0 END) AS part_count
         FROM group_memberships gm
        WHERE gm.account_id = ?`,
    )
    .get(accountId) as { group_count?: number | bigint; part_count?: number | bigint } | undefined;
  return {
    groupCount:
      typeof row?.group_count === "bigint" ? Number(row.group_count) : (row?.group_count ?? 0),
    partCount:
      typeof row?.part_count === "bigint" ? Number(row.part_count) : (row?.part_count ?? 0),
  };
}

function validateJoinRequestTargets(params: {
  groupId: string;
  partId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const group = getGroupScopeById(params.groupId, env);
  if (!group || group.scopeType !== "group" || group.archivedAt) {
    throw new Error("selected group is not available");
  }
  const part = getGroupScopeById(params.partId, env);
  if (!part || part.scopeType !== "part" || part.archivedAt) {
    throw new Error("selected part is not available");
  }
  if (part.parentGroupId !== group.id) {
    throw new Error("selected part does not belong to the selected group");
  }
  return { group, part };
}

function listJoinRequestRows(params: {
  actorAccountId: string;
  status?: GroupJoinRequestStatus;
  env?: NodeJS.ProcessEnv;
}): GroupJoinRequestRow[] {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  const actorIsAdmin = isAdminAccount(params.actorAccountId, env);
  const statusFilter = trimOrNull(params.status) ?? null;
  const rows = db
    .prepare(
      `SELECT r.id,
              r.account_id,
              a.employee_id,
              a.display_name,
              a.email,
              a.department,
              r.group_id,
              grp.name AS group_name,
              grp.archived_at AS group_archived_at,
              r.part_id,
              part.name AS part_name,
              part.archived_at AS part_archived_at,
              part.parent_group_id AS part_parent_group_id,
              r.status,
              r.requested_at,
              r.updated_at,
              r.reviewed_at,
              r.reviewed_by_account_id,
              r.review_comment
         FROM group_join_requests r
         JOIN accounts a ON a.id = r.account_id
         LEFT JOIN groups grp ON grp.id = r.group_id
         LEFT JOIN groups part ON part.id = r.part_id
        WHERE (@status IS NULL OR r.status = @status)
          AND (
            @is_admin = 1 OR EXISTS (
              SELECT 1
                FROM group_memberships gm
               WHERE gm.account_id = @actor_account_id
                 AND gm.scope_type = 'group'
                 AND gm.scope_id = r.group_id
                 AND gm.group_role = 'leader'
            )
          )
        ORDER BY r.requested_at DESC, r.updated_at DESC`,
    )
    .all({
      actor_account_id: params.actorAccountId,
      is_admin: actorIsAdmin ? 1 : 0,
      status: statusFilter,
    }) as GroupJoinRequestRow[];
  return rows;
}

export function getLatestGroupJoinRequestForAccount(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): GroupJoinRequestEntry | null {
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(
      `SELECT r.id,
              r.account_id,
              a.employee_id,
              a.display_name,
              a.email,
              a.department,
              r.group_id,
              grp.name AS group_name,
              grp.archived_at AS group_archived_at,
              r.part_id,
              part.name AS part_name,
              part.archived_at AS part_archived_at,
              part.parent_group_id AS part_parent_group_id,
              r.status,
              r.requested_at,
              r.updated_at,
              r.reviewed_at,
              r.reviewed_by_account_id,
              r.review_comment
         FROM group_join_requests r
         JOIN accounts a ON a.id = r.account_id
         LEFT JOIN groups grp ON grp.id = r.group_id
         LEFT JOIN groups part ON part.id = r.part_id
        WHERE r.account_id = ?
        ORDER BY r.updated_at DESC, r.requested_at DESC
        LIMIT 1`,
    )
    .get(accountId) as GroupJoinRequestRow | undefined;
  return row ? rowToJoinRequestEntry(row) : null;
}

export function upsertGroupJoinRequest(params: {
  accountId: string;
  groupId: string;
  partId: string;
  env?: NodeJS.ProcessEnv;
}): GroupJoinRequestEntry {
  const env = params.env ?? process.env;
  const { group, part } = validateJoinRequestTargets(params);
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  const existing = db
    .prepare(`SELECT id, requested_at FROM group_join_requests WHERE account_id = ?`)
    .get(params.accountId) as { id?: string; requested_at?: string | null } | undefined;
  const id = existing?.id ?? randomUUID();
  db.prepare(
    `INSERT INTO group_join_requests (
       id, account_id, group_id, part_id, status, requested_at, updated_at,
       reviewed_at, reviewed_by_account_id, review_comment
     ) VALUES (
       @id, @account_id, @group_id, @part_id, 'pending', @requested_at, @updated_at,
       NULL, NULL, NULL
     )
     ON CONFLICT(account_id) DO UPDATE SET
       group_id = excluded.group_id,
       part_id = excluded.part_id,
       status = 'pending',
       updated_at = excluded.updated_at,
       reviewed_at = NULL,
       reviewed_by_account_id = NULL,
       review_comment = NULL`,
  ).run({
    id,
    account_id: params.accountId,
    group_id: group.id,
    part_id: part.id,
    requested_at: trimOrNull(existing?.requested_at) ?? now,
    updated_at: now,
  });
  appendAuditEvent({
    actorAccountId: params.accountId,
    eventType: "group.join-request.submitted",
    targetType: "account",
    targetId: params.accountId,
    payload: {
      groupId: group.id,
      partId: part.id,
    },
    env,
  });
  return getLatestGroupJoinRequestForAccount(params.accountId, env)!;
}

export function listVisibleGroupJoinRequests(params: {
  actorAccountId: string;
  status?: GroupJoinRequestStatus;
  env?: NodeJS.ProcessEnv;
}): GroupJoinRequestEntry[] {
  return listJoinRequestRows(params).map(rowToJoinRequestEntry);
}

export function countVisiblePendingGroupJoinRequests(
  actorAccountId: string,
  env: NodeJS.ProcessEnv = process.env,
): number {
  return listJoinRequestRows({
    actorAccountId,
    status: "pending",
    env,
  }).length;
}

export function approveGroupJoinRequest(params: {
  actorAccountId: string;
  requestId: string;
  reviewComment?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  const request = db
    .prepare(
      `SELECT id, account_id, group_id, part_id, status
         FROM group_join_requests
        WHERE id = ?`,
    )
    .get(params.requestId) as
    | {
        id: string;
        account_id: string;
        group_id: string;
        part_id: string;
        status: GroupJoinRequestStatus;
      }
    | undefined;
  if (!request) {
    throw new Error("join request not found");
  }
  if (request.status !== "pending") {
    throw new Error("only pending requests can be approved");
  }
  if (!canReviewJoinRequestForGroup(params.actorAccountId, request.group_id, env)) {
    throw new Error("not allowed to review this join request");
  }
  validateJoinRequestTargets({
    groupId: request.group_id,
    partId: request.part_id,
    env,
  });
  const now = new Date().toISOString();
  const upsertMembership = db.prepare(
    `INSERT INTO group_memberships (scope_type, scope_id, account_id, group_role, created_at, updated_at)
     VALUES (@scope_type, @scope_id, @account_id, 'member', @created_at, @updated_at)
     ON CONFLICT(scope_type, scope_id, account_id) DO UPDATE SET
       group_role = CASE
         WHEN group_memberships.group_role = 'leader' THEN group_memberships.group_role
         ELSE excluded.group_role
       END,
       updated_at = excluded.updated_at`,
  );
  upsertMembership.run({
    scope_type: "group",
    scope_id: request.group_id,
    account_id: request.account_id,
    created_at: now,
    updated_at: now,
  });
  upsertMembership.run({
    scope_type: "part",
    scope_id: request.part_id,
    account_id: request.account_id,
    created_at: now,
    updated_at: now,
  });
  db.prepare(
    `UPDATE group_join_requests
        SET status = 'approved',
            updated_at = @updated_at,
            reviewed_at = @reviewed_at,
            reviewed_by_account_id = @reviewed_by_account_id,
            review_comment = @review_comment
      WHERE id = @id`,
  ).run({
    id: request.id,
    updated_at: now,
    reviewed_at: now,
    reviewed_by_account_id: params.actorAccountId,
    review_comment: trimOrNull(params.reviewComment),
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: "group.join-request.approved",
    targetType: "account",
    targetId: request.account_id,
    payload: {
      requestId: request.id,
      groupId: request.group_id,
      partId: request.part_id,
    },
    env,
  });
}

export function rejectGroupJoinRequest(params: {
  actorAccountId: string;
  requestId: string;
  reviewComment?: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const { db } = getPlatformClawDatabase(env);
  const request = db
    .prepare(
      `SELECT id, account_id, group_id, status
         FROM group_join_requests
        WHERE id = ?`,
    )
    .get(params.requestId) as
    | { id: string; account_id: string; group_id: string; status: GroupJoinRequestStatus }
    | undefined;
  if (!request) {
    throw new Error("join request not found");
  }
  if (request.status !== "pending") {
    throw new Error("only pending requests can be rejected");
  }
  if (!canReviewJoinRequestForGroup(params.actorAccountId, request.group_id, env)) {
    throw new Error("not allowed to review this join request");
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE group_join_requests
        SET status = 'rejected',
            updated_at = @updated_at,
            reviewed_at = @reviewed_at,
            reviewed_by_account_id = @reviewed_by_account_id,
            review_comment = @review_comment
      WHERE id = @id`,
  ).run({
    id: request.id,
    updated_at: now,
    reviewed_at: now,
    reviewed_by_account_id: params.actorAccountId,
    review_comment: trimOrNull(params.reviewComment),
  });
  appendAuditEvent({
    actorAccountId: params.actorAccountId,
    eventType: "group.join-request.rejected",
    targetType: "account",
    targetId: request.account_id,
    payload: {
      requestId: request.id,
      groupId: request.group_id,
    },
    env,
  });
}
