import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createAsyncLock, writeJsonAtomic } from "../infra/json-files.js";
import { readPlatformClawReleaseIndex } from "../platformclaw-release.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import {
  EMPLOYEE_RELEASE_NOTES_READ_PATH,
  EMPLOYEE_RELEASE_NOTES_STATUS_PATH,
  type EmployeeReleaseNotesStatus,
} from "./employee-ui-contract.js";
import { readEmployeeSession } from "./employee-web-auth.js";

type EmployeeReleaseReadEntry = {
  readVersions: Record<string, string>;
};

type EmployeeReleaseReadStore = {
  version: 1;
  employees: Record<string, EmployeeReleaseReadEntry>;
};

const withReleaseReadStoreLock = createAsyncLock();

function emptyReadStore(): EmployeeReleaseReadStore {
  return { version: 1, employees: Object.create(null) as Record<string, EmployeeReleaseReadEntry> };
}

function parseReadStore(raw: unknown): EmployeeReleaseReadStore {
  if (!raw || typeof raw !== "object" || (raw as { version?: unknown }).version !== 1) {
    throw new Error("invalid release note read state");
  }
  const rawEmployees = (raw as { employees?: unknown }).employees;
  if (!rawEmployees || typeof rawEmployees !== "object" || Array.isArray(rawEmployees)) {
    throw new Error("invalid release note employee read state");
  }
  const employees = Object.create(null) as Record<string, EmployeeReleaseReadEntry>;
  for (const [employeeId, candidate] of Object.entries(rawEmployees)) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }
    const rawReadVersions = (candidate as { readVersions?: unknown }).readVersions;
    if (rawReadVersions && typeof rawReadVersions === "object" && !Array.isArray(rawReadVersions)) {
      const readVersions = Object.create(null) as Record<string, string>;
      for (const [version, rawReadAt] of Object.entries(rawReadVersions)) {
        const readAt = normalizeOptionalString(rawReadAt);
        if (readAt) {
          Object.defineProperty(readVersions, version, {
            value: readAt,
            enumerable: true,
            configurable: true,
            writable: true,
          });
        }
      }
      Object.defineProperty(employees, employeeId, {
        value: { readVersions },
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return { version: 1, employees };
}

export function resolveEmployeeReleaseReadStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "platformclaw", "release-notes", "read-state.json");
}

async function readReleaseReadStore(filePath: string): Promise<EmployeeReleaseReadStore> {
  try {
    return parseReadStore(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyReadStore();
    }
    throw error;
  }
}

function requireLatestVersion(): string {
  const latestVersion = readPlatformClawReleaseIndex()?.latest;
  if (!latestVersion) {
    throw new Error("PlatformClaw release index unavailable");
  }
  return latestVersion;
}

export async function readEmployeeReleaseNotesStatus(
  employeeId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EmployeeReleaseNotesStatus> {
  const latestVersion = requireLatestVersion();
  const store = await readReleaseReadStore(resolveEmployeeReleaseReadStatePath(env));
  const readVersion = store.employees[employeeId]?.readVersions[latestVersion]
    ? latestVersion
    : null;
  return {
    latestVersion,
    readVersion,
    shouldAutoOpen: readVersion !== latestVersion,
  };
}

export async function markEmployeeReleaseNotesRead(
  employeeId: string,
  version: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EmployeeReleaseNotesStatus> {
  return withReleaseReadStoreLock(async () => {
    const latestVersion = requireLatestVersion();
    if (version !== latestVersion) {
      throw new Error("only the latest PlatformClaw release can be marked as read");
    }
    const filePath = resolveEmployeeReleaseReadStatePath(env);
    const store = await readReleaseReadStore(filePath);
    const readVersions =
      store.employees[employeeId]?.readVersions ?? (Object.create(null) as Record<string, string>);
    Object.defineProperty(readVersions, version, {
      value: new Date().toISOString(),
      enumerable: true,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(store.employees, employeeId, {
      value: { readVersions },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    await writeJsonAtomic(filePath, store, {
      mode: 0o600,
      ensureDirMode: 0o700,
      trailingNewline: true,
    });
    return { latestVersion, readVersion: version, shouldAutoOpen: false };
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function handleEmployeeReleaseNotesHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  readJsonBody: (
    req: IncomingMessage,
    maxBytes: number,
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  const isStatus = url.pathname === EMPLOYEE_RELEASE_NOTES_STATUS_PATH;
  const isRead = url.pathname === EMPLOYEE_RELEASE_NOTES_READ_PATH;
  if (!isStatus && !isRead) {
    return false;
  }

  const session = readEmployeeSession(params.req);
  if (!session) {
    sendJson(params.res, 401, { error: "employee sign-in required" });
    return true;
  }

  try {
    if (isStatus) {
      const method = (params.req.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        params.res.setHeader("Allow", "GET");
        sendJson(params.res, 405, { error: "Method Not Allowed" });
        return true;
      }
      sendJson(params.res, 200, await readEmployeeReleaseNotesStatus(session.employeeId));
      return true;
    }

    const method = (params.req.method ?? "POST").toUpperCase();
    if (method !== "POST") {
      params.res.setHeader("Allow", "POST");
      sendJson(params.res, 405, { error: "Method Not Allowed" });
      return true;
    }
    const parsedBody = await params.readJsonBody(params.req, 4 * 1024);
    const version =
      parsedBody.ok && parsedBody.value && typeof parsedBody.value === "object"
        ? normalizeOptionalString((parsedBody.value as { version?: unknown }).version)
        : null;
    if (!version) {
      sendJson(params.res, 400, {
        error: parsedBody.ok ? "version is required" : parsedBody.error,
      });
      return true;
    }
    sendJson(params.res, 200, await markEmployeeReleaseNotesRead(session.employeeId, version));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "release note request failed";
    const status = message.startsWith("only the latest") ? 409 : 500;
    sendJson(params.res, status, { error: message });
    return true;
  }
}
