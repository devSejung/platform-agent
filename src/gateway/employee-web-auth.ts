import type { IncomingMessage, ServerResponse } from "node:http";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { ensureAgentWorkspace, upsertWorkspaceUserProfile } from "../agents/workspace.js";
import type { OpenClawConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import {
  EMPLOYEE_AUTH_ENV_SECRET,
  signEmployeeSessionToken,
  signEmployeeBootstrapToken,
  verifyEmployeeBootstrapToken,
  verifyEmployeeSessionToken,
  type EmployeeSessionPayload,
} from "./employee-auth.js";
import {
  EMPLOYEE_BOOTSTRAP_PATH,
  EMPLOYEE_ADSSO_PATH,
  EMPLOYEE_LOGIN_PATH,
  EMPLOYEE_LOGOUT_PATH,
  type EmployeeUiLoginNotice,
  type EmployeeUiLoginSuccessResponse,
  type EmployeeUiBootstrapAuthenticatedResponse,
  type EmployeeUiBootstrapUnauthenticatedResponse,
} from "./employee-ui-contract.js";
import { buildAgentMainSessionKey, normalizeAgentId } from "../routing/session-key.js";
import { upsertEmployeeActivationRecord } from "./employee-activation.js";
import { resolveEmployeeUiSurfaceConfig } from "./employee-ui-surface-config.js";

const EMPLOYEE_SESSION_COOKIE = "openclaw_employee_session";
const EMPLOYEE_LOGIN_URL_ENV = "OPENCLAW_EMPLOYEE_AUTH_LOGIN_URL";
const EMPLOYEE_LOGIN_BEARER_ENV = "OPENCLAW_EMPLOYEE_AUTH_BEARER_TOKEN";
const EMPLOYEE_ADSSO_URL_ENV = "OPENCLAW_EMPLOYEE_AUTH_ADSSO_URL";
const EMPLOYEE_ADSSO_BEARER_ENV = "OPENCLAW_EMPLOYEE_AUTH_ADSSO_BEARER_TOKEN";
const EMPLOYEE_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const EMPLOYEE_BOOTSTRAP_TTL_MS = 5 * 60 * 1000;
const EMPLOYEE_AUTH_RATE_LIMIT_SCOPE = "employee-web-auth";

export type EmployeeAuthRequestContext = {
  clientIp?: string;
  gatewayUrl?: string;
  userAgent?: string;
};

type EmployeeExternalAuthSuccess = {
  authenticated: true;
  employeeId: string;
  email?: string;
  name?: string;
  department?: string;
  agentId?: string;
  sessionKey?: string;
};

type EmployeeExternalAuthFailure = {
  authenticated: false;
  message?: string;
  redirectUrl?: string;
  signInUrl?: string;
};

type EmployeeExternalAuthResponse = EmployeeExternalAuthSuccess | EmployeeExternalAuthFailure;

type EmployeeLoginBody = {
  identifier?: unknown;
  username?: unknown;
  email?: unknown;
  password?: unknown;
};

function parseEmployeeExternalAuthResponse(
  parsed: unknown,
  fallbackInvalidMessage: string,
): EmployeeExternalAuthResponse {
  if (!parsed || typeof parsed !== "object") {
    return { authenticated: false, message: fallbackInvalidMessage };
  }
  const authenticated = (parsed as { authenticated?: unknown }).authenticated;
  if (typeof authenticated !== "boolean") {
    return { authenticated: false, message: fallbackInvalidMessage };
  }
  if (!authenticated) {
    const message =
      typeof (parsed as { message?: unknown }).message === "string"
        ? (parsed as { message: string }).message
        : undefined;
    const redirectUrl =
      typeof (parsed as { redirectUrl?: unknown }).redirectUrl === "string"
        ? (parsed as { redirectUrl: string }).redirectUrl
        : undefined;
    const signInUrl =
      typeof (parsed as { signInUrl?: unknown }).signInUrl === "string"
        ? (parsed as { signInUrl: string }).signInUrl
        : undefined;
    return { authenticated: false, message, redirectUrl, signInUrl };
  }

  const employeeId =
    typeof (parsed as { employeeId?: unknown }).employeeId === "string"
      ? (parsed as { employeeId: string }).employeeId.trim()
      : "";
  if (!employeeId) {
    return {
      authenticated: false,
      message: "employee auth response missing employeeId",
    };
  }

  return {
    authenticated: true,
    employeeId,
    email:
      typeof (parsed as { email?: unknown }).email === "string"
        ? (parsed as { email: string }).email.trim() || undefined
        : undefined,
    name:
      typeof (parsed as { name?: unknown }).name === "string"
        ? (parsed as { name: string }).name.trim() || undefined
        : undefined,
    department:
      typeof (parsed as { department?: unknown }).department === "string"
        ? (parsed as { department: string }).department.trim() || undefined
        : undefined,
    agentId:
      typeof (parsed as { agentId?: unknown }).agentId === "string"
        ? (parsed as { agentId: string }).agentId.trim() || undefined
        : undefined,
    sessionKey:
      typeof (parsed as { sessionKey?: unknown }).sessionKey === "string"
        ? (parsed as { sessionKey: string }).sessionKey.trim() || undefined
        : undefined,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.end(JSON.stringify(body));
}

function appendSetCookie(res: ServerResponse, cookie: string) {
  const existing = res.getHeader("Set-Cookie");
  if (!existing) {
    res.setHeader("Set-Cookie", cookie);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader("Set-Cookie", [...existing, cookie]);
    return;
  }
  res.setHeader("Set-Cookie", [String(existing), cookie]);
}

function serializeCookie(
  name: string,
  value: string,
  opts?: { maxAge?: number; clear?: boolean; secure?: boolean },
) {
  const parts = [`${name}=${value}`];
  if (opts?.clear) {
    parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else if (typeof opts?.maxAge === "number" && Number.isFinite(opts.maxAge)) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  }
  parts.push("Path=/", "HttpOnly", "SameSite=Lax");
  if (opts?.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function requestUsesSecureTransport(req: IncomingMessage): boolean {
  const forwardedProto =
    typeof req.headers["x-forwarded-proto"] === "string"
      ? req.headers["x-forwarded-proto"].split(",")[0]?.trim().toLowerCase()
      : "";
  if (forwardedProto === "https") {
    return true;
  }
  const socket = req.socket as { encrypted?: boolean };
  return socket.encrypted === true;
}

function clearEmployeeSessionCookie(req: IncomingMessage, res: ServerResponse) {
  appendSetCookie(
    res,
    serializeCookie(EMPLOYEE_SESSION_COOKIE, "", {
      clear: true,
      secure: requestUsesSecureTransport(req),
    }),
  );
}

function setEmployeeSessionCookie(req: IncomingMessage, res: ServerResponse, token: string) {
  appendSetCookie(
    res,
    serializeCookie(EMPLOYEE_SESSION_COOKIE, encodeURIComponent(token), {
      maxAge: Math.floor(EMPLOYEE_SESSION_TTL_MS / 1000),
      secure: requestUsesSecureTransport(req),
    }),
  );
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie;
  const header = Array.isArray(raw) ? raw.join("; ") : raw ?? "";
  if (!header.trim()) {
    return {};
  }
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [keyRaw, ...valueParts] = part.split("=");
    const key = keyRaw?.trim();
    if (!key) {
      continue;
    }
    const valueRaw = valueParts.join("=").trim();
    try {
      cookies[key] = decodeURIComponent(valueRaw);
    } catch {
      cookies[key] = valueRaw;
    }
  }
  return cookies;
}

function readEmployeeSession(req: IncomingMessage) {
  const token = parseCookies(req)[EMPLOYEE_SESSION_COOKIE];
  return verifyEmployeeSessionToken(token);
}

function normalizeEmployeeAuthRecord(
  config: OpenClawConfig,
  raw: EmployeeExternalAuthSuccess,
  gatewayUrl?: string,
): EmployeeSessionPayload {
  const agentId = normalizeAgentId(raw.agentId || resolveDefaultAgentId(config));
  const sessionKey =
    typeof raw.sessionKey === "string" && raw.sessionKey.trim()
      ? raw.sessionKey.trim()
      : buildAgentMainSessionKey({ agentId });
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + Math.floor(EMPLOYEE_SESSION_TTL_MS / 1000);
  return {
    kind: "session",
    employeeId: raw.employeeId.trim(),
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : undefined,
    department:
      typeof raw.department === "string" && raw.department.trim() ? raw.department.trim() : undefined,
    agentId,
    sessionKey,
    gatewayUrl: gatewayUrl?.trim() || undefined,
    iat: nowSec,
    exp: expSec,
  };
}

async function initializeEmployeeWorkspaceAndActivation(params: {
  config: OpenClawConfig;
  authResult: EmployeeExternalAuthSuccess;
}): Promise<{
  workspaceCreated: boolean;
  userProfileSeeded: boolean;
  activationCreated: boolean;
}> {
  const agentId = normalizeAgentId(params.authResult.agentId || resolveDefaultAgentId(params.config));
  const workspaceDir = resolveAgentWorkspaceDir(params.config, agentId);
  const workspace = await ensureAgentWorkspace({ dir: workspaceDir, ensureBootstrapFiles: true });
  const userProfile = await upsertWorkspaceUserProfile({
    workspaceDir,
    profile: {
      employeeId: params.authResult.employeeId,
      name: params.authResult.name,
      department: params.authResult.department,
      email: params.authResult.email,
    },
  });
  const activation = await upsertEmployeeActivationRecord({
    employeeId: params.authResult.employeeId,
    agentId,
    name: params.authResult.name,
    department: params.authResult.department,
    email: params.authResult.email,
  });
  return {
    workspaceCreated: workspace.workspaceCreated === true,
    userProfileSeeded: userProfile.seeded,
    activationCreated: activation.created,
  };
}

function buildEmployeeProvisioningNotice(result: {
  workspaceCreated: boolean;
  userProfileSeeded: boolean;
  activationCreated: boolean;
}): EmployeeUiLoginNotice | undefined {
  if (!result.workspaceCreated && !result.userProfileSeeded && !result.activationCreated) {
    return undefined;
  }
  const bodyParts: string[] = [];
  if (result.workspaceCreated) {
    bodyParts.push("전용 workspace를 생성했습니다.");
  }
  if (result.userProfileSeeded) {
    bodyParts.push("USER.md에 사용자 기본 정보를 반영했습니다.");
  }
  if (result.activationCreated) {
    bodyParts.push("Knox 연동을 위한 employee activation을 등록했습니다.");
  }
  return {
    title: "Workspace ready",
    body: bodyParts.join(" "),
  };
}

function sendEmployeeRateLimited(res: ServerResponse, retryAfterMs?: number) {
  if (retryAfterMs && retryAfterMs > 0) {
    res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
  }
  sendJson(res, 429, {
    authenticated: false,
    message: "Too many sign-in attempts. Please try again later.",
  });
}

async function authenticateViaExternalService(params: {
  body: EmployeeLoginBody;
  context: EmployeeAuthRequestContext;
}): Promise<EmployeeExternalAuthResponse> {
  const loginUrl = process.env[EMPLOYEE_LOGIN_URL_ENV]?.trim();
  if (!loginUrl) {
    return {
      authenticated: false,
      message: `${EMPLOYEE_LOGIN_URL_ENV} is not configured`,
    };
  }
  const identifierCandidates = [params.body.identifier, params.body.username, params.body.email];
  const identifier = identifierCandidates.find(
    (value) => typeof value === "string" && value.trim(),
  ) as string | undefined;
  const password = typeof params.body.password === "string" ? params.body.password : "";
  if (!identifier?.trim() || !password) {
    return {
      authenticated: false,
      message: "identifier and password are required",
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const bearer = process.env[EMPLOYEE_LOGIN_BEARER_ENV]?.trim();
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }
  const response = await fetch(loginUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      identifier: identifier.trim(),
      username: identifier.trim(),
      password,
      clientIp: params.context.clientIp ?? null,
      gatewayUrl: params.context.gatewayUrl ?? null,
      userAgent: params.context.userAgent ?? null,
    }),
  });

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : `employee auth failed (${response.status})`;
    return { authenticated: false, message };
  }
  return parseEmployeeExternalAuthResponse(parsed, "employee auth response was invalid");
}

