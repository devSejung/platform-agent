/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
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

function createProps(overrides: Partial<SkillHubProps> = {}): SkillHubProps {
  return {
    loading: false,
    entries: [],
    error: null,
    scope: "discover",
    sort: "recent",
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
    editorDescription: "",
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
    onOpenUploadEditor: () => undefined,
    onToggleWorkspacePanel: () => undefined,
    onOpenEditMetadataEditor: () => undefined,
    onEditorClose: () => undefined,
    onEditorDescriptionChange: () => undefined,
    onEditorPromptChange: () => undefined,
    onEditorFileChange: () => undefined,
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
  });
});
