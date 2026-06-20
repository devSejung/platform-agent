import { html, type TemplateResult } from "lit";
import type { SkillCategory, SkillHubPresentation } from "./controllers/skill-hub.ts";
import { icons } from "./icons.ts";

const CATEGORY_LABELS: Record<SkillCategory, string> = {
  knowledge: "Knowledge",
  automation: "Automation",
  utility: "Utility",
  other: "Other",
};

const CATEGORY_ICONS: Record<SkillCategory, TemplateResult> = {
  knowledge: icons.fileText,
  automation: icons.zap,
  utility: icons.wrench,
  other: icons.package,
};

export function skillCategoryLabel(category: SkillCategory): string {
  return CATEGORY_LABELS[category];
}

export function renderSkillPresentationIcon(
  presentation: SkillHubPresentation,
  size: "card" | "detail" = "card",
) {
  const fallbackCategory = presentation.icon.fallbackKey;
  const fallbackIcon = html`<span class="skillhub-presentation-icon__fallback">
    ${CATEGORY_ICONS[fallbackCategory]}
  </span>`;
  return html`
    <span
      class="skillhub-presentation-icon skillhub-presentation-icon--${size} skillhub-presentation-icon--${fallbackCategory}"
      data-category=${fallbackCategory}
      data-icon-source=${presentation.icon.source}
      aria-hidden="true"
    >
      ${presentation.icon.source === "uploaded" && presentation.icon.assetUrl
        ? html`
            <img
              src=${presentation.icon.assetUrl}
              alt=""
              loading="lazy"
              @error=${(event: Event) => {
                (event.currentTarget as HTMLImageElement).parentElement?.classList.add("is-broken");
              }}
            />
            ${fallbackIcon}
          `
        : fallbackIcon}
    </span>
  `;
}
