import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../test-helpers/storage.ts";
import {
  dismissEmployeeAnnouncement,
  getEmployeeAnnouncementFingerprint,
  isEmployeeAnnouncementDismissed,
  resolveEmployeeAnnouncement,
} from "./employee-announcement.ts";

describe("employee announcement dismissal", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createStorageMock());
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves trimmed announcement fields", () => {
    expect(
      resolveEmployeeAnnouncement(true, {
        announcementTitle: " Scheduled maintenance ",
        announcementBody: " PlatformClaw will be read-only. ",
        announcementLinkLabel: " View notice ",
        announcementLinkUrl: " https://example.com/notice ",
      }),
    ).toEqual({
      title: "Scheduled maintenance",
      body: "PlatformClaw will be read-only.",
      linkLabel: "View notice",
      linkUrl: "https://example.com/notice",
    });
  });

  it("hides a dismissed announcement until content changes", () => {
    const announcement = resolveEmployeeAnnouncement(true, {
      announcementTitle: "Scheduled maintenance",
      announcementBody: "PlatformClaw will be read-only.",
      announcementLinkLabel: "View notice",
      announcementLinkUrl: "https://example.com/notice",
    });
    expect(announcement).not.toBeNull();
    expect(isEmployeeAnnouncementDismissed(announcement)).toBe(false);

    dismissEmployeeAnnouncement(announcement);
    expect(isEmployeeAnnouncementDismissed(announcement)).toBe(true);

    const updatedAnnouncement = resolveEmployeeAnnouncement(true, {
      announcementTitle: "Scheduled maintenance",
      announcementBody: "PlatformClaw will be read-only on April 13.",
      announcementLinkLabel: "View notice",
      announcementLinkUrl: "https://example.com/notice",
    });
    expect(getEmployeeAnnouncementFingerprint(updatedAnnouncement)).not.toBe(
      getEmployeeAnnouncementFingerprint(announcement),
    );
    expect(isEmployeeAnnouncementDismissed(updatedAnnouncement)).toBe(false);
  });
});
