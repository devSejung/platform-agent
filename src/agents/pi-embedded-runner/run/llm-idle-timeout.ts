import type { StreamFn } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { OpenClawConfig } from "../../../config/config.js";
import type { EmbeddedRunTrigger } from "./params.js";

/**
 * Default idle timeout for LLM streaming responses in milliseconds.
 * If no token is received within this time, the request is aborted.
 * Set to 0 to disable (never timeout).
 * Default: 60 seconds.
 */
export const DEFAULT_LLM_IDLE_TIMEOUT_MS = 60_000;
const CRON_LLM_IDLE_TIMEOUT_MS = 60_000;
const LOCAL_PROVIDER_AUTH_MARKERS = new Set(["custom-local", "ollama-local"]);
const SELF_HOSTED_PROVIDER_ID_PREFIXES = ["ollama", "lmstudio", "vllm", "sglang", "llama-cpp"];

/**
 * Maximum safe timeout value (approximately 24.8 days).
 */
const MAX_SAFE_TIMEOUT_MS = 2_147_000_000;

type IdleTimeoutProviderConfig = {
  apiKey?: unknown;
  localService?: unknown;
};

type IdleTimeoutModelInfo = {
  baseUrl?: string;
  id?: string;
  provider?: string;
};

function isLocalProviderBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    isPrivate172Host(host)
  );
}

function isPrivate172Host(host: string): boolean {
  if (!host.startsWith("172.")) {
    return false;
  }
  const secondOctet = Number(host.split(".")[1] ?? "");
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31;
}

function isExplicitLocalHostnameBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "docker.orb.internal" ||
    host === "host.docker.internal" ||
    host === "host.orb.internal"
  );
}

function isBareProviderHostnameBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host.includes(".") || host.includes(":")) {
    return false;
  }
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host);
}

