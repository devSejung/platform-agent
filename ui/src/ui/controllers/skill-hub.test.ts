import { describe, expect, it, vi } from "vitest";
import {
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
