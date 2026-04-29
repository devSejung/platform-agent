import {
  EMPLOYEE_BOOTSTRAP_PATH,
  type EmployeeUiBootstrapResponse,
} from "../../../../src/gateway/employee-ui-contract.js";
import type { UiSettings } from "../storage.ts";

export type EmployeeBootstrapState = {
  basePath: string;
  employeeMode: boolean;
  settings: UiSettings;
  sessionKey?: string;
  applySessionKey?: string;
  applySettings?: (next: UiSettings) => void;
  password: string;
  employeeUi: {
    docsUrl: string | null;
    announcementTitle: string | null;
    announcementBody: string | null;
    announcementLinkLabel: string | null;
    announcementLinkUrl: string | null;
  };
  employeeProfile: {
    employeeId: string | null;
    name: string | null;
    department: string | null;
    agentId: string | null;
  };
  employeeBootstrapToken: string | null;
  employeeBootstrapReady: boolean;
  employeeBootstrapError: string | null;
};

export async function loadEmployeeBootstrap(
  state: EmployeeBootstrapState,
  opts?: { background?: boolean },
) {
  if (!state.employeeMode || typeof window === "undefined" || typeof fetch !== "function") {
    return;
  }
  const background = opts?.background === true;
  if (!background) {
    state.employeeBootstrapError = null;
    state.employeeBootstrapReady = false;
  }
  try {
    const res = await fetch(EMPLOYEE_BOOTSTRAP_PATH, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    if (!res.ok) {
      throw new Error(`employee bootstrap failed (${res.status})`);
    }
    const parsed = (await res.json()) as EmployeeUiBootstrapResponse;
    state.employeeUi = {
      docsUrl: parsed.ui?.docsUrl?.trim() || null,
      announcementTitle: parsed.ui?.announcement?.title?.trim() || null,
      announcementBody: parsed.ui?.announcement?.body?.trim() || null,
      announcementLinkLabel: parsed.ui?.announcement?.linkLabel?.trim() || null,
      announcementLinkUrl: parsed.ui?.announcement?.linkUrl?.trim() || null,
    };
    if (!parsed.authenticated) {
      state.employeeBootstrapToken = null;
      state.employeeProfile = {
        employeeId: null,
        name: null,
        department: null,
        agentId: null,
      };
      state.employeeBootstrapReady = false;
      state.employeeBootstrapError = null;
      return;
    }
    if (!parsed.token || !parsed.agentId || !parsed.sessionKey) {
      throw new Error("employee bootstrap missing required fields");
    }
    const nextSettings: UiSettings = {
      ...state.settings,
      gatewayUrl: parsed.gatewayUrl?.trim() || state.settings.gatewayUrl,
      token: "",
      sessionKey: parsed.sessionKey,
      lastActiveSessionKey: parsed.sessionKey,
    };
    if (typeof state.applySettings === "function") {
      state.applySettings(nextSettings);
    } else {
      state.settings = nextSettings;
    }
    if (typeof state.sessionKey === "string") {
      state.sessionKey = parsed.sessionKey;
    }
    if (typeof state.applySessionKey === "string") {
      state.applySessionKey = parsed.sessionKey;
    }
    state.password = "";
    state.employeeProfile = {
      employeeId: parsed.employeeId,
      name: parsed.name ?? null,
      department: parsed.department ?? null,
      agentId: parsed.agentId,
    };
    state.employeeBootstrapToken = parsed.token;
    state.employeeBootstrapReady = true;
    state.employeeBootstrapError = null;
  } catch (error) {
    if (!background) {
      state.employeeBootstrapError = error instanceof Error ? error.message : String(error);
      state.employeeBootstrapReady = false;
    }
  }
}
