import { afterEach, describe, expect, it, vi } from "vitest";
import { loadEmployeeBootstrap, type EmployeeBootstrapState } from "./employee-bootstrap.ts";
import type { UiSettings } from "../storage.ts";

function createSettings(): UiSettings {
  return {
    gatewayUrl: "ws://127.0.0.1:18789",
    token: "",
    sessionKey: "agent:eon:main",
    lastActiveSessionKey: "agent:eon:main",
    theme: "claw",
    themeMode: "system",
    chatFocusMode: false,
    chatShowThinking: true,
    chatShowToolCalls: true,
    splitRatio: 0.6,
    navCollapsed: false,
    navWidth: 280,
    navGroupsCollapsed: {},
    borderRadius: 50,
  };
}

function createBootstrapState(overrides: Partial<EmployeeBootstrapState> = {}) {
  const settings = createSettings();
  const state = {
    basePath: "",
    employeeMode: true,
    settings,
    sessionKey: settings.sessionKey,
    applySessionKey: settings.lastActiveSessionKey,
    applySettings: vi.fn((next: UiSettings) => {
      state.settings = next;
    }),
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
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    },
    employeeAccountSummary: null,
    employeeBootstrapToken: null,
    employeeBootstrapReady: true,
    employeeBootstrapError: null,
    employeeMembershipBootstrapOpen: false,
    maybeEnsureEmployeeMembershipBootstrap: vi.fn(async () => true),
    maybeOpenUnreadReleaseNotes: vi.fn(),
    ...overrides,
  } as EmployeeBootstrapState;
  state.applySettings = vi.fn((next: UiSettings) => {
    state.settings = next;
  });
  return state;
}

function mockBootstrapResponse(payload: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
  );
}

describe("loadEmployeeBootstrap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the selected employee session during background bootstrap refresh", async () => {
    const settings = createSettings();
    settings.sessionKey = "agent:eon:dashboard:alpha";
    settings.lastActiveSessionKey = "agent:eon:dashboard:alpha";
    const state: EmployeeBootstrapState = {
      basePath: "",
      employeeMode: true,
      settings,
      sessionKey: "agent:eon:dashboard:alpha",
      applySessionKey: "agent:eon:dashboard:alpha",
      applySettings: vi.fn((next: UiSettings) => {
        state.settings = next;
      }),
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
        employeeId: "eon",
        name: "Eon",
        department: "Ops",
        agentId: "eon",
      },
      employeeAccountSummary: null,
      employeeBootstrapToken: "old-token",
      employeeBootstrapReady: true,
      employeeBootstrapError: null,
      employeeMembershipBootstrapOpen: false,
      maybeEnsureEmployeeMembershipBootstrap: vi.fn(async () => true),
      maybeOpenUnreadReleaseNotes: vi.fn(),
    };
    mockBootstrapResponse({
      authenticated: true,
      token: "new-token",
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
      sessionKey: "agent:eon:main",
      gatewayUrl: "ws://127.0.0.1:19001",
    });

    await loadEmployeeBootstrap(state, { background: true });

    expect(state.sessionKey).toBe("agent:eon:dashboard:alpha");
    expect(state.settings.sessionKey).toBe("agent:eon:dashboard:alpha");
    expect(state.settings.lastActiveSessionKey).toBe("agent:eon:dashboard:alpha");
    expect(state.employeeBootstrapToken).toBe("new-token");
  });

  it("applies the bootstrap session on the initial foreground load", async () => {
    const state = createBootstrapState({
      employeeProfile: {
        employeeId: null,
        name: null,
        department: null,
        agentId: null,
      },
      employeeBootstrapReady: false,
    });
    mockBootstrapResponse({
      authenticated: true,
      token: "bootstrap-token",
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
      sessionKey: "agent:eon:main",
      gatewayUrl: "ws://127.0.0.1:19001",
    });

    await loadEmployeeBootstrap(state);

    expect(state.sessionKey).toBe("agent:eon:main");
    expect(state.settings.sessionKey).toBe("agent:eon:main");
    expect(state.settings.lastActiveSessionKey).toBe("agent:eon:main");
  });

  it("skips release note auto-open while membership bootstrap is required", async () => {
    const state = createBootstrapState({
      employeeProfile: {
        employeeId: null,
        name: null,
        department: null,
        agentId: null,
      },
      employeeBootstrapReady: false,
    });
    state.maybeEnsureEmployeeMembershipBootstrap = vi.fn(async () => false);
    mockBootstrapResponse({
      authenticated: true,
      token: "bootstrap-token",
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
      sessionKey: "agent:eon:main",
      gatewayUrl: "ws://127.0.0.1:19001",
    });

    await loadEmployeeBootstrap(state);

    expect(state.maybeEnsureEmployeeMembershipBootstrap).toHaveBeenCalledTimes(1);
    expect(state.maybeOpenUnreadReleaseNotes).not.toHaveBeenCalled();
  });
});
