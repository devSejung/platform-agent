// @vitest-environment jsdom

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderReleaseNotesDialog } from "./app-render.ts";
import type { AppViewState } from "./app-view-state.ts";

describe("release note dialog", () => {
  it("keeps the dialog open when selecting another release rerenders it", () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    const close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: close,
    });
    const container = document.createElement("div");
    const state = {
      employeeMode: true,
      employeeProfile: { employeeId: "eon" },
      releaseNotesOpen: true,
      releaseNotesLoading: false,
      releaseNotesError: null,
      releaseNotesIndex: {
        name: "PlatformClaw",
        latest: "2026.6.21",
        releases: [
          {
            version: "2026.6.21",
            date: "2026-06-21",
            title: "최신 업데이트",
            path: "docs/platformclaw/releases/2026.6.21.md",
          },
          {
            version: "2026.6.18",
            date: "2026-06-18",
            title: "이전 업데이트",
            path: "docs/platformclaw/releases/2026.6.18.md",
          },
        ],
      },
      releaseNotesSelectedVersion: "2026.6.21",
      releaseNotesMarkdownByVersion: { "2026.6.21": "# PlatformClaw v2026.6.21" },
      releaseNotesReadVersion: null,
      releaseNotesAutoMode: false,
      releaseNotesMobileDetail: false,
      releaseNotesReadSubmitting: false,
      handleSelectReleaseNotesVersion: vi.fn(),
      handleReleaseNotesBackToList: vi.fn(),
      handleConfirmReleaseNotes: vi.fn(),
      handleCloseReleaseNotes: vi.fn(),
    } as unknown as AppViewState;

    try {
      render(renderReleaseNotesDialog(state), container);
      state.releaseNotesSelectedVersion = "2026.6.18";
      state.releaseNotesMarkdownByVersion["2026.6.18"] = "# PlatformClaw v2026.6.18";
      render(renderReleaseNotesDialog(state), container);

      expect(showModal).toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
      Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    }
  });

  it("renders the release list, selected content, and unread confirmation actions", () => {
    const container = document.createElement("div");
    const state = {
      employeeMode: true,
      employeeProfile: { employeeId: "eon" },
      releaseNotesOpen: true,
      releaseNotesLoading: false,
      releaseNotesError: null,
      releaseNotesIndex: {
        name: "PlatformClaw",
        latest: "2026.6.18",
        releases: [
          {
            version: "2026.6.18",
            date: "2026-06-18",
            title: "첨부파일 및 로그인 화면 개선",
            path: "docs/platformclaw/releases/2026.6.18.md",
          },
          {
            version: "2026.5.20",
            date: "2026-05-20",
            title: "이전 업데이트",
            path: "docs/platformclaw/releases/2026.5.20.md",
          },
        ],
      },
      releaseNotesSelectedVersion: "2026.6.18",
      releaseNotesMarkdownByVersion: {
        "2026.6.18": "# PlatformClaw v2026.6.18\n\n## 추가\n\n- 새 기능",
      },
      releaseNotesReadVersion: null,
      releaseNotesAutoMode: true,
      releaseNotesMobileDetail: true,
      releaseNotesReadSubmitting: false,
      handleSelectReleaseNotesVersion: vi.fn(),
      handleReleaseNotesBackToList: vi.fn(),
      handleConfirmReleaseNotes: vi.fn(),
      handleCloseReleaseNotes: vi.fn(),
    } as unknown as AppViewState;

    render(renderReleaseNotesDialog(state), container);

    expect(container.querySelectorAll(".release-notes-list__item")).toHaveLength(2);
    expect(container.textContent).toContain("첨부파일 및 로그인 화면 개선");
    expect(container.textContent).toContain("최신");
    expect(container.textContent).toContain("PlatformClaw v2026.6.18");
    expect(container.textContent).toContain("나중에");
    expect(container.textContent).toContain("확인");
    expect(container.querySelector(".release-notes-list__unread")).not.toBeNull();
  });

  it("does not offer read confirmation after the latest release was read", () => {
    const container = document.createElement("div");
    const state = {
      employeeMode: true,
      employeeProfile: { employeeId: "eon" },
      releaseNotesOpen: true,
      releaseNotesLoading: false,
      releaseNotesError: null,
      releaseNotesIndex: {
        name: "PlatformClaw",
        latest: "2026.6.18",
        releases: [
          {
            version: "2026.6.18",
            date: "2026-06-18",
            title: "최신 업데이트",
            path: "docs/platformclaw/releases/2026.6.18.md",
          },
        ],
      },
      releaseNotesSelectedVersion: "2026.6.18",
      releaseNotesMarkdownByVersion: { "2026.6.18": "# PlatformClaw v2026.6.18" },
      releaseNotesReadVersion: "2026.6.18",
      releaseNotesAutoMode: false,
      releaseNotesMobileDetail: false,
      releaseNotesReadSubmitting: false,
      handleSelectReleaseNotesVersion: vi.fn(),
      handleReleaseNotesBackToList: vi.fn(),
      handleConfirmReleaseNotes: vi.fn(),
      handleCloseReleaseNotes: vi.fn(),
    } as unknown as AppViewState;

    render(renderReleaseNotesDialog(state), container);

    expect(container.querySelector(".release-notes-list__unread")).toBeNull();
    expect(container.textContent).not.toContain("나중에");
    expect(container.textContent).toContain("닫기");
  });

  it("does not offer read confirmation before employee sign-in", () => {
    const container = document.createElement("div");
    const state = {
      employeeMode: true,
      employeeProfile: { employeeId: null },
      releaseNotesOpen: true,
      releaseNotesLoading: false,
      releaseNotesError: null,
      releaseNotesIndex: {
        name: "PlatformClaw",
        latest: "2026.6.18",
        releases: [
          {
            version: "2026.6.18",
            date: "2026-06-18",
            title: "최신 업데이트",
            path: "docs/platformclaw/releases/2026.6.18.md",
          },
        ],
      },
      releaseNotesSelectedVersion: "2026.6.18",
      releaseNotesMarkdownByVersion: { "2026.6.18": "# PlatformClaw v2026.6.18" },
      releaseNotesReadVersion: null,
      releaseNotesAutoMode: false,
      releaseNotesMobileDetail: false,
      releaseNotesReadSubmitting: false,
      handleSelectReleaseNotesVersion: vi.fn(),
      handleReleaseNotesBackToList: vi.fn(),
      handleConfirmReleaseNotes: vi.fn(),
      handleCloseReleaseNotes: vi.fn(),
    } as unknown as AppViewState;

    render(renderReleaseNotesDialog(state), container);

    expect(container.textContent).not.toContain("확인");
    expect(container.textContent).toContain("닫기");
  });
});
