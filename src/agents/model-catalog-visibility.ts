import { resolveAgentModelFallbackValues } from "../config/model-input.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { resolveAgentModelFallbacksOverride } from "./agent-scope.js";
import type { ModelCatalogEntry } from "./model-catalog.js";
import { modelKey, normalizeProviderId, parseModelRef } from "./model-selection.js";

type VisibleModelCatalogParams = {
  cfg: OpenClawConfig;
  catalog: ModelCatalogEntry[];
  defaultProvider: string;
  defaultModel?: string;
  agentId?: string;
};

function sortModelCatalogEntries(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  return entries.toSorted(
    (a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
  );
}

function dedupeModelCatalogEntries(entries: ModelCatalogEntry[]): ModelCatalogEntry[] {
  const seen = new Set<string>();
  const result: ModelCatalogEntry[] = [];
  for (const entry of entries) {
    const key = modelKey(entry.provider, entry.id);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function resolveConfiguredSyntheticEntry(params: {
  cfg: OpenClawConfig;
  provider: string;
  model: string;
}): ModelCatalogEntry | null {
  const configuredModels = params.cfg.models?.providers?.[params.provider]?.models;
  if (!Array.isArray(configuredModels)) {
    return null;
  }
  const configured = configuredModels.find(
    (entry) => typeof entry?.id === "string" && entry.id.trim() === params.model,
  );
  if (!configured) {
    return null;
  }
  return {
    provider: params.provider,
    id: params.model,
    name:
      typeof configured.name === "string" && configured.name.trim().length > 0
        ? configured.name.trim()
        : params.model,
    contextWindow:
      typeof configured.contextWindow === "number" && configured.contextWindow > 0
        ? configured.contextWindow
        : undefined,
    reasoning: typeof configured.reasoning === "boolean" ? configured.reasoning : undefined,
    input: Array.isArray(configured.input) ? configured.input : undefined,
  };
}

function resolveFallbackModels(params: { cfg: OpenClawConfig; agentId?: string }): string[] {
  if (params.agentId) {
    const override = resolveAgentModelFallbacksOverride(params.cfg, params.agentId);
    if (override !== undefined) {
      return override;
    }
  }
  return resolveAgentModelFallbackValues(params.cfg.agents?.defaults?.model);
}

function addVisibleModelRef(params: {
  cfg: OpenClawConfig;
  catalogByKey: Map<string, ModelCatalogEntry>;
  defaultProvider: string;
  raw: string;
  visible: ModelCatalogEntry[];
  seen: Set<string>;
}): void {
  const parsed = parseModelRef(params.raw, params.defaultProvider);
  if (!parsed) {
    return;
  }
  const key = modelKey(parsed.provider, parsed.model);
  if (params.seen.has(key)) {
    return;
  }
  const entry = params.catalogByKey.get(key) ??
    resolveConfiguredSyntheticEntry({
      cfg: params.cfg,
      provider: parsed.provider,
      model: parsed.model,
    }) ?? {
      provider: parsed.provider,
      id: parsed.model,
      name: parsed.model,
    };
  params.seen.add(key);
  params.visible.push(entry);
}

/**
 * Resolve the model catalog that should be visible to picker/browse surfaces.
 * This follows upstream's model-visibility direction: exact configured models,
 * provider wildcards, defaults, and fallbacks are visible; the full runtime
 * catalog is not exposed unless policy explicitly asks for a provider wildcard.
 */
export function resolveVisibleModelCatalog(params: VisibleModelCatalogParams): ModelCatalogEntry[] {
  const catalogByKey = new Map(
    params.catalog.map((entry) => [modelKey(entry.provider, entry.id), entry] as const),
  );
  const visible: ModelCatalogEntry[] = [];
  const seen = new Set<string>();
  const providerWildcards = new Set<string>();

  for (const raw of Object.keys(params.cfg.agents?.defaults?.models ?? {})) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.endsWith("/*")) {
      const provider = normalizeProviderId(trimmed.slice(0, -2));
      if (provider) {
        providerWildcards.add(provider);
      }
      continue;
    }
    addVisibleModelRef({
      cfg: params.cfg,
      catalogByKey,
      defaultProvider: params.defaultProvider,
      raw: trimmed,
      visible,
      seen,
    });
  }

  for (const provider of providerWildcards) {
    for (const entry of params.catalog) {
      if (normalizeProviderId(entry.provider) !== provider) {
        continue;
      }
      const key = modelKey(entry.provider, entry.id);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      visible.push(entry);
    }
  }

  const defaultModel = normalizeOptionalString(params.defaultModel);
  if (defaultModel) {
    addVisibleModelRef({
      cfg: params.cfg,
      catalogByKey,
      defaultProvider: params.defaultProvider,
      raw: defaultModel,
      visible,
      seen,
    });
  }

  for (const fallback of resolveFallbackModels({ cfg: params.cfg, agentId: params.agentId })) {
    addVisibleModelRef({
      cfg: params.cfg,
      catalogByKey,
      defaultProvider: params.defaultProvider,
      raw: fallback,
      visible,
      seen,
    });
  }

  return sortModelCatalogEntries(dedupeModelCatalogEntries(visible));
}
