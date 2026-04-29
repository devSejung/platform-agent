import {
  EMPLOYEE_ADSSO_PATH,
  EMPLOYEE_LOGIN_PATH,
  EMPLOYEE_LOGOUT_PATH,
  type EmployeeUiLoginNotice,
} from "../../../../src/gateway/employee-ui-contract.js";
import { clearStoredAuthState } from "../storage.ts";
import { loadEmployeeBootstrap } from "./employee-bootstrap.ts";

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
        payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
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
  state.employeeLoginSubmitting = true;
  state.employeeBootstrapError = null;
  state.employeeLoginNotice = null;
  try {
    const response = await fetch(EMPLOYEE_ADSSO_PATH, {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const redirectUrl =
      payload && typeof payload === "object"
        ? ("redirectUrl" in payload && typeof payload.redirectUrl === "string"
            ? payload.redirectUrl
            : "signInUrl" in payload && typeof payload.signInUrl === "string"
              ? payload.signInUrl
              : null)
        : null;
    if (redirectUrl) {
      window.location.assign(redirectUrl);
      return;
    }
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload && typeof payload.message === "string"
          ? payload.message
          : `employee AD SSO failed (${response.status})`;
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
