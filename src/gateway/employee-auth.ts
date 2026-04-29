import { createHmac, timingSafeEqual } from "node:crypto";
import { normalizeAgentId } from "../routing/session-key.js";

export const EMPLOYEE_AUTH_ENV_SECRET = "OPENCLAW_EMPLOYEE_AUTH_SECRET";

export type EmployeeAccessTokenKind = "session" | "bootstrap";

type EmployeeAccessPayloadBase = {
  employeeId: string;
  name?: string;
  department?: string;
  agentId: string;
  sessionKey?: string;
  gatewayUrl?: string;
  exp?: number;
  iat?: number;
};

export type EmployeeSessionPayload = EmployeeAccessPayloadBase & {
  kind: "session";
};

export type EmployeeBootstrapPayload = EmployeeAccessPayloadBase & {
  kind: "bootstrap";
};

export type EmployeeAccessPayload = EmployeeSessionPayload | EmployeeBootstrapPayload;

export type VerifiedEmployeeAccess = EmployeeAccessPayload & {
  token: string;
};

export type EmployeeTokenVerifyFailureReason =
  | "missing_token"
  | "missing_secret"
  | "malformed_token"
  | "invalid_payload_encoding"
  | "invalid_signature"
  | "invalid_payload_json"
  | "invalid_payload_shape"
  | "wrong_kind"
  | "expired";

function toBase64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(input: string): Buffer | null {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    return Buffer.from(`${normalized}${padding}`, "base64");
  } catch {
    return null;
  }
}

function signPayload(secret: string, payloadPart: string): Buffer {
  return createHmac("sha256", secret).update(payloadPart).digest();
}

function normalizePayload(payload: Record<string, unknown>): EmployeeAccessPayload | null {
  const employeeId =
    typeof payload.employeeId === "string" && payload.employeeId.trim()
      ? payload.employeeId.trim()
      : "";
  const agentIdRaw =
    typeof payload.agentId === "string" && payload.agentId.trim() ? payload.agentId.trim() : "";
  const kind = payload.kind === "session" || payload.kind === "bootstrap" ? payload.kind : null;
  if (!employeeId || !agentIdRaw || !kind) {
    return null;
  }
  const agentId = normalizeAgentId(agentIdRaw);
  const sessionKey =
    typeof payload.sessionKey === "string" && payload.sessionKey.trim()
      ? payload.sessionKey.trim()
      : undefined;
  const exp =
    typeof payload.exp === "number" && Number.isFinite(payload.exp) ? Math.floor(payload.exp) : undefined;
  const iat =
    typeof payload.iat === "number" && Number.isFinite(payload.iat) ? Math.floor(payload.iat) : undefined;
  return {
    kind,
    employeeId,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : undefined,
    department:
      typeof payload.department === "string" && payload.department.trim()
        ? payload.department.trim()
        : undefined,
    agentId,
    sessionKey,
    gatewayUrl:
      typeof payload.gatewayUrl === "string" && payload.gatewayUrl.trim()
        ? payload.gatewayUrl.trim()
        : undefined,
    exp,
    iat,
  };
}

function verifyEmployeeAccessToken(
  token: string | null | undefined,
  expectedKind: EmployeeAccessTokenKind,
  secret = process.env[EMPLOYEE_AUTH_ENV_SECRET],
): VerifiedEmployeeAccess | null {
  const result = inspectEmployeeAccessToken(token, expectedKind, secret);
  return result.ok ? result.value : null;
}

