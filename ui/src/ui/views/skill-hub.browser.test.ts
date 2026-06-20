import { describe, expect, it, vi } from "vitest";
import "../../test-helpers/load-styles.ts";
import type { SkillHubDetail, SkillHubEntry } from "../controllers/skill-hub.ts";
import { mountApp, registerAppMountHooks } from "../test-helpers/app-mount.ts";

registerAppMountHooks();

function createEntry(): SkillHubEntry {
  return {
    slug: "internal-skill-slug",
    displayName: "Identity Source Name",
    summary: "Legacy summary",
    presentation: {
      displayName: "Presented Skill",
      displayDescription: "Resolved marketplace description.",
      category: "knowledge",
      icon: { source: "category_default", fallbackKey: "knowledge" },
    },
    uploaderName: "Owner",
    uploaderEmployeeId: "owner",
    ownerAccountId: "owner",
    latestVersion: "1.0.0",
    publishedAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-02T00:00:00.000Z",
    installCount: 3,
    installerCount: 2,
    likeCount: 1,
    hidden: false,
    uploadedByYou: false,
    likedByYou: false,
    installed: false,
    canEditMetadata: true,
    canManageVisibility: false,
    canAdminManage: false,
    canTransferOwnership: false,
    updateAvailable: false,
    flags: { hasHiddenFiles: false, hasExecutableFiles: false },
  };
}

describe("Skill Hub presentation (browser)", () => {
  it("renders resolved cards and detail metadata with production styles", async () => {
    const app = mountApp("/skill-hub");
    const entry = createEntry();
    const detail: SkillHubDetail = {
      ...entry,
      sourceDescription: "Original SKILL.md description.",
      presentationEdit: {
        displayName: "Presented Skill",
        displayDescription: "Resolved marketplace description.",
        category: "knowledge",
        revision: 1,
      },
      examplePrompts: [],
      versions: [],
    };
    app.skillHubEntries = [entry];
    app.skillHubCategory = "all";
    app.skillHubOverview = {
      sharedSkillCount: 1,
      updateAvailableCount: 0,
      localSkillCount: 0,
      installedSkillCount: 0,
      recentUpdates: [],
    };
    app.skillHubDetailSlug = entry.slug;
    app.skillHubDetail = detail;
    app.requestUpdate();

    await vi.waitFor(() => {
      expect(app.querySelector(".skillhub-card__title")?.textContent).toBe("Presented Skill");
    });

    const card = app.querySelector(".skillhub-card");
    const icon = card?.querySelector<HTMLElement>(".skillhub-presentation-icon--card");
    expect(card?.textContent).toContain("Resolved marketplace description.");
    expect(card?.textContent).toContain("Knowledge");
    expect(card?.textContent).not.toContain(entry.slug);
    expect(
      [...app.querySelectorAll(".skillhub-category-filter")].map((chip) =>
        chip.textContent?.trim(),
      ),
    ).toEqual(["All", "Knowledge", "Automation", "Utility", "Other"]);
    expect(icon).not.toBeNull();
    expect(getComputedStyle(icon!).width).toBe("42px");
    expect(getComputedStyle(icon!).height).toBe("42px");

    const dialog = app.querySelector("dialog");
    expect(dialog?.textContent).toContain(entry.slug);
    expect(dialog?.textContent).toContain("Original SKILL.md description.");
    expect(dialog?.textContent).toContain("Category default");

    const editButton = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Edit",
    );
    editButton?.click();
    await vi.waitFor(() => {
      expect(app.querySelector<HTMLInputElement>('input[maxlength="80"]')?.value).toBe(
        "Presented Skill",
      );
    });
    expect(app.querySelector<HTMLTextAreaElement>('textarea[maxlength="100"]')?.value).toBe(
      "Resolved marketplace description.",
    );
    expect(app.querySelector<HTMLSelectElement>("dialog select")?.value).toBe("knowledge");
  });

  it("renders uploaded PNG icons and falls back to the category icon on load failure", async () => {
    const app = mountApp("/skill-hub");
    const entry = createEntry();
    entry.presentation.icon = {
      source: "uploaded",
      fallbackKey: "knowledge",
      assetUrl: `/api/v1/platformclaw/skillhub/icons/${"a".repeat(64)}.png`,
    };
    app.skillHubEntries = [entry];
    app.requestUpdate();

    const image = await vi.waitFor(() => {
      const element = app.querySelector<HTMLImageElement>(".skillhub-presentation-icon img");
      expect(element).not.toBeNull();
      return element!;
    });
    const icon = image.parentElement!;
    expect(icon.dataset.iconSource).toBe("uploaded");
    image.dispatchEvent(new Event("error"));
    expect(icon.classList.contains("is-broken")).toBe(true);
    expect(icon.querySelector(".skillhub-presentation-icon__fallback svg")).not.toBeNull();
  });

  it("keeps the ownership transfer dialog compact with production styles", async () => {
    const app = mountApp("/skill-hub");
    app.skillHubTransferOpen = true;
    app.skillHubTransferTitle = "Presented Skill";
    app.skillHubTransferTargetAccountId = "eon";
    app.skillHubTransferResults = [
      {
        accountId: "eon",
        employeeId: "eon",
        displayName: "Eon",
        email: "eon@example.com",
        department: "Platform",
        globalRole: "admin",
        status: "active",
      },
      {
        accountId: "minji",
        employeeId: "minji",
        displayName: "Minji",
        email: "minji@example.com",
        department: "Platform",
        globalRole: "member",
        status: "active",
      },
    ];
    app.requestUpdate();

    const panel = await vi.waitFor(() => {
      const element = app.querySelector<HTMLElement>(".skillhub-transfer-dialog__panel");
      expect(element).not.toBeNull();
      return element!;
    });
    const search = app.querySelector<HTMLInputElement>(".skillhub-transfer-dialog__search input")!;
    const reason = app.querySelector<HTMLTextAreaElement>(
      ".skillhub-transfer-dialog__reason textarea",
    )!;
    const account = app.querySelector<HTMLElement>(".skillhub-transfer-account")!;
    const actions = app.querySelector<HTMLElement>(".skillhub-transfer-dialog__actions")!;

    expect(parseFloat(getComputedStyle(panel).width)).toBeLessThanOrEqual(640);
    expect(getComputedStyle(panel).minHeight).toBe("0px");
    expect(getComputedStyle(search).height).toBe("42px");
    expect(parseFloat(getComputedStyle(reason).minHeight)).toBe(96);
    expect(parseFloat(getComputedStyle(account).minHeight)).toBe(64);
    expect(getComputedStyle(actions).display).toBe("flex");
    expect(app.querySelector(".skillhub-transfer-account.is-selected")).not.toBeNull();
    expect(panel.textContent).not.toContain("common.close");
  });
});
