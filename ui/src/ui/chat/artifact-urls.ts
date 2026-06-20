import { EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH } from "../../../../src/gateway/employee-workspace-files-contract.ts";

export function buildWorkspaceDownloadUrl(relativePath: string): string {
  return `${EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH}?path=${encodeURIComponent(relativePath)}`;
}

export function buildWorkspaceInlineUrl(relativePath: string): string {
  return `${buildWorkspaceDownloadUrl(relativePath)}&inline=1`;
}
