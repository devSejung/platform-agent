export const EMPLOYEE_BOOTSTRAP_PATH = "/auth/me";
export const EMPLOYEE_LOGIN_PATH = "/employee/auth/login";
export const EMPLOYEE_ADSSO_PATH = "/employee/auth/adsso";
export const EMPLOYEE_LOGOUT_PATH = "/employee/auth/logout";

export type EmployeeUiLoginNotice = {
  title: string;
  body: string;
};

export type EmployeeUiAnnouncement = {
  title?: string;
  body?: string;
  linkUrl?: string;
  linkLabel?: string;
};

export type EmployeeUiSurfaceConfig = {
  docsUrl?: string;
  announcement?: EmployeeUiAnnouncement;
};

export type EmployeeUiBootstrapAuthenticatedResponse = {
  authenticated: true;
  employeeId: string;
  name?: string;
  department?: string;
  agentId: string;
  sessionKey: string;
  gatewayUrl?: string;
  token: string;
  ui?: EmployeeUiSurfaceConfig;
};

export type EmployeeUiBootstrapUnauthenticatedResponse = {
  authenticated: false;
  message?: string;
  signInUrl?: string;
  ui?: EmployeeUiSurfaceConfig;
};

export type EmployeeUiBootstrapResponse =
  | EmployeeUiBootstrapAuthenticatedResponse
  | EmployeeUiBootstrapUnauthenticatedResponse;

export type EmployeeUiLoginSuccessResponse = {
  authenticated: true;
  notice?: EmployeeUiLoginNotice;
};
