import {
  getAdminAccountDetail,
  listAdminAccounts,
  searchAccounts,
  updateAccountGlobalRole,
} from "../../accounts/account-store.js";
import {
  addGroupMembership,
  archiveGroupScope,
  createGroup,
  createPart,
  getGroupDetail,
  listGroupEntries,
  listGroupScopeOptions,
  removeGroupMembership,
} from "../../accounts/group-store.js";
import { requireAdminAccount, requireRequesterAccountId } from "../../accounts/permissions.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateAccountsSearchParams,
  validateAdminAccountDetailParams,
  validateAdminAccountRoleUpdateParams,
  validateAdminAccountsListParams,
  validateGroupArchiveParams,
  validateGroupCreateParams,
  validateGroupDetailParams,
  validateGroupMembershipAddParams,
  validateGroupMembershipRemoveParams,
  validateGroupPartCreateParams,
  validateGroupsListParams,
  validateGroupScopesListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const accountGroupHandlers: GatewayRequestHandlers = {
  "accounts.search": ({ params, respond }) => {
    if (!validateAccountsSearchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid accounts.search params: ${formatValidationErrors(validateAccountsSearchParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const { query, limit } = params as { query?: string; limit?: number };
      respond(true, { entries: searchAccounts({ query, limit }) }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "groups.list": ({ params, respond, client }) => {
    if (!validateGroupsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid groups.list params: ${formatValidationErrors(validateGroupsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const actorAccountId = requireRequesterAccountId(client);
      const { includeArchived } = params as { includeArchived?: boolean };
      respond(
        true,
        { entries: listGroupEntries({ actorAccountId, includeArchived: Boolean(includeArchived) }) },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "groups.detail": ({ params, respond, client }) => {
    if (!validateGroupDetailParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid groups.detail params: ${formatValidationErrors(validateGroupDetailParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const actorAccountId = requireRequesterAccountId(client);
      const { groupId, includeArchived } = params as { groupId: string; includeArchived?: boolean };
      respond(
        true,
        {
          detail: getGroupDetail({
            actorAccountId,
            groupId,
            includeArchived: Boolean(includeArchived),
          }),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "groups.create": ({ params, respond, client }) => {
    if (!validateGroupCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid groups.create params: ${formatValidationErrors(validateGroupCreateParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const actorAccountId = requireAdminAccount(client);
      const { name, description } = params as { name: string; description?: string };
      const created = createGroup({ actorAccountId, name, description });
      respond(true, { ok: true, message: `Created group ${created.name}` }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "groups.part.create": ({ params, respond, client }) => {
    if (!validateGroupPartCreateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid groups.part.create params: ${formatValidationErrors(validateGroupPartCreateParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const actorAccountId = requireAdminAccount(client);
      const { groupId, name, description } = params as {
        groupId: string;
        name: string;
        description?: string;
      };
      const created = createPart({ actorAccountId, groupId, name, description });
      respond(true, { ok: true, message: `Created part ${created.name}` }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "groups.scopes.list": ({ params, respond }) => {
    if (!validateGroupScopesListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid groups.scopes.list params: ${formatValidationErrors(validateGroupScopesListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const { includeArchived } = params as { includeArchived?: boolean };
      respond(
        true,
        { entries: listGroupScopeOptions({ includeArchived: Boolean(includeArchived) }) },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "groups.members.add": ({ params, respond, client }) => {
    if (!validateGroupMembershipAddParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid groups.members.add params: ${formatValidationErrors(validateGroupMembershipAddParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const actorAccountId = requireRequesterAccountId(client);
      const { scopeType, scopeId, accountId, groupRole } = params as {
        scopeType: "group" | "part";
        scopeId: string;
        accountId: string;
        groupRole?: "member" | "leader";
      };
      addGroupMembership({
        actorAccountId,
        targetAccountId: accountId,
        scopeType,
        scopeId,
        groupRole,
      });
      respond(true, { ok: true, message: "Member added." }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "groups.members.remove": ({ params, respond, client }) => {
    if (!validateGroupMembershipRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid groups.members.remove params: ${formatValidationErrors(validateGroupMembershipRemoveParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const actorAccountId = requireRequesterAccountId(client);
      const { scopeType, scopeId, accountId } = params as {
        scopeType: "group" | "part";
        scopeId: string;
        accountId: string;
      };
      removeGroupMembership({
        actorAccountId,
        targetAccountId: accountId,
        scopeType,
        scopeId,
      });
      respond(true, { ok: true, message: "Member removed." }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "groups.archive": ({ params, respond, client }) => {
    if (!validateGroupArchiveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid groups.archive params: ${formatValidationErrors(validateGroupArchiveParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const actorAccountId = requireAdminAccount(client);
      const { scopeId } = params as { scopeId: string };
      const archived = archiveGroupScope({ actorAccountId, scopeId });
      respond(true, { ok: true, message: `Archived ${archived.name}` }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "admin.accounts.list": ({ params, respond, client }) => {
    if (!validateAdminAccountsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid admin.accounts.list params: ${formatValidationErrors(validateAdminAccountsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      requireAdminAccount(client);
      const { query } = params as { query?: string };
      respond(true, { entries: listAdminAccounts({ query }) }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "admin.accounts.detail": ({ params, respond, client }) => {
    if (!validateAdminAccountDetailParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid admin.accounts.detail params: ${formatValidationErrors(validateAdminAccountDetailParams.errors)}`,
        ),
      );
      return;
    }
    try {
      requireAdminAccount(client);
      const { accountId } = params as { accountId: string };
      respond(true, { detail: getAdminAccountDetail(accountId) }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "admin.accounts.role.update": ({ params, respond, client }) => {
    if (!validateAdminAccountRoleUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid admin.accounts.role.update params: ${formatValidationErrors(
            validateAdminAccountRoleUpdateParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      const actorAccountId = requireAdminAccount(client);
      const { accountId, globalRole } = params as { accountId: string; globalRole: "member" | "admin" };
      const updated = updateAccountGlobalRole({
        actorAccountId,
        targetAccountId: accountId,
        nextRole: globalRole,
      });
      respond(true, { ok: true, message: `Role updated for ${updated.employeeId}` }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
};
