import { afterEach, describe, expect, it, vi } from "vitest";
import { submitEmployeeVoc, type EmployeeVocState } from "./employee-voc.ts";

function createState(locale: "ko" | "en" = "ko"): EmployeeVocState {
  return {
    employeeMode: true,
    employeeVocModalOpen: true,
    employeeVocTitle: "",
    employeeVocBody: "",
    employeeVocSubmitting: false,
    employeeVocError: null,
    employeeVocResult: null,
    settings: { locale },
  };
}

describe("submitEmployeeVoc", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("validates a required title", async () => {
    const state = createState("ko");

    await submitEmployeeVoc(state);

    expect(state.employeeVocError).toBe("제목을 입력해주세요.");
  });

  it("validates a required body", async () => {
    const state = createState("en");
    state.employeeVocTitle = "Need a fix";

    await submitEmployeeVoc(state);

    expect(state.employeeVocError).toBe("Please enter details.");
  });

  it("posts the trimmed payload and stores the created issue", async () => {
    vi.useFakeTimers();
    const state = createState("ko");
    state.employeeVocTitle = "  VOC title  ";
    state.employeeVocBody = "  first line\nsecond line  ";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        issueKey: "SOCPE-99999",
        issueUrl: "https://jira.samsungds.net/browse/SOCPE-99999",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));

    await submitEmployeeVoc(state);

    expect(fetchMock).toHaveBeenCalledWith(
      "/employee/voc",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          title: "VOC title",
          body: "first line\nsecond line",
        }),
      }),
    );
    expect(state.employeeVocError).toBeNull();
    expect(state.employeeVocResult).toEqual({
      issueKey: "SOCPE-99999",
      issueUrl: "https://jira.samsungds.net/browse/SOCPE-99999",
    });
    expect(state.employeeVocTitle).toBe("");
    expect(state.employeeVocBody).toBe("");
    expect(state.employeeVocModalOpen).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.employeeVocModalOpen).toBe(false);
  });

  it("surfaces a safe error message from the server", async () => {
    const state = createState("en");
    state.employeeVocTitle = "Need a fix";
    state.employeeVocBody = "Please improve this workflow.";
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ ok: false, error: "VOC registration failed." }),
      }),
    );

    await submitEmployeeVoc(state);

    expect(state.employeeVocError).toBe("VOC registration failed.");
    expect(state.employeeVocResult).toBeNull();
  });

  it("stops when the confirmation popup is cancelled", async () => {
    const state = createState("ko");
    state.employeeVocTitle = "Need a fix";
    state.employeeVocBody = "Please improve this workflow.";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));

    await submitEmployeeVoc(state);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.employeeVocSubmitting).toBe(false);
    expect(state.employeeVocResult).toBeNull();
  });
});
