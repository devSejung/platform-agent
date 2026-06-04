/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { SkillStatusEntry, SkillStatusReport } from "../types.ts";
import { renderSkillHub, type SkillHubProps } from "./skill-hub.ts";

const dialogRestores: Array<() => void> = [];

function createWorkspaceSkill(overrides: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: "workspace-skill-alpha",
    description: "Workspace skill description",
    source: "openclaw-workspace",
    filePath: "/tmp/workspace/skills/workspace-skill-alpha/SKILL.md",
    baseDir: "/tmp/workspace/skills/workspace-skill-alpha",
    skillKey: "workspace-skill-alpha",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: { bins: [], env: [], config: [], os: [] },
    missing: { bins: [], env: [], config: [], os: [] },
    configChecks: [],
    install: [],
    ...overrides,
  };
}

function createProps(overrides: Partial<SkillHubProps> = {}): SkillHubProps {
  const workspaceSkillsReport: SkillStatusReport = {
    workspaceDir: "/tmp/workspace",
    managedSkillsDir: "/tmp/managed-skills",
    skills: [createWorkspaceSkill()],
  };
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
    uploading: false,
    workspacePanelOpen: false,
    workspaceSkillsReport,
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
    onSetVisibility: () => undefined,
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

describe("renderSkillHub", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (dialogRestores.length > 0) {
      dialogRestores.pop()?.();
    }
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
