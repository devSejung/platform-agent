import fs from "node:fs";
import path from "node:path";
import JSON5 from "json5";
import type { OpenClawConfig } from "../config/config.js";
import { resolveConfigPath } from "../config/paths.js";
import type { EmployeeUiAnnouncement, EmployeeUiSurfaceConfig } from "./employee-ui-contract.js";

const EMPLOYEE_UI_EXTRA_PATH_ENV = "OPENCLAW_EMPLOYEE_UI_EXTRA_PATH";
const DEFAULT_EMPLOYEE_UI_EXTRA_FILENAME = "employee-ui.extra.json";

type EmployeeUiSurfaceExtraFile = {
  docsUrl?: unknown;
  announcement?: {
    title?: unknown;
    body?: unknown;
    linkLabel?: unknown;
    linkUrl?: unknown;
  };
  announcementTitle?: unknown;
  announcementBody?: unknown;
  announcementLinkLabel?: unknown;
  announcementLinkUrl?: unknown;
};

type SurfaceConfigCacheEntry = {
  filePath: string;
  mtimeMs: number;
  size: number;
  value: EmployeeUiSurfaceConfig | undefined;
};

let surfaceConfigCache: SurfaceConfigCacheEntry | null = null;

function trimOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSurfaceConfigExtra(value: unknown): EmployeeUiSurfaceConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const parsed = value as EmployeeUiSurfaceExtraFile;
  const docsUrl = trimOptionalString(parsed.docsUrl);
  const announcement: EmployeeUiAnnouncement = {
    title:
      trimOptionalString(parsed.announcement?.title) ??
      trimOptionalString(parsed.announcementTitle),
    body:
      trimOptionalString(parsed.announcement?.body) ?? trimOptionalString(parsed.announcementBody),
    linkLabel:
      trimOptionalString(parsed.announcement?.linkLabel) ??
      trimOptionalString(parsed.announcementLinkLabel),
    linkUrl:
      trimOptionalString(parsed.announcement?.linkUrl) ??
      trimOptionalString(parsed.announcementLinkUrl),
  };
  const hasAnnouncement = Boolean(
    announcement.title || announcement.body || announcement.linkLabel || announcement.linkUrl,
  );
  if (!docsUrl && !hasAnnouncement) {
    return undefined;
  }
  return {
    ...(docsUrl ? { docsUrl } : {}),
    ...(hasAnnouncement ? { announcement } : {}),
  };
}

function resolveEmployeeUiExtraFilePath(): string {
  const explicitPath = process.env[EMPLOYEE_UI_EXTRA_PATH_ENV]?.trim();
  if (explicitPath) {
    return explicitPath;
  }
  const configPath = resolveConfigPath(process.env);
  return path.join(path.dirname(configPath), DEFAULT_EMPLOYEE_UI_EXTRA_FILENAME);
}

function readSurfaceConfigExtraFile(filePath: string): EmployeeUiSurfaceConfig | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    if (surfaceConfigCache?.filePath === filePath) {
      surfaceConfigCache = null;
    }
    return undefined;
  }
  if (!stat.isFile()) {
    return surfaceConfigCache?.filePath === filePath ? surfaceConfigCache.value : undefined;
  }
  if (
    surfaceConfigCache?.filePath === filePath &&
    surfaceConfigCache.mtimeMs === stat.mtimeMs &&
    surfaceConfigCache.size === stat.size
  ) {
    return surfaceConfigCache.value;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const next = normalizeSurfaceConfigExtra(JSON5.parse(raw));
    surfaceConfigCache = {
      filePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      value: next,
    };
    return next;
  } catch {
    return surfaceConfigCache?.filePath === filePath ? surfaceConfigCache.value : undefined;
  }
}

function resolveConfigSurfaceConfig(config: OpenClawConfig): EmployeeUiSurfaceConfig | undefined {
  const controlUi = config.gateway?.controlUi;
  const docsUrl = trimOptionalString(controlUi?.docsUrl);
  const announcement: EmployeeUiAnnouncement = {
    title: trimOptionalString(controlUi?.announcementTitle),
    body: trimOptionalString(controlUi?.announcementBody),
    linkLabel: trimOptionalString(controlUi?.announcementLinkLabel),
    linkUrl: trimOptionalString(controlUi?.announcementLinkUrl),
  };
  const hasAnnouncement = Boolean(
    announcement.title || announcement.body || announcement.linkLabel || announcement.linkUrl,
  );
  if (!docsUrl && !hasAnnouncement) {
    return undefined;
  }
  return {
    ...(docsUrl ? { docsUrl } : {}),
    ...(hasAnnouncement ? { announcement } : {}),
  };
}

export function resolveEmployeeUiSurfaceConfig(
  config: OpenClawConfig,
): EmployeeUiSurfaceConfig | undefined {
  const base = resolveConfigSurfaceConfig(config);
  const extra = readSurfaceConfigExtraFile(resolveEmployeeUiExtraFilePath());
  if (!base && !extra) {
    return undefined;
  }
  return {
    ...base,
    ...extra,
    announcement: {
      ...base?.announcement,
      ...Object.fromEntries(
        Object.entries(extra?.announcement ?? {}).filter(([, value]) => value !== undefined),
      ),
    },
  };
}

export function resetEmployeeUiSurfaceConfigCacheForTests() {
  surfaceConfigCache = null;
}
