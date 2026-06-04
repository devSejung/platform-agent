import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveManifestContractOwnerPluginId } from "../../plugins/manifest-registry.js";
import type { RuntimeWebSearchMetadata } from "../../secrets/runtime-web-tools.types.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import { isRecord } from "../../utils.js";
import {
  resolveWebSearchDefinition,
  resolveWebSearchProviderId,
  runWebSearch,
} from "../../web-search/runtime.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import {
  buildSearchCacheKey,
  readCachedSearchPayload,
  resolveSearchCacheTtlMs,
  resolveSearchTimeoutSeconds,
  SEARCH_CACHE,
  withTrustedWebSearchEndpoint,
  writeCachedSearchPayload,
} from "./web-search-provider-common.js";
import { readResponseText } from "./web-shared.js";

const GenericWebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query." }),
  count: Type.Optional(
    Type.Number({
      description: "Maximum number of results to return.",
      minimum: 1,
    }),
  ),
  country: Type.Optional(Type.String({ description: "Optional country filter." })),
  language: Type.Optional(Type.String({ description: "Optional language filter." })),
  freshness: Type.Optional(Type.String({ description: "Optional recency filter." })),
  date_after: Type.Optional(Type.String({ description: "Optional inclusive start date filter." })),
  date_before: Type.Optional(Type.String({ description: "Optional inclusive end date filter." })),
});

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function runRelayWebSearch(params: {
  relayUrl: string;
  args: Record<string, unknown>;
  config?: OpenClawConfig;
}): Promise<{ provider: string; result: Record<string, unknown> }> {
  let parsedRelayUrl: URL;
  try {
    parsedRelayUrl = new URL(params.relayUrl);
  } catch {
    throw new Error("Invalid WEB_SEARCH_RELAY_URL: must be http or https");
  }
  if (!["http:", "https:"].includes(parsedRelayUrl.protocol)) {
    throw new Error("Invalid WEB_SEARCH_RELAY_URL: must be http or https");
  }

  const searchConfig = params.config?.tools?.web?.search;
  const cacheKey = buildSearchCacheKey([
    "relay",
    parsedRelayUrl.toString(),
    stableStringify(params.args),
  ]);
  const cached = readCachedSearchPayload(cacheKey);
  if (cached) {
    const provider =
      typeof cached.provider === "string" && cached.provider.trim() ? cached.provider : "relay";
    return { provider, result: cached };
  }

  const relayToken = normalizeOptionalString(process.env.WEB_SEARCH_RELAY_TOKEN);
  const payload = await withTrustedWebSearchEndpoint(
    {
      url: parsedRelayUrl.toString(),
      timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(relayToken ? { "x-token": relayToken } : {}),
        },
        body: JSON.stringify(params.args),
      },
    },
    async (response) => {
      if (!response.ok) {
        const detail = await readResponseText(response, { maxBytes: 64_000 });
        throw new Error(
          `Web search relay failed (${response.status}): ${detail.text || response.statusText}`,
        );
      }
      const body = await response.json();
      if (!isRecord(body)) {
        throw new Error("Web search relay returned a non-object JSON payload.");
      }
      return body;
    },
  );

  const provider =
    typeof payload.provider === "string" && payload.provider.trim() ? payload.provider : "relay";
  writeCachedSearchPayload(cacheKey, payload, resolveSearchCacheTtlMs(searchConfig));
  return { provider, result: payload };
}

export function createWebSearchTool(options?: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
}): AnyAgentTool | null {
  const runtimeProviderId =
    options?.runtimeWebSearch?.selectedProvider ?? options?.runtimeWebSearch?.providerConfigured;
  const preferRuntimeProviders =
    Boolean(runtimeProviderId) &&
    !resolveManifestContractOwnerPluginId({
      contract: "webSearchProviders",
      value: runtimeProviderId,
      origin: "bundled",
      config: options?.config,
    });
  const relayUrl = normalizeOptionalString(process.env.WEB_SEARCH_RELAY_URL);
  const resolved = resolveWebSearchDefinition({
    ...options,
    preferRuntimeProviders,
  });
  if (!resolved && !relayUrl) {
    return null;
  }

  return {
    label: "Web Search",
    name: "web_search",
    description:
      resolved?.definition.description ??
      "Search the web and return matching results. Use for discovering relevant URLs before fetching specific pages.",
    parameters: resolved?.definition.parameters ?? GenericWebSearchSchema,
    execute: async (_toolCallId, args) => {
      if (relayUrl) {
        const result = await runRelayWebSearch({
          relayUrl,
          args: args as Record<string, unknown>,
          config: options?.config,
        });
        return jsonResult({
          ...result.result,
          provider: result.provider,
        });
      }
      const result = await runWebSearch({
        config: options?.config,
        sandboxed: options?.sandboxed,
        runtimeWebSearch: options?.runtimeWebSearch,
        preferRuntimeProviders,
        args,
      });
      return jsonResult({
        ...result.result,
        provider: result.provider,
      });
    },
  };
}

export const __testing = {
  SEARCH_CACHE,
  resolveSearchProvider: (search?: Parameters<typeof resolveWebSearchProviderId>[0]["search"]) =>
    resolveWebSearchProviderId({ search }),
};
