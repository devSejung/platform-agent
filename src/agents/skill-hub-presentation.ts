export type SkillCategory = "knowledge" | "automation" | "utility" | "other";

export type SkillHubPresentationIcon = {
  type: "uploaded";
  assetId: string;
};

export type SkillHubPresentationInput = {
  displayName?: string;
  displayDescription?: string;
  category?: unknown;
  icon?: SkillHubPresentationIcon;
};

export type ResolvedSkillHubIcon = {
  source: "uploaded" | "category_default";
  fallbackKey: SkillCategory;
  assetUrl?: string;
};

export type ResolvedSkillHubPresentation = {
  displayName: string;
  displayDescription: string;
  category: SkillCategory;
  icon: ResolvedSkillHubIcon;
};

export const SKILL_HUB_ICON_HTTP_BASE_PATH = "/api/v1/platformclaw/skillhub/icons";
const SKILL_HUB_ICON_ASSET_ID_PATTERN = /^[a-f0-9]{64}$/;

const SKILL_CATEGORIES = new Set<SkillCategory>(["knowledge", "automation", "utility", "other"]);

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function normalizeSkillCategory(value: unknown): SkillCategory | undefined {
  const normalized = trimmedString(value)?.toLowerCase();
  return normalized && SKILL_CATEGORIES.has(normalized as SkillCategory)
    ? (normalized as SkillCategory)
    : undefined;
}

export function resolveSkillCategory(value: unknown): SkillCategory {
  return normalizeSkillCategory(value) ?? "other";
}

export function resolveSkillDisplayName(params: {
  slug: string;
  presentation?: SkillHubPresentationInput | null;
}): string {
  return trimmedString(params.presentation?.displayName) ?? params.slug;
}

export function resolveSkillDisplayDescription(params: {
  sourceDescription?: string;
  legacySummary?: string;
  presentation?: SkillHubPresentationInput | null;
}): string {
  return (
    trimmedString(params.presentation?.displayDescription) ??
    trimmedString(params.sourceDescription) ??
    trimmedString(params.legacySummary) ??
    ""
  );
}

export function resolveSkillIcon(params: {
  category: SkillCategory;
  presentation?: SkillHubPresentationInput | null;
}): ResolvedSkillHubIcon {
  const icon = params.presentation?.icon;
  if (icon?.type === "uploaded" && SKILL_HUB_ICON_ASSET_ID_PATTERN.test(icon.assetId)) {
    return {
      source: "uploaded",
      fallbackKey: params.category,
      assetUrl: `${SKILL_HUB_ICON_HTTP_BASE_PATH}/${icon.assetId}.png`,
    };
  }
  return {
    source: "category_default",
    fallbackKey: params.category,
  };
}

export function resolveSkillPresentation(params: {
  slug: string;
  sourceDescription?: string;
  legacySummary?: string;
  presentation?: SkillHubPresentationInput | null;
}): ResolvedSkillHubPresentation {
  const category = resolveSkillCategory(params.presentation?.category);
  return {
    displayName: resolveSkillDisplayName(params),
    displayDescription: resolveSkillDisplayDescription(params),
    category,
    icon: resolveSkillIcon({ category, presentation: params.presentation }),
  };
}
