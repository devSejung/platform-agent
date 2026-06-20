import { describe, expect, it } from "vitest";
import {
  normalizeSkillCategory,
  resolveSkillCategory,
  resolveSkillPresentation,
} from "./skill-hub-presentation.js";

describe("skill hub presentation resolver", () => {
  it("resolves legacy metadata through stable fallbacks", () => {
    expect(
      resolveSkillPresentation({ slug: "legacy-skill", legacySummary: "Legacy summary" }),
    ).toEqual({
      displayName: "legacy-skill",
      displayDescription: "Legacy summary",
      category: "other",
      icon: { source: "category_default", fallbackKey: "other" },
    });
  });

  it("prefers presentation values and source description over legacy summary", () => {
    expect(
      resolveSkillPresentation({
        slug: "source-skill",
        sourceDescription: "Source description",
        legacySummary: "Legacy summary",
        presentation: {
          displayName: "Presented Skill",
          displayDescription: "Presented description",
          category: "knowledge",
          icon: { type: "uploaded", assetId: "a".repeat(64) },
        },
      }),
    ).toEqual({
      displayName: "Presented Skill",
      displayDescription: "Presented description",
      category: "knowledge",
      icon: {
        source: "uploaded",
        fallbackKey: "knowledge",
        assetUrl: `/api/v1/platformclaw/skillhub/icons/${"a".repeat(64)}.png`,
      },
    });

    expect(
      resolveSkillPresentation({
        slug: "source-skill",
        sourceDescription: "Source description",
        legacySummary: "Legacy summary",
      }).displayDescription,
    ).toBe("Source description");
  });

  it("normalizes missing and invalid categories to other", () => {
    expect(resolveSkillCategory(undefined)).toBe("other");
    expect(resolveSkillCategory("invalid")).toBe("other");
    expect(resolveSkillCategory(" Utility ")).toBe("utility");
    expect(normalizeSkillCategory("invalid")).toBeUndefined();
  });

  it("falls back to the category icon when an uploaded descriptor is invalid", () => {
    expect(
      resolveSkillPresentation({
        slug: "utility-skill",
        presentation: {
          category: "utility",
          icon: { type: "uploaded", assetId: "" },
        },
      }).icon,
    ).toEqual({ source: "category_default", fallbackKey: "utility" });
  });
});
