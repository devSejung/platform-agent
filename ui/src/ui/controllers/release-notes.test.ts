import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmEmployeeReleaseNotesRead,
  loadEmployeeReleaseNotesStatus,
  loadPlatformClawReleaseIndex,
  loadPlatformClawReleaseMarkdown,
} from "./release-notes.ts";

describe("release note controller", () => {
  const fetchMock = vi.fn();

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("loads the release list and a selected version from the Control UI base path", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
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
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "# PlatformClaw v2026.6.18",
        }),
    );

    const index = await loadPlatformClawReleaseIndex("/control/");
    const markdown = await loadPlatformClawReleaseMarkdown("/control/", index.latest);

    expect(index.latest).toBe("2026.6.18");
    expect(markdown).toContain("v2026.6.18");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/control/__openclaw/release-notes/index.json");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/control/__openclaw/release-notes/2026.6.18.md");
  });

  it("uses the employee session cookie for status and read confirmation", async () => {
    vi.stubGlobal(
      "fetch",
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            latestVersion: "2026.6.18",
            readVersion: null,
            shouldAutoOpen: true,
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            latestVersion: "2026.6.18",
            readVersion: "2026.6.18",
            shouldAutoOpen: false,
          }),
        }),
    );

    expect(await loadEmployeeReleaseNotesStatus()).toMatchObject({ shouldAutoOpen: true });
    expect(await confirmEmployeeReleaseNotesRead("2026.6.18")).toMatchObject({
      shouldAutoOpen: false,
    });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      credentials: "include",
    });
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ version: "2026.6.18" }),
    });
  });
});
