import { describe, expect, it, vi } from "vitest";
import {
  deleteSkillHubEntry,
  publishWorkspaceSkillWithPrompts,
  resolveExistingSkillHubPromptsForSkillName,
  type SkillHubState,
} from "./skill-hub.ts";

function createState() {
  const request = vi.fn();
  const state: SkillHubState = {
    client: {
      request,
    } as unknown as SkillHubState["client"],
    connected: true,
    skillHubLoading: false,
    skillHubEntries: [],
    skillHubError: null,
    skillHubScope: "discover",
    skillHubSort: "recent",
    skillHubQuery: "",
    skillHubDetail: null,
    skillHubDetailSlug: null,
    skillHubDetailLoading: false,
    skillHubDetailError: null,
    skillHubBusySlug: null,
    skillHubMessage: null,
    skillHubWorkspacePublishing: false,
    skillHubWorkspacePendingKeys: [],
    skillHubWorkspacePublishEntries: [],
    skillHubOverview: null,
    skillHubUploading: false,
    skillHubEditorOpen: false,
    skillHubEditorMode: null,
    skillHubEditorSlug: null,
    skillHubEditorTitle: null,
    skillHubEditorSkillName: null,
    skillHubEditorFile: null,
    skillHubEditorDescription: "",
    skillHubEditorPrompts: ["", "", ""],
    skillHubEditorError: null,
    skillHubEditorLoading: false,
  };
  return { state, request };
}

