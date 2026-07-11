export const EMPLOYEE_BOOTSTRAP_PATH = "/auth/me";
export const EMPLOYEE_LOGIN_PATH = "/employee/auth/login";
export const EMPLOYEE_ADSSO_PATH = "/employee/auth/adsso";
export const EMPLOYEE_LOGOUT_PATH = "/employee/auth/logout";
export const EMPLOYEE_RELEASE_NOTES_STATUS_PATH = "/employee/release-notes/status";
export const EMPLOYEE_RELEASE_NOTES_READ_PATH = "/employee/release-notes/read";
export const EMPLOYEE_MEMBERSHIP_PATH = "/employee/membership";
export const EMPLOYEE_MEMBERSHIP_GROUPS_PATH = "/employee/groups";
export const EMPLOYEE_GROUP_JOIN_REQUEST_PATH = "/employee/group-join-request";

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
  vocUrl?: string;
  announcement?: EmployeeUiAnnouncement;
};

export type EmployeeUiAccountSummary = {
  accountId: string;
  globalRole: "member" | "admin";
  groupCount: number;
  partCount: number;
  topLevelGroupNames: string[];
  hasAdminAccess: boolean;
  hasLeaderScope: boolean;
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
  account?: EmployeeUiAccountSummary;
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

export type EmployeeTimezoneBody = {
  timezone?: string;
};

export type EmployeeReleaseNotesStatus = {
  latestVersion: string;
  readVersion: string | null;
  shouldAutoOpen: boolean;
};

export type EmployeeMembershipInvalidReason =
  | "NOT_REGISTERED"
  | "GROUP_MISSING"
  | "PART_MISSING"
  | "GROUP_INVALID"
  | "PART_INVALID"
  | "PART_GROUP_MISMATCH";

export type EmployeeMembershipStatus = "approved" | "pending" | "rejected" | "none";

export type EmployeeMembershipPendingRequest = {
  request_id: string;
  group_id: string;
  group_name: string;
  part_id: string;
  part_name: string;
  status: "pending" | "rejected";
  requested_at: string;
};

export type EmployeeMembershipStatusResponse = {
  has_membership: boolean;
  has_valid_membership: boolean;
  reason: EmployeeMembershipInvalidReason | null;
  membership_status: EmployeeMembershipStatus;
  group_id: string | null;
  group_name: string | null;
  part_id: string | null;
  part_name: string | null;
  pending_request: EmployeeMembershipPendingRequest | null;
};

export type EmployeeMembershipGroupOption = {
  id: string;
  name: string;
};

export type EmployeeMembershipPartOption = {
  id: string;
  name: string;
  group_id: string;
};

export type EmployeeGroupJoinRequestSaveResponse = {
  success: true;
  request_id: string;
  status: "pending";
  group_id: string;
  part_id: string;
};