async function authenticateViaExternalAdSso(params: {
  context: EmployeeAuthRequestContext;
}): Promise<EmployeeExternalAuthResponse> {
  const adSsoUrl = process.env[EMPLOYEE_ADSSO_URL_ENV]?.trim();
  if (!adSsoUrl) {
    return {
      authenticated: false,
      message: `${EMPLOYEE_ADSSO_URL_ENV} is not configured`,
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const bearer = process.env[EMPLOYEE_ADSSO_BEARER_ENV]?.trim();
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }

  const response = await fetch(adSsoUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      clientIp: params.context.clientIp ?? null,
      gatewayUrl: params.context.gatewayUrl ?? null,
      userAgent: params.context.userAgent ?? null,
      returnUrl: "/employee",
    }),
  });

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string"
        ? parsed.message
        : `employee AD SSO failed (${response.status})`;
    return { authenticated: false, message };
  }
  return parseEmployeeExternalAuthResponse(parsed, "employee AD SSO response was invalid");
}

export function handleEmployeeBootstrapRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: OpenClawConfig,
  gatewayUrl?: string,
): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== EMPLOYEE_BOOTSTRAP_PATH) {
    return false;
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("Method Not Allowed");
    return true;
  }
  const session = readEmployeeSession(req);
  if (!session) {
    const body: EmployeeUiBootstrapUnauthenticatedResponse = {
      authenticated: false,
      message: "company sign-in required",
      ui: resolveEmployeeUiSurfaceConfig(config),
    };
    sendJson(res, 200, method === "HEAD" ? undefined : body);
    return true;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const token = signEmployeeBootstrapToken({
    employeeId: session.employeeId,
    name: session.name,
    department: session.department,
    agentId: session.agentId,
    sessionKey: session.sessionKey,
    gatewayUrl: gatewayUrl?.trim() || session.gatewayUrl,
    iat: nowSec,
    exp: nowSec + Math.floor(EMPLOYEE_BOOTSTRAP_TTL_MS / 1000),
  });
  const body: EmployeeUiBootstrapAuthenticatedResponse = {
    authenticated: true,
    employeeId: session.employeeId,
    name: session.name,
    department: session.department,
    agentId: session.agentId,
    sessionKey: session.sessionKey ?? buildAgentMainSessionKey({ agentId: session.agentId }),
    gatewayUrl: gatewayUrl?.trim() || session.gatewayUrl,
    token,
    ui: resolveEmployeeUiSurfaceConfig(config),
  };
  sendJson(res, 200, method === "HEAD" ? undefined : body);
  return true;
}

