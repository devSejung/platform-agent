import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { isBlockedHostnameOrIp } from "../infra/net/ssrf.js";
import { getPlatformClawDatabase } from "./db.js";

export const USER_MCP_TRANSPORTS = ["stdio", "streamable-http", "sse"] as const;
export type UserMcpTransport = (typeof USER_MCP_TRANSPORTS)[number];
export type UserMcpStatus =
  | "unknown"
  | "starting"
  | "connecting"
  | "connected"
  | "disabled"
  | "error"
  | "stopped"
  | "blocked_by_policy";

export type UserMcpToolPolicy =
  | { mode: "all"; tools: [] }
  | { mode: "allowlist" | "denylist"; tools: string[] };

export type UserMcpRemoteConfig = { url: string };
export type UserMcpStdioConfig = {
  templateId: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type UserMcpServer = {
  id: string;
  ownerUserId: string;
  name: string;
  description?: string;
  transport: UserMcpTransport;
  config: UserMcpRemoteConfig | UserMcpStdioConfig;
  enabled: boolean;
  forcedDisabled: boolean;
  timeoutMs: number;
  toolPolicy: UserMcpToolPolicy;
  status: UserMcpStatus;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  toolCount: number;
  createdAt: string;
  updatedAt: string;
};

export type UserMcpStdioTemplate = {
  id: string;
  label: string;
  command: string;
  allowedArgs?: string[];
  allowedCwdRoots?: string[];
  allowedEnv?: string[];
};

export type UserMcpAdminPolicy = {
  enabled: boolean;
  allowedTransports: UserMcpTransport[];
  maxServersPerUser: number;
  maxTimeoutMs: number;
  allowPrivateNetwork: boolean;
  allowedHostnames: string[];
  stdioTemplates: UserMcpStdioTemplate[];
};

const DEFAULT_POLICY: UserMcpAdminPolicy = {
  enabled: true,
  allowedTransports: ["streamable-http", "sse", "stdio"],
  maxServersPerUser: 10,
  maxTimeoutMs: 30_000,
  allowPrivateNetwork: false,
  allowedHostnames: [],
  // No user runner/template exists yet. Empty means stdio is safely blocked.
  stdioTemplates: [],
};

const toolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const toolPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all"), tools: z.array(z.never()).optional().default([]) }),
  z.object({ mode: z.enum(["allowlist", "denylist"]), tools: z.array(toolNameSchema).max(256) }),
]);
const remoteConfigSchema = z.object({ url: z.string().trim().min(1).max(2048) }).strict();
const stdioConfigSchema = z
  .object({
    templateId: z.string().trim().min(1).max(100),
    args: z.array(z.string().max(500)).max(64).optional(),
    cwd: z.string().trim().max(1000).optional(),
    env: z.record(z.string().max(100), z.string().max(2000)).optional(),
  })
  .strict();

const serverInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).optional(),
    transport: z.enum(USER_MCP_TRANSPORTS),
    config: z.record(z.string(), z.unknown()),
    enabled: z.boolean().optional().default(true),
    timeoutMs: z.number().int().min(1000).optional().default(30_000),
    toolPolicy: toolPolicySchema.optional().default({ mode: "all", tools: [] }),
  })
  .strict();

const stdioTemplateSchema = z.object({
  id: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(100),
  command: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .refine((command) => {
      const executable = path.basename(command).toLowerCase();
      return ![
        "bash",
        "sh",
        "cmd",
        "cmd.exe",
        "powershell",
        "powershell.exe",
        "pwsh",
        "pwsh.exe",
      ].includes(executable);
    }, "shell wrapper commands are not allowed"),
  allowedArgs: z.array(z.string().max(500)).max(128).optional(),
  allowedCwdRoots: z.array(z.string().trim().min(1).max(1000)).max(32).optional(),
  allowedEnv: z.array(z.string().trim().min(1).max(100)).max(64).optional(),
});

const adminPolicySchema = z.object({
  enabled: z.boolean(),
  allowedTransports: z.array(z.enum(USER_MCP_TRANSPORTS)),
  maxServersPerUser: z.number().int().min(0).max(100),
  maxTimeoutMs: z.number().int().min(1000).max(300_000),
  allowPrivateNetwork: z.boolean(),
  allowedHostnames: z.array(z.string().trim().min(1).max(255)).max(100),
  stdioTemplates: z.array(stdioTemplateSchema).max(50),
});

