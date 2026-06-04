import type { GatewayBrowserClient } from "../gateway.ts";

export type SkillHubScope = "discover" | "installed" | "uploads" | "updates";
export type SkillHubSort = "recent" | "installs" | "likes" | "az";

export type SkillHubEntry = {
  slug: string;
  displayName: string;
  summary: string;
  uploaderName: string;
  uploaderEmployeeId: string;
  ownerAccountId: string;
  latestVersion: string;
  publishedAt: string;
  updatedAt: string;
  installCount: number;
  installerCount: number;
  likeCount: number;
  hidden: boolean;
  uploadedByYou: boolean;
  likedByYou: boolean;
  installed: boolean;
  canEditMetadata: boolean;
  canManageVisibility: boolean;
  canAdminManage: boolean;
  canTransferOwnership: boolean;
  installedVersion?: string;
  updateAvailable: boolean;
  flags: {
    hasHiddenFiles: boolean;
    hasExecutableFiles: boolean;
  };
};

export type SkillHubDetail = SkillHubEntry & {
  examplePrompts: string[];
  versions: Array<{
    version: string;
    uploadedBy: {
      employeeId: string;
      name?: string;
    };
    uploadedAt: string;
    path: string;
  }>;
};

export type SkillHubState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  skillHubLoading: boolean;
  skillHubEntries: SkillHubEntry[];
  skillHubError: string | null;
  skillHubScope: SkillHubScope;
  skillHubSort: SkillHubSort;
  skillHubQuery: string;
  skillHubDetail: SkillHubDetail | null;
  skillHubDetailSlug: string | null;
  skillHubDetailLoading: boolean;
  skillHubDetailError: string | null;
  skillHubBusySlug: string | null;
  skillHubMessage: { kind: "success" | "error"; text: string } | null;
  skillHubWorkspacePublishing: boolean;
  skillHubUploading: boolean;
  skillHubEditorOpen: boolean;
  skillHubEditorMode: "publish" | "upload" | "edit-metadata" | null;
  skillHubEditorSlug: string | null;
  skillHubEditorTitle: string | null;
  skillHubEditorSkillName: string | null;
  skillHubEditorFile: File | null;
  skillHubEditorDescription: string;
  skillHubEditorPrompts: string[];
  skillHubEditorError: string | null;
  skillHubEditorLoading: boolean;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export async function loadSkillHub(state: SkillHubState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillHubLoading = true;
  state.skillHubError = null;
  try {
    const result = await state.client.request<{ entries: SkillHubEntry[] }>("skillhub.list", {
      scope: state.skillHubScope,
      sort: state.skillHubSort,
      ...(state.skillHubQuery.trim() ? { query: state.skillHubQuery.trim() } : {}),
    });
    state.skillHubEntries = result?.entries ?? [];
  } catch (err) {
    state.skillHubError = getErrorMessage(err);
  } finally {
    state.skillHubLoading = false;
  }
}

export async function loadSkillHubDetail(state: SkillHubState, slug: string) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillHubDetailSlug = slug;
  state.skillHubDetailLoading = true;
  state.skillHubDetailError = null;
  state.skillHubDetail = null;
  try {
    const result = await state.client.request<{ detail: SkillHubDetail | null }>("skillhub.detail", {
      slug,
    });
    if (state.skillHubDetailSlug !== slug) {
      return;
    }
    state.skillHubDetail = result?.detail ?? null;
  } catch (err) {
    if (state.skillHubDetailSlug === slug) {
      state.skillHubDetailError = getErrorMessage(err);
    }
  } finally {
    if (state.skillHubDetailSlug === slug) {
      state.skillHubDetailLoading = false;
    }
  }
}

export function closeSkillHubDetail(state: SkillHubState) {
  state.skillHubDetail = null;
  state.skillHubDetailSlug = null;
  state.skillHubDetailError = null;
  state.skillHubDetailLoading = false;
}

function padEditorPrompts(prompts: string[]): string[] {
  const next = prompts.slice(0, 3);
  while (next.length < 3) {
    next.push("");
  }
  return next;
}

