import fs from "node:fs/promises";
import path from "node:path";
import { resolveMemoryHostEventLogPath } from "openclaw/plugin-sdk/memory-core-host-events";
import { resolveMemoryDreamingWorkspaces } from "openclaw/plugin-sdk/memory-core-host-status";
import type { MemoryPluginPublicArtifact } from "openclaw/plugin-sdk/memory-host-core";
import { openFileWithinRoot } from "openclaw/plugin-sdk/security-runtime";
import type { OpenClawConfig } from "../api.js";

async function listMarkdownFilesRecursive(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFilesRecursive(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

async function collectWorkspaceArtifacts(params: {
  workspaceDir: string;
  agentIds: string[];
}): Promise<MemoryPluginPublicArtifact[]> {
  const artifacts: MemoryPluginPublicArtifact[] = [];
  const workspaceRoot = await fs
    .realpath(params.workspaceDir)
    .catch(() => path.resolve(params.workspaceDir));
  const workspaceEntries = new Set(
    (await fs.readdir(workspaceRoot, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  );
  for (const relativePath of ["MEMORY.md", "memory.md"]) {
    if (!workspaceEntries.has(relativePath)) {
      continue;
    }
    const absolutePath = path.join(workspaceRoot, relativePath);
    artifacts.push({
      kind: "memory-root",
      workspaceDir: workspaceRoot,
      relativePath,
      absolutePath,
      agentIds: [...params.agentIds],
      contentType: "markdown",
    });
  }

  const memoryDir = path.join(workspaceRoot, "memory");
  const memoryDirStat = await fs.lstat(memoryDir).catch(() => undefined);
  if (memoryDirStat?.isDirectory()) {
    for (const absolutePath of await listMarkdownFilesRecursive(memoryDir)) {
      const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
      artifacts.push({
        kind: relativePath.startsWith("memory/dreaming/") ? "dream-report" : "daily-note",
        workspaceDir: workspaceRoot,
        relativePath,
        absolutePath,
        agentIds: [...params.agentIds],
        contentType: "markdown",
      });
    }
  }

  const eventLogRelativePath = path
    .relative(workspaceRoot, resolveMemoryHostEventLogPath(workspaceRoot))
    .replace(/\\/g, "/");
  const eventLog = await openFileWithinRoot({
    rootDir: workspaceRoot,
    relativePath: eventLogRelativePath,
  }).catch(() => undefined);
  if (eventLog) {
    try {
      artifacts.push({
        kind: "event-log",
        workspaceDir: workspaceRoot,
        relativePath: eventLogRelativePath,
        absolutePath: eventLog.realPath,
        agentIds: [...params.agentIds],
        contentType: "json",
      });
    } finally {
      await eventLog.handle.close().catch(() => undefined);
    }
  }

  const deduped = new Map<string, MemoryPluginPublicArtifact>();
  for (const artifact of artifacts) {
    deduped.set(`${artifact.workspaceDir}\0${artifact.relativePath}\0${artifact.kind}`, artifact);
  }
  return [...deduped.values()];
}

export async function listMemoryCorePublicArtifacts(params: {
  cfg: OpenClawConfig;
}): Promise<MemoryPluginPublicArtifact[]> {
  const workspaces = resolveMemoryDreamingWorkspaces(params.cfg);
  const artifacts: MemoryPluginPublicArtifact[] = [];
  for (const workspace of workspaces) {
    artifacts.push(
      ...(await collectWorkspaceArtifacts({
        workspaceDir: workspace.workspaceDir,
        agentIds: workspace.agentIds,
      })),
    );
  }
  return artifacts;
}