type UserMcpRow = {
  id: string;
  owner_account_id: string;
  name: string;
  description: string | null;
  transport: UserMcpTransport;
  config_json: string;
  enabled: number;
  forced_disabled: number;
  timeout_ms: number;
  tool_policy_json: string;
  status: UserMcpStatus;
  last_error_code: string | null;
  last_error_message: string | null;
  last_checked_at: string | null;
  last_success_at: string | null;
  tool_count: number;
  created_at: string;
  updated_at: string;
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToServer(row: UserMcpRow): UserMcpServer {
  return {
    id: row.id,
    ownerUserId: row.owner_account_id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    transport: row.transport,
    config: parseJson<UserMcpRemoteConfig | UserMcpStdioConfig>(row.config_json, { url: "" }),
    enabled: row.enabled === 1,
    forcedDisabled: row.forced_disabled === 1,
    timeoutMs: row.timeout_ms,
    toolPolicy: parseJson<UserMcpToolPolicy>(row.tool_policy_json, { mode: "all", tools: [] }),
    status: row.status,
    ...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
    ...(row.last_error_message ? { lastErrorMessage: row.last_error_message } : {}),
    ...(row.last_checked_at ? { lastCheckedAt: row.last_checked_at } : {}),
    ...(row.last_success_at ? { lastSuccessAt: row.last_success_at } : {}),
    toolCount: row.tool_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isSecretEnvName(name: string): boolean {
  return /(TOKEN|SECRET|PASSWORD|API_?KEY|AUTHORIZATION|COOKIE|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIAL)/i.test(
    name,
  );
}

function assertRemoteUrl(url: string, policy: UserMcpAdminPolicy): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid_url");
  }
  if (parsed.username || parsed.password) {
    throw new Error("invalid_url");
  }
  for (const key of parsed.searchParams.keys()) {
    if (isSecretEnvName(key)) {
      throw new Error("invalid_url");
    }
  }
  const hostname = parsed.hostname.toLowerCase();
  const explicitlyAllowed = policy.allowedHostnames.some(
    (entry) => entry.toLowerCase() === hostname,
  );
  if (!policy.allowPrivateNetwork && !explicitlyAllowed && isBlockedHostnameOrIp(hostname)) {
    throw new Error("blocked_by_policy");
  }
  return parsed.toString();
}

function normalizeToolPolicy(policy: z.infer<typeof toolPolicySchema>): UserMcpToolPolicy {
  if (policy.mode === "all") {
    return { mode: "all", tools: [] };
  }
  return { mode: policy.mode, tools: [...new Set(policy.tools)].toSorted() };
}

function validateStdioConfig(
  input: z.infer<typeof stdioConfigSchema>,
  policy: UserMcpAdminPolicy,
): UserMcpStdioConfig {
  const template = policy.stdioTemplates.find((entry) => entry.id === input.templateId);
  if (!template) {
    throw new Error("command_not_allowed");
  }
  const args = input.args ?? [];
  const allowedArgs = new Set(template.allowedArgs ?? []);
  if (args.some((arg) => !allowedArgs.has(arg))) {
    throw new Error("invalid_args");
  }
  const env = input.env ?? {};
  const allowedEnv = new Set(template.allowedEnv ?? []);
  if (Object.keys(env).some((key) => isSecretEnvName(key))) {
    throw new Error("secret_env_not_supported");
  }
  if (Object.keys(env).some((key) => !allowedEnv.has(key))) {
    throw new Error("invalid_env");
  }
  let cwd: string | undefined;
  if (input.cwd) {
    const resolved = path.resolve(input.cwd);
    const allowed = (template.allowedCwdRoots ?? []).some((root) => {
      const resolvedRoot = path.resolve(root);
      return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
    });
    if (!allowed) {
      throw new Error("invalid_cwd");
    }
    cwd = resolved;
  }
  return {
    templateId: input.templateId,
    ...(args.length ? { args } : {}),
    ...(cwd ? { cwd } : {}),
    ...(Object.keys(env).length ? { env } : {}),
  };
}

function normalizeServerInput(input: unknown, policy: UserMcpAdminPolicy) {
  const parsed = serverInputSchema.parse(input);
  if (!policy.enabled || !policy.allowedTransports.includes(parsed.transport)) {
    throw new Error("blocked_by_policy");
  }
  if (parsed.timeoutMs > policy.maxTimeoutMs) {
    throw new Error("connection_timeout");
  }
  const config =
    parsed.transport === "stdio"
      ? validateStdioConfig(stdioConfigSchema.parse(parsed.config), policy)
      : { url: assertRemoteUrl(remoteConfigSchema.parse(parsed.config).url, policy) };
  return { ...parsed, config, toolPolicy: normalizeToolPolicy(parsed.toolPolicy) };
}

export function getUserMcpAdminPolicy(env: NodeJS.ProcessEnv = process.env): UserMcpAdminPolicy {
  const { db } = getPlatformClawDatabase(env);
  const row = db.prepare(`SELECT policy_json FROM user_mcp_policy WHERE id = 1`).get() as
    | { policy_json?: string }
    | undefined;
  if (!row?.policy_json) {
    return structuredClone(DEFAULT_POLICY);
  }
  const parsed = adminPolicySchema.safeParse(parseJson(row.policy_json, DEFAULT_POLICY));
  return parsed.success ? parsed.data : structuredClone(DEFAULT_POLICY);
}

export function setUserMcpAdminPolicy(params: {
  actorUserId: string;
  policy: unknown;
  env?: NodeJS.ProcessEnv;
}): UserMcpAdminPolicy {
  const env = params.env ?? process.env;
  const policy = adminPolicySchema.parse(params.policy);
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `INSERT INTO user_mcp_policy (id, policy_json, updated_by_account_id, updated_at)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET policy_json=excluded.policy_json,
       updated_by_account_id=excluded.updated_by_account_id, updated_at=excluded.updated_at`,
  ).run(JSON.stringify(policy), params.actorUserId, now);
  recordAudit({
    actorUserId: params.actorUserId,
    eventType: "user_mcp.policy_updated",
    targetId: "1",
    env,
  });
  return policy;
}