export async function resolveExistingSkillHubPromptsForSkillName(
  state: SkillHubState,
  skillName: string,
): Promise<{ slug: string; examplePrompts: string[] } | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const normalizedName = skillName.trim();
  if (!normalizedName) {
    return null;
  }

  if (
    state.skillHubDetail &&
    state.skillHubDetail.uploadedByYou &&
    state.skillHubDetail.displayName === normalizedName
  ) {
    return {
      slug: state.skillHubDetail.slug,
      examplePrompts: [...state.skillHubDetail.examplePrompts],
    };
  }

  const currentEntry = state.skillHubEntries.find(
    (entry) => entry.uploadedByYou && entry.displayName === normalizedName,
  );
  let slug = currentEntry?.slug ?? null;
  if (!slug) {
    const result = await state.client.request<{ entries: SkillHubEntry[] }>("skillhub.list", {
      scope: "uploads",
      sort: "recent",
      query: normalizedName,
    });
    slug =
      result?.entries?.find((entry) => entry.uploadedByYou && entry.displayName === normalizedName)?.slug ?? null;
  }
  if (!slug) {
    return null;
  }

  if (state.skillHubDetail?.slug === slug) {
    return {
      slug,
      examplePrompts: [...state.skillHubDetail.examplePrompts],
    };
  }

  const result = await state.client.request<{ detail: SkillHubDetail | null }>("skillhub.detail", { slug });
  if (!result?.detail || !result.detail.uploadedByYou || result.detail.displayName !== normalizedName) {
    return null;
  }
  return {
    slug,
    examplePrompts: [...result.detail.examplePrompts],
  };
}

export function toEditorPrompts(prompts: string[]): string[] {
  return padEditorPrompts(prompts);
}

async function runMutation(
  state: SkillHubState,
  slug: string,
  request: Promise<{ message?: string; version?: string }>,
) {
  state.skillHubBusySlug = slug;
  state.skillHubMessage = null;
  try {
    const result = await request;
    state.skillHubMessage = {
      kind: "success",
      text: result?.message ?? slug,
    };
    await loadSkillHub(state);
    if (state.skillHubDetailSlug === slug) {
      await loadSkillHubDetail(state, slug);
    }
  } catch (err) {
    state.skillHubMessage = {
      kind: "error",
      text: getErrorMessage(err),
    };
  } finally {
    state.skillHubBusySlug = null;
  }
}

function patchEntryLike(entry: SkillHubEntry, liked: boolean, likeCount: number): SkillHubEntry {
  return { ...entry, likedByYou: liked, likeCount };
}

function patchDetailLike(detail: SkillHubDetail, liked: boolean, likeCount: number): SkillHubDetail {
  return { ...detail, likedByYou: liked, likeCount };
}

export async function installSkillHubSkill(state: SkillHubState, slug: string) {
  if (!state.client || !state.connected) {
    return;
  }
  await runMutation(state, slug, state.client.request("skillhub.install", { slug }));
}

export async function updateSkillHubSkill(state: SkillHubState, slug: string) {
  if (!state.client || !state.connected) {
    return;
  }
  await runMutation(state, slug, state.client.request("skillhub.update", { slug }));
}

export async function deleteSkillHubSkill(state: SkillHubState, slug: string) {
  if (!state.client || !state.connected) {
    return;
  }
  await runMutation(state, slug, state.client.request("skillhub.delete", { slug }));
}

export async function hideSkillHubSkill(state: SkillHubState, slug: string, hidden = true) {
  if (!state.client || !state.connected) {
    return;
  }
  await runMutation(
    state,
    slug,
    state.client.request("skillhub.visibility.update", { slug, hidden }),
  );
}

