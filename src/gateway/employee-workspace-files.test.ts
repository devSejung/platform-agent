import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWorkspaceDirectory,
  deleteWorkspacePaths,
  appendHtmlArtifactResizeBridge,
  listWorkspaceDirectory,
  normalizeWorkspaceRelativePath,
  readWorkspaceFilePreview,
  renameWorkspacePath,
  uploadWorkspaceFiles,
  validateWorkspaceEntryName,
} from "./employee-workspace-files.js";

const tempDirs: string[] = [];

async function makeWorkspace() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-files-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("employee workspace files", () => {
  it("appends the adaptive preview bridge without parsing HTML-like script text", () => {
    const original =
      '<!doctype html><html><body><script>const example = "</body>";</script></body></html>';
    const preview = appendHtmlArtifactResizeBridge(original);

    expect(preview.startsWith(original)).toBe(true);
    expect(preview).toContain("data-platformclaw-artifact-resize");
    expect(preview).toContain("platformclaw:artifact-resize-request");
    expect(original).not.toContain("data-platformclaw-artifact-resize");
  });

  it("normalizes relative paths and rejects traversal", () => {
    expect(normalizeWorkspaceRelativePath("docs/report.txt")).toBe("docs/report.txt");
    expect(normalizeWorkspaceRelativePath("docs\\report.txt")).toBe("docs/report.txt");
    expect(() => normalizeWorkspaceRelativePath("../secret")).toThrow(/접근할 수 없는 경로|traversal/i);
    expect(() => normalizeWorkspaceRelativePath("/etc/passwd")).toThrow(/접근할 수 없는 경로|absolute/i);
  });

  it("validates entry names with reserved OS names blocked", () => {
    expect(validateWorkspaceEntryName("report.txt")).toBe("report.txt");
    expect(() => validateWorkspaceEntryName(".hidden")).toThrow();
    expect(() => validateWorkspaceEntryName("CON")).toThrow();
  });

  it("lists visible files with folders first and hides dotfiles", async () => {
    const workspace = await makeWorkspace();
    await fs.mkdir(path.join(workspace, "docs"));
    await fs.writeFile(path.join(workspace, "zeta.txt"), "z");
    await fs.writeFile(path.join(workspace, ".secret"), "s");
    await fs.writeFile(path.join(workspace, "docs", "alpha.txt"), "a");

    const result = await listWorkspaceDirectory({ rootDir: workspace, relativePath: "" });
    expect(result.entries.map((entry) => entry.name)).toEqual(["docs", "zeta.txt"]);
    expect(result.entries[0]?.kind).toBe("directory");
    expect(result.breadcrumbs[0]).toEqual({ name: "Workspace", path: "" });
  });

  it("creates, renames, uploads, and deletes inside the workspace root", async () => {
    const workspace = await makeWorkspace();
    await createWorkspaceDirectory({
      rootDir: workspace,
      parentPath: "",
      name: "incoming",
    });
    expect(await fs.stat(path.join(workspace, "incoming"))).toBeTruthy();

    const upload = await uploadWorkspaceFiles({
      rootDir: workspace,
      parentPath: "incoming",
      files: [new File(["hello"], "note.txt", { type: "text/plain" })],
      overwrite: false,
    });
    expect(upload.uploaded).toEqual(["incoming/note.txt"]);

    const renamed = await renameWorkspacePath({
      rootDir: workspace,
      relativePath: "incoming/note.txt",
      nextName: "renamed.txt",
    });
    expect(renamed.path).toBe("incoming/renamed.txt");

    const deletion = await deleteWorkspacePaths({
      rootDir: workspace,
      relativePaths: ["incoming"],
    });
    expect(deletion.deleted).toEqual(["incoming"]);
    expect(deletion.failed).toEqual([]);
    await expect(fs.stat(path.join(workspace, "incoming"))).rejects.toThrow();
  });

  it("reads markdown, code, and text previews inside the workspace", async () => {
    const workspace = await makeWorkspace();
    await fs.writeFile(path.join(workspace, "README.md"), "# Hello\n\nworld");
    await fs.writeFile(path.join(workspace, "app.py"), "def main():\n    return 'ok'\n");
    await fs.writeFile(path.join(workspace, "note.txt"), "plain");

    const preview = await readWorkspaceFilePreview({
      rootDir: workspace,
      relativePath: "README.md",
    });
    expect(preview.kind).toBe("markdown");
    expect(preview.name).toBe("README.md");
    expect(preview.content).toContain("# Hello");

    const codePreview = await readWorkspaceFilePreview({
      rootDir: workspace,
      relativePath: "app.py",
    });
    expect(codePreview.kind).toBe("code");
    expect(codePreview.language).toBe("python");
    expect(codePreview.content).toContain("def main");

    const textPreview = await readWorkspaceFilePreview({
      rootDir: workspace,
      relativePath: "note.txt",
    });
    expect(textPreview.kind).toBe("text");
    expect(textPreview.content).toContain("plain");
  });

  it("reads archive previews and falls back for binary files", async () => {
    const workspace = await makeWorkspace();
    const zip = new JSZip();
    zip.file("docs/readme.txt", "hello");
    zip.file("src/app.py", "print('ok')\n");
    await fs.writeFile(
      path.join(workspace, "bundle.zip"),
      await zip.generateAsync({ type: "nodebuffer" }),
    );
    await fs.writeFile(path.join(workspace, "file.bin"), Buffer.from([0, 159, 146, 150]));
    await fs.writeFile(path.join(workspace, "notes.txt"), "one\ntwo\n");
    await tar.create({
      cwd: workspace,
      file: path.join(workspace, "notes.tar"),
    }, ["notes.txt"]);

    const zipPreview = await readWorkspaceFilePreview({
      rootDir: workspace,
      relativePath: "bundle.zip",
    });
    expect(zipPreview.kind).toBe("archive");
    expect(zipPreview.archiveEntries.some((entry) => entry.path === "docs/readme.txt")).toBe(true);

    const tarPreview = await readWorkspaceFilePreview({
      rootDir: workspace,
      relativePath: "notes.tar",
    });
    expect(tarPreview.kind).toBe("archive");
    expect(tarPreview.archiveEntries.some((entry) => entry.path === "notes.txt")).toBe(true);

    const unsupported = await readWorkspaceFilePreview({
      rootDir: workspace,
      relativePath: "file.bin",
    });
    expect(unsupported.kind).toBe("unsupported");
    expect(unsupported.content).toBeNull();
  });
});
