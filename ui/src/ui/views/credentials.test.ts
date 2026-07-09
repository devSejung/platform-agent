/* @vitest-environment jsdom */

import { render } from "lit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { renderCredentials, type CredentialsViewProps } from "./credentials.ts";

function createProps(overrides: Partial<CredentialsViewProps> = {}): CredentialsViewProps {
  return {
    statusLoading: false,
    encryptionReady: true,
    encryptionKeyName: "PLATFORMCLAW_MASTER_KEY",
    statusError: null,
    loading: false,
    definitions: [
      {
        id: "def-jira",
        key: "jira.default",
        label: "Jira Token",
        type: "jira_token",
        description: "Jira 작업용 토큰",
        descriptionEn: "Token used for Jira actions.",
        usageHint: "Jira 이슈 생성 Skill",
        ownerPolicy: "account",
        rotationDays: 90,
        required: true,
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        archivedAt: null,
      },
    ],
    definitionsError: null,
    credentialsLoading: false,
    credentials: [
      {
        id: "cred-jira",
        definitionId: "def-jira",
        definitionKey: "jira.default",
        type: "jira_token",
        ownerType: "account",
        ownerId: "eon",
        encryptionVersion: 1,
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z",
        lastUsedAt: null,
        expiresAt: null,
        revokedAt: null,
      },
    ],
    credentialsError: null,
    message: null,
    valueDrafts: {},
    expiresAtDrafts: {},
    savingKey: null,
    revokingKey: null,
    canManageDefinitions: false,
    definitionDraft: {
      key: "",
      label: "",
      type: "api_token",
      description: "",
      descriptionEn: "",
      usageHint: "",
      ownerPolicy: "account",
      rotationDays: "",
      required: false,
    },
    definitionSaving: false,
    definitionDeletingKey: null,
    definitionModalOpen: false,
    onRefresh: () => undefined,
    onValueDraftChange: () => undefined,
    onExpiresAtDraftChange: () => undefined,
    onSaveCredential: () => undefined,
    onRevokeCredential: () => undefined,
    onDefinitionDraftChange: () => undefined,
    onOpenDefinitionCreate: () => undefined,
    onCloseDefinitionModal: () => undefined,
    onSaveDefinition: () => undefined,
    onDeleteDefinition: () => undefined,
    onUseDefinitionTemplate: () => undefined,
    ...overrides,
  };
}

describe("renderCredentials", () => {
  beforeEach(async () => {
    await i18n.setLocale("ko");
  });

  it("renders credential metadata without rendering the secret value", async () => {
    const container = document.createElement("div");
    render(
      renderCredentials(createProps({ valueDrafts: { "jira.default": "jira-secret-token" } })),
      container,
    );
    await Promise.resolve();

    const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(text).toContain("Jira Token");
    expect(text).toContain("등록됨");
    expect(text).toContain("Jira 작업용 토큰");
    expect(text).toContain("Jira 이슈 생성 Skill");
    expect(text).not.toContain("Token used for Jira actions.");
    expect(text).not.toContain("jira-secret-token");
    expect(container.querySelector("input[type='password']")).toBeTruthy();
  });

  it("shows admin definition fields only for admins", async () => {
    const container = document.createElement("div");
    render(renderCredentials(createProps({ canManageDefinitions: false })), container);
    await Promise.resolve();
    expect(container.textContent).not.toContain("Credential Types");

    render(renderCredentials(createProps({ canManageDefinitions: true })), container);
    await Promise.resolve();
    expect(container.textContent).toContain("Credential 유형 추가");
    expect(container.querySelector("dialog")).toBeNull();

    render(
      renderCredentials(createProps({ canManageDefinitions: true, definitionModalOpen: true })),
      container,
    );
    await Promise.resolve();
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(container.textContent).toContain("Credential 유형");
    expect(container.textContent).toContain("영어 설명");
  });

  it("switches static labels when locale is English", async () => {
    await i18n.setLocale("en");
    const container = document.createElement("div");
    render(
      renderCredentials(createProps({ canManageDefinitions: true, definitionModalOpen: true })),
      container,
    );
    await Promise.resolve();

    const text = container.textContent?.replace(/\s+/g, " ").trim() ?? "";
    expect(text).toContain("Registered");
    expect(text).toContain("Credential Types");
    expect(text).toContain("English description");
    expect(text).toContain("Token used for Jira actions.");
    expect(text).toContain("Jira 이슈 생성 Skill");
    expect(text).not.toContain("Jira 작업용 토큰");
  });

  it("disables credential value inputs when encryption is not ready", async () => {
    const container = document.createElement("div");
    render(renderCredentials(createProps({ encryptionReady: false })), container);
    await Promise.resolve();

    expect(container.textContent).toContain("Credential 암호화 설정이 필요합니다");
    expect((container.querySelector("input[type='password']") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  it("submits row save actions without exposing the value in text", async () => {
    const onSaveCredential = vi.fn();
    const container = document.createElement("div");
    render(
      renderCredentials(
        createProps({
          credentials: [],
          valueDrafts: { "jira.default": "jira-secret-token" },
          onSaveCredential,
        }),
      ),
      container,
    );
    await Promise.resolve();

    (container.querySelector("form.credentials-card__form") as HTMLFormElement).requestSubmit();
    expect(onSaveCredential).toHaveBeenCalledWith("jira.default");
    expect(container.textContent).not.toContain("jira-secret-token");
  });
});
