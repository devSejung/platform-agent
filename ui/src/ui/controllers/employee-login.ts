import {
  EMPLOYEE_LOGIN_PATH,
  EMPLOYEE_LOGOUT_PATH,
  type EmployeeUiLoginNotice,
} from "../../../../src/gateway/employee-ui-contract.js";
import { clearStoredAuthState } from "../storage.ts";
import { loadEmployeeBootstrap } from "./employee-bootstrap.ts";

function resolveBrowserTimezone(): string | undefined {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timezone === "string" && timezone.trim() ? timezone.trim() : undefined;
  } catch {
    return undefined;
  }
}

export type EmployeeLoginState = {
  employeeMode: boolean;
  employeeLoginIdentifier: string;
  employeeLoginPassword: string;
  employeeLoginSubmitting: boolean;
  employeeBootstrapReady: boolean;
  employeeBootstrapError: string | null;
  employeeLoginNotice: EmployeeUiLoginNotice | null;
  connect: () => void;
  connected?: boolean;
  client?: { stop?: () => void } | null;
  lastError?: string | null;
  lastErrorCode?: string | null;
  chatMessages?: unknown[];
  chatToolMessages?: unknown[];
  chatQueue?: unknown[];
  chatRunId?: string | null;
  chatSendDrafts?: Record<string, unknown>;
  chatSendFailures?: Record<string, unknown>;
  resetReleaseNotesSession?: () => void;
} & Parameters<typeof loadEmployeeBootstrap>[0];

export async function submitEmployeeLogin(state: EmployeeLoginState) {
  if (!state.employeeMode || state.employeeLoginSubmitting) {
    return;
  }
  const identifier = state.employeeLoginIdentifier.trim();
  const password = state.employeeLoginPassword;
  if (!identifier || !password) {
    state.employeeBootstrapError = "ID and password are required";
    return;
  }
  state.employeeLoginSubmitting = true;
  state.employeeBootstrapError = null;
  state.employeeLoginNotice = null;
  try {
    const response = await fetch(EMPLOYEE_LOGIN_PATH, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        identifier,
        password,
        timezone: resolveBrowserTimezone(),
      }),
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof payload.message === "string"
          ? payload.message
          : `employee login failed (${response.status})`;
      throw new Error(message);
    }
    state.employeeLoginNotice =
      payload &&
      typeof payload === "object" &&
      "notice" in payload &&
      payload.notice &&
      typeof payload.notice === "object" &&
      "title" in payload.notice &&
      typeof payload.notice.title === "string" &&
      "body" in payload.notice &&
      typeof payload.notice.body === "string"
        ? {
            title: payload.notice.title,
            body: payload.notice.body,
          }
        : null;
    state.employeeLoginPassword = "";
    await loadEmployeeBootstrap(state);
    if (state.employeeBootstrapReady) {
      state.connect();
    }
  } catch (error) {
    state.employeeBootstrapError = error instanceof Error ? error.message : String(error);
  } finally {
    state.employeeLoginSubmitting = false;
  }
}

export async function submitEmployeeAdSso(state: EmployeeLoginState) {
  if (!state.employeeMode || state.employeeLoginSubmitting) {
    return;
  }
  state.employeeBootstrapError = "AD SSO sign-in is not supported yet.";
  state.employeeLoginNotice = null;
}

export async function logoutEmployee(state: EmployeeLoginState) {
  if (!state.employeeMode) {
    return;
  }
  state.employeeLoginSubmitting = true;
  try {
    await fetch(EMPLOYEE_LOGOUT_PATH, {
      method: "POST",
      credentials: "include",
    });
  } finally {
    state.resetReleaseNotesSession?.();
    state.client?.stop?.();
    state.connected = false;
    state.employeeBootstrapReady = false;
    state.employeeBootstrapToken = null;
    state.employeeProfile = {
      employeeId: null,
      name: null,
      department: null,
      agentId: null,
    };
    state.employeeAccountSummary = null;
    state.employeeBootstrapError = null;
    state.employeeLoginNotice = null;
    state.employeeLoginIdentifier = "";
    state.employeeLoginPassword = "";
    state.lastError = null;
    state.lastErrorCode = null;
    state.chatMessages = [];
    state.chatToolMessages = [];
    state.chatQueue = [];
    state.chatRunId = null;
    state.chatSendDrafts = {};
    state.chatSendFailures = {};
    state.settings = {
      ...state.settings,
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
    };
    clearStoredAuthState(state.settings);
    state.employeeLoginSubmitting = false;
  }
}
