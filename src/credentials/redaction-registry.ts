const DEFAULT_MAX_SECRETS = 256;
const DEFAULT_TTL_MS = 30 * 60 * 1000;

type RegisteredRuntimeSecret = {
  value: string;
  expiresAtMs: number;
};

const registeredSecrets = new Map<string, RegisteredRuntimeSecret>();

function pruneExpiredSecrets(now = Date.now()): void {
  for (const [key, entry] of registeredSecrets) {
    if (entry.expiresAtMs <= now) {
      registeredSecrets.delete(key);
    }
  }
}

function maskRegisteredSecret(value: string): string {
  if (value.length < 18) {
    return "***";
  }
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function registerRuntimeSecretForRedaction(
  value: string,
  opts: { ttlMs?: number; maxSecrets?: number } = {},
): void {
  const normalized = value.trim();
  if (!normalized) {
    return;
  }
  const now = Date.now();
  pruneExpiredSecrets(now);
  const maxSecrets = opts.maxSecrets ?? DEFAULT_MAX_SECRETS;
  while (registeredSecrets.size >= maxSecrets) {
    const oldest = registeredSecrets.keys().next().value;
    if (!oldest) {
      break;
    }
    registeredSecrets.delete(oldest);
  }
  registeredSecrets.set(normalized, {
    value: normalized,
    expiresAtMs: now + (opts.ttlMs ?? DEFAULT_TTL_MS),
  });
}

export function redactRegisteredRuntimeSecrets(text: string): string {
  if (!text || registeredSecrets.size === 0) {
    return text;
  }
  pruneExpiredSecrets();
  let redacted = text;
  for (const entry of registeredSecrets.values()) {
    if (!entry.value || !redacted.includes(entry.value)) {
      continue;
    }
    redacted = redacted.split(entry.value).join(maskRegisteredSecret(entry.value));
  }
  return redacted;
}

export function clearRuntimeSecretRedactionRegistryForTest(): void {
  registeredSecrets.clear();
}
