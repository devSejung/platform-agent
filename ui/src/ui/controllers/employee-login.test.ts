import { afterEach, describe, expect, it, vi } from "vitest";
import { submitEmployeeAdSso, type EmployeeLoginState } from "./employee-login.ts";

function createEmployeeLoginState(): EmployeeLoginState {
  return {
    basePath: "",
    employeeMode: true,
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      sessionKey: "main",
      theme: "knot",
    },
    password: "",
    employeeUi: {
      docsUrl: null,
      vocUrl: null,
      announcementTitle: null,
      announcementBody: null,
      announcementLinkLabel: null,
      announcementLinkUrl: null,
    },
    employeeProfile: {
      employeeId: null,
      name: null,
      department: null,
      agentId: null,
    },
    employeeAccountSummary: null,
    employeeBootstrapToken: null,
    employeeLoginIdentifier: "",
    employeeLoginPassword: "",
    employeeLoginSubmitting: false,
    employeeBootstrapReady: false,
    employeeBootstrapError: null,
    employeeLoginNotice: null,
    connect: vi.fn(),
  } as unknown as EmployeeLoginState;
}

describe("submitEmployeeAdSso", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("navigates to the gateway AD SSO start endpoint", async () => {
    const state = createEmployeeLoginState();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });

    await submitEmployeeAdSso(state);

    expect(assign).toHaveBeenCalledWith("/employee/auth/adsso");
    expect(state.connect).not.toHaveBeenCalled();
    expect(state.employeeBootstrapReady).toBe(false);
    expect(state.employeeBootstrapError).toBeNull();
    expect(state.employeeLoginSubmitting).toBe(true);
  });
});
