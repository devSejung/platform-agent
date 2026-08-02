import type { IncomingMessage, ServerResponse } from "node:http";
import { isAdminAccount } from "../accounts/group-store.js";
import {
  createUserMcpServer,
  deleteUserMcpServer,
  getUserMcpAdminPolicy,
  getUserMcpServer,
  listUserMcpServers,
  listAdminUserMcpServers,
  listUserMcpAuditEvents,
  recordUserMcpAuditEvent,
  setUserMcpForcedDisabled,
  setUserMcpAdminPolicy,
  updateUserMcpServer,
  updateUserMcpStatus,
} from "../accounts/user-mcp-store.js";
import { createSessionMcpRuntime } from "../agents/pi-bundle-mcp-tools.js";
import { disposeUserMcpRuntimes } from "../agents/pi-bundle-mcp-tools.js";
import { readEmployeeSession } from "./employee-web-auth.js";
import {
  ADMIN_MCP_POLICY_API_PATH,
  ADMIN_MCP_AUDIT_API_PATH,
  ADMIN_MCP_SERVERS_API_PATH,
  USER_MCP_API_PATH,
} from "./user-mcp-contract.js";

const MAX_JSON_BYTES = 128 * 1024;

type JsonBodyReader = (
  req: IncomingMessage,
  maxBytes: number,
) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function parseUserPath(pathname: string): { id?: string; action?: string } | null {
  if (pathname === USER_MCP_API_PATH) {
    return {};
  }
  if (!pathname.startsWith(`${USER_MCP_API_PATH}/`)) {
    return null;
  }
  const parts = pathname
    .slice(USER_MCP_API_PATH.length + 1)
    .split("/")
    .filter(Boolean);
  if (parts.length < 1 || parts.length > 2) {
    return null;
  }
  return { id: decodeURIComponent(parts[0]), action: parts[1] };
}

async function readBody(req: IncomingMessage, readJsonBody: JsonBodyReader) {
  const parsed = await readJsonBody(req, MAX_JSON_BYTES);
  if (!parsed.ok) {
    throw new Error("invalid_config");
  }
  return parsed.value;
}

async function testConnection(ownerUserId: string, agentId: string, serverId: string) {
  const server = getUserMcpServer(ownerUserId, serverId);
  if (!server) {
    return null;
  }
  if (!server.enabled || server.forcedDisabled) {
    throw new Error("server_disabled");
  }
  const runtime = createSessionMcpRuntime({
    sessionId: `user-mcp-test:${ownerUserId}:${serverId}:${Date.now()}`,
    workspaceDir: process.cwd(),
    userScope: { ownerUserId, agentId },
  });
  try {
    const catalog = await runtime.getCatalog();
    const serverKey = `user_${serverId.replaceAll("-", "_")}`;
    const tools = catalog.tools
      .filter((tool) => tool.serverName === serverKey)
      .map((tool) => ({ name: tool.toolName, title: tool.title, description: tool.description }));
    if (!catalog.servers[serverKey]) {
      throw new Error("mcp_handshake_failed");
    }
    updateUserMcpStatus({
      ownerUserId,
      serverId,
      status: "connected",
      toolCount: tools.length,
      success: true,
    });
    return { server: getUserMcpServer(ownerUserId, serverId), tools };
  } finally {
    await runtime.dispose();
  }
}

export async function handleEmployeeUserMcpHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  readJsonBody: JsonBodyReader;
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  const userPath = parseUserPath(url.pathname);
  const isAdminPolicy = url.pathname === ADMIN_MCP_POLICY_API_PATH;
  const isAdminAudit = url.pathname === ADMIN_MCP_AUDIT_API_PATH;
  const adminServerId = url.pathname.startsWith(`${ADMIN_MCP_SERVERS_API_PATH}/`)
    ? decodeURIComponent(url.pathname.slice(ADMIN_MCP_SERVERS_API_PATH.length + 1))
    : undefined;
  const isAdminServers = url.pathname === ADMIN_MCP_SERVERS_API_PATH || Boolean(adminServerId);
  if (!userPath && !isAdminPolicy && !isAdminServers && !isAdminAudit) {
    return false;
  }
  const session = readEmployeeSession(params.req);
  if (!session?.employeeId?.trim()) {
    sendJson(params.res, 401, { ok: false, error: "Employee sign-in required." });
    return true;
  }
  const ownerUserId = session.employeeId.trim();
  const method = (params.req.method ?? "GET").toUpperCase();
  try {
    if (isAdminPolicy || isAdminServers || isAdminAudit) {
      if (!isAdminAccount(ownerUserId)) {
        sendJson(params.res, 403, { ok: false, error: "admin access required" });
        return true;
      }
      if (isAdminServers && method === "GET" && !adminServerId) {
        sendJson(params.res, 200, { ok: true, servers: listAdminUserMcpServers() });
        return true;
      }
      if (isAdminAudit && method === "GET") {
        sendJson(params.res, 200, { ok: true, events: listUserMcpAuditEvents() });
        return true;
      }
      if (isAdminServers && method === "PATCH" && adminServerId) {
        const target = listAdminUserMcpServers().find((server) => server.id === adminServerId);
        const body = await readBody(params.req, params.readJsonBody);
        const forcedDisabled =
          body &&
          typeof body === "object" &&
          typeof (body as { forcedDisabled?: unknown }).forcedDisabled === "boolean"
            ? (body as { forcedDisabled: boolean }).forcedDisabled
            : null;
        if (forcedDisabled === null) {
          throw new Error("invalid_config");
        }
        const changed = setUserMcpForcedDisabled({
          actorUserId: ownerUserId,
          serverId: adminServerId,
          forcedDisabled,
        });
        if (changed && target) {
          await disposeUserMcpRuntimes(target.ownerUserId);
        }
        sendJson(params.res, changed ? 200 : 404, { ok: changed });
        return true;
      }
      if (isAdminPolicy && method === "GET") {
        sendJson(params.res, 200, { ok: true, policy: getUserMcpAdminPolicy() });
        return true;
      }
      if (isAdminPolicy && method === "PUT") {
        const owners = [...new Set(listAdminUserMcpServers().map((server) => server.ownerUserId))];
        const policy = setUserMcpAdminPolicy({
          actorUserId: ownerUserId,
          policy: await readBody(params.req, params.readJsonBody),
        });
        await Promise.allSettled(owners.map((owner) => disposeUserMcpRuntimes(owner)));
        sendJson(params.res, 200, { ok: true, policy });
        return true;
      }
      params.res.setHeader("Allow", "GET, PUT");
      sendJson(params.res, 405, { ok: false, error: "Method Not Allowed" });
      return true;
    }

    const { id, action } = userPath!;
    if (!id) {
      if (method === "GET") {
        sendJson(params.res, 200, {
          ok: true,
          servers: listUserMcpServers(ownerUserId),
          policy: getUserMcpAdminPolicy(),
        });
        return true;
      }
      if (method === "POST") {
        const server = createUserMcpServer({
          ownerUserId,
          input: await readBody(params.req, params.readJsonBody),
        });
        await disposeUserMcpRuntimes(ownerUserId);
        sendJson(params.res, 201, { ok: true, server });
        return true;
      }
    } else if (!action) {
      if (method === "GET") {
        const server = getUserMcpServer(ownerUserId, id);
        sendJson(params.res, server ? 200 : 404, { ok: Boolean(server), server });
        return true;
      }
      if (method === "PATCH") {
        const server = updateUserMcpServer({
          ownerUserId,
          serverId: id,
          input: await readBody(params.req, params.readJsonBody),
        });
        if (!server) {
          sendJson(params.res, 404, { ok: false, error: "not_found" });
          return true;
        }
        await disposeUserMcpRuntimes(ownerUserId);
        sendJson(params.res, 200, { ok: true, server });
        return true;
      }
      if (method === "DELETE") {
        const deleted = deleteUserMcpServer(ownerUserId, id);
        if (deleted) {
          await disposeUserMcpRuntimes(ownerUserId);
        }
        sendJson(params.res, deleted ? 200 : 404, { ok: deleted });
        return true;
      }
    } else if (["test", "refresh-tools", "tools"].includes(action)) {
      const isRead = action === "tools";
      if ((isRead && method !== "GET") || (!isRead && method !== "POST")) {
        sendJson(params.res, 405, { ok: false, error: "Method Not Allowed" });
        return true;
      }
      const result = await testConnection(ownerUserId, session.agentId, id);
      if (!result) {
        sendJson(params.res, 404, { ok: false, error: "not_found" });
        return true;
      }
      recordUserMcpAuditEvent({
        actorUserId: ownerUserId,
        eventType: action === "test" ? "connection_test" : "tools_refreshed",
        targetId: id,
      });
      sendJson(params.res, 200, { ok: true, ...result });
      return true;
    }
    sendJson(params.res, 405, { ok: false, error: "Method Not Allowed" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_config";
    if (userPath?.id) {
      updateUserMcpStatus({
        ownerUserId,
        serverId: userPath.id,
        status: code === "blocked_by_policy" ? "blocked_by_policy" : "error",
        errorCode: code,
        errorMessage: code,
      });
    }
    sendJson(params.res, 400, { ok: false, error: code });
  }
  return true;
}
