import crypto from "node:crypto";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { isTruthyEnvValue, logAcceptedEnvOption } from "./env.js";

const log = createSubsystemLogger("image-payload-debug");
const DATA_URL_RE = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/i;
const BASE64_CHARS_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export type ImagePayloadSummary = {
  kind:
    | "base64"
    | "base64-invalid"
    | "blob-url"
    | "data-url-base64"
    | "data-url-non-base64"
    | "http-url"
    | "other-string"
    | "non-string";
  length?: number;
  digest?: string;
  mimeType?: string;
  prefix?: string;
};

type ImagePayloadLogEntry = {
  index: number;
  mimeType?: string;
  summary: ImagePayloadSummary;
};

type ImagePayloadLogParams = {
  stage: string;
  runId?: string;
  sessionKey?: string;
  provider?: string;
  model?: string;
  entries: ImagePayloadLogEntry[];
  note?: string;
  allowEmpty?: boolean;
};

let envLogged = false;

function shortDigest(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function previewPrefix(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.slice(0, 48);
}

function isBase64Payload(value: string): boolean {
  if (!value || value.length % 4 !== 0) {
    return false;
  }
  return BASE64_CHARS_RE.test(value);
}

function logEnvOnce(): void {
  if (envLogged) {
    return;
  }
  envLogged = true;
  logAcceptedEnvOption({
    key: "OPENCLAW_DEBUG_IMAGE_PAYLOADS",
    description: "image payload debug logging enabled",
  });
}

export function isImagePayloadDebugEnabled(): boolean {
  const enabled = isTruthyEnvValue(process.env.OPENCLAW_DEBUG_IMAGE_PAYLOADS);
  if (enabled) {
    logEnvOnce();
  }
  return enabled;
}

export function summarizeImagePayload(value: unknown): ImagePayloadSummary {
  if (typeof value !== "string") {
    return { kind: "non-string" };
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { kind: "other-string", length: 0, prefix: "" };
  }
  const dataUrl = DATA_URL_RE.exec(trimmed);
  if (dataUrl) {
    const mimeType = dataUrl[1]?.trim().toLowerCase() || undefined;
    const lower = trimmed.toLowerCase();
    return {
      kind: lower.includes(";base64,") ? "data-url-base64" : "data-url-non-base64",
      length: trimmed.length,
      digest: shortDigest(trimmed),
      mimeType,
      prefix: previewPrefix(trimmed),
    };
  }
  if (trimmed.startsWith("blob:")) {
    return {
      kind: "blob-url",
      length: trimmed.length,
      digest: shortDigest(trimmed),
      prefix: previewPrefix(trimmed),
    };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return {
      kind: "http-url",
      length: trimmed.length,
      digest: shortDigest(trimmed),
      prefix: previewPrefix(trimmed),
    };
  }
  if (isBase64Payload(trimmed)) {
    return {
      kind: "base64",
      length: trimmed.length,
      digest: shortDigest(trimmed),
      prefix: previewPrefix(trimmed),
    };
  }
  return {
    kind: "base64-invalid",
    length: trimmed.length,
    digest: shortDigest(trimmed),
    prefix: previewPrefix(trimmed),
  };
}

export function logImagePayloadDebug(params: ImagePayloadLogParams): void {
  if (!isImagePayloadDebugEnabled()) {
    return;
  }
  if (params.entries.length === 0 && params.allowEmpty !== true) {
    return;
  }
  log.warn(
    `image-payload-debug stage=${params.stage}` +
      (params.runId ? ` runId=${params.runId}` : "") +
      (params.sessionKey ? ` sessionKey=${params.sessionKey}` : "") +
      (params.provider ? ` provider=${params.provider}` : "") +
      (params.model ? ` model=${params.model}` : "") +
      (params.note ? ` note=${params.note}` : ""),
    {
      entries: params.entries,
    },
  );
}
