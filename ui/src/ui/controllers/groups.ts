import type { GatewayBrowserClient } from "../gateway.ts";

export type GroupScopeType = "group" | "part";
export type GroupRole = "member" | "leader";

export type GroupMemberEntry = {
  accountId: string;
  displayName: string;
  email: string | null;
  department: string | null;
  groupRole: GroupRole;
};

export type GroupEntry = {
  id: string;
  name: string;
  description: string | null;
  scopeType: GroupScopeType;
  parentGroupId: string | null;
  parentGroupName: string | null;
  groupLevel: 1 | 2;
  createdByAccountId: string;
  ownerAccountId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  partCount: number;
  memberCount: number;
  leaderCount: number;
  canManageMembers: boolean;
  canEditMetadata: boolean;
  canCreatePart: boolean;
  canArchive: boolean;
};

export type GroupDetail = {
  group: GroupEntry;
  members: GroupMemberEntry[];
  parts: Array<GroupEntry & { members: GroupMemberEntry[] }>;
};

export type GroupJoinRequestStatus = "pending" | "approved" | "rejected";

export type GroupJoinRequestEntry = {
  id: string;
  accountId: string;
  employeeId: string;
  displayName: string;
  email: string | null;
  department: string | null;
  groupId: string;
  groupName: string;
  partId: string;
  partName: string;
  status: GroupJoinRequestStatus;
  requestedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedByAccountId: string | null;
  reviewComment: string | null;
};

export type GroupScopeOption = {
  scopeType: GroupScopeType;
  scopeId: string;
  label: string;
  archived: boolean;
};

type GroupsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  groupsLoading: boolean;
  groupsEntries: GroupEntry[];
  groupsError: string | null;
  groupsIncludeArchived: boolean;
  groupsDetailGroupId: string | null;
  groupsDetailLoading: boolean;
  groupsDetail: GroupDetail | null;
  groupsDetailError: string | null;
  groupsScopeOptions: GroupScopeOption[];
  groupsMessage: { kind: "success" | "error"; text: string } | null;
  groupsJoinRequests: GroupJoinRequestEntry[];
  groupsJoinRequestsLoading: boolean;
  groupsJoinRequestsError: string | null;
  groupsJoinRequestsPendingCount: number;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function loadGroups(state: GroupsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsLoading = true;
  state.groupsError = null;
  try {
    const result = await state.client.request<{ entries: GroupEntry[] }>("groups.list", {
      includeArchived: state.groupsIncludeArchived,
    });
    state.groupsEntries = result?.entries ?? [];
  } catch (err) {
    state.groupsError = getErrorMessage(err);
  } finally {
    state.groupsLoading = false;
  }
}

export async function loadGroupDetail(state: GroupsState, groupId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsDetailGroupId = groupId;
  state.groupsDetailLoading = true;
  state.groupsDetailError = null;
  try {
    const result = await state.client.request<{ detail: GroupDetail | null }>("groups.detail", {
      groupId,
      includeArchived: state.groupsIncludeArchived,
    });
    if (state.groupsDetailGroupId !== groupId) {
      return;
    }
    state.groupsDetail = result?.detail ?? null;
  } catch (err) {
    if (state.groupsDetailGroupId === groupId) {
      state.groupsDetailError = getErrorMessage(err);
    }
  } finally {
    if (state.groupsDetailGroupId === groupId) {
      state.groupsDetailLoading = false;
    }
  }
}

export async function loadGroupScopeOptions(state: GroupsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const result = await state.client.request<{ entries: GroupScopeOption[] }>("groups.scopes.list", {
      includeArchived: false,
    });
    state.groupsScopeOptions = result?.entries ?? [];
  } catch {
    state.groupsScopeOptions = [];
  }
}

async function afterMutation(state: GroupsState, currentGroupId?: string | null) {
  await Promise.all([
    loadGroups(state),
    loadGroupScopeOptions(state),
    loadGroupJoinRequestPendingCount(state),
    loadGroupJoinRequests(state),
    currentGroupId ? loadGroupDetail(state, currentGroupId) : Promise.resolve(),
  ]);
}

export async function loadGroupJoinRequests(state: GroupsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsJoinRequestsLoading = true;
  state.groupsJoinRequestsError = null;
  try {
    const result = await state.client.request<{ entries: GroupJoinRequestEntry[] }>(
      "groups.joinRequests.list",
      {},
    );
    state.groupsJoinRequests = result?.entries ?? [];
  } catch (err) {
    state.groupsJoinRequestsError = getErrorMessage(err);
  } finally {
    state.groupsJoinRequestsLoading = false;
  }
}

