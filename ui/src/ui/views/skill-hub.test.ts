/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { SkillHubDetail, SkillHubEntry } from "../controllers/skill-hub.ts";
import { renderSkillHub, type SkillHubProps } from "./skill-hub.ts";

function createWorkspaceSkill() {
  return {
    skillName: "workspace-skill-alpha",
    description: "Workspace skill description",
    skillKey: "workspace-skill-alpha",
    installedFromHub: false,
    localChecksum: "checksum",
    state: "new_local_skill" as const,
    actionLabel: "Publish",
    disabled: false,
    reason: "This will be published as a new skill.",
  };
}

function createEntry(overrides: Partial<SkillHubEntry> = {}): SkillHubEntry {
  return {
    slug: "internal-skill-slug",
    displayName: "Identity Source Name",
    summary: "Legacy summary",
    presentation: {
      displayName: "Presented Skill",
      displayDescription: "A resolved marketplace description.",
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
    canEditMetadata: false,
    canManageVisibility: false,
    canAdminManage: false,
    canTransferOwnership: false,
    updateAvailable: false,
    flags: { hasHiddenFiles: false, hasExecutableFiles: false },
    ...overrides,
  };
}

function createDetail(overrides: Partial<SkillHubDetail> = {}): SkillHubDetail {
  return {
    ...createEntry(),
    sourceDescription: "Original SKILL.md description.",
    presentationEdit: {
      displayName: "Presented Skill",
      displayDescription: "A resolved marketplace description.",
      category: "knowledge",
      revision: 2,
    },
    examplePrompts: [],
    versions: [],
    ...overrides,
  };
}

function createProps(overrides: Partial<SkillHubProps> = {}): SkillHubProps {
  return {
    loading: false,
    entries: [],
    error: null,
    scope: "discover",
    sort: "recent",
    category: "all",
    query: "",
    detail: null,
    detailSlug: null,
    detailLoading: false,
    detailError: null,
    busySlug: null,
    message: null,
    workspacePublishing: false,
    workspacePendingKeys: [],
    workspacePublishEntries: [createWorkspaceSkill()],
    overview: {
      sharedSkillCount: 0,
      updateAvailableCount: 0,
      localSkillCount: 1,
      installedSkillCount: 0,
      recentUpdates: [],
    },
    uploading: false,
    workspacePanelOpen: false,
    editorOpen: false,
    editorMode: null,
    editorTitle: null,
    editorSkillName: null,
    editorFile: null,
    editorIconFile: null,
    editorIconReset: false,
    editorHasUploadedIcon: false,
    editorDisplayName: "",
    editorDescription: "",
    editorCategory: "",
    editorPrompts: ["", "", ""],
    editorError: null,
    editorLoading: false,
    transferOpen: false,
    transferTitle: null,
    transferQuery: "",
    transferResults: [],
    transferTargetAccountId: null,
    transferReason: "",
    transferError: null,
    transferLoading: false,
    onScopeChange: () => undefined,
    onSortChange: () => undefined,
    onCategoryChange: () => undefined,
    onQueryChange: () => undefined,
    onRefresh: () => undefined,
    onOpenDetail: () => undefined,
    onCloseDetail: () => undefined,
    onInstall: () => undefined,
    onUpdate: () => undefined,
    onDelete: () => undefined,
    onDeleteFromHub: () => undefined,
    onLike: () => undefined,
    onCopy: () => undefined,
    onOpenPublishEditor: () => undefined,
    onOpenWorkspaceSkillDetail: () => undefined,
    onOpenUploadEditor: () => undefined,
    onToggleWorkspacePanel: () => undefined,
    onOpenEditMetadataEditor: () => undefined,
    onEditorDisplayNameChange: () => undefined,
    onEditorClose: () => undefined,
    onEditorDescriptionChange: () => undefined,
    onEditorCategoryChange: () => undefined,
    onEditorPromptChange: () => undefined,
    onEditorFileChange: () => undefined,
    onEditorIconFileChange: () => undefined,
    onEditorIconReset: () => undefined,
    onEditorSubmit: () => undefined,
    onOpenTransfer: () => undefined,
    onCloseTransfer: () => undefined,
    onTransferQueryChange: () => undefined,
    onTransferTargetSelect: () => undefined,
    onTransferReasonChange: () => undefined,
    onTransferSubmit: () => undefined,
    ...overrides,
  };
}

describe("renderSkillHub", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the view and workspace publish panel without throwing", async () => {
    const container = document.createElement("div");
    render(renderSkillHub(createProps()), container);
    await Promise.resolve();

    const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(text).toContain("Skill Hub");
    expect(text).toContain("Publish from Workspace");
    expect(text).toContain("Your workspace has 1 publishable local skill(s).");
  });

  it("renders compact category chips and reports selection changes", async () => {
    const onCategoryChange = vi.fn();
    const container = document.createElement("div");
    render(
      renderSkillHub(
        createProps({
          category: "all",
          onCategoryChange,
        }),
      ),
      container,
    );
    await Promise.resolve();

    const chips = [...container.querySelectorAll<HTMLButtonElement>(".skillhub-category-filter")];
    expect(chips.map((chip) => chip.textContent?.trim())).toEqual([
      "All",
      "Knowledge",
      "Automation",
      "Utility",
      "Other",
    ]);
    expect(chips[0]?.getAttribute("aria-pressed")).toBe("true");
    chips[2]?.click();
    expect(onCategoryChange).toHaveBeenCalledWith("automation");
  });

  it("renders the editor dialog when requested", async () => {
    const container = document.createElement("div");

    render(
      renderSkillHub(
        createProps({
          editorOpen: true,
          editorMode: "upload",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(container.textContent).toContain("Upload skill package");
  });

  it("renders presentation override fields with enforced limits", async () => {
    const container = document.createElement("div");
    render(
      renderSkillHub(
        createProps({
          editorOpen: true,
          editorMode: "edit-metadata",
          editorDisplayName: "Presented Skill",
          editorDescription: "Short description",
          editorCategory: "automation",
        }),
      ),
      container,
    );
    await Promise.resolve();

    const fields = [...container.querySelectorAll("dialog .field")];
    const displayName = fields[0]?.querySelector("input");
    const description = fields[1]?.querySelector("textarea");
    const category = fields[2]?.querySelector("select");
    expect(displayName?.value).toBe("Presented Skill");
    expect(displayName?.maxLength).toBe(80);
    expect(description?.value).toBe("Short description");
    expect(description?.maxLength).toBe(100);
    expect(category?.value).toBe("automation");
  });

  it("renders the server-provided publish state and disables unavailable actions", async () => {
    const container = document.createElement("div");
    render(
      renderSkillHub(
        createProps({
          workspacePanelOpen: true,
          workspacePublishEntries: [
            {
              ...createWorkspaceSkill(),
              installedFromHub: true,
              state: "existing_skill_non_owner",
              actionLabel: "발행 불가",
              disabled: true,
              reason: "원본 업데이트는 owner만 가능합니다.",
            },
          ],
        }),
      ),
      container,
    );
    await Promise.resolve();

    const buttons = [...container.querySelectorAll("button")];
    const publishButton = buttons.find((button) => button.textContent?.includes("발행 불가"));
    expect(publishButton?.disabled).toBe(true);
    expect(container.textContent).toContain("원본 업데이트는 owner만 가능합니다.");
  });

  it("renders the ownership transfer dialog when requested", async () => {
    const container = document.createElement("div");

    render(
      renderSkillHub(
        createProps({
          transferOpen: true,
          transferTitle: "Demo Skill",
          transferTargetAccountId: "eon",
          transferResults: [
            {
              accountId: "eon",
              employeeId: "eon",
              displayName: "Eon",
              email: "eon@example.com",
              department: "Platform",
              globalRole: "admin",
              status: "active",
            },
          ],
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(container.textContent).toContain("Transfer ownership");
    expect(container.textContent).toContain("Eon");
    expect(container.querySelector(".skillhub-transfer-dialog__panel")).not.toBeNull();
    expect(container.querySelector(".skillhub-transfer-account.is-selected")).not.toBeNull();
    expect(container.querySelector(".skillhub-transfer-dialog__search input")).not.toBeNull();
    expect(container.querySelector(".skillhub-transfer-dialog__reason textarea")).not.toBeNull();
  });

  it("renders resolved presentation fields and a category icon without emphasizing the slug", async () => {
    const container = document.createElement("div");
    render(renderSkillHub(createProps({ entries: [createEntry()] })), container);
    await Promise.resolve();

    const card = container.querySelector(".skillhub-card");
    expect(card?.querySelector(".skillhub-card__title")?.textContent).toBe("Presented Skill");
    expect(card?.querySelector(".skillhub-card__summary")?.textContent).toBe(
      "A resolved marketplace description.",
    );
    expect(card?.querySelector(".skillhub-category-badge")?.textContent).toContain("Knowledge");
    expect(card?.querySelector('[data-category="knowledge"] svg')).not.toBeNull();
    expect(card?.textContent).not.toContain("internal-skill-slug");
    expect(card?.textContent).not.toContain("Identity Source Name");
    expect(card?.textContent).not.toContain("Legacy summary");
  });

  it("shows resolved and source descriptions separately in detail", async () => {
    const container = document.createElement("div");
    render(
      renderSkillHub(
        createProps({
          detailSlug: "internal-skill-slug",
          detail: createDetail(),
        }),
      ),
      container,
    );
    await Promise.resolve();

    const dialog = container.querySelector("dialog");
    expect(dialog?.querySelector(".md-preview-dialog__title")?.textContent).toContain(
      "Presented Skill",
    );
    expect(dialog?.textContent).toContain("internal-skill-slug");
    expect(dialog?.textContent).toContain("A resolved marketplace description.");
    expect(dialog?.textContent).toContain("Original SKILL.md description.");
    expect(dialog?.textContent).toContain("Category default");
  });

  it("renders server-resolved legacy fallbacks", async () => {
    const container = document.createElement("div");
    render(
      renderSkillHub(
        createProps({
          entries: [
            createEntry({
              slug: "legacy-skill",
              presentation: {
                displayName: "legacy-skill",
                displayDescription: "Legacy summary fallback",
                category: "other",
                icon: { source: "category_default", fallbackKey: "other" },
              },
            }),
          ],
        }),
      ),
      container,
    );
    await Promise.resolve();

    const card = container.querySelector(".skillhub-card");
    expect(card?.querySelector(".skillhub-card__title")?.textContent).toBe("legacy-skill");
    expect(card?.querySelector(".skillhub-card__summary")?.textContent).toBe(
      "Legacy summary fallback",
    );
    expect(card?.querySelector(".skillhub-category-badge")?.textContent).toContain("Other");
  });

  it("preserves install, update, and delete card actions", async () => {
    const onInstall = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();
    const container = document.createElement("div");
    render(
      renderSkillHub(
        createProps({
          entries: [
            createEntry({ slug: "new-skill" }),
            createEntry({
              slug: "installed-skill",
              installed: true,
              installedVersion: "1.0.0",
              updateAvailable: true,
            }),
          ],
          onInstall,
          onUpdate,
          onDelete,
        }),
      ),
      container,
    );
    await Promise.resolve();

    const cards = [...container.querySelectorAll(".skillhub-card")];
    const clickAction = (card: Element, label: string) => {
      const button = [...card.querySelectorAll("button")].find(
        (candidate) => candidate.textContent?.trim() === label,
      );
      button?.click();
    };
    clickAction(cards[0], "Install");
    clickAction(cards[1], "Update");
    clickAction(cards[1], "Delete");

    expect(onInstall).toHaveBeenCalledWith("new-skill");
    expect(onUpdate).toHaveBeenCalledWith("installed-skill");
    expect(onDelete).toHaveBeenCalledWith("installed-skill");
  });
});
