import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

describe("skill hub metadata compatibility", () => {
  let stateDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    vi.resetModules();
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-hub-meta-"));
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skill-hub-workspace-"));
    vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(stateDir, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("fills defaults for existing metadata files without likes or example prompts", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Existing metadata",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      owner: { accountId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      versions: [
        {
          version: "1.0.0",
          uploadedBy: { employeeId: "agent-demo", name: "Demo" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.0.0",
        },
      ],
    });

    const { getSkillHubDetail, listSkillHubEntries } = await import("./skill-hub.js");
    const actor = { employeeId: "agent-demo", name: "Demo" };
    const entries = await listSkillHubEntries({ workspaceDir, actor });
    const detail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });

    expect(entries[0]?.likeCount).toBe(0);
    expect(entries[0]?.likedByYou).toBe(false);
    expect(entries[0]?.presentation).toEqual({
      displayName: "demo-skill",
      displayDescription: "Existing metadata",
      category: "other",
      icon: { source: "category_default", fallbackKey: "other" },
    });
    expect(detail?.examplePrompts).toEqual([]);
    expect(detail?.presentation).toEqual(entries[0]?.presentation);
  });

  it("returns resolved presentation without mutating stored content metadata", async () => {
    const metadataPath = path.join(stateDir, "skill-hub", "metadata", "demo-skill.json");
    const storedMetadata = {
      slug: "demo-skill",
      displayName: "Demo Skill Identity",
      summary: "Legacy summary",
      sourceDescription: "Source description",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      owner: { accountId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      latestVersion: "1.2.3",
      contentChecksum: "content-checksum",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: {
        displayName: "Presented Skill",
        displayDescription: "Presented description",
        category: "knowledge",
        icon: { type: "uploaded", assetId: "a".repeat(64) },
        examplePrompts: [],
      },
      engagement: { likeCount: 0 },
      versions: [
        {
          version: "1.2.3",
          uploadedBy: { employeeId: "agent-demo", name: "Demo" },
          uploadedAt: "2026-05-22T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.2.3",
        },
      ],
    };
    await writeJson(metadataPath, storedMetadata);
    const before = await fs.readFile(metadataPath, "utf8");

    const { getSkillHubDetail, listSkillHubEntries } = await import("./skill-hub.js");
    const actor = { employeeId: "agent-demo", name: "Demo" };
    const entries = await listSkillHubEntries({ workspaceDir, actor });
    const detail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });

    expect(entries[0]?.displayName).toBe("Demo Skill Identity");
    expect(entries[0]?.presentation).toEqual({
      displayName: "Presented Skill",
      displayDescription: "Presented description",
      category: "knowledge",
      icon: {
        source: "uploaded",
        fallbackKey: "knowledge",
        assetUrl: `/api/v1/platformclaw/skillhub/icons/${"a".repeat(64)}.png`,
      },
    });
    expect(detail?.sourceDescription).toBe("Source description");
    expect(detail?.presentation).toEqual(entries[0]?.presentation);
    expect(detail?.latestVersion).toBe("1.2.3");
    expect(detail?.updatedAt).toBe("2026-05-22T00:00:00.000Z");
    const after = await fs.readFile(metadataPath, "utf8");
    const persisted = JSON.parse(after) as {
      contentChecksum: string;
      latestVersion: string;
      updatedAt: string;
    };
    expect(persisted.contentChecksum).toBe(storedMetadata.contentChecksum);
    expect(persisted.latestVersion).toBe(storedMetadata.latestVersion);
    expect(persisted.updatedAt).toBe(storedMetadata.updatedAt);
    expect(after).toBe(before);
  });

  it("normalizes invalid stored presentation values on read", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill Identity",
      summary: "Legacy summary",
      sourceDescription: "Source description",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      owner: { accountId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: {
        displayName: " ",
        displayDescription: " ",
        category: "not-a-category",
        icon: { type: "uploaded", assetId: "" },
        examplePrompts: [],
      },
      versions: [],
    });

    const { getSkillHubDetail } = await import("./skill-hub.js");
    const detail = await getSkillHubDetail({
      workspaceDir,
      actor: { employeeId: "agent-demo", name: "Demo" },
      slug: "demo-skill",
    });

    expect(detail?.presentation).toEqual({
      displayName: "demo-skill",
      displayDescription: "Source description",
      category: "other",
      icon: { source: "category_default", fallbackKey: "other" },
    });
  });

  it("updates presentation overrides without changing content metadata", async () => {
    const metadataPath = path.join(stateDir, "skill-hub", "metadata", "demo-skill.json");
    await writeJson(metadataPath, {
      slug: "demo-skill",
      displayName: "Demo Skill Identity",
      summary: "Legacy summary",
      sourceDescription: "Source description",
      uploader: { employeeId: "owner", name: "Owner" },
      owner: { accountId: "owner", name: "Owner" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      latestVersion: "1.2.3",
      contentChecksum: "content-checksum",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: [] },
      engagement: { likeCount: 0 },
      versions: [],
    });
    const { getSkillHubDetail, listSkillHubEntries, updateSkillHubPresentation } =
      await import("./skill-hub.js");

    const updated = await updateSkillHubPresentation({
      slug: "demo-skill",
      actor: { employeeId: "owner", name: "Owner" },
      expectedRevision: 0,
      displayName: "Presented Skill",
      displayDescription: "Presented description",
      category: "knowledge",
      examplePrompts: ["Use this skill"],
    });
    expect(updated.revision).toBe(1);
    expect(updated.noOp).toBe(false);

    const persisted = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      displayName: string;
      updatedAt: string;
      latestVersion: string;
      contentChecksum: string;
      presentation: {
        displayName?: string;
        displayDescription?: string;
        category?: string;
        revision: number;
        updatedAt: string;
      };
    };
    expect(persisted.displayName).toBe("Demo Skill Identity");
    expect(persisted.contentChecksum).toBe("content-checksum");
    expect(persisted.latestVersion).toBe("1.2.3");
    expect(persisted.updatedAt).toBe("2026-05-22T00:00:00.000Z");
    expect(persisted.presentation).toMatchObject({
      displayName: "Presented Skill",
      displayDescription: "Presented description",
      category: "knowledge",
      revision: 1,
    });
    expect(persisted.presentation.updatedAt).not.toBe(persisted.updatedAt);

    const actor = { employeeId: "owner", name: "Owner" };
    const entries = await listSkillHubEntries({ workspaceDir, actor });
    const detail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });
    expect(entries[0]?.presentation.displayName).toBe("Presented Skill");
    expect(detail?.presentation.displayDescription).toBe("Presented description");
    expect(detail?.presentationEdit).toMatchObject({
      displayName: "Presented Skill",
      displayDescription: "Presented description",
      category: "knowledge",
      revision: 1,
    });

    await updateSkillHubPresentation({
      slug: "demo-skill",
      actor,
      expectedRevision: 1,
      displayName: " ",
      displayDescription: null,
      category: null,
      examplePrompts: [],
    });
    const fallbackDetail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });
    expect(fallbackDetail?.presentation).toMatchObject({
      displayName: "demo-skill",
      displayDescription: "Source description",
      category: "other",
    });
    expect(fallbackDetail?.presentationEdit).toMatchObject({ revision: 2 });
    expect(fallbackDetail?.presentationEdit.displayName).toBeUndefined();
    expect(fallbackDetail?.presentationEdit.displayDescription).toBeUndefined();
    expect(fallbackDetail?.presentationEdit.category).toBeUndefined();
  });

  it("uploads and resets icons without changing content metadata, and preserves icons on failure", async () => {
    const metadataPath = path.join(stateDir, "skill-hub", "metadata", "demo-skill.json");
    await writeJson(metadataPath, {
      slug: "demo-skill",
      displayName: "Demo Skill Identity",
      summary: "Summary",
      uploader: { employeeId: "owner" },
      owner: { accountId: "owner" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      latestVersion: "1.2.3",
      contentChecksum: "content-checksum",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { category: "utility", examplePrompts: [] },
      engagement: { likeCount: 0 },
      versions: [],
    });
    const png = await sharp({
      create: { width: 64, height: 32, channels: 4, background: "#16877a" },
    })
      .png()
      .toBuffer();
    const { getSkillHubDetail, updateSkillHubPresentation } = await import("./skill-hub.js");
    const base = {
      slug: "demo-skill",
      actor: { employeeId: "owner" },
      displayName: null,
      displayDescription: null,
      category: "utility" as const,
      examplePrompts: [],
    };

    await updateSkillHubPresentation({
      ...base,
      expectedRevision: 0,
      iconChange: {
        action: "upload",
        mimeType: "image/png",
        dataBase64: png.toString("base64"),
      },
    });
    const uploaded = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      updatedAt: string;
      latestVersion: string;
      contentChecksum: string;
      presentation: { icon?: { assetId: string }; revision: number };
    };
    expect(uploaded.updatedAt).toBe("2026-05-22T00:00:00.000Z");
    expect(uploaded.latestVersion).toBe("1.2.3");
    expect(uploaded.contentChecksum).toBe("content-checksum");
    expect(uploaded.presentation.icon?.assetId).toMatch(/^[a-f0-9]{64}$/);
    expect(uploaded.presentation.revision).toBe(1);
    expect(
      await fs.readFile(
        path.join(
          stateDir,
          "skill-hub",
          "assets",
          "icons",
          `${uploaded.presentation.icon?.assetId}.png`,
        ),
      ),
    ).toBeInstanceOf(Buffer);
    expect(
      (await getSkillHubDetail({ workspaceDir, actor: base.actor, slug: base.slug }))?.presentation
        .icon,
    ).toMatchObject({ source: "uploaded", fallbackKey: "utility" });

    await expect(
      updateSkillHubPresentation({
        ...base,
        expectedRevision: 1,
        iconChange: {
          action: "upload",
          mimeType: "image/png",
          dataBase64: Buffer.from("broken").toString("base64"),
        },
      }),
    ).rejects.toThrow();
    const afterFailure = JSON.parse(await fs.readFile(metadataPath, "utf8")) as typeof uploaded;
    expect(afterFailure.presentation.icon).toEqual(uploaded.presentation.icon);
    expect(afterFailure.presentation.revision).toBe(1);

    await updateSkillHubPresentation({
      ...base,
      expectedRevision: 1,
      iconChange: { action: "reset" },
    });
    const resetDetail = await getSkillHubDetail({
      workspaceDir,
      actor: base.actor,
      slug: base.slug,
    });
    expect(resetDetail?.presentation.icon).toEqual({
      source: "category_default",
      fallbackKey: "utility",
    });
  });

  it("allows admins and rejects non-owners and stale presentation edits", async () => {
    const metadataPath = path.join(stateDir, "skill-hub", "metadata", "demo-skill.json");
    await writeJson(metadataPath, {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Summary",
      uploader: { employeeId: "owner", name: "Owner" },
      owner: { accountId: "owner", name: "Owner" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: [] },
      engagement: { likeCount: 0 },
      versions: [],
    });
    const { updateSkillHubPresentation } = await import("./skill-hub.js");
    const input = {
      slug: "demo-skill",
      expectedRevision: 0,
      displayName: "Admin title",
      displayDescription: "Admin description",
      category: "utility" as const,
      examplePrompts: [],
    };

    await expect(
      updateSkillHubPresentation({
        ...input,
        actor: { employeeId: "other", name: "Other" },
      }),
    ).rejects.toThrow("only the skill owner or an admin");
    await expect(
      updateSkillHubPresentation({
        ...input,
        actor: { employeeId: "admin", name: "Admin", globalRole: "admin" },
      }),
    ).resolves.toMatchObject({ revision: 1, noOp: false });
    await expect(
      updateSkillHubPresentation({
        ...input,
        actor: { employeeId: "owner", name: "Owner" },
      }),
    ).rejects.toThrow("skill presentation changed");
  });

  it("validates presentation lengths and category in the service layer", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Summary",
      uploader: { employeeId: "owner" },
      owner: { accountId: "owner" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: [] },
      versions: [],
    });
    const { updateSkillHubPresentation } = await import("./skill-hub.js");
    const base = {
      slug: "demo-skill",
      actor: { employeeId: "owner" },
      expectedRevision: 0,
      displayName: null,
      displayDescription: null,
      category: null,
      examplePrompts: [],
    };
    await expect(
      updateSkillHubPresentation({ ...base, displayName: "x".repeat(81) }),
    ).rejects.toThrow("displayName must be 80 characters or fewer");
    await expect(
      updateSkillHubPresentation({ ...base, displayDescription: "x".repeat(101) }),
    ).rejects.toThrow("displayDescription must be 100 characters or fewer");
    await expect(
      updateSkillHubPresentation({ ...base, category: "invalid" as never }),
    ).rejects.toThrow("invalid skill category");
  });

  it("filters, searches, and sorts using resolved presentation fields", async () => {
    const fixtures = [
      {
        slug: "knowledge-slug",
        identityName: "Knowledge Identity",
        summary: "Knowledge legacy summary",
        sourceDescription: "Original corpus phrase",
        owner: "actor",
        presentation: {
          displayName: "Zulu Knowledge",
          displayDescription: "Presented knowledge text",
          category: "knowledge",
        },
      },
      {
        slug: "automation-slug",
        identityName: "Automation Identity",
        summary: "Automation summary",
        owner: "other",
        presentation: {
          displayName: "Alpha Automation",
          displayDescription: "Runs a workflow",
          category: "automation",
        },
      },
      {
        slug: "format-helper",
        identityName: "Utility Identity",
        summary: "Format helper",
        owner: "other",
        presentation: {
          displayName: "Converter",
          displayDescription: "Transforms formats",
          category: "utility",
        },
      },
      {
        slug: "legacy-skill",
        identityName: "Legacy Identity",
        summary: "Legacy fallback summary",
        owner: "other",
        presentation: {},
      },
      {
        slug: "invalid-skill",
        identityName: "Invalid Identity",
        summary: "Invalid category summary",
        owner: "other",
        presentation: { category: "unsupported" },
      },
    ];
    for (const [index, fixture] of fixtures.entries()) {
      await writeJson(path.join(stateDir, "skill-hub", "metadata", `${fixture.slug}.json`), {
        slug: fixture.slug,
        displayName: fixture.identityName,
        summary: fixture.summary,
        ...(fixture.sourceDescription ? { sourceDescription: fixture.sourceDescription } : {}),
        uploader: { employeeId: fixture.owner },
        owner: { accountId: fixture.owner },
        publishedAt: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        updatedAt: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        latestVersion: "1.0.0",
        hidden: false,
        flags: { hasHiddenFiles: false, hasExecutableFiles: false },
        stats: { installCount: 0, installerCount: 0 },
        presentation: { ...fixture.presentation, examplePrompts: [] },
        engagement: { likeCount: 0 },
        versions: [],
      });
    }
    const { getSkillHubOverview, listSkillHubEntries } = await import("./skill-hub.js");
    const base = { workspaceDir, actor: { employeeId: "actor" } };

    expect(await listSkillHubEntries({ ...base, category: "all" })).toHaveLength(5);
    expect(
      (await listSkillHubEntries({ ...base, category: "knowledge" })).map((entry) => entry.slug),
    ).toEqual(["knowledge-slug"]);
    expect(
      (await listSkillHubEntries({ ...base, category: "automation" })).map((entry) => entry.slug),
    ).toEqual(["automation-slug"]);
    expect(
      (await listSkillHubEntries({ ...base, category: "utility" })).map((entry) => entry.slug),
    ).toEqual(["format-helper"]);
    expect(
      (await listSkillHubEntries({ ...base, category: "other" }))
        .map((entry) => entry.slug)
        .toSorted(),
    ).toEqual(["invalid-skill", "legacy-skill"]);

    for (const [query, slug] of [
      ["Zulu Knowledge", "knowledge-slug"],
      ["knowledge-slug", "knowledge-slug"],
      ["Presented knowledge", "knowledge-slug"],
      ["Original corpus", "knowledge-slug"],
      ["Utility", "format-helper"],
    ] as const) {
      expect((await listSkillHubEntries({ ...base, query })).map((entry) => entry.slug)).toEqual([
        slug,
      ]);
    }

    const sorted = await listSkillHubEntries({ ...base, sort: "az" });
    expect(sorted.map((entry) => entry.presentation.displayName)).toEqual(
      sorted.map((entry) => entry.presentation.displayName).toSorted((a, b) => a.localeCompare(b)),
    );
    expect(
      await listSkillHubEntries({
        ...base,
        scope: "uploads",
        category: "knowledge",
      }),
    ).toHaveLength(1);
    expect(
      await listSkillHubEntries({
        ...base,
        scope: "uploads",
        category: "automation",
      }),
    ).toHaveLength(0);
    const overview = await getSkillHubOverview(base);
    expect(overview.recentUpdates[0]).toMatchObject({
      slug: "invalid-skill",
      displayName: "invalid-skill",
    });
  });

  it("serializes legacy presentation writers without dropping resolved metadata", async () => {
    const metadataPath = path.join(stateDir, "skill-hub", "metadata", "demo-skill.json");
    await writeJson(metadataPath, {
      slug: "demo-skill",
      displayName: "Identity Name",
      summary: "Legacy summary",
      sourceDescription: "Source description",
      uploader: { employeeId: "owner" },
      owner: { accountId: "owner" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-22T00:00:00.000Z",
      latestVersion: "1.2.3",
      contentChecksum: "content-checksum",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: {
        displayName: "Presented Name",
        displayDescription: "Presented description",
        category: "automation",
        icon: { type: "uploaded", assetId: "a".repeat(64) },
        examplePrompts: [],
        revision: 0,
      },
      engagement: { likeCount: 0 },
      versions: [],
    });
    const { updateSkillHubExamplePrompts, updateSkillHubMetadata } = await import("./skill-hub.js");
    const actor = { employeeId: "owner" };

    await Promise.all([
      updateSkillHubExamplePrompts({
        slug: "demo-skill",
        actor,
        examplePrompts: ["legacy prompt writer"],
      }),
      updateSkillHubMetadata({
        slug: "demo-skill",
        actor,
        summary: "Updated legacy summary",
        examplePrompts: ["metadata writer"],
      }),
    ]);

    const persisted = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      updatedAt: string;
      latestVersion: string;
      contentChecksum: string;
      presentation: {
        displayName?: string;
        displayDescription?: string;
        category?: string;
        icon?: { assetId: string };
        examplePrompts: string[];
        revision: number;
      };
    };
    expect(persisted.presentation).toMatchObject({
      displayName: "Presented Name",
      displayDescription: "Presented description",
      category: "automation",
      icon: { assetId: "a".repeat(64) },
      examplePrompts: ["metadata writer"],
      revision: 2,
    });
    expect(persisted.updatedAt).toBe("2026-05-22T00:00:00.000Z");
    expect(persisted.latestVersion).toBe("1.2.3");
    expect(persisted.contentChecksum).toBe("content-checksum");
  });

  it("toggles likes per actor and updates aggregate count", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Existing metadata",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      owner: { accountId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: [] },
      engagement: { likeCount: 0 },
      versions: [
        {
          version: "1.0.0",
          uploadedBy: { employeeId: "agent-demo", name: "Demo" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.0.0",
        },
      ],
    });

    const { getSkillHubDetail, toggleSkillHubLike } = await import("./skill-hub.js");
    const actor = { employeeId: "agent-a", name: "A" };

    const liked = await toggleSkillHubLike({ slug: "demo-skill", actor });
    expect(liked.liked).toBe(true);
    expect(liked.likeCount).toBe(1);

    let detail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });
    expect(detail?.likedByYou).toBe(true);
    expect(detail?.likeCount).toBe(1);

    const unliked = await toggleSkillHubLike({ slug: "demo-skill", actor });
    expect(unliked.liked).toBe(false);
    expect(unliked.likeCount).toBe(0);

    detail = await getSkillHubDetail({ workspaceDir, actor, slug: "demo-skill" });
    expect(detail?.likedByYou).toBe(false);
    expect(detail?.likeCount).toBe(0);
  });

  it("allows only the owner to edit example prompts", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Existing metadata",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      owner: { accountId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: [] },
      engagement: { likeCount: 0 },
      versions: [
        {
          version: "1.0.0",
          uploadedBy: { employeeId: "agent-demo", name: "Demo" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.0.0",
        },
      ],
    });

    const { getSkillHubDetail, updateSkillHubExamplePrompts } = await import("./skill-hub.js");

    await expect(
      updateSkillHubExamplePrompts({
        slug: "demo-skill",
        actor: { employeeId: "agent-other", name: "Other" },
        examplePrompts: ["one"],
      }),
    ).rejects.toThrow("only the skill owner or an admin can edit example prompts");

    await updateSkillHubExamplePrompts({
      slug: "demo-skill",
      actor: { employeeId: "agent-demo", name: "Demo" },
      examplePrompts: ["prompt one", "prompt two", "", "ignored"],
    });

    const detail = await getSkillHubDetail({
      workspaceDir,
      actor: { employeeId: "agent-demo", name: "Demo" },
      slug: "demo-skill",
    });
    expect(detail?.examplePrompts).toEqual(["prompt one", "prompt two", "ignored"]);
  });

  it("transfers ownership to another active account and preserves install state semantics", async () => {
    await writeJson(path.join(stateDir, "skill-hub", "metadata", "demo-skill.json"), {
      slug: "demo-skill",
      displayName: "Demo Skill",
      summary: "Existing metadata",
      uploader: { employeeId: "agent-demo", name: "Demo" },
      owner: { accountId: "agent-demo", name: "Demo" },
      publishedAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
      latestVersion: "1.0.0",
      hidden: false,
      flags: { hasHiddenFiles: false, hasExecutableFiles: false },
      stats: { installCount: 0, installerCount: 0 },
      presentation: { examplePrompts: [] },
      engagement: { likeCount: 0 },
      versions: [
        {
          version: "1.0.0",
          uploadedBy: { employeeId: "agent-demo", name: "Demo" },
          uploadedAt: "2026-05-21T00:00:00.000Z",
          path: "registry/skills/demo-skill/1.0.0",
        },
      ],
    });

    const { provisionEmployeeAccount } = await import("../accounts/account-provisioning.js");
    provisionEmployeeAccount({
      config: { agents: { defaults: { workspace: workspaceDir } } },
      employeeId: "agent-demo",
      email: "demo@example.com",
      name: "Demo",
      department: "Platform",
      agentId: "agent-demo",
    });
    provisionEmployeeAccount({
      config: { agents: { defaults: { workspace: workspaceDir } } },
      employeeId: "agent-target",
      email: "target@example.com",
      name: "Target",
      department: "Platform",
      agentId: "agent-target",
    });

    const { getSkillHubDetail, transferSkillHubOwnership } = await import("./skill-hub.js");
    const result = await transferSkillHubOwnership({
      slug: "demo-skill",
      actor: { employeeId: "agent-demo", name: "Demo" },
      targetAccountId: "agent-target",
    });

    expect(result.ownerAccountId).toBe("agent-target");

    const previousOwnerView = await getSkillHubDetail({
      workspaceDir,
      actor: { employeeId: "agent-demo", name: "Demo" },
      slug: "demo-skill",
    });
    const nextOwnerView = await getSkillHubDetail({
      workspaceDir,
      actor: { employeeId: "agent-target", name: "Target" },
      slug: "demo-skill",
    });

    expect(previousOwnerView?.uploadedByYou).toBe(false);
    expect(previousOwnerView?.canTransferOwnership).toBe(false);
    expect(nextOwnerView?.uploadedByYou).toBe(true);
    expect(nextOwnerView?.canTransferOwnership).toBe(true);
    expect(nextOwnerView?.ownerAccountId).toBe("agent-target");
  });
});
