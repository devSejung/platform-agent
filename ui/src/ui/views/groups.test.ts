/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderGroups, type GroupsViewProps } from "./groups.ts";

const dialogRestores: Array<() => void> = [];

function installDialogMethod(name: "showModal" | "close", impl: (this: HTMLDialogElement) => void) {
  const original = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name);
  Object.defineProperty(HTMLDialogElement.prototype, name, {
    configurable: true,
    value: impl,
  });
  dialogRestores.push(() => {
    if (original) {
      Object.defineProperty(HTMLDialogElement.prototype, name, original);
    } else {
      delete (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[name];
    }
  });
}

function createProps(overrides: Partial<GroupsViewProps> = {}): GroupsViewProps {
  return {
    loading: false,
    entries: [
      {
        id: "group-platform",
        name: "Platform",
        description: "Platform group",
        scopeType: "group",
        parentGroupId: null,
        parentGroupName: null,
        groupLevel: 1,
        createdByAccountId: "eon",
        ownerAccountId: "eon",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
        archivedAt: null,
        partCount: 1,
        memberCount: 2,
        leaderCount: 1,
        canManageMembers: true,
        canEditMetadata: true,
        canCreatePart: true,
        canArchive: true,
      },
    ],
    error: null,
    includeArchived: false,
    detailGroupId: "group-platform",
    detailLoading: false,
    detail: {
      group: {
        id: "group-platform",
        name: "Platform",
        description: "Platform group",
        scopeType: "group",
        parentGroupId: null,
        parentGroupName: null,
        groupLevel: 1,
        createdByAccountId: "eon",
        ownerAccountId: "eon",
        createdAt: "2026-05-31T00:00:00.000Z",
        updatedAt: "2026-05-31T00:00:00.000Z",
        archivedAt: null,
        partCount: 1,
        memberCount: 1,
        leaderCount: 1,
        canManageMembers: true,
        canEditMetadata: true,
        canCreatePart: true,
        canArchive: true,
      },
      members: [
        {
          accountId: "eon",
          displayName: "Eon",
          email: "eon@example.com",
          department: "Platform",
          groupRole: "leader",
        },
      ],
      parts: [],
    },
    detailError: null,
    message: null,
    joinRequests: [],
    joinRequestsLoading: false,
    joinRequestsError: null,
    joinRequestsPendingCount: 0,
    showJoinRequests: true,
    createOpen: false,
    createName: "",
    createDescription: "",
    createSubmitting: false,
    partCreateOpen: false,
    partCreateParentId: null,
    partCreateName: "",
    partCreateDescription: "",
    partCreateSubmitting: false,
    editOpen: false,
    editScopeType: "group",
    editTitle: null,
    editName: "",
    editDescription: "",
    editSubmitting: false,
    memberModalOpen: false,
    memberModalScopeType: "group",
    memberModalScopeLabel: null,
    memberModalQuery: "",
    memberModalResults: [],
    memberModalSelectedAccountId: null,
    memberModalRole: "member",
    memberModalError: null,
    memberModalLoading: false,
    canAssignLeader: true,
    onToggleArchived: () => undefined,
    onRefresh: () => undefined,
    onSelectGroup: () => undefined,
    onOpenCreate: () => undefined,
    onCloseCreate: () => undefined,
    onCreateNameChange: () => undefined,
    onCreateDescriptionChange: () => undefined,
    onSubmitCreate: () => undefined,
    onOpenCreatePart: () => undefined,
    onCloseCreatePart: () => undefined,
    onPartNameChange: () => undefined,
    onPartDescriptionChange: () => undefined,
    onSubmitCreatePart: () => undefined,
    onOpenEdit: () => undefined,
    onCloseEdit: () => undefined,
    onEditNameChange: () => undefined,
    onEditDescriptionChange: () => undefined,
    onSubmitEdit: () => undefined,
    onOpenAddMember: () => undefined,
    onCloseAddMember: () => undefined,
    onMemberQueryChange: () => undefined,
    onSelectMemberAccount: () => undefined,
    onMemberRoleChange: () => undefined,
    onSubmitAddMember: () => undefined,
    onRemoveMember: () => undefined,
    onPromoteMember: () => undefined,
    onDemoteMember: () => undefined,
    onArchiveScope: () => undefined,
    onApproveJoinRequest: () => undefined,
    onRejectJoinRequest: () => undefined,
    ...overrides,
  };
}

describe("renderGroups", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (dialogRestores.length > 0) {
      dialogRestores.pop()?.();
    }
  });

  it("renders the groups workspace without throwing", async () => {
    const container = document.createElement("div");
    render(renderGroups(createProps()), container);
    await Promise.resolve();

    const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(text).toContain("Groups");
    expect(text).toContain("Platform");
    expect(text).toContain("Add member");
  });

  it("renders the create group modal when requested", async () => {
    installDialogMethod("showModal", function showModal(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    const container = document.createElement("div");
    render(
      renderGroups(
        createProps({
          createOpen: true,
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(container.textContent).toContain("Create Group");
  });
});
