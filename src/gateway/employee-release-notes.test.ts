import fs from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { signEmployeeSessionToken } from "./employee-auth.js";
import {
  handleEmployeeReleaseNotesHttpRequest,
  markEmployeeReleaseNotesRead,
  readEmployeeReleaseNotesStatus,
  resolveEmployeeReleaseReadStatePath,
} from "./employee-release-notes.js";
import { makeMockHttpResponse } from "./test-http-response.js";
import { readPlatformClawReleaseIndex } from "../platformclaw-release.js";

const latestReleaseVersion = readPlatformClawReleaseIndex()?.latest ?? "";

describe("employee release note read state", () => {
  let tempDir = "";

  afterEach(async () => {
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET;
    delete process.env.OPENCLAW_STATE_DIR;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function prepareStateDir() {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "platformclaw-release-read-"));
    process.env.OPENCLAW_STATE_DIR = tempDir;
  }

  it("keeps read state separate for each employee", async () => {
    await prepareStateDir();

    expect(await readEmployeeReleaseNotesStatus("eon")).toEqual({
      latestVersion: latestReleaseVersion,
      readVersion: null,
      shouldAutoOpen: true,
    });

    await markEmployeeReleaseNotesRead("eon", latestReleaseVersion);

    expect(await readEmployeeReleaseNotesStatus("eon")).toEqual({
      latestVersion: latestReleaseVersion,
      readVersion: latestReleaseVersion,
      shouldAutoOpen: false,
    });
    expect(await readEmployeeReleaseNotesStatus("minji")).toEqual({
      latestVersion: latestReleaseVersion,
      readVersion: null,
      shouldAutoOpen: true,
    });

    const statePath = resolveEmployeeReleaseReadStatePath();
    expect(statePath).toBe(path.join(tempDir, "platformclaw", "release-notes", "read-state.json"));
    const stored = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      employees: Record<string, { readVersions: Record<string, string> }>;
    };
    expect(stored.employees.eon.readVersions[latestReleaseVersion]).toBeTruthy();
  });

  it("treats an empty mounted state file as unread initial state", async () => {
    await prepareStateDir();
    const statePath = resolveEmployeeReleaseReadStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, "", "utf8");

    expect(await readEmployeeReleaseNotesStatus("eon")).toEqual({
      latestVersion: latestReleaseVersion,
      readVersion: null,
      shouldAutoOpen: true,
    });

    await markEmployeeReleaseNotesRead("eon", latestReleaseVersion);
    expect(await readEmployeeReleaseNotesStatus("eon")).toMatchObject({
      readVersion: latestReleaseVersion,
      shouldAutoOpen: false,
    });
  });

  it("does not allow an old or unknown release to replace latest read state", async () => {
    await prepareStateDir();

    await expect(markEmployeeReleaseNotesRead("eon", "2026.5.1")).rejects.toThrow(
      "only the latest PlatformClaw release can be marked as read",
    );
    expect(await readEmployeeReleaseNotesStatus("eon")).toMatchObject({
      readVersion: null,
      shouldAutoOpen: true,
    });
  });

  it("preserves concurrent read confirmations from different employees", async () => {
    await prepareStateDir();

    await Promise.all([
      markEmployeeReleaseNotesRead("eon", latestReleaseVersion),
      markEmployeeReleaseNotesRead("minji", latestReleaseVersion),
    ]);

    const stored = JSON.parse(await fs.readFile(resolveEmployeeReleaseReadStatePath(), "utf8")) as {
      employees: Record<string, { readVersions: Record<string, string> }>;
    };
    expect(stored.employees.eon.readVersions[latestReleaseVersion]).toBeTruthy();
    expect(stored.employees.minji.readVersions[latestReleaseVersion]).toBeTruthy();
  });

  it("preserves previously read versions when confirming a newer release", async () => {
    await prepareStateDir();
    const statePath = resolveEmployeeReleaseReadStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        employees: {
          eon: {
            readVersions: {
              "2026.5.20": "2026-05-20T00:00:00.000Z",
            },
          },
        },
      }),
      "utf8",
    );

    await markEmployeeReleaseNotesRead("eon", latestReleaseVersion);

    const stored = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      employees: Record<string, { readVersions: Record<string, string> }>;
    };
    expect(stored.employees.eon.readVersions["2026.5.20"]).toBe("2026-05-20T00:00:00.000Z");
    expect(stored.employees.eon.readVersions[latestReleaseVersion]).toBeTruthy();
  });

  it("auto-opens a new latest release after the employee read the previous release", async () => {
    await prepareStateDir();
    const statePath = resolveEmployeeReleaseReadStatePath();
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        employees: {
          eon: {
            readVersions: {
              "2026.6.18": "2026-06-18T00:00:00.000Z",
            },
          },
        },
      }),
      "utf8",
    );

    expect(await readEmployeeReleaseNotesStatus("eon")).toEqual({
      latestVersion: latestReleaseVersion,
      readVersion: null,
      shouldAutoOpen: true,
    });
  });

  it("requires an employee session before updating read state", async () => {
    await prepareStateDir();
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "release-note-test-secret";

    const unauthorized = makeMockHttpResponse();
    await handleEmployeeReleaseNotesHttpRequest({
      req: {
        url: "/employee/release-notes/status",
        method: "GET",
        headers: {},
      } as IncomingMessage,
      res: unauthorized.res,
      readJsonBody: async () => ({ ok: true, value: {} }),
    });
    expect(unauthorized.res.statusCode).toBe(401);

    const token = signEmployeeSessionToken({
      employeeId: "eon",
      agentId: "eon",
    });
    const authorized = makeMockHttpResponse();
    await handleEmployeeReleaseNotesHttpRequest({
      req: {
        url: "/employee/release-notes/read",
        method: "POST",
        headers: { cookie: `openclaw_employee_session=${encodeURIComponent(token)}` },
      } as IncomingMessage,
      res: authorized.res,
      readJsonBody: async () => ({ ok: true, value: { version: latestReleaseVersion } }),
    });
    expect(authorized.res.statusCode).toBe(200);
    expect(JSON.parse(String(authorized.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      latestVersion: latestReleaseVersion,
      readVersion: latestReleaseVersion,
      shouldAutoOpen: false,
    });
  });
});