function inspectEmployeeAccessToken(
  token: string | null | undefined,
  expectedKind: EmployeeAccessTokenKind,
  secret = process.env[EMPLOYEE_AUTH_ENV_SECRET],
):
  | { ok: true; value: VerifiedEmployeeAccess }
  | { ok: false; reason: EmployeeTokenVerifyFailureReason } {
  const raw = typeof token === "string" ? token.trim() : "";
  if (!raw) {
    return { ok: false, reason: "missing_token" };
  }
  if (!secret) {
    return { ok: false, reason: "missing_secret" };
  }
  const parts = raw.split(".");
  if (parts.length !== 2) {
    return { ok: false, reason: "malformed_token" };
  }
  const [payloadPart, signaturePart] = parts;
  if (!payloadPart || !signaturePart) {
    return { ok: false, reason: "malformed_token" };
  }
  const payloadBuf = fromBase64Url(payloadPart);
  const signatureBuf = fromBase64Url(signaturePart);
  if (!payloadBuf || !signatureBuf) {
    return { ok: false, reason: "invalid_payload_encoding" };
  }
  const expected = signPayload(secret, payloadPart);
  if (expected.length !== signatureBuf.length || !timingSafeEqual(expected, signatureBuf)) {
    return { ok: false, reason: "invalid_signature" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_payload_json" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "invalid_payload_shape" };
  }
  const normalized = normalizePayload(parsed as Record<string, unknown>);
  if (!normalized) {
    return { ok: false, reason: "invalid_payload_shape" };
  }
  if (normalized.kind !== expectedKind) {
    return { ok: false, reason: "wrong_kind" };
  }
  if (typeof normalized.exp === "number" && normalized.exp * 1000 < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, value: { ...normalized, token: raw } };
}

function signEmployeeAccessToken(
  payload: EmployeeAccessPayload,
  secret = process.env[EMPLOYEE_AUTH_ENV_SECRET],
): string {
  if (!secret) {
    throw new Error(`${EMPLOYEE_AUTH_ENV_SECRET} is not set`);
  }
  const normalized = normalizePayload(payload as unknown as Record<string, unknown>);
  if (!normalized) {
    throw new Error("invalid employee bootstrap payload");
  }
  const payloadPart = toBase64Url(JSON.stringify(normalized));
  const signaturePart = toBase64Url(signPayload(secret, payloadPart));
  return `${payloadPart}.${signaturePart}`;
}

export function verifyEmployeeSessionToken(
  token: string | null | undefined,
  secret = process.env[EMPLOYEE_AUTH_ENV_SECRET],
): VerifiedEmployeeAccess | null {
  return verifyEmployeeAccessToken(token, "session", secret);
}

export function verifyEmployeeBootstrapToken(
  token: string | null | undefined,
  secret = process.env[EMPLOYEE_AUTH_ENV_SECRET],
): VerifiedEmployeeAccess | null {
  return verifyEmployeeAccessToken(token, "bootstrap", secret);
}

export function inspectEmployeeBootstrapToken(
  token: string | null | undefined,
  secret = process.env[EMPLOYEE_AUTH_ENV_SECRET],
):
  | { ok: true; value: VerifiedEmployeeAccess }
  | { ok: false; reason: EmployeeTokenVerifyFailureReason } {
  return inspectEmployeeAccessToken(token, "bootstrap", secret);
}

export function signEmployeeSessionToken(
  payload: Omit<EmployeeSessionPayload, "kind"> | EmployeeSessionPayload,
  secret = process.env[EMPLOYEE_AUTH_ENV_SECRET],
): string {
  const normalizedPayload: EmployeeSessionPayload =
    "kind" in payload ? { ...payload, kind: "session" } : { ...payload, kind: "session" };
  return signEmployeeAccessToken(normalizedPayload, secret);
}

export function signEmployeeBootstrapToken(
  payload: Omit<EmployeeBootstrapPayload, "kind"> | EmployeeBootstrapPayload,
  secret = process.env[EMPLOYEE_AUTH_ENV_SECRET],
): string {
  const normalizedPayload: EmployeeBootstrapPayload =
    "kind" in payload ? { ...payload, kind: "bootstrap" } : { ...payload, kind: "bootstrap" };
  return signEmployeeAccessToken(normalizedPayload, secret);
}
