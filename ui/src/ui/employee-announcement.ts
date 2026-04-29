import { getSafeLocalStorage } from "../local-storage.ts";

const EMPLOYEE_ANNOUNCEMENT_DISMISS_KEY = "openclaw:employee-ui:announcement-dismissed:v1";

export type EmployeeAnnouncement = {
  title: string | null;
  body: string | null;
  linkLabel: string | null;
  linkUrl: string | null;
};

type EmployeeUiAnnouncementFields = {
  announcementTitle: string | null;
  announcementBody: string | null;
  announcementLinkLabel: string | null;
  announcementLinkUrl: string | null;
};

function normalizeField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveEmployeeAnnouncement(
  employeeMode: boolean,
  employeeUi: EmployeeUiAnnouncementFields,
): EmployeeAnnouncement | null {
  if (!employeeMode) {
    return null;
  }
  const title = normalizeField(employeeUi.announcementTitle);
  const body = normalizeField(employeeUi.announcementBody);
  const linkLabel = normalizeField(employeeUi.announcementLinkLabel);
  const linkUrl = normalizeField(employeeUi.announcementLinkUrl);
  if (!title && !body && !linkLabel && !linkUrl) {
    return null;
  }
  return { title, body, linkLabel, linkUrl };
}

export function getEmployeeAnnouncementFingerprint(
  announcement: EmployeeAnnouncement | null,
): string | null {
  if (!announcement) {
    return null;
  }
  return JSON.stringify([
    announcement.title ?? "",
    announcement.body ?? "",
    announcement.linkLabel ?? "",
    announcement.linkUrl ?? "",
  ]);
}

function loadDismissedEmployeeAnnouncementFingerprint(): string | null {
  try {
    const raw = getSafeLocalStorage()?.getItem(EMPLOYEE_ANNOUNCEMENT_DISMISS_KEY);
    return typeof raw === "string" && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function isEmployeeAnnouncementDismissed(
  announcement: EmployeeAnnouncement | null,
): boolean {
  const fingerprint = getEmployeeAnnouncementFingerprint(announcement);
  if (!fingerprint) {
    return false;
  }
  return loadDismissedEmployeeAnnouncementFingerprint() === fingerprint;
}

export function dismissEmployeeAnnouncement(announcement: EmployeeAnnouncement | null): void {
  const fingerprint = getEmployeeAnnouncementFingerprint(announcement);
  if (!fingerprint) {
    return;
  }
  try {
    getSafeLocalStorage()?.setItem(EMPLOYEE_ANNOUNCEMENT_DISMISS_KEY, fingerprint);
  } catch {
    // ignore storage write failures
  }
}
