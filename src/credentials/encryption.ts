import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const MASTER_KEY_ENV = "PLATFORMCLAW_MASTER_KEY";
const CURRENT_ENCRYPTION_VERSION = 1;
const AES_256_GCM_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;

type EncryptedCredentialPayload = {
  alg: "AES-256-GCM";
  v: number;
  iv: string;
  tag: string;
  ciphertext: string;
};

export class CredentialMasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialMasterKeyError";
  }
}

export function currentCredentialEncryptionVersion(): number {
  return CURRENT_ENCRYPTION_VERSION;
}

export function getCredentialMasterKeyStatus(env: NodeJS.ProcessEnv = process.env): {
  ready: boolean;
  keyName: typeof MASTER_KEY_ENV;
  message: string | null;
} {
  try {
    loadCredentialMasterKey(env);
    return { ready: true, keyName: MASTER_KEY_ENV, message: null };
  } catch (err) {
    return {
      ready: false,
      keyName: MASTER_KEY_ENV,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

function decodeMasterKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("base64:")) {
    return Buffer.from(trimmed.slice("base64:".length), "base64");
  }
  if (trimmed.startsWith("hex:")) {
    return Buffer.from(trimmed.slice("hex:".length), "hex");
  }
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return Buffer.from(trimmed, "base64");
}

export function loadCredentialMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env[MASTER_KEY_ENV];
  if (!raw) {
    throw new CredentialMasterKeyError(`${MASTER_KEY_ENV} is required for credential encryption.`);
  }
  const key = decodeMasterKey(raw);
  if (!key || key.length !== AES_256_GCM_KEY_BYTES) {
    throw new CredentialMasterKeyError(
      `${MASTER_KEY_ENV} must decode to exactly ${AES_256_GCM_KEY_BYTES} bytes.`,
    );
  }
  return key;
}

export function encryptCredentialValue(params: {
  value: string;
  env?: NodeJS.ProcessEnv;
  randomBytesFn?: (size: number) => Buffer;
}): { encryptedValue: string; encryptionVersion: number } {
  const key = loadCredentialMasterKey(params.env);
  const iv = (params.randomBytesFn ?? randomBytes)(AES_GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(params.value, "utf8"), cipher.final()]);
  const payload: EncryptedCredentialPayload = {
    alg: "AES-256-GCM",
    v: CURRENT_ENCRYPTION_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return {
    encryptedValue: JSON.stringify(payload),
    encryptionVersion: CURRENT_ENCRYPTION_VERSION,
  };
}

function parseEncryptedPayload(encryptedValue: string): EncryptedCredentialPayload {
  const parsed = JSON.parse(encryptedValue) as Partial<EncryptedCredentialPayload>;
  if (
    parsed.alg !== "AES-256-GCM" ||
    typeof parsed.v !== "number" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.tag !== "string" ||
    typeof parsed.ciphertext !== "string"
  ) {
    throw new Error("Invalid encrypted credential payload.");
  }
  return parsed as EncryptedCredentialPayload;
}

export function decryptCredentialValue(params: {
  encryptedValue: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const payload = parseEncryptedPayload(params.encryptedValue);
  if (payload.v !== CURRENT_ENCRYPTION_VERSION) {
    throw new Error(`Unsupported credential encryption version: ${payload.v}`);
  }
  const key = loadCredentialMasterKey(params.env);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
