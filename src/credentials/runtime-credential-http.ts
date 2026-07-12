import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  resolveRuntimeCredential,
  type CredentialRuntimeContext,
} from "./runtime-credential-resolver.js";

type RuntimeCredentialSession = {
  context: CredentialRuntimeContext;
  expiresAtMs: number;
};

export type RuntimeCredentialHttpServer = {
  endpoint: string;
  listenHost: string;
  registerSession: (context: CredentialRuntimeContext, opts?: { ttlMs?: number }) => string;
  revokeSession: (token: string) => void;
  close: () => Promise<void>;
};

export type RuntimeCredentialHttpServerOptions = {
  listenHost?: string;
  endpointHost?: string;
};

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;
const DEFAULT_LISTEN_HOST = "127.0.0.1";

const serverPromises = new Map<string, Promise<RuntimeCredentialHttpServer>>();

// PlatformClaw Phase 3: this loopback server is an internal SDK transport for
// child processes. It is intentionally separate from the browser Gateway API.
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function bearerToken(req: IncomingMessage): string | null {
  const raw = req.headers.authorization;
  if (!raw || Array.isArray(raw)) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() || null;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("request body too large");
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function readDefinitionKey(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("request body must be an object");
  }
  const record = body as Record<string, unknown>;
  for (const forbidden of ["ownerId", "accountId", "roomId", "systemId", "ownerType", "scope"]) {
    if (forbidden in record) {
      throw new Error(`credential owner field "${forbidden}" is not allowed`);
    }
  }
  const raw = typeof record.definitionKey === "string" ? record.definitionKey : record.name;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("definitionKey is required");
  }
  return raw.trim();
}

function pruneSessions(sessions: Map<string, RuntimeCredentialSession>): void {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expiresAtMs <= now) {
      sessions.delete(token);
    }
  }
}

function normalizeHost(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function serverKey(options?: RuntimeCredentialHttpServerOptions): string {
  return normalizeHost(options?.listenHost, DEFAULT_LISTEN_HOST);
}

export function startRuntimeCredentialHttpServer(
  options?: RuntimeCredentialHttpServerOptions,
): Promise<RuntimeCredentialHttpServer> {
  const listenHost = serverKey(options);
  const endpointHost = normalizeHost(options?.endpointHost, listenHost);
  const existing = serverPromises.get(listenHost);
  if (existing) {
    return existing;
  }

  const startingServer = new Promise<RuntimeCredentialHttpServer>((resolve, reject) => {
    const sessions = new Map<string, RuntimeCredentialSession>();
    const server = createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/credentials/get") {
        sendJson(res, 404, { ok: false, error: "not_found" });
        return;
      }

      const token = bearerToken(req);
      if (!token) {
        sendJson(res, 401, { ok: false, error: "unauthorized" });
        return;
      }
      pruneSessions(sessions);
      const session = sessions.get(token);
      if (!session) {
        sendJson(res, 403, { ok: false, error: "forbidden" });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const definitionKey = readDefinitionKey(body);
        const resolved = await resolveRuntimeCredential({ definitionKey }, session.context);
        sendJson(res, 200, {
          ok: true,
          value: resolved.value,
          credential: resolved.credential,
        });
      } catch (err) {
        sendJson(res, 400, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    server.on("error", reject);
    server.listen(0, listenHost, () => {
      const address = server.address() as AddressInfo;
      resolve({
        endpoint: `http://${endpointHost}:${address.port}`,
        listenHost,
        registerSession: (context: CredentialRuntimeContext, opts?: { ttlMs?: number }) => {
          pruneSessions(sessions);
          const token = randomBytes(32).toString("base64url");
          sessions.set(token, {
            context,
            expiresAtMs: Date.now() + (opts?.ttlMs ?? DEFAULT_SESSION_TTL_MS),
          });
          return token;
        },
        revokeSession: (token: string) => {
          sessions.delete(token);
        },
        close: async () => {
          sessions.clear();
          await new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          });
          serverPromises.delete(listenHost);
        },
      });
    });
  }).catch((err) => {
    serverPromises.delete(listenHost);
    throw err;
  });

  serverPromises.set(listenHost, startingServer);
  return startingServer;
}

export async function stopRuntimeCredentialHttpServerForTest(): Promise<void> {
  const pendingServers = [...serverPromises.values()];
  for (const pendingServer of pendingServers) {
    const server = await pendingServer;
    if (server) {
      await server.close();
    }
  }
}
