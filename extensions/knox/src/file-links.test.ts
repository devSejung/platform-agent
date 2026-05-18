import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreConfig } from "./types.js";
import {
  buildKnoxFileLinksText,
  handleKnoxFileLinksHttpRequest,
  KNOX_FILE_LINKS_DELETE_GRACE_MS,
} from "./file-links.js";

const envKeys = ["OPENCLAW_STATE_DIR"] as const;

function captureEnv() {
  return Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const key of envKeys) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function withTempStateDir<T>(fn: (stateDir: string) => Promise<T>) {
  const snapshot = captureEnv();
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-knox-links-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
  try {
    return await fn(stateDir);
  } finally {
    restoreEnv(snapshot);
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

async function startTestServer() {
  const server = createServer((req, res) => {
    void (async () => {
      if (!(await handleKnoxFileLinksHttpRequest(req, res))) {
        res.statusCode = 404;
        res.end("not handled");
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start test server");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("knox file links", () => {
  it("formats a single marker message and dedupes identical file inputs", async () => {
    await withTempStateDir(async () => {
      const tempFile = path.join(os.tmpdir(), `knox-report-${Date.now()}.pdf`);
      await fs.writeFile(tempFile, "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
      const text = await buildKnoxFileLinksText({
        cfg: {
          gateway: { port: 19001 },
        } as CoreConfig,
        baseUrl: "https://openclaw.example.test",
        mediaUrls: [tempFile, tempFile],
        mediaAccess: {
          localRoots: [path.dirname(tempFile)],
          readFile: async (filePath) => await fs.readFile(filePath),
        },
      });
      expect(text.startsWith("[KNOX_FILE_LINKS]")).toBe(true);
      expect(text).toContain("파일 1개를 준비했습니다.");
      expect(text).toContain("report");
      expect(text.match(/링크: https:\/\/openclaw\.example\.test\/api\/v1\/knox\/file-links\//u)).toBeTruthy();
      await fs.rm(tempFile, { force: true });
    });
  });

  it("truncates long intro text and reports blocked files separately", async () => {
    await withTempStateDir(async () => {
      const allowedFile = path.join(os.tmpdir(), `knox-allowed-${Date.now()}.pdf`);
      const blockedFile = path.join(os.tmpdir(), `knox-blocked-${Date.now()}.exe`);
      await fs.writeFile(allowedFile, "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
      await fs.writeFile(blockedFile, "exe-body");
      const text = await buildKnoxFileLinksText({
        cfg: {} as CoreConfig,
        baseUrl: "https://openclaw.example.test",
        text: "a".repeat(1400),
        mediaUrls: [allowedFile, blockedFile],
        mediaAccess: {
          localRoots: [os.tmpdir()],
          readFile: async (filePath) => await fs.readFile(filePath),
        },
      });
      expect(text).toContain("... (truncated)");
      expect(text).toContain("파일 1개를 준비했습니다.");
      expect(text).toContain("제외된 파일 1개:");
      expect(text).toContain("민감한 확장자(.exe)");
      await fs.rm(allowedFile, { force: true });
      await fs.rm(blockedFile, { force: true });
    });
  });

  it("returns an explicit message when no attachable files remain", async () => {
    await withTempStateDir(async () => {
      const blockedFile = path.join(os.tmpdir(), `knox-only-blocked-${Date.now()}.exe`);
      await fs.writeFile(blockedFile, "exe-body");
      const text = await buildKnoxFileLinksText({
        cfg: {} as CoreConfig,
        baseUrl: "https://openclaw.example.test",
        mediaUrls: [blockedFile],
        mediaAccess: {
          localRoots: [path.dirname(blockedFile)],
          readFile: async (filePath) => await fs.readFile(filePath),
        },
      });
      expect(text).toContain("첨부 가능한 파일이 없습니다.");
      expect(text).toContain("제외된 파일 1개:");
      await fs.rm(blockedFile, { force: true });
    });
  });

  it("serves a generated download URL over HTTP", async () => {
    await withTempStateDir(async () => {
      const { server, baseUrl } = await startTestServer();
      try {
        const tempFile = path.join(os.tmpdir(), `knox-doc-${Date.now()}.pdf`);
        const body = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";
        await fs.writeFile(tempFile, body);
        const text = await buildKnoxFileLinksText({
          cfg: {} as CoreConfig,
          baseUrl,
          mediaUrls: [tempFile],
          mediaAccess: {
            localRoots: [path.dirname(tempFile)],
            readFile: async (filePath) => await fs.readFile(filePath),
          },
        });
        const url = text.match(/https?:\/\/\S+/u)?.[0];
        expect(url).toBeTruthy();
        const response = await fetch(url!);
        expect(response.status).toBe(200);
        expect(response.headers.get("content-disposition")).toContain("inline");
        expect(await response.text()).toBe(body);
        await fs.rm(tempFile, { force: true });
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  });

  it("loads absolute local files even without explicit mediaAccess roots", async () => {
    await withTempStateDir(async () => {
      const tempFile = path.join(os.tmpdir(), `knox-local-${Date.now()}.txt`);
      await fs.writeFile(tempFile, "local file link smoke\n");
      const text = await buildKnoxFileLinksText({
        cfg: {} as CoreConfig,
        baseUrl: "https://openclaw.example.test",
        mediaUrls: [tempFile],
      });
      expect(text).toContain("파일 1개를 준비했습니다.");
      expect(text).toContain("knox-local-");
      expect(text).toContain("text/plain");
      await fs.rm(tempFile, { force: true });
    });
  });

  it("loads absolute text files even when runtime provides mediaReadFile", async () => {
    await withTempStateDir(async () => {
      const tempFile = path.join(os.tmpdir(), `knox-local-readfile-${Date.now()}.txt`);
      await fs.writeFile(tempFile, "local file link smoke with readFile\n");
      const text = await buildKnoxFileLinksText({
        cfg: {} as CoreConfig,
        baseUrl: "https://openclaw.example.test",
        mediaUrls: [tempFile],
        mediaAccess: {
          localRoots: ["/non-matching-root"],
          readFile: async (filePath) => await fs.readFile(filePath),
        },
      });
      expect(text).toContain("파일 1개를 준비했습니다.");
      expect(text).toContain("knox-local-readfile-");
      expect(text).toContain("text/plain");
      await fs.rm(tempFile, { force: true });
    });
  });

  it("reports sensitive executable file extensions as excluded files", async () => {
    await withTempStateDir(async () => {
      const tempFile = path.join(os.tmpdir(), `knox-danger-${Date.now()}.exe`);
      await fs.writeFile(tempFile, "exe-body");
      const text = await buildKnoxFileLinksText({
        cfg: {} as CoreConfig,
        baseUrl: "https://openclaw.example.test",
        mediaUrls: [tempFile],
        mediaAccess: {
          localRoots: [path.dirname(tempFile)],
          readFile: async (filePath) => await fs.readFile(filePath),
        },
      });
      expect(text).toContain("첨부 가능한 파일이 없습니다.");
      expect(text).toContain("민감한 확장자(.exe)");
      await fs.rm(tempFile, { force: true });
    });
  });

  it("keeps expired artifacts until the delete grace period elapses", async () => {
    await withTempStateDir(async () => {
      const { server, baseUrl } = await startTestServer();
      try {
        const tempFile = path.join(os.tmpdir(), `knox-expire-${Date.now()}.pdf`);
        const body = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";
        await fs.writeFile(tempFile, body);
        const text = await buildKnoxFileLinksText({
          cfg: {} as CoreConfig,
          baseUrl,
          mediaUrls: [tempFile],
          mediaAccess: {
            localRoots: [path.dirname(tempFile)],
            readFile: async (filePath) => await fs.readFile(filePath),
          },
        });
        const url = text.match(/https?:\/\/\S+/u)?.[0];
        expect(url).toBeTruthy();
        const artifactId = url!.split("/").pop()!;
        const stateDir = process.env.OPENCLAW_STATE_DIR!;
        const metaPath = path.join(stateDir, "knox-file-links", artifactId, "meta.json");
        const raw = await fs.readFile(metaPath, "utf8");
        const meta = JSON.parse(raw) as { expiresAt: string; deleteAfterAt: string };
        const expiredMeta = {
          ...meta,
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          deleteAfterAt: new Date(Date.now() + KNOX_FILE_LINKS_DELETE_GRACE_MS).toISOString(),
        };
        await fs.writeFile(metaPath, JSON.stringify(expiredMeta, null, 2));
        const response = await fetch(url!);
        expect(response.status).toBe(410);
        await expect(fs.stat(metaPath)).resolves.toBeTruthy();
        await fs.rm(tempFile, { force: true });
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
  });
});
