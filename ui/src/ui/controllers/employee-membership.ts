import {
  EMPLOYEE_GROUP_JOIN_REQUEST_PATH,
  EMPLOYEE_MEMBERSHIP_GROUPS_PATH,
  EMPLOYEE_MEMBERSHIP_PATH,
  type EmployeeMembershipGroupOption,
  type EmployeeGroupJoinRequestSaveResponse,
  type EmployeeMembershipPartOption,
  type EmployeeMembershipStatusResponse,
} from "../../../../src/gateway/employee-ui-contract.js";

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
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
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : fallbackMessage;
    throw new Error(message);
  }
  return payload as T;
}

export async function loadEmployeeMembershipStatus(): Promise<EmployeeMembershipStatusResponse> {
  const response = await fetch(EMPLOYEE_MEMBERSHIP_PATH, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  return await parseJsonResponse<EmployeeMembershipStatusResponse>(
    response,
    "Membership status unavailable",
  );
}

export async function loadEmployeeMembershipGroups(): Promise<EmployeeMembershipGroupOption[]> {
  const response = await fetch(EMPLOYEE_MEMBERSHIP_GROUPS_PATH, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  const payload = await parseJsonResponse<{ groups?: EmployeeMembershipGroupOption[] }>(
    response,
    "Group list unavailable",
  );
  return Array.isArray(payload.groups) ? payload.groups : [];
}

export async function loadEmployeeMembershipParts(
  groupId: string,
): Promise<EmployeeMembershipPartOption[]> {
  const response = await fetch(
    `${EMPLOYEE_MEMBERSHIP_GROUPS_PATH}/${encodeURIComponent(groupId)}/parts`,
    {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
    },
  );
  const payload = await parseJsonResponse<{ parts?: EmployeeMembershipPartOption[] }>(
    response,
    "Part list unavailable",
  );
  return Array.isArray(payload.parts) ? payload.parts : [];
}

export async function submitEmployeeGroupJoinRequest(
  groupId: string,
  partId: string,
): Promise<EmployeeGroupJoinRequestSaveResponse> {
  const response = await fetch(EMPLOYEE_GROUP_JOIN_REQUEST_PATH, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify({
      group_id: groupId,
      part_id: partId,
    }),
  });
  return await parseJsonResponse<EmployeeGroupJoinRequestSaveResponse>(
    response,
    "Failed to submit join request",
  );
}
