import {
  EMPLOYEE_RELEASE_NOTES_READ_PATH,
  EMPLOYEE_RELEASE_NOTES_STATUS_PATH,
  type EmployeeReleaseNotesStatus,
} from "../../../../src/gateway/employee-ui-contract.js";
import type { PlatformClawReleaseIndex } from "../../../../src/platformclaw-release.js";

function releaseAssetRoot(basePath: string): string {
  const base = basePath ? basePath.replace(/\/$/, "") : "";
  return `${base}/__openclaw/release-notes`;
}

async function parseJsonResponse<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${label} (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function loadPlatformClawReleaseIndex(
  basePath: string,
): Promise<PlatformClawReleaseIndex> {
  const response = await fetch(`${releaseAssetRoot(basePath)}/index.json`, {
    headers: { Accept: "application/json" },
  });
  const index = await parseJsonResponse<PlatformClawReleaseIndex>(
    response,
    "Release note list unavailable",
  );
  if (!index.latest || !Array.isArray(index.releases)) {
    throw new Error("Release note list is invalid");
  }
  return index;
}

export async function loadPlatformClawReleaseMarkdown(
  basePath: string,
  version: string,
): Promise<string> {
  const response = await fetch(`${releaseAssetRoot(basePath)}/${encodeURIComponent(version)}.md`, {
    headers: { Accept: "text/markdown, text/plain;q=0.9" },
  });
  if (!response.ok) {
    throw new Error(`Release notes unavailable (${response.status})`);
  }
  return await response.text();
}

export async function loadEmployeeReleaseNotesStatus(): Promise<EmployeeReleaseNotesStatus> {
  const response = await fetch(EMPLOYEE_RELEASE_NOTES_STATUS_PATH, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  return await parseJsonResponse<EmployeeReleaseNotesStatus>(
    response,
    "Release note status unavailable",
  );
}

export async function confirmEmployeeReleaseNotesRead(
  version: string,
): Promise<EmployeeReleaseNotesStatus> {
  const response = await fetch(EMPLOYEE_RELEASE_NOTES_READ_PATH, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({ version }),
  });
  return await parseJsonResponse<EmployeeReleaseNotesStatus>(
    response,
    "Failed to save release note status",
  );
}
