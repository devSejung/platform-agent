import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  appendMemoryHostEvent,
  resolveMemoryHostEventLogPath,
} from "openclaw/plugin-sdk/memory-core-host-events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../api.js";
import { listMemoryCorePublicArtifacts } from "./public-artifacts.js";

describe("listMemoryCorePublicArtifacts", () => {
  let fixtureRoot = "";

  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "memory-core-public-artifacts-"));
  });

  afterAll(async () => {
    if (!fixtureRoot) {
      return;
    }
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  });

  it("lists public workspace artifacts with stable kinds", async () => {
    const workspaceDir = path.join(fixtureRoot, "workspace-stable-kinds");
    await fs.mkdir(path.join(workspaceDir, "memory", "dreaming"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Durable Memory\n", "utf8");
    await fs.writeFile(
      path.join(workspaceDir, "memory", "2026-04-06.md"),
      "# Daily Note\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(workspaceDir, "memory", "dreaming", "2026-04-06.md"),
      "# Dream Report\n",
      "utf8",
    );
    await appendMemoryHostEvent(workspaceDir, {
      type: "memory.recall.recorded",
      timestamp: "2026-04-06T12:00:00.000Z",
      query: "alpha",
      resultCount: 0,
      results: [],
    });

    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", default: true, workspace: workspaceDir }],
      },
    };
    const canonicalWorkspaceDir = await fs.realpath(workspaceDir);

    await expect(listMemoryCorePublicArtifacts({ cfg })).resolves.toEqual([
      {
        kind: "memory-root",
        workspaceDir: canonicalWorkspaceDir,
        relativePath: "MEMORY.md",
        absolutePath: path.join(canonicalWorkspaceDir, "MEMORY.md"),
        agentIds: ["main"],
        contentType: "markdown",
      },
      {
        kind: "daily-note",
        workspaceDir: canonicalWorkspaceDir,
        relativePath: "memory/2026-04-06.md",
        absolutePath: path.join(canonicalWorkspaceDir, "memory", "2026-04-06.md"),
        agentIds: ["main"],
        contentType: "markdown",
      },
      {
        kind: "dream-report",
        workspaceDir: canonicalWorkspaceDir,
        relativePath: "memory/dreaming/2026-04-06.md",
        absolutePath: path.join(canonicalWorkspaceDir, "memory", "dreaming", "2026-04-06.md"),
        agentIds: ["main"],
        contentType: "markdown",
      },
      {
        kind: "event-log",
        workspaceDir: canonicalWorkspaceDir,
        relativePath: "memory/.dreams/events.jsonl",
        absolutePath: resolveMemoryHostEventLogPath(canonicalWorkspaceDir),
        agentIds: ["main"],
        contentType: "json",
      },
    ]);
  });

  it("lists lowercase memory root when only the legacy filename exists", async () => {
    const workspaceDir = path.join(fixtureRoot, "workspace-lowercase-root");
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "memory.md"), "# Legacy Durable Memory\n", "utf8");

    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", default: true, workspace: workspaceDir }],
      },
    };
    const canonicalWorkspaceDir = await fs.realpath(workspaceDir);

    await expect(listMemoryCorePublicArtifacts({ cfg })).resolves.toEqual([
      {
        kind: "memory-root",
        workspaceDir: canonicalWorkspaceDir,
        relativePath: "memory.md",
        absolutePath: path.join(canonicalWorkspaceDir, "memory.md"),
        agentIds: ["main"],
        contentType: "markdown",
      },
    ]);
  });

  it.runIf(process.platform !== "win32")(
    "does not traverse a symlinked memory directory",
    async () => {
      const workspaceDir = path.join(fixtureRoot, "workspace-memory-link");
      const linkedMemoryDir = path.join(fixtureRoot, "outside-memory-link");
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.mkdir(linkedMemoryDir, { recursive: true });
      await fs.writeFile(path.join(linkedMemoryDir, "private.md"), "# Private\n", "utf8");
      await fs.symlink(linkedMemoryDir, path.join(workspaceDir, "memory"));

      const cfg: OpenClawConfig = {
        agents: {
          list: [{ id: "main", default: true, workspace: workspaceDir }],
        },
      };

      await expect(listMemoryCorePublicArtifacts({ cfg })).resolves.toEqual([]);
    },
  );

  it.runIf(process.platform !== "win32")("ignores symlinked event journals", async () => {
    const workspaceDir = path.join(fixtureRoot, "workspace-event-link");
    const eventLogPath = resolveMemoryHostEventLogPath(workspaceDir);
    const outsidePath = path.join(fixtureRoot, "outside-events.jsonl");
    await fs.mkdir(path.dirname(eventLogPath), { recursive: true });
    await fs.writeFile(outsidePath, '{"type":"memory.recall.recorded"}\n', "utf8");
    await fs.symlink(outsidePath, eventLogPath);

    const cfg: OpenClawConfig = {
      agents: {
        list: [{ id: "main", default: true, workspace: workspaceDir }],
      },
    };

    const artifacts = await listMemoryCorePublicArtifacts({ cfg });

    expect(artifacts.some((artifact) => artifact.kind === "event-log")).toBe(false);
  });
});