export async function loadGroupJoinRequestPendingCount(state: GroupsState) {
  if (!state.client || !state.connected) {
    return;
  }
  try {
    const result = await state.client.request<{ count: number }>("groups.joinRequests.pendingCount", {});
    state.groupsJoinRequestsPendingCount = typeof result?.count === "number" ? result.count : 0;
  } catch {
    state.groupsJoinRequestsPendingCount = 0;
  }
}

export async function approveGroupJoinRequestAction(state: GroupsState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.joinRequests.approve", {
      requestId,
    });
    state.groupsMessage = { kind: "success", text: result.message };
    await afterMutation(state, state.groupsDetail?.group.id ?? null);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function rejectGroupJoinRequestAction(state: GroupsState, requestId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.joinRequests.reject", {
      requestId,
    });
    state.groupsMessage = { kind: "success", text: result.message };
    await afterMutation(state, state.groupsDetail?.group.id ?? null);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function createGroupAction(
  state: GroupsState,
  params: { name: string; description?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.create", params);
    state.groupsMessage = { kind: "success", text: result.message };
    await afterMutation(state);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function createPartAction(
  state: GroupsState,
  params: { groupId: string; name: string; description?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.part.create", params);
    state.groupsMessage = { kind: "success", text: result.message };
    await afterMutation(state, params.groupId);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function updateGroupAction(
  state: GroupsState,
  params: { groupId: string; name: string; description?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.update", params);
    state.groupsMessage = { kind: "success", text: result.message };
    await afterMutation(state, params.groupId);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function updatePartAction(
  state: GroupsState,
  params: { groupId: string; partId: string; name: string; description?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.part.update", {
      partId: params.partId,
      name: params.name,
      description: params.description,
    });
    state.groupsMessage = { kind: "success", text: result.message };
    await afterMutation(state, params.groupId);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function addGroupMemberAction(
  state: GroupsState,
  params: { scopeType: GroupScopeType; scopeId: string; accountId: string; groupRole?: GroupRole },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.members.add", params);
    state.groupsMessage = { kind: "success", text: result.message };
    const detailGroupId =
      state.groupsDetail?.group.id === params.scopeId
        ? params.scopeId
        : state.groupsDetail?.group.id ?? null;
    await afterMutation(state, detailGroupId);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function removeGroupMemberAction(
  state: GroupsState,
  params: { scopeType: GroupScopeType; scopeId: string; accountId: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.members.remove", params);
    state.groupsMessage = { kind: "success", text: result.message };
    const detailGroupId =
      state.groupsDetail?.group.id === params.scopeId
        ? params.scopeId
        : state.groupsDetail?.group.id ?? null;
    await afterMutation(state, detailGroupId);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function archiveGroupScopeAction(state: GroupsState, scopeId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.archive", { scopeId });
    state.groupsMessage = { kind: "success", text: result.message };
    const currentGroupId =
      state.groupsDetail?.group.id === scopeId ? null : state.groupsDetail?.group.id ?? null;
    state.groupsDetail = currentGroupId ? state.groupsDetail : null;
    state.groupsDetailGroupId = currentGroupId;
    await afterMutation(state, currentGroupId);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function restoreGroupScopeAction(state: GroupsState, scopeId: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.groupsMessage = null;
  try {
    const result = await state.client.request<{ message: string }>("groups.restore", { scopeId });
    state.groupsMessage = { kind: "success", text: result.message };
    const restoredAt = null;
    state.groupsEntries = state.groupsEntries.map((entry) =>
      entry.id === scopeId ? { ...entry, archivedAt: restoredAt } : entry,
    );
    if (state.groupsDetail?.group.id === scopeId) {
      state.groupsDetail = {
        ...state.groupsDetail,
        group: { ...state.groupsDetail.group, archivedAt: restoredAt },
      };
    } else if (state.groupsDetail) {
      state.groupsDetail = {
        ...state.groupsDetail,
        parts: state.groupsDetail.parts.map((part) =>
          part.id === scopeId ? { ...part, archivedAt: restoredAt } : part,
        ),
      };
    }
    const currentGroupId = state.groupsDetail?.group.id ?? null;
    await afterMutation(state, currentGroupId);
  } catch (err) {
    state.groupsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}