export function listUserMcpServers(ownerUserId: string, env = process.env): UserMcpServer[] {
  const { db } = getPlatformClawDatabase(env);
  const rows = db
    .prepare(
      `SELECT * FROM user_mcp_servers WHERE owner_account_id = ? ORDER BY name COLLATE NOCASE`,
    )
    .all(ownerUserId) as UserMcpRow[];
  return rows.map(rowToServer);
}

export function getUserMcpServer(
  ownerUserId: string,
  serverId: string,
  env = process.env,
): UserMcpServer | null {
  const { db } = getPlatformClawDatabase(env);
  const row = db
    .prepare(`SELECT * FROM user_mcp_servers WHERE id = ? AND owner_account_id = ?`)
    .get(serverId, ownerUserId) as UserMcpRow | undefined;
  return row ? rowToServer(row) : null;
}

export function createUserMcpServer(params: {
  ownerUserId: string;
  input: unknown;
  env?: NodeJS.ProcessEnv;
}): UserMcpServer {
  const env = params.env ?? process.env;
  const policy = getUserMcpAdminPolicy(env);
  const input = normalizeServerInput(params.input, policy);
  const { db } = getPlatformClawDatabase(env);
  const count = db
    .prepare(`SELECT COUNT(*) AS count FROM user_mcp_servers WHERE owner_account_id = ?`)
    .get(params.ownerUserId) as { count: number };
  if (count.count >= policy.maxServersPerUser) {
    throw new Error("server_limit_reached");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_mcp_servers
      (id, owner_account_id, name, description, transport, config_json, enabled, timeout_ms,
       tool_policy_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.ownerUserId,
    input.name,
    input.description ?? null,
    input.transport,
    JSON.stringify(input.config),
    input.enabled ? 1 : 0,
    input.timeoutMs,
    JSON.stringify(input.toolPolicy),
    input.enabled ? "unknown" : "disabled",
    now,
    now,
  );
  recordAudit({
    actorUserId: params.ownerUserId,
    eventType: "user_mcp.created",
    targetId: id,
    env,
  });
  return getUserMcpServer(params.ownerUserId, id, env)!;
}

export function updateUserMcpServer(params: {
  ownerUserId: string;
  serverId: string;
  input: unknown;
  env?: NodeJS.ProcessEnv;
}): UserMcpServer | null {
  const env = params.env ?? process.env;
  const existing = getUserMcpServer(params.ownerUserId, params.serverId, env);
  if (!existing) {
    return null;
  }
  const merged = {
    name: existing.name,
    description: existing.description,
    transport: existing.transport,
    config: existing.config,
    enabled: existing.enabled,
    timeoutMs: existing.timeoutMs,
    toolPolicy: existing.toolPolicy,
    ...(params.input && typeof params.input === "object" ? params.input : {}),
  };
  const input = normalizeServerInput(merged, getUserMcpAdminPolicy(env));
  const now = new Date().toISOString();
  const { db } = getPlatformClawDatabase(env);
  db.prepare(
    `UPDATE user_mcp_servers SET name=?, description=?, transport=?, config_json=?, enabled=?,
       timeout_ms=?, tool_policy_json=?, status=?, last_error_code=NULL, last_error_message=NULL,
       updated_at=? WHERE id=? AND owner_account_id=?`,
  ).run(
    input.name,
    input.description ?? null,
    input.transport,
    JSON.stringify(input.config),
    input.enabled ? 1 : 0,
    input.timeoutMs,
    JSON.stringify(input.toolPolicy),
    input.enabled ? "unknown" : "disabled",
    now,
    params.serverId,
    params.ownerUserId,
  );
  recordAudit({
    actorUserId: params.ownerUserId,
    eventType: "user_mcp.updated",
    targetId: params.serverId,
    env,
  });
  return getUserMcpServer(params.ownerUserId, params.serverId, env);
}

export function deleteUserMcpServer(
  ownerUserId: string,
  serverId: string,
  env = process.env,
): boolean {
  const { db } = getPlatformClawDatabase(env);
  const result = db
    .prepare(`DELETE FROM user_mcp_servers WHERE id = ? AND owner_account_id = ?`)
    .run(serverId, ownerUserId);
  if (result.changes > 0) {
    recordAudit({
      actorUserId: ownerUserId,
      eventType: "user_mcp.deleted",
      targetId: serverId,
      env,
    });
  }
  return result.changes > 0;
}

export type AdminUserMcpSummary = {
  id: string;
  ownerUserId: string;
  name: string;
  transport: UserMcpTransport;
  targetSummary: string;
  enabled: boolean;
  forcedDisabled: boolean;
  status: UserMcpStatus;
  policyViolation: boolean;
};

export function listAdminUserMcpServers(env = process.env): AdminUserMcpSummary[] {
  const policy = getUserMcpAdminPolicy(env);
  const rows = getPlatformClawDatabase(env)
    .db.prepare(`SELECT * FROM user_mcp_servers ORDER BY owner_account_id, name COLLATE NOCASE`)
    .all() as UserMcpRow[];
  return rows.map((row) => {
    const server = rowToServer(row);
    const targetSummary =
      server.transport === "stdio"
        ? (server.config as UserMcpStdioConfig).templateId
        : new URL((server.config as UserMcpRemoteConfig).url).host;
    return {
      id: server.id,
      ownerUserId: server.ownerUserId,
      name: server.name,
      transport: server.transport,
      targetSummary,
      enabled: server.enabled,
      forcedDisabled: server.forcedDisabled,
      status: server.status,
      policyViolation: !policy.enabled || !policy.allowedTransports.includes(server.transport),
    };
  });
}

export function setUserMcpForcedDisabled(params: {
  actorUserId: string;
  serverId: string;
  forcedDisabled: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = params.env ?? process.env;
  const result = getPlatformClawDatabase(env)
    .db.prepare(`UPDATE user_mcp_servers SET forced_disabled=?, status=?, updated_at=? WHERE id=?`)
    .run(
      params.forcedDisabled ? 1 : 0,
      params.forcedDisabled ? "blocked_by_policy" : "unknown",
      new Date().toISOString(),
      params.serverId,
    );
  if (result.changes > 0) {
    recordAudit({
      actorUserId: params.actorUserId,
      eventType: params.forcedDisabled ? "user_mcp.force_disabled" : "user_mcp.force_enabled",
      targetId: params.serverId,
      env,
    });
  }
  return result.changes > 0;
}

export function updateUserMcpStatus(params: {
  ownerUserId: string;
  serverId: string;
  status: UserMcpStatus;
  errorCode?: string;
  errorMessage?: string;
  toolCount?: number;
  success?: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const now = new Date().toISOString();
  getPlatformClawDatabase(env)
    .db.prepare(
      `UPDATE user_mcp_servers SET status=?, last_error_code=?, last_error_message=?,
       last_checked_at=?, last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END,
       tool_count=COALESCE(?, tool_count) WHERE id=? AND owner_account_id=?`,
    )
    .run(
      params.status,
      params.errorCode ?? null,
      params.errorMessage?.slice(0, 500) ?? null,
      now,
      params.success ? 1 : 0,
      now,
      params.toolCount ?? null,
      params.serverId,
      params.ownerUserId,
    );
}

export function isToolAllowed(policy: UserMcpToolPolicy, toolName: string): boolean {
  if (policy.mode === "all") {
    return true;
  }
  const listed = policy.tools.includes(toolName);
  return policy.mode === "allowlist" ? listed : !listed;
}

export function resolveUserMcpRuntimeServers(ownerUserId: string, env = process.env) {
  const policy = getUserMcpAdminPolicy(env);
  if (!policy.enabled) {
    return {};
  }
  return Object.fromEntries(
    listUserMcpServers(ownerUserId, env)
      .filter(
        (server) =>
          server.enabled &&
          !server.forcedDisabled &&
          policy.allowedTransports.includes(server.transport) &&
          (server.transport !== "stdio" || policy.stdioTemplates.length > 0),
      )
      .map((server) => {
        const config =
          server.transport === "stdio"
            ? (() => {
                const stored = server.config as UserMcpStdioConfig;
                const template = policy.stdioTemplates.find(
                  (entry) => entry.id === stored.templateId,
                )!;
                return {
                  command: template.command,
                  args: stored.args,
                  cwd: stored.cwd,
                  env: stored.env,
                };
              })()
            : {
                url: (server.config as UserMcpRemoteConfig).url,
                transport: server.transport,
              };
        return [
          `user_${server.id.replaceAll("-", "_")}`,
          {
            ...config,
            connectionTimeoutMs: server.timeoutMs,
            __platformclawUserMcp: {
              ownerUserId,
              serverId: server.id,
              toolPolicy: server.toolPolicy,
            },
          },
        ];
      }),
  );
}

export function authorizeUserMcpToolCall(params: {
  ownerUserId: string;
  serverId: string;
  toolName: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const env = params.env ?? process.env;
  const server = getUserMcpServer(params.ownerUserId, params.serverId, env);
  const policy = getUserMcpAdminPolicy(env);
  return Boolean(
    server &&
    policy.enabled &&
    policy.allowedTransports.includes(server.transport) &&
    server.timeoutMs <= policy.maxTimeoutMs &&
    (server.transport !== "stdio" ||
      policy.stdioTemplates.some(
        (template) => template.id === (server.config as UserMcpStdioConfig).templateId,
      )) &&
    server.enabled &&
    !server.forcedDisabled &&
    isToolAllowed(server.toolPolicy, params.toolName),
  );
}

export type UserMcpAuditEvent = {
  id: string;
  actorUserId: string;
  eventType: string;
  targetId: string;
  createdAt: string;
};

export function listUserMcpAuditEvents(env = process.env, limit = 100): UserMcpAuditEvent[] {
  const rows = getPlatformClawDatabase(env)
    .db.prepare(
      `SELECT id, actor_account_id, event_type, target_id, created_at
       FROM audit_events WHERE event_type LIKE 'user_mcp.%'
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(Math.max(1, Math.min(limit, 500))) as Array<{
    id: string;
    actor_account_id: string;
    event_type: string;
    target_id: string;
    created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    actorUserId: row.actor_account_id,
    eventType: row.event_type,
    targetId: row.target_id,
    createdAt: row.created_at,
  }));
}

export function recordUserMcpAuditEvent(params: {
  actorUserId: string;
  eventType: "connection_test" | "tools_refreshed";
  targetId: string;
  env?: NodeJS.ProcessEnv;
}) {
  recordAudit({
    actorUserId: params.actorUserId,
    eventType: `user_mcp.${params.eventType}`,
    targetId: params.targetId,
    env: params.env ?? process.env,
  });
}

function recordAudit(params: {
  actorUserId: string;
  eventType: string;
  targetId: string;
  env: NodeJS.ProcessEnv;
}) {
  getPlatformClawDatabase(params.env)
    .db.prepare(
      `INSERT INTO audit_events
      (id, actor_account_id, event_type, target_type, target_id, payload_json, created_at)
     VALUES (?, ?, ?, 'user_mcp_server', ?, NULL, ?)`,
    )
    .run(
      randomUUID(),
      params.actorUserId,
      params.eventType,
      params.targetId,
      new Date().toISOString(),
    );
}
