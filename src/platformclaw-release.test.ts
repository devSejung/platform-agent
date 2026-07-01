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
    const latest = index?.releases[0];

    expect(index).toMatchObject({
      name: "PlatformClaw",
      latest: latest?.version,
    });
    expect(latest).toMatchObject({
      version: index?.latest,
      path: `docs/platformclaw/releases/${index?.latest}.md`,
    });
    expect(readLatestPlatformClawReleaseNotes()).toContain(`# PlatformClaw v${index?.latest}`);
    expect(readPlatformClawReleaseNotes(index?.latest ?? "")).toContain("## 추가");
    expect(readPlatformClawReleaseNotes("2026.6.18")).toContain("## 추가");
    expect(readPlatformClawReleaseNotes("missing")).toBeNull();
  });

  it("uses the manifest latest version for product metadata", () => {
    const index = readPlatformClawReleaseIndex();
    expect(resolvePlatformClawReleaseInfo({} as NodeJS.ProcessEnv)).toMatchObject({
      name: "PlatformClaw",
      version: index?.latest,
      releaseNotesPath: `docs/platformclaw/releases/${index?.latest}.md`,
    });
  });
});