export async function handleEmployeeLoginRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenClawConfig;
  readJsonBody: (
    req: IncomingMessage,
    maxBytes: number,
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;
  context: EmployeeAuthRequestContext;
  rateLimiter?: AuthRateLimiter;
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  if (url.pathname !== EMPLOYEE_LOGIN_PATH) {
    return false;
  }
  const method = (params.req.method ?? "POST").toUpperCase();
  if (method !== "POST") {
    params.res.statusCode = 405;
    params.res.setHeader("Allow", "POST");
    params.res.end("Method Not Allowed");
    return true;
  }
  const rateLimitState = params.rateLimiter?.check(
    params.context.clientIp,
    EMPLOYEE_AUTH_RATE_LIMIT_SCOPE,
  );
  if (rateLimitState && !rateLimitState.allowed) {
    sendEmployeeRateLimited(params.res, rateLimitState.retryAfterMs);
    return true;
  }
  const parsedBody = await params.readJsonBody(params.req, 64 * 1024);
  if (!parsedBody.ok || !parsedBody.value || typeof parsedBody.value !== "object") {
    sendJson(params.res, 400, {
      authenticated: false,
      message: parsedBody.ok ? "invalid employee login payload" : parsedBody.error,
    });
    return true;
  }
  const authResult = await authenticateViaExternalService({
    body: parsedBody.value as EmployeeLoginBody,
    context: params.context,
  });
  if (!authResult.authenticated) {
    params.rateLimiter?.recordFailure(params.context.clientIp, EMPLOYEE_AUTH_RATE_LIMIT_SCOPE);
    clearEmployeeSessionCookie(params.req, params.res);
    sendJson(params.res, 401, authResult);
    return true;
  }
  const sessionPayload = normalizeEmployeeAuthRecord(
    params.config,
    authResult,
    params.context.gatewayUrl,
  );
  let provisioningNotice: EmployeeUiLoginNotice | undefined;
  try {
    const provisioning = await initializeEmployeeWorkspaceAndActivation({
      config: params.config,
      authResult,
    });
    provisioningNotice = buildEmployeeProvisioningNotice(provisioning);
  } catch (error) {
    clearEmployeeSessionCookie(params.req, params.res);
    sendJson(params.res, 500, {
      authenticated: false,
      message:
        error instanceof Error
          ? `failed to initialize employee workspace: ${error.message}`
          : "failed to initialize employee workspace",
    });
    return true;
  }
  const sessionToken = signEmployeeSessionToken(sessionPayload);
  params.rateLimiter?.reset(params.context.clientIp, EMPLOYEE_AUTH_RATE_LIMIT_SCOPE);
  setEmployeeSessionCookie(params.req, params.res, sessionToken);
  const responseBody: EmployeeUiLoginSuccessResponse = {
    authenticated: true,
    ...(provisioningNotice ? { notice: provisioningNotice } : {}),
  };
  sendJson(params.res, 200, responseBody);
  return true;
}

export async function handleEmployeeAdSsoRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  config: OpenClawConfig;
  context: EmployeeAuthRequestContext;
  rateLimiter?: AuthRateLimiter;
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  if (url.pathname !== EMPLOYEE_ADSSO_PATH) {
    return false;
  }
  const method = (params.req.method ?? "POST").toUpperCase();
  if (method !== "POST") {
    params.res.statusCode = 405;
    params.res.setHeader("Allow", "POST");
    params.res.end("Method Not Allowed");
    return true;
  }
  const rateLimitState = params.rateLimiter?.check(
    params.context.clientIp,
    EMPLOYEE_AUTH_RATE_LIMIT_SCOPE,
  );
  if (rateLimitState && !rateLimitState.allowed) {
    sendEmployeeRateLimited(params.res, rateLimitState.retryAfterMs);
    return true;
  }

  const authResult = await authenticateViaExternalAdSso({
    context: params.context,
  });
  if (!authResult.authenticated) {
    if (!authResult.redirectUrl && !authResult.signInUrl) {
      params.rateLimiter?.recordFailure(params.context.clientIp, EMPLOYEE_AUTH_RATE_LIMIT_SCOPE);
    }
    clearEmployeeSessionCookie(params.req, params.res);
    sendJson(params.res, 401, authResult);
    return true;
  }

  const sessionPayload = normalizeEmployeeAuthRecord(
    params.config,
    authResult,
    params.context.gatewayUrl,
  );
  let provisioningNotice: EmployeeUiLoginNotice | undefined;
  try {
    const provisioning = await initializeEmployeeWorkspaceAndActivation({
      config: params.config,
      authResult,
    });
    provisioningNotice = buildEmployeeProvisioningNotice(provisioning);
  } catch (error) {
    clearEmployeeSessionCookie(params.req, params.res);
    sendJson(params.res, 500, {
      authenticated: false,
      message:
        error instanceof Error
          ? `failed to initialize employee workspace: ${error.message}`
          : "failed to initialize employee workspace",
    });
    return true;
  }
  const sessionToken = signEmployeeSessionToken(sessionPayload);
  params.rateLimiter?.reset(params.context.clientIp, EMPLOYEE_AUTH_RATE_LIMIT_SCOPE);
  setEmployeeSessionCookie(params.req, params.res, sessionToken);
  const responseBody: EmployeeUiLoginSuccessResponse = {
    authenticated: true,
    ...(provisioningNotice ? { notice: provisioningNotice } : {}),
  };
  sendJson(params.res, 200, responseBody);
  return true;
}

export function handleEmployeeLogoutRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== EMPLOYEE_LOGOUT_PATH) {
    return false;
  }
  const method = (req.method ?? "POST").toUpperCase();
  if (method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end("Method Not Allowed");
    return true;
  }
  clearEmployeeSessionCookie(req, res);
  sendJson(res, 200, { ok: true });
  return true;
}
