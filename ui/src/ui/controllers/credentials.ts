import { i18n } from "../../i18n/index.ts";
import type { GatewayBrowserClient } from "../gateway.ts";

export type CredentialOwnerType = "account" | "room" | "system";
export type CredentialOwnerPolicy = CredentialOwnerType | "mixed";

export type CredentialDefinition = {
  id: string;
  key: string;
  label: string;
  type: string;
  description: string | null;
  descriptionEn: string | null;
  usageHint: string | null;
  ownerPolicy: CredentialOwnerPolicy;
  rotationDays: number | null;
  required: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CredentialMetadata = {
  id: string;
  definitionId: string;
  definitionKey: string;
  type: string;
  ownerType: CredentialOwnerType;
  ownerId: string;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type CredentialStatus = {
  encryptionReady: boolean;
  keyName: string;
  message: string | null;
};

type CredentialsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  credentialStatusLoading: boolean;
  credentialStatus: CredentialStatus | null;
  credentialStatusError: string | null;
  credentialDefinitionsLoading: boolean;
  credentialDefinitions: CredentialDefinition[];
  credentialDefinitionsError: string | null;
  credentialsLoading: boolean;
  credentials: CredentialMetadata[];
  credentialsError: string | null;
  credentialsMessage: { kind: "success" | "error"; text: string } | null;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isKoreanLocale(): boolean {
  return i18n.getLocale() === "ko";
}

export async function loadCredentialDefinitions(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.credentialDefinitionsLoading = true;
  state.credentialDefinitionsError = null;
  try {
    const result = await state.client.request<{ entries: CredentialDefinition[] }>(
      "credentials.definitions.list",
      {},
    );
    state.credentialDefinitions = result?.entries ?? [];
  } catch (err) {
    state.credentialDefinitionsError = getErrorMessage(err);
  } finally {
    state.credentialDefinitionsLoading = false;
  }
}

export async function loadCredentialStatus(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.credentialStatusLoading = true;
  state.credentialStatusError = null;
  try {
    state.credentialStatus = await state.client.request<CredentialStatus>("credentials.status", {});
  } catch (err) {
    state.credentialStatusError = getErrorMessage(err);
  } finally {
    state.credentialStatusLoading = false;
  }
}

export async function loadCredentials(state: CredentialsState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.credentialsLoading = true;
  state.credentialsError = null;
  try {
    const result = await state.client.request<{ entries: CredentialMetadata[] }>(
      "credentials.list",
      {},
    );
    state.credentials = result?.entries ?? [];
  } catch (err) {
    state.credentialsError = getErrorMessage(err);
  } finally {
    state.credentialsLoading = false;
  }
}

export async function upsertCredentialDefinitionAction(
  state: CredentialsState,
  params: {
    key: string;
    label: string;
    type: string;
    description?: string | null;
    descriptionEn?: string | null;
    usageHint?: string | null;
    ownerPolicy?: CredentialOwnerPolicy;
    rotationDays?: number | null;
    required?: boolean;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.credentialsMessage = null;
  try {
    await state.client.request("credentials.definitions.upsert", params);
    state.credentialsMessage = {
      kind: "success",
      text: isKoreanLocale() ? "Credential 유형을 저장했습니다." : "Credential type saved.",
    };
    await loadCredentialDefinitions(state);
  } catch (err) {
    state.credentialsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function deleteCredentialDefinitionAction(
  state: CredentialsState,
  params: { key: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.credentialsMessage = null;
  try {
    await state.client.request("credentials.definitions.delete", params);
    state.credentialsMessage = {
      kind: "success",
      text: isKoreanLocale() ? "Credential 유형을 삭제했습니다." : "Credential type deleted.",
    };
    await Promise.all([loadCredentialDefinitions(state), loadCredentials(state)]);
  } catch (err) {
    state.credentialsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function upsertCredentialAction(
  state: CredentialsState,
  params: { definitionKey: string; value: string; expiresAt?: string | null },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.credentialsMessage = null;
  try {
    await state.client.request("credentials.upsert", params);
    state.credentialsMessage = {
      kind: "success",
      text: isKoreanLocale() ? "Credential을 저장했습니다." : "Credential saved.",
    };
    await loadCredentials(state);
  } catch (err) {
    state.credentialsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}

export async function revokeCredentialAction(
  state: CredentialsState,
  params: { definitionKey: string },
) {
  if (!state.client || !state.connected) {
    return;
  }
  state.credentialsMessage = null;
  try {
    await state.client.request("credentials.revoke", params);
    state.credentialsMessage = {
      kind: "success",
      text: isKoreanLocale() ? "Credential을 폐기했습니다." : "Credential revoked.",
    };
    await loadCredentials(state);
  } catch (err) {
    state.credentialsMessage = { kind: "error", text: getErrorMessage(err) };
    throw err;
  }
}
