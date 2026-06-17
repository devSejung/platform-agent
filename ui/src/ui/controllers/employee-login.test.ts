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

  it("does not make network requests or connect while AD SSO is unsupported", async () => {
    const state = createEmployeeLoginState();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await submitEmployeeAdSso(state);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.connect).not.toHaveBeenCalled();
    expect(state.employeeBootstrapReady).toBe(false);
    expect(state.employeeBootstrapError).toBe("AD SSO sign-in is not supported yet.");
    expect(state.employeeLoginSubmitting).toBe(false);
  });
});