describe("resolveExistingSkillHubPromptsForSkillName", () => {
  it("reuses currently loaded detail when it matches the workspace skill name", async () => {
    const { state, request } = createState();
    state.skillHubDetail = {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "summary",
      uploaderName: "Eon",
      uploaderEmployeeId: "eon",
      ownerAccountId: "eon",
      latestVersion: "1.0.1",
      publishedAt: "2026-05-24T00:00:00.000Z",
      updatedAt: "2026-05-24T00:00:00.000Z",
      installCount: 1,
      installerCount: 1,
      likeCount: 0,
      hidden: false,
      uploadedByYou: true,
      likedByYou: false,
      installed: false,
      canEditMetadata: true,
      canManageVisibility: true,
      canAdminManage: false,
      canTransferOwnership: true,
      updateAvailable: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      examplePrompts: ["prompt one", "prompt two"],
      versions: [],
    };

    const result = await resolveExistingSkillHubPromptsForSkillName(state, "Demo Skill");

    expect(result).toEqual({
      slug: "demo-skill",
      examplePrompts: ["prompt one", "prompt two"],
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("loads prompts from the uploader's exact-name hub entry when detail is not loaded", async () => {
    const { state, request } = createState();
    request
      .mockResolvedValueOnce({
        entries: [
          {
            slug: "demo-skill",
            displayName: "Demo Skill",
            summary: "summary",
            uploaderName: "Eon",
            uploaderEmployeeId: "eon",
            ownerAccountId: "eon",
            latestVersion: "1.0.1",
            publishedAt: "2026-05-24T00:00:00.000Z",
            updatedAt: "2026-05-24T00:00:00.000Z",
            installCount: 1,
            installerCount: 1,
            likeCount: 0,
            hidden: false,
            uploadedByYou: true,
            likedByYou: false,
            installed: false,
            canEditMetadata: true,
            canManageVisibility: true,
            canAdminManage: false,
            canTransferOwnership: true,
            updateAvailable: false,
            flags: { hasHiddenFiles: false, hasExecutableFiles: false },
          },
        ],
      })
      .mockResolvedValueOnce({
        detail: {
          slug: "demo-skill",
          displayName: "Demo Skill",
          summary: "summary",
          uploaderName: "Eon",
          uploaderEmployeeId: "eon",
          ownerAccountId: "eon",
          latestVersion: "1.0.1",
          publishedAt: "2026-05-24T00:00:00.000Z",
          updatedAt: "2026-05-24T00:00:00.000Z",
          installCount: 1,
          installerCount: 1,
          likeCount: 0,
          hidden: false,
          uploadedByYou: true,
          likedByYou: false,
          installed: false,
          canEditMetadata: true,
          canManageVisibility: true,
          canAdminManage: false,
          canTransferOwnership: true,
          updateAvailable: false,
          flags: { hasHiddenFiles: false, hasExecutableFiles: false },
          examplePrompts: ["prompt one"],
          versions: [],
        },
      });

    const result = await resolveExistingSkillHubPromptsForSkillName(state, "Demo Skill");

    expect(request).toHaveBeenNthCalledWith(1, "skillhub.list", {
      scope: "uploads",
      sort: "recent",
      query: "Demo Skill",
    });
    expect(request).toHaveBeenNthCalledWith(2, "skillhub.detail", { slug: "demo-skill" });
    expect(result).toEqual({
      slug: "demo-skill",
      examplePrompts: ["prompt one"],
    });
  });
});

describe("publishWorkspaceSkillWithPrompts", () => {
  it("sends explicit intent and checksum expectations, then refreshes both views", async () => {
    const { state, request } = createState();
    request
      .mockResolvedValueOnce({ message: "Updated" })
      .mockResolvedValueOnce({ entries: [] })
      .mockResolvedValueOnce({
        entries: [],
        overview: {
          sharedSkillCount: 1,
          updateAvailableCount: 0,
          localSkillCount: 1,
          installedSkillCount: 0,
          recentUpdates: [],
        },
      });

    await publishWorkspaceSkillWithPrompts(
      state,
      {
        skillName: "demo-skill",
        skillKey: "demo-skill",
        description: "Demo",
        matchedHubSlug: "demo-skill",
        installedFromHub: false,
        localChecksum: "local-checksum",
        hubChecksum: "hub-checksum",
        state: "update_available_from_local",
        actionLabel: "업데이트 업로드",
        disabled: false,
        reason: "update",
      },
      ["prompt"],
    );

    expect(request).toHaveBeenNthCalledWith(1, "skillhub.publish", {
      skillName: "demo-skill",
      intent: "update",
      expectedSlug: "demo-skill",
      expectedLocalChecksum: "local-checksum",
      expectedHubChecksum: "hub-checksum",
      examplePrompts: ["prompt"],
    });
    expect(request).toHaveBeenNthCalledWith(2, "skillhub.list", {
      scope: "discover",
      sort: "recent",
    });
    expect(request).toHaveBeenNthCalledWith(3, "skillhub.workspacePublish.list", {});
    expect(state.skillHubWorkspacePendingKeys).toEqual([]);
    expect(state.skillHubMessage).toEqual({ kind: "success", text: "Updated" });
  });
});

describe("deleteSkillHubEntry", () => {
  it("hard-deletes the Hub entry, closes stale detail, and refreshes catalog and overview", async () => {
    const { state, request } = createState();
    state.skillHubDetailSlug = "demo-skill";
    state.skillHubDetail = {} as SkillHubState["skillHubDetail"];
    request
      .mockResolvedValueOnce({ message: "Deleted from Skill Hub: demo-skill" })
      .mockResolvedValueOnce({ entries: [] })
      .mockResolvedValueOnce({
        entries: [
          {
            skillName: "Demo Skill",
            skillKey: "demo-skill",
            description: "Demo",
            installedFromHub: false,
            localChecksum: "checksum",
            state: "new_local_skill",
            actionLabel: "발행",
            disabled: false,
            reason: "new",
          },
        ],
        overview: {
          sharedSkillCount: 0,
          updateAvailableCount: 0,
          localSkillCount: 1,
          installedSkillCount: 0,
          recentUpdates: [],
        },
      });

    await deleteSkillHubEntry(state, "demo-skill");

    expect(request).toHaveBeenNthCalledWith(1, "skillhub.hardDelete", { slug: "demo-skill" });
    expect(request).toHaveBeenNthCalledWith(2, "skillhub.list", {
      scope: "discover",
      sort: "recent",
    });
    expect(request).toHaveBeenNthCalledWith(3, "skillhub.workspacePublish.list", {});
    expect(state.skillHubDetailSlug).toBeNull();
    expect(state.skillHubDetail).toBeNull();
    expect(state.skillHubOverview?.sharedSkillCount).toBe(0);
    expect(state.skillHubWorkspacePublishEntries[0]?.state).toBe("new_local_skill");
  });
});
