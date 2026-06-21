// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const releaseMocks = vi.hoisted(() => ({
  loadIndex: vi.fn(),
  loadMarkdown: vi.fn(),
  loadStatus: vi.fn(),
  confirmRead: vi.fn(),
}));

vi.mock("./controllers/release-notes.ts", () => ({
  loadPlatformClawReleaseIndex: releaseMocks.loadIndex,
  loadPlatformClawReleaseMarkdown: releaseMocks.loadMarkdown,
  loadEmployeeReleaseNotesStatus: releaseMocks.loadStatus,
  confirmEmployeeReleaseNotesRead: releaseMocks.confirmRead,
}));

import { OpenClawApp } from "./app.ts";

describe("OpenClawApp release note flow", () => {
  beforeEach(() => {
    releaseMocks.loadIndex.mockReset().mockResolvedValue({
      name: "PlatformClaw",
      latest: "2026.6.18",
      releases: [
        {
          version: "2026.6.18",
          date: "2026-06-18",
          title: "첨부파일 및 로그인 화면 개선",
          path: "docs/platformclaw/releases/2026.6.18.md",
        },
      ],
    });
    releaseMocks.loadMarkdown.mockReset().mockResolvedValue("# PlatformClaw v2026.6.18");
    releaseMocks.loadStatus.mockReset().mockResolvedValue({
      latestVersion: "2026.6.18",
      readVersion: null,
      shouldAutoOpen: true,
    });
    releaseMocks.confirmRead.mockReset().mockResolvedValue({
      latestVersion: "2026.6.18",
      readVersion: "2026.6.18",
      shouldAutoOpen: false,
    });
  });

  it("auto-opens once for an unread employee and stops after confirmation", async () => {
    const app = new OpenClawApp();
    app.employeeMode = true;
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    };

    await app.maybeOpenUnreadReleaseNotes();
    await app.maybeOpenUnreadReleaseNotes();

    expect(releaseMocks.loadStatus).toHaveBeenCalledTimes(1);
    expect(app.releaseNotesOpen).toBe(true);
    expect(app.releaseNotesAutoMode).toBe(true);
    expect(app.releaseNotesSelectedVersion).toBe("2026.6.18");

    await app.handleConfirmReleaseNotes();

    expect(releaseMocks.confirmRead).toHaveBeenCalledWith("2026.6.18");
    expect(app.releaseNotesReadVersion).toBe("2026.6.18");
    expect(app.releaseNotesOpen).toBe(false);
  });

  it("does not auto-open when the employee already read the latest release", async () => {
    releaseMocks.loadStatus.mockResolvedValue({
      latestVersion: "2026.6.18",
      readVersion: "2026.6.18",
      shouldAutoOpen: false,
    });
    const app = new OpenClawApp();
    app.employeeMode = true;
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    };

    await app.maybeOpenUnreadReleaseNotes();

    expect(app.releaseNotesOpen).toBe(false);
    expect(releaseMocks.loadIndex).not.toHaveBeenCalled();
  });

  it("checks the new employee after an in-flight check for another employee", async () => {
    let resolveFirstStatus: ((value: unknown) => void) | undefined;
    releaseMocks.loadStatus
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstStatus = resolve;
          }),
      )
      .mockResolvedValueOnce({
        latestVersion: "2026.6.18",
        readVersion: null,
        shouldAutoOpen: true,
      });
    const app = new OpenClawApp();
    app.employeeMode = true;
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    };

    const firstCheck = app.maybeOpenUnreadReleaseNotes();
    app.employeeProfile = {
      employeeId: "minji",
      name: "Minji",
      department: "Platform",
      agentId: "minji",
    };
    const secondCheck = app.maybeOpenUnreadReleaseNotes();
    resolveFirstStatus?.({
      latestVersion: "2026.6.18",
      readVersion: "2026.6.18",
      shouldAutoOpen: false,
    });

    await Promise.all([firstCheck, secondCheck]);

    expect(releaseMocks.loadStatus).toHaveBeenCalledTimes(2);
    expect(app.releaseNotesOpen).toBe(true);
    expect(app.releaseNotesSelectedVersion).toBe("2026.6.18");
  });

  it("does not apply a read confirmation after the employee changes", async () => {
    let resolveConfirmation: ((value: unknown) => void) | undefined;
    releaseMocks.confirmRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConfirmation = resolve;
        }),
    );
    const app = new OpenClawApp();
    app.employeeMode = true;
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Platform",
      agentId: "eon",
    };
    app.releaseNotesIndex = await releaseMocks.loadIndex();
    app.releaseNotesSelectedVersion = "2026.6.18";
    app.releaseNotesOpen = true;

    const confirmation = app.handleConfirmReleaseNotes();
    app.employeeProfile = {
      employeeId: "minji",
      name: "Minji",
      department: "Platform",
      agentId: "minji",
    };
    resolveConfirmation?.({
      latestVersion: "2026.6.18",
      readVersion: "2026.6.18",
      shouldAutoOpen: false,
    });
    await confirmation;

    expect(app.releaseNotesReadVersion).toBeNull();
    expect(app.releaseNotesOpen).toBe(true);
  });
});
