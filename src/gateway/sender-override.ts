import type { IncomingMessage } from "node:http";
import { isTruthyEnvValue } from "../infra/env.js";
import type { GatewayClientInfo } from "./protocol/client-info.js";
import { getHeader } from "./http-utils.js";

const MAX_SENDER_ID_LENGTH = 256;
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const TRUSTED_SENDER_CLIENT_IDS_ENV = "OPENCLAW_TRUSTED_SENDER_CLIENT_IDS";
const TRUST_HTTP_SENDER_HEADER_ENV = "OPENCLAW_TRUST_HTTP_SENDER_HEADER";

function normalizeSenderId(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_SENDER_ID_LENGTH || CONTROL_CHAR_RE.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function hasSenderIdInput(raw: unknown): boolean {
  return typeof raw === "string" && raw.trim().length > 0;
}

function getTrustedSenderClientIds(): Set<string> {
  const raw = process.env[TRUSTED_SENDER_CLIENT_IDS_ENV] ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function resolveTrustedWsSenderId(params: {
  clientInfo?: GatewayClientInfo;
  senderId: unknown;
}): { senderId?: string; trusted: boolean; present: boolean; invalid: boolean } {
  const normalized = normalizeSenderId(params.senderId);
  const clientId = params.clientInfo?.id;
  const trusted =
    params.clientInfo?.mode === "backend" &&
    typeof clientId === "string" &&
    getTrustedSenderClientIds().has(clientId);
  return {
    senderId: trusted ? normalized : undefined,
    trusted,
    present: hasSenderIdInput(params.senderId),
    invalid: hasSenderIdInput(params.senderId) && normalized === undefined,
  };
}

export function resolveTrustedHttpSenderId(req: IncomingMessage): {
  senderId?: string;
  trusted: boolean;
  present: boolean;
  invalid: boolean;
} {
  const raw = getHeader(req, "x-openclaw-sender-id");
  const normalized = normalizeSenderId(raw);
  const trusted = isTruthyEnvValue(process.env[TRUST_HTTP_SENDER_HEADER_ENV]);
  return {
    senderId: trusted ? normalized : undefined,
    trusted,
    present: hasSenderIdInput(raw),
    invalid: hasSenderIdInput(raw) && normalized === undefined,
  };
}