export async function toggleLikeSkillHubSkill(state: SkillHubState, slug: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.skillHubBusySlug === slug) {
    return;
  }
  const currentEntry = state.skillHubEntries.find((entry) => entry.slug === slug);
  const currentDetail = state.skillHubDetail?.slug === slug ? state.skillHubDetail : null;
  const currentLiked = currentDetail?.likedByYou ?? currentEntry?.likedByYou ?? false;
  const currentLikeCount = currentDetail?.likeCount ?? currentEntry?.likeCount ?? 0;
  const nextLiked = !currentLiked;
  const nextLikeCount = Math.max(0, currentLikeCount + (nextLiked ? 1 : -1));
  state.skillHubBusySlug = slug;

  state.skillHubEntries = state.skillHubEntries.map((entry) =>
    entry.slug === slug ? patchEntryLike(entry, nextLiked, nextLikeCount) : entry,
  );
  if (currentDetail) {
    state.skillHubDetail = patchDetailLike(currentDetail, nextLiked, nextLikeCount);
  }

  try {
    const result = await state.client.request<{
      message?: string;
      liked?: boolean;
      likeCount?: number;
    }>("skillhub.like", { slug });
    const liked = typeof result?.liked === "boolean" ? result.liked : nextLiked;
    const likeCount = typeof result?.likeCount === "number" ? result.likeCount : nextLikeCount;
    state.skillHubEntries = state.skillHubEntries.map((entry) =>
      entry.slug === slug ? patchEntryLike(entry, liked, likeCount) : entry,
    );
    if (state.skillHubDetail?.slug === slug) {
      state.skillHubDetail = patchDetailLike(state.skillHubDetail, liked, likeCount);
    }
    state.skillHubMessage = {
      kind: "success",
      text: result?.message ?? slug,
    };
  } catch (err) {
    state.skillHubEntries = state.skillHubEntries.map((entry) =>
      entry.slug === slug ? patchEntryLike(entry, currentLiked, currentLikeCount) : entry,
    );
    if (currentDetail) {
      state.skillHubDetail = patchDetailLike(currentDetail, currentLiked, currentLikeCount);
    }
    state.skillHubMessage = {
      kind: "error",
      text: getErrorMessage(err),
    };
  } finally {
    if (state.skillHubBusySlug === slug) {
      state.skillHubBusySlug = null;
    }
  }
}

export async function publishWorkspaceSkillWithPrompts(
  state: SkillHubState,
  skillName: string,
  examplePrompts: string[],
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillHubWorkspacePublishing = true;
  try {
    const result = await state.client.request<{ message?: string }>("skillhub.publish", {
      skillName,
      examplePrompts,
    });
    state.skillHubMessage = {
      kind: "success",
      text: result?.message ?? `Published ${skillName}`,
    };
    await loadSkillHub(state);
  } catch (err) {
    throw err;
  } finally {
    state.skillHubWorkspacePublishing = false;
  }
}

export async function uploadSkillHubPackageWithPrompts(
  state: SkillHubState,
  file: File,
  examplePrompts: string[],
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.skillHubUploading = true;
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      const chunk = bytes.subarray(i, Math.min(bytes.length, i + 0x8000));
      binary += String.fromCharCode(...chunk);
    }
    const contentBase64 = btoa(binary);
    const result = await state.client.request<{ message?: string }>("skillhub.upload", {
      filename: file.name,
      contentBase64,
      examplePrompts,
    });
    state.skillHubMessage = {
      kind: "success",
      text: result?.message ?? `Uploaded ${file.name}`,
    };
    await loadSkillHub(state);
  } catch (err) {
    throw err;
  } finally {
    state.skillHubUploading = false;
  }
}

export async function updateSkillHubExamplePromptsAction(
  state: SkillHubState,
  slug: string,
  examplePrompts: string[],
) {
  if (!state.client || !state.connected) {
    return;
  }
  await runMutation(
    state,
    slug,
    state.client.request("skillhub.examplePrompts.update", {
      slug,
      examplePrompts,
    }),
  );
}

export async function updateSkillHubMetadataAction(
  state: SkillHubState,
  params: { slug: string; summary: string; examplePrompts: string[] },
) {
  if (!state.client || !state.connected) {
    return;
  }
  await runMutation(
    state,
    params.slug,
    state.client.request("skillhub.metadata.update", {
      slug: params.slug,
      summary: params.summary,
      examplePrompts: params.examplePrompts,
    }),
  );
}

export async function transferSkillHubOwnershipAction(
  state: SkillHubState,
  params: { slug: string; targetAccountId: string; reason?: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  await runMutation(
    state,
    params.slug,
    state.client.request("skillhub.transferOwnership", {
      slug: params.slug,
      targetAccountId: params.targetAccountId,
      ...(params.reason?.trim() ? { reason: params.reason.trim() } : {}),
    }),
  );
}
