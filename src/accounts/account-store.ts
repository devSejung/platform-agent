import { randomUUID } from "node:crypto";
import { getPlatformClawDatabase } from "./db.js";

export type AccountGlobalRole = "member" | "admin";
export type AccountStatus = "active" | "disabled";

export type AccountRecord = {
  id: string;
  externalProvider: string;
  externalSubject: string;
  employeeId: string;
  email: string | null;
  displayName: string | null;
  department: string | null;
  timezone: string | null;
  status: AccountStatus;
  globalRole: AccountGlobalRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

export type AccountSummary = {
  accountId: string;
  globalRole: AccountGlobalRole;
  groupCount: number;
  partCount: number;
  topLevelGroupNames: string[];
  hasAdminAccess: boolean;
  hasLeaderScope: boolean;
};

export type AccountMembershipSummary = {
  scopeType: "group" | "part";
  scopeId: string;
  scopeName: string;
  parentGroupId: string | null;
  parentGroupName: string | null;
  groupRole: "member" | "leader";
  archived: boolean;
};

export type AccountDirectoryEntry = {
  accountId: string;
  employeeId: string;
  displayName: string;
  email: string | null;
  department: string | null;
  globalRole: AccountGlobalRole;
  status: AccountStatus;
};

export type AdminAccountListEntry = AccountDirectoryEntry & {
  lastLoginAt: string | null;
  groups: string[];
};

export type AdminAccountDetail = AdminAccountListEntry & {
  memberships: AccountMembershipSummary[];
};

type AccountRow = {
  id: string;
  external_provider: string;
  external_subject: string;
  employee_id: string;
  email: string | null;
  display_name: string | null;
  department: string | null;
  timezone: string | null;
  status: AccountStatus;
  global_role: AccountGlobalRole;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function rowToAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    externalProvider: row.external_provider,
    externalSubject: row.external_subject,
    employeeId: row.employee_id,
    email: row.email,
    displayName: row.display_name,
    department: row.department,
    timezone: row.timezone,
    status: row.status,
    globalRole: row.global_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function toAccountDirectoryEntry(row: AccountRow): AccountDirectoryEntry {
  return {
    accountId: row.id,
    employeeId: row.employee_id,
    displayName: trimOrNull(row.display_name) ?? row.employee_id,
    email: row.email,
    department: row.department,
    globalRole: row.global_role,
    status: row.status,
  };
}

export function resolveInitialAdminEmployeeIds(
  env: NodeJS.ProcessEnv = process.env,
): Set<string> {
  const fallback = new Set(["test_admin", "eon"]);
  const raw = env.OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS?.trim();
  if (!raw) {
    return fallback;
  }
  const ids = new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  if (ids.size === 0) {
    return fallback;
  }
  return ids;
}

export function getAccountById(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): AccountRecord | null {
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(
      `SELECT id, external_provider, external_subject, employee_id, email, display_name, department,
              timezone, status, global_role, created_at, updated_at, last_login_at
         FROM accounts
        WHERE id = ?`,
    )
    .get(accountId) as AccountRow | undefined;
  return row ? rowToAccount(row) : null;
}

export function resolveAccountDisplayName(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const account = getAccountById(accountId, env);
  return trimOrNull(account?.displayName) ?? trimOrNull(account?.employeeId) ?? null;
}

export function resolveAccountIdByEmployeeId(
  employeeId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const normalized = trimOrNull(employeeId);
  if (!normalized) {
    return null;
  }
  const { db } = getPlatformClawDatabase(env);
  const direct = db
    .prepare(
      `SELECT id
         FROM accounts
        WHERE employee_id = ?
        LIMIT 1`,
    )
    .get(normalized) as { id?: string } | undefined;
  if (trimOrNull(direct?.id)) {
    return trimOrNull(direct?.id);
  }
  const alias = db
    .prepare(
      `SELECT account_id
         FROM account_aliases
        WHERE alias_type = 'employee_id'
          AND alias_value = ?
        LIMIT 1`,
    )
    .get(normalized) as { account_id?: string } | undefined;
  return trimOrNull(alias?.account_id);
}

export function resolveAccountIdByAlias(params: {
  aliasType: string;
  aliasValue: string;
  env?: NodeJS.ProcessEnv;
}): string | null {
  const env = params.env ?? process.env;
  const aliasType = trimOrNull(params.aliasType);
  const aliasValue = trimOrNull(params.aliasValue);
  if (!aliasType || !aliasValue) {
    return null;
  }
  const { db } = getPlatformClawDatabase(env);
  const alias = db
    .prepare(
      `SELECT account_id
         FROM account_aliases
        WHERE alias_type = ?
          AND alias_value = ?
        LIMIT 1`,
    )
    .get(aliasType, aliasValue) as { account_id?: string } | undefined;
  return trimOrNull(alias?.account_id);
}

export function upsertAccount(params: {
  employeeId: string;
  email?: string | null;
  displayName?: string | null;
  department?: string | null;
  timezone?: string | null;
  externalProvider?: string;
  externalSubject?: string;
  env?: NodeJS.ProcessEnv;
}): AccountRecord {
  const env = params.env ?? process.env;
  const employeeId = trimOrNull(params.employeeId);
  if (!employeeId) {
    throw new Error("employeeId is required");
  }
  const email = trimOrNull(params.email);
  const displayName = trimOrNull(params.displayName);
  const department = trimOrNull(params.department);
  const timezone = trimOrNull(params.timezone);
  const externalProvider = trimOrNull(params.externalProvider) ?? "ldap";
  const externalSubject = trimOrNull(params.externalSubject) ?? employeeId;
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  const existing = getAccountById(employeeId, env);
  const initialRole: AccountGlobalRole = resolveInitialAdminEmployeeIds(env).has(employeeId)
    ? "admin"
    : "member";

  if (!existing) {
    db.prepare(
      `INSERT INTO accounts (
         id, external_provider, external_subject, employee_id, email, display_name, department, timezone,
         status, global_role, created_at, updated_at, last_login_at
       ) VALUES (
         @id, @external_provider, @external_subject, @employee_id, @email, @display_name, @department, @timezone,
         'active', @global_role, @created_at, @updated_at, @last_login_at
       )`,
    ).run({
      id: employeeId,
      external_provider: externalProvider,
      external_subject: externalSubject,
      employee_id: employeeId,
      email,
      display_name: displayName,
      department,
      timezone,
      global_role: initialRole,
      created_at: now,
      updated_at: now,
      last_login_at: now,
    });
  } else {
    db.prepare(
      `UPDATE accounts
          SET external_provider = @external_provider,
              external_subject = @external_subject,
              email = COALESCE(@email, email),
              display_name = COALESCE(@display_name, display_name),
              department = COALESCE(@department, department),
              timezone = COALESCE(@timezone, timezone),
              updated_at = @updated_at,
              last_login_at = @last_login_at
        WHERE id = @id`,
    ).run({
      id: employeeId,
      external_provider: externalProvider,
      external_subject: externalSubject,
      email,
      display_name: displayName,
      department,
      timezone,
      updated_at: now,
      last_login_at: now,
    });
  }

  upsertAccountAlias({
    accountId: employeeId,
    aliasType: "employee_id",
    aliasValue: employeeId,
    env,
  });

  return getAccountById(employeeId, env)!;
}

export function upsertAccountAlias(params: {
  accountId: string;
  aliasType: string;
  aliasValue: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const accountId = trimOrNull(params.accountId);
  const aliasType = trimOrNull(params.aliasType);
  const aliasValue = trimOrNull(params.aliasValue);
  if (!accountId || !aliasType || !aliasValue) {
    return;
  }
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO account_aliases (account_id, alias_type, alias_value, created_at)
     VALUES (@account_id, @alias_type, @alias_value, @created_at)
     ON CONFLICT(alias_type, alias_value) DO UPDATE SET
       account_id = excluded.account_id`,
  ).run({
    account_id: accountId,
    alias_type: aliasType,
    alias_value: aliasValue,
    created_at: now,
  });
}

export function upsertWorkspaceBinding(params: {
  accountId: string;
  agentId: string;
  workspacePath: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = params.env ?? process.env;
  const accountId = trimOrNull(params.accountId);
  const agentId = trimOrNull(params.agentId);
  const workspacePath = trimOrNull(params.workspacePath);
  if (!accountId || !agentId || !workspacePath) {
    throw new Error("accountId, agentId, and workspacePath are required");
  }
  const now = new Date().toISOString();
  const workspaceId = `${accountId}:${agentId}`;
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO workspaces (id, account_id, agent_id, workspace_path, status, created_at, updated_at)
     VALUES (@id, @account_id, @agent_id, @workspace_path, 'active', @created_at, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       workspace_path = excluded.workspace_path,
       updated_at = excluded.updated_at`,
  ).run({
    id: workspaceId,
    account_id: accountId,
    agent_id: agentId,
    workspace_path: workspacePath,
    created_at: now,
    updated_at: now,
  });
  upsertAccountAlias({
    accountId,
    aliasType: "agent_id",
    aliasValue: agentId,
    env,
  });
  return workspaceId;
}

export function appendSessionRecord(params: {
  sessionId?: string;
  accountId: string;
  agentId: string;
  workspaceId: string;
  issuedAt?: string;
  expiresAt?: string | null;
  env?: NodeJS.ProcessEnv;
}): string {
  const env = params.env ?? process.env;
  const now = params.issuedAt ?? new Date().toISOString();
  const sessionId = trimOrNull(params.sessionId) ?? randomUUID();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO sessions (id, account_id, agent_id, workspace_id, issued_at, expires_at, last_seen_at)
     VALUES (@id, @account_id, @agent_id, @workspace_id, @issued_at, @expires_at, @last_seen_at)
     ON CONFLICT(id) DO UPDATE SET
       account_id = excluded.account_id,
       agent_id = excluded.agent_id,
       workspace_id = excluded.workspace_id,
       expires_at = excluded.expires_at,
       last_seen_at = excluded.last_seen_at`,
  ).run({
    id: sessionId,
    account_id: params.accountId,
    agent_id: params.agentId,
    workspace_id: params.workspaceId,
    issued_at: now,
    expires_at: params.expiresAt ?? null,
    last_seen_at: now,
  });
  return sessionId;
}

export function buildAccountSummary(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): AccountSummary | null {
  const account = getAccountById(accountId, env);
  if (!account) {
    return null;
  }
  const { db } = getPlatformClawDatabase(env);
  const groupCountRow = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM group_memberships
        WHERE account_id = ?
          AND scope_type = 'group'`,
    )
    .get(accountId) as { count?: number | bigint } | undefined;
  const partCountRow = db
    .prepare(
      `SELECT COUNT(*) AS count
         FROM group_memberships
        WHERE account_id = ?
          AND scope_type = 'part'`,
    )
    .get(accountId) as { count?: number | bigint } | undefined;
  const topLevelRows = db
    .prepare(
      `SELECT DISTINCT
              CASE
                WHEN gm.scope_type = 'group' THEN g.name
                WHEN gm.scope_type = 'part' THEN parent.name
                ELSE NULL
              END AS name
         FROM group_memberships gm
         JOIN groups g ON g.id = gm.scope_id
         LEFT JOIN groups parent ON parent.id = g.parent_group_id
        WHERE gm.account_id = ?
          AND (
            (gm.scope_type = 'group' AND g.archived_at IS NULL)
            OR (gm.scope_type = 'part' AND parent.archived_at IS NULL)
          )
        ORDER BY name COLLATE NOCASE ASC
        LIMIT 3`,
    )
    .all(accountId) as Array<{ name?: string }> | undefined;
  const leaderScopeRow = db
    .prepare(
      `SELECT 1 AS found
         FROM group_memberships
        WHERE account_id = ?
          AND group_role = 'leader'
        LIMIT 1`,
    )
    .get(accountId) as { found?: number } | undefined;
  const groupCount =
    typeof groupCountRow?.count === "bigint"
      ? Number(groupCountRow.count)
      : (groupCountRow?.count ?? 0);
  const partCount =
    typeof partCountRow?.count === "bigint"
      ? Number(partCountRow.count)
      : (partCountRow?.count ?? 0);
  return {
    accountId: account.id,
    globalRole: account.globalRole,
    groupCount,
    partCount,
    topLevelGroupNames: (topLevelRows ?? [])
      .map((row) => trimOrNull(row.name) ?? "")
      .filter(Boolean),
    hasAdminAccess: account.globalRole === "admin",
    hasLeaderScope: leaderScopeRow?.found === 1,
  };
}

export function resolveAccountTimezone(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return trimOrNull(getAccountById(accountId, env)?.timezone) ?? null;
}

export function listAccountMembershipSummaries(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): AccountMembershipSummary[] {
  const { db } = getPlatformClawDatabase(env);
  const rows = db
    .prepare(
      `SELECT gm.scope_type,
              gm.scope_id,
              gm.group_role,
              g.name AS scope_name,
              g.parent_group_id,
              parent.name AS parent_group_name,
              CASE
                WHEN gm.scope_type = 'group' THEN g.archived_at
                ELSE COALESCE(g.archived_at, parent.archived_at)
              END AS archived_at
         FROM group_memberships gm
         JOIN groups g ON g.id = gm.scope_id
         LEFT JOIN groups parent ON parent.id = g.parent_group_id
        WHERE gm.account_id = ?
        ORDER BY
          CASE gm.scope_type WHEN 'group' THEN 0 ELSE 1 END,
          COALESCE(parent.name, g.name) COLLATE NOCASE ASC,
          g.name COLLATE NOCASE ASC`,
    )
    .all(accountId) as Array<{
      scope_type: "group" | "part";
      scope_id: string;
      group_role: "member" | "leader";
      scope_name: string;
      parent_group_id: string | null;
      parent_group_name: string | null;
      archived_at: string | null;
    }>;
  return rows.map((row) => ({
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    scopeName: row.scope_name,
    parentGroupId: row.parent_group_id,
    parentGroupName: row.parent_group_name,
    groupRole: row.group_role,
    archived: Boolean(trimOrNull(row.archived_at)),
  }));
}

export function searchAccounts(params: {
  query?: string;
  limit?: number;
  env?: NodeJS.ProcessEnv;
}): AccountDirectoryEntry[] {
  const env = params.env ?? process.env;
  const query = trimOrNull(params.query);
  const limit = Math.max(1, Math.min(50, params.limit ?? 12));
  const { db } = getPlatformClawDatabase(env);
  const rows = query
    ? (db
        .prepare(
          `SELECT id, external_provider, external_subject, employee_id, email, display_name, department,
                  timezone, status, global_role, created_at, updated_at, last_login_at
             FROM accounts
            WHERE status = 'active'
              AND (
                employee_id LIKE @query
                OR COALESCE(display_name, '') LIKE @query
                OR COALESCE(email, '') LIKE @query
              )
            ORDER BY COALESCE(display_name, employee_id) COLLATE NOCASE ASC
            LIMIT @limit`,
        )
        .all({
          query: `%${query}%`,
          limit,
        }) as AccountRow[])
    : (db
        .prepare(
          `SELECT id, external_provider, external_subject, employee_id, email, display_name, department,
                  timezone, status, global_role, created_at, updated_at, last_login_at
             FROM accounts
            WHERE status = 'active'
            ORDER BY COALESCE(display_name, employee_id) COLLATE NOCASE ASC
            LIMIT ?`,
        )
        .all(limit) as AccountRow[]);
  return rows.map(toAccountDirectoryEntry);
}

export function listAdminAccounts(params: {
  query?: string;
  env?: NodeJS.ProcessEnv;
}): AdminAccountListEntry[] {
  const env = params.env ?? process.env;
  const query = trimOrNull(params.query);
  const { db } = getPlatformClawDatabase(env);
  const rows = query
    ? (db
        .prepare(
          `SELECT id, external_provider, external_subject, employee_id, email, display_name, department,
                  timezone, status, global_role, created_at, updated_at, last_login_at
             FROM accounts
            WHERE employee_id LIKE @query
               OR COALESCE(display_name, '') LIKE @query
               OR COALESCE(email, '') LIKE @query
            ORDER BY COALESCE(last_login_at, created_at) DESC, employee_id COLLATE NOCASE ASC`,
        )
        .all({ query: `%${query}%` }) as AccountRow[])
    : (db
        .prepare(
          `SELECT id, external_provider, external_subject, employee_id, email, display_name, department,
                  timezone, status, global_role, created_at, updated_at, last_login_at
             FROM accounts
            ORDER BY COALESCE(last_login_at, created_at) DESC, employee_id COLLATE NOCASE ASC`,
        )
        .all() as AccountRow[]);
  return rows.map((row) => ({
    ...toAccountDirectoryEntry(row),
    lastLoginAt: row.last_login_at,
    groups: listAccountMembershipSummaries(row.id, env).map((membership) =>
      membership.scopeType === "group"
        ? membership.scopeName
        : `${membership.parentGroupName ?? "Group"} / ${membership.scopeName}`,
    ),
  }));
}

export function getAdminAccountDetail(
  accountId: string,
  env: NodeJS.ProcessEnv = process.env,
): AdminAccountDetail | null {
  const account = getAccountById(accountId, env);
  if (!account) {
    return null;
  }
  const memberships = listAccountMembershipSummaries(accountId, env);
  return {
    accountId: account.id,
    employeeId: account.employeeId,
    displayName: trimOrNull(account.displayName) ?? account.employeeId,
    email: account.email,
    department: account.department,
    globalRole: account.globalRole,
    status: account.status,
    lastLoginAt: account.lastLoginAt,
    groups: memberships.map((membership) =>
      membership.scopeType === "group"
        ? membership.scopeName
        : `${membership.parentGroupName ?? "Group"} / ${membership.scopeName}`,
    ),
    memberships,
  };
}

function countAdminAccounts(env: NodeJS.ProcessEnv = process.env): number {
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM accounts WHERE global_role = 'admin'`)
    .get() as { count?: number | bigint } | undefined;
  return typeof row?.count === "bigint" ? Number(row.count) : (row?.count ?? 0);
}

export function updateAccountGlobalRole(params: {
  actorAccountId: string;
  targetAccountId: string;
  nextRole: AccountGlobalRole;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const actor = getAccountById(params.actorAccountId, env);
  if (!actor || actor.globalRole !== "admin") {
    throw new Error("only admins can change account roles");
  }
  const target = getAccountById(params.targetAccountId, env);
  if (!target) {
    throw new Error("target account not found");
  }
  if (target.id === actor.id) {
    throw new Error("admins cannot change their own global role");
  }
  if (target.globalRole === params.nextRole) {
    return target;
  }
  if (target.globalRole === "admin" && params.nextRole === "member" && countAdminAccounts(env) <= 1) {
    throw new Error("cannot demote the last admin");
  }
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `UPDATE accounts
        SET global_role = @global_role,
            updated_at = @updated_at
      WHERE id = @id`,
  ).run({
    id: target.id,
    global_role: params.nextRole,
    updated_at: new Date().toISOString(),
  });
  return getAccountById(target.id, env)!;
}