function isSelfHostedProviderId(provider: string | undefined): boolean {
  const normalized = provider?.trim().toLowerCase();
  if (!normalized || normalized === "ollama-cloud") {
    return false;
  }
  return SELF_HOSTED_PROVIDER_ID_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}-`),
  );
}

function isOllamaCloudModel(model: IdleTimeoutModelInfo | undefined): boolean {
  const rawModelId = model?.id;
  if (typeof rawModelId !== "string") {
    return false;
  }
  return rawModelId.toLowerCase().includes("cloud");
}

function findConfiguredProviderConfig(
  cfg: OpenClawConfig | undefined,
  provider: string | undefined,
): IdleTimeoutProviderConfig | undefined {
  const normalizedProvider = provider?.trim().toLowerCase();
  if (!normalizedProvider) {
    return undefined;
  }
  const providers = cfg?.models?.providers as
    | Record<string, IdleTimeoutProviderConfig | undefined>
    | undefined;
  const exact = providers?.[normalizedProvider];
  if (exact) {
    return exact;
  }
  return Object.entries(providers ?? {}).find(
    ([key]) => key.trim().toLowerCase() === normalizedProvider,
  )?.[1];
}

function hasLocalProviderAuthMarker(apiKey: unknown): boolean {
  return typeof apiKey === "string" && LOCAL_PROVIDER_AUTH_MARKERS.has(apiKey.trim().toLowerCase());
}

function hasConfiguredLocalProviderSignal(params: {
  cfg: OpenClawConfig | undefined;
  provider: string | undefined;
}): boolean {
  const providerConfig = findConfiguredProviderConfig(params.cfg, params.provider);
  return Boolean(
    providerConfig?.localService || hasLocalProviderAuthMarker(providerConfig?.apiKey),
  );
}

function isSelfHostedRuntimeModel(params: {
  cfg?: OpenClawConfig;
  model?: IdleTimeoutModelInfo;
}): boolean {
  const baseUrl = params.model?.baseUrl;
  if (typeof baseUrl !== "string" || baseUrl.length === 0 || isOllamaCloudModel(params.model)) {
    return false;
  }
  if (isLocalProviderBaseUrl(baseUrl) || isExplicitLocalHostnameBaseUrl(baseUrl)) {
    return true;
  }
  return (
    isBareProviderHostnameBaseUrl(baseUrl) &&
    (isSelfHostedProviderId(params.model?.provider) ||
      hasConfiguredLocalProviderSignal({ cfg: params.cfg, provider: params.model?.provider }))
  );
}

/**
 * Resolves the LLM idle timeout from configuration.
 * @returns Idle timeout in milliseconds, or 0 to disable
 */
export function resolveLlmIdleTimeoutMs(params?: {
  cfg?: OpenClawConfig;
  trigger?: EmbeddedRunTrigger;
  model?: IdleTimeoutModelInfo;
}): number {
  const raw = params?.cfg?.agents?.defaults?.llm?.idleTimeoutSeconds;
  // 0 means explicitly disabled (no timeout).
  if (raw === 0) {
    return 0;
  }
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.min(Math.floor(raw) * 1000, MAX_SAFE_TIMEOUT_MS);
  }

  const agentTimeoutSeconds = params?.cfg?.agents?.defaults?.timeoutSeconds;
  if (
    typeof agentTimeoutSeconds === "number" &&
    Number.isFinite(agentTimeoutSeconds) &&
    agentTimeoutSeconds > 0
  ) {
    const timeoutMs = Math.min(Math.floor(agentTimeoutSeconds) * 1000, MAX_SAFE_TIMEOUT_MS);
    if (params?.trigger === "cron" && !isSelfHostedRuntimeModel(params)) {
      return Math.min(timeoutMs, CRON_LLM_IDLE_TIMEOUT_MS);
    }
    return timeoutMs;
  }

  if (params?.trigger === "cron") {
    return isSelfHostedRuntimeModel(params) ? 0 : CRON_LLM_IDLE_TIMEOUT_MS;
  }

  return DEFAULT_LLM_IDLE_TIMEOUT_MS;
}

/**
 * Wraps a stream function with idle timeout detection.
 * If no token is received within the specified timeout, the request is aborted.
 *
 * @param baseFn - The base stream function to wrap
 * @param timeoutMs - Idle timeout in milliseconds
 * @param onIdleTimeout - Optional callback invoked when idle timeout triggers
 * @returns A wrapped stream function with idle timeout detection
 */
export function streamWithIdleTimeout(
  baseFn: StreamFn,
  timeoutMs: number,
  onIdleTimeout?: (error: Error) => void,
): StreamFn {
  return (model, context, options) => {
    const maybeStream = baseFn(model, context, options);

    const wrapStream = (stream: ReturnType<typeof streamSimple>) => {
      const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
      (stream as { [Symbol.asyncIterator]: typeof originalAsyncIterator })[Symbol.asyncIterator] =
        function () {
          const iterator = originalAsyncIterator();
          let idleTimer: NodeJS.Timeout | null = null;

          const createTimeoutPromise = (): Promise<never> => {
            return new Promise((_, reject) => {
              idleTimer = setTimeout(() => {
                const error = new Error(
                  `LLM idle timeout (${Math.floor(timeoutMs / 1000)}s): no response from model`,
                );
                onIdleTimeout?.(error);
                reject(error);
              }, timeoutMs);
            });
          };

          const clearTimer = () => {
            if (idleTimer) {
              clearTimeout(idleTimer);
              idleTimer = null;
            }
          };

          return {
            async next() {
              clearTimer();

              try {
                // Race between the actual next() and the timeout
                const result = await Promise.race([iterator.next(), createTimeoutPromise()]);

                if (result.done) {
                  clearTimer();
                  return result;
                }

                clearTimer();
                return result;
              } catch (error) {
                clearTimer();
                throw error;
              }
            },

            return() {
              clearTimer();
              return iterator.return?.() ?? Promise.resolve({ done: true, value: undefined });
            },

            throw(error?: unknown) {
              clearTimer();
              return iterator.throw?.(error) ?? Promise.reject(error);
            },
          };
        };

      return stream;
    };

    if (maybeStream && typeof maybeStream === "object" && "then" in maybeStream) {
      return Promise.resolve(maybeStream).then(wrapStream);
    }
    return wrapStream(maybeStream);
  };
}
