import { describe, expect, it } from "vitest";
import {
  readLatestPlatformClawReleaseNotes,
  readPlatformClawReleaseIndex,
  readPlatformClawReleaseNotes,
  resolvePlatformClawReleaseInfo,
} from "./platformclaw-release.js";

describe("PlatformClaw release notes", () => {
  it("loads the latest release from the versioned manifest", () => {
    const index = readPlatformClawReleaseIndex();

    expect(index).toMatchObject({
      name: "PlatformClaw",
      latest: "2026.6.21",
    });
    expect(index?.releases[0]).toMatchObject({
      version: "2026.6.21",
      date: "2026-06-21",
      title: "결과물 미리보기 및 Skill Hub 개선",
    });
    expect(readLatestPlatformClawReleaseNotes()).toContain("# PlatformClaw v2026.6.21");
    expect(readPlatformClawReleaseNotes("2026.6.21")).toContain("## 추가");
    expect(readPlatformClawReleaseNotes("2026.6.18")).toContain("## 추가");
    expect(readPlatformClawReleaseNotes("missing")).toBeNull();
  });

  it("uses the manifest latest version for product metadata", () => {
    expect(resolvePlatformClawReleaseInfo({} as NodeJS.ProcessEnv)).toMatchObject({
      name: "PlatformClaw",
      version: "2026.6.21",
      releaseNotesPath: "docs/platformclaw/releases/2026.6.21.md",
    });
  });
});
