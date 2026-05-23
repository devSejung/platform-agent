/* @vitest-environment jsdom */

import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import type { SkillStatusEntry, SkillStatusReport } from "../types.ts";
import { renderSkills, type SkillsProps } from "./skills.ts";

const dialogRestores: Array<() => void> = [];

function normalizeText(node: Element | DocumentFragment): string {
  return node.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function createSkill(overrides: Partial<SkillStatusEntry> = {}): SkillStatusEntry {
  return {
    name: "Repo Skill",
    description: "Skill description",
    source: "workspace",
    filePath: "/tmp/skill",
    baseDir: "/tmp",
    skillKey: "repo-skill",
    bundled: false,
    primaryEnv: "OPENAI_API_KEY",
    emoji: undefined,
    homepage: "https://example.com",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    missing: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [],
    ...overrides,
  };
}

function createProps(overrides: Partial<SkillsProps> = {}): SkillsProps {
  const report: SkillStatusReport = {
    workspaceDir: "/tmp/workspace",
    managedSkillsDir: "/tmp/skills",
    skills: [createSkill()],
  };

  return {
    connected: true,
    loading: false,
    report,
    error: null,
    filter: "",
    statusFilter: "all",
    edits: {},
    busyKey: null,
    messages: {},
    detailKey: null,
    clawhubQuery: "",
    clawhubResults: null,
    clawhubSearchLoading: false,
    clawhubSearchError: null,
    clawhubDetail: null,
    clawhubDetailSlug: null,
    clawhubDetailLoading: false,
    clawhubDetailError: null,
    clawhubInstallSlug: null,
    clawhubInstallMessage: null,
    onFilterChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onRefresh: () => undefined,
    onToggle: () => undefined,
    onEdit: () => undefined,
    onSaveKey: () => undefined,
    onInstall: () => undefined,
    onDelete: () => undefined,
    onUpdateHubSkill: () => undefined,
    onDetailOpen: () => undefined,
    onDetailClose: () => undefined,
    onClawHubQueryChange: () => undefined,
    onClawHubDetailOpen: () => undefined,
    onClawHubDetailClose: () => undefined,
    onClawHubInstall: () => undefined,
    ...overrides,
  };
}

describe("renderSkills", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    while (dialogRestores.length > 0) {
      dialogRestores.pop()?.();
    }
  });

  it("opens the skill detail dialog as a modal", async () => {
    const container = document.createElement("div");
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    installDialogMethod("showModal", showModal);

    render(
      renderSkills(
        createProps({
          detailKey: "repo-skill",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(container.querySelector("dialog")?.hasAttribute("open")).toBe(true);
  });

  it("shows source and SKILL.md paths in the skill detail dialog", async () => {
    const container = document.createElement("div");
    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });

    render(
      renderSkills(
        createProps({
          detailKey: "repo-skill",
          report: {
            workspaceDir: "/work/main",
            managedSkillsDir: "/tmp/skills",
            skills: [
              createSkill({
                source: "openclaw-extra",
                filePath: "/opt/platformclaw/skills/repo-skill/SKILL.md",
                baseDir: "/opt/platformclaw/skills/repo-skill",
              }),
            ],
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = normalizeText(container);
    expect(text).toContain("Source Configured Global");
    expect(text).toContain("SKILL.md");
    expect(text).toContain("Base dir");
    expect(text).toContain("/opt/platformclaw/skills/repo-skill/SKILL.md");
  });

  it("closes the skill detail dialog through the dialog close event", async () => {
    const container = document.createElement("div");
    const onDetailClose = vi.fn();

    installDialogMethod("showModal", function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    installDialogMethod("close", function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });

    render(
      renderSkills(
        createProps({
          detailKey: "repo-skill",
          onDetailClose,
        }),
      ),
      container,
    );
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>(".md-preview-dialog__header .btn")?.click();

    expect(onDetailClose).toHaveBeenCalledTimes(1);
  });

  it("renders the Skill Hub callout and external browse action", async () => {
    const container = document.createElement("div");

    render(
      renderSkills(
        createProps({
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = normalizeText(container);
    expect(text).toContain("Browse Skills Store");
    expect(text).toContain("Skill Hub");
    expect(text).toContain("Skill discovery, publishing, package upload, and shared installs");
    const browseLink = container.querySelector<HTMLAnchorElement>('a[href="https://clawhub.com"]');
    expect(browseLink).not.toBeNull();
  });

  it("renders skill diagnostics with configured global source and attention shortcuts", async () => {
    const container = document.createElement("div");
    const onDetailOpen = vi.fn();

    render(
      renderSkills(
        createProps({
          report: {
            workspaceDir: "/work/main",
            managedSkillsDir: "/home/node/.openclaw/skills",
            skills: [
              createSkill({
                name: "Jira Company",
                source: "openclaw-extra",
                filePath: "/opt/platformclaw/skills/jira-company/SKILL.md",
                baseDir: "/opt/platformclaw/skills/jira-company",
                skillKey: "jira-company",
              }),
              createSkill({
                name: "Broken Skill",
                source: "agents-skills-project",
                filePath: "/work/main/.agents/skills/broken/SKILL.md",
                baseDir: "/work/main/.agents/skills/broken",
                skillKey: "broken",
                eligible: false,
                missing: {
                  bins: ["jira"],
                  env: [],
                  config: [],
                  os: [],
                },
              }),
              createSkill({
                name: "Apple Notes",
                source: "openclaw-bundled",
                filePath: "/app/skills/apple-notes/SKILL.md",
                baseDir: "/app/skills/apple-notes",
                skillKey: "apple-notes",
                bundled: true,
                eligible: false,
                missing: {
                  bins: [],
                  env: [],
                  config: [],
                  os: ["darwin"],
                },
              }),
            ],
          },
          onDetailOpen,
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = normalizeText(container);
    expect(text).toContain("Skill Diagnostics");
    expect(text).toContain("Configured Global");
    expect(text).toContain("skills.load.extraDirs");
    expect(text).toContain("Unavailable");
    expect(text).toContain("Needs attention");
    expect(text).toContain("Broken Skill");
    expect(text).not.toContain("Apple Notes os:darwin");

    container.querySelector<HTMLButtonElement>(".skills-issue-pill")?.click();
    expect(onDetailOpen).toHaveBeenCalledWith("broken");
  });

  it("opens the ClawHub detail dialog and renders install feedback", async () => {
    const container = document.createElement("div");
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    const onClawHubInstall = vi.fn();
    installDialogMethod("showModal", showModal);

    render(
      renderSkills(
        createProps({
          clawhubInstallMessage: { kind: "success", text: "Installed github" },
          clawhubDetailSlug: "github",
          clawhubDetail: {
            skill: {
              slug: "github",
              displayName: "GitHub",
              summary: "GitHub integration for OpenClaw",
              createdAt: 1_700_000_000,
              updatedAt: 1_700_000_100,
            },
            latestVersion: {
              version: "1.2.3",
              createdAt: 1_700_000_200,
              changelog: "Added search support",
            },
            metadata: {
              os: ["macos", "linux"],
            },
            owner: {
              displayName: "OpenClaw",
              handle: "openclaw",
            },
          },
          onClawHubInstall,
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(showModal).toHaveBeenCalledTimes(1);
    const text = normalizeText(container);
    expect(text).toContain("Installed github");
    expect(text).toContain("By OpenClaw (@openclaw)");
    expect(text).toContain("Latest: v1.2.3");
    expect(text).toContain("Platforms: macos, linux");
    expect(text).toContain("Added search support");

    container
      .querySelector<HTMLButtonElement>(".md-preview-dialog__body .btn.primary")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onClawHubInstall).toHaveBeenCalledTimes(1);
    expect(onClawHubInstall).toHaveBeenCalledWith("github");
  });
});

function installDialogMethod(
  name: "showModal" | "close",
  value: (this: HTMLDialogElement) => void,
) {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & Record<string, unknown>;
  const original = Object.getOwnPropertyDescriptor(proto, name);
  Object.defineProperty(proto, name, {
    configurable: true,
    writable: true,
    value,
  });
  dialogRestores.push(() => {
    if (original) {
      Object.defineProperty(proto, name, original);
      return;
    }
    delete proto[name];
  });
}
