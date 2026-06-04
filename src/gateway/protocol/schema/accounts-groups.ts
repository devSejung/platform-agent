import { Type, type Static } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

const GlobalRoleSchema = Type.Union([Type.Literal("member"), Type.Literal("admin")]);
const GroupRoleSchema = Type.Union([Type.Literal("member"), Type.Literal("leader")]);
const ScopeTypeSchema = Type.Union([Type.Literal("group"), Type.Literal("part")]);

export const AccountsSearchParamsSchema = Type.Object(
  {
    query: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
  },
  { additionalProperties: false },
);

export const AccountDirectoryEntrySchema = Type.Object(
  {
    accountId: NonEmptyString,
    employeeId: NonEmptyString,
    displayName: NonEmptyString,
    email: Type.Union([Type.String(), Type.Null()]),
    department: Type.Union([Type.String(), Type.Null()]),
    globalRole: GlobalRoleSchema,
    status: Type.Union([Type.Literal("active"), Type.Literal("disabled")]),
  },
  { additionalProperties: false },
);

export const AccountsSearchResultSchema = Type.Object(
  {
    entries: Type.Array(AccountDirectoryEntrySchema),
  },
  { additionalProperties: false },
);

const GroupMembershipSummarySchema = Type.Object(
  {
    scopeType: ScopeTypeSchema,
    scopeId: NonEmptyString,
    scopeName: NonEmptyString,
    parentGroupId: Type.Union([NonEmptyString, Type.Null()]),
    parentGroupName: Type.Union([Type.String(), Type.Null()]),
    groupRole: GroupRoleSchema,
    archived: Type.Boolean(),
  },
  { additionalProperties: false },
);

const AdminAccountListEntrySchema = Type.Composite([
  AccountDirectoryEntrySchema,
  Type.Object(
    {
      lastLoginAt: Type.Union([Type.String(), Type.Null()]),
      groups: Type.Array(NonEmptyString),
    },
    { additionalProperties: false },
  ),
]);

export const AdminAccountsListParamsSchema = Type.Object(
  {
    query: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const AdminAccountsListResultSchema = Type.Object(
  {
    entries: Type.Array(AdminAccountListEntrySchema),
  },
  { additionalProperties: false },
);

export const AdminAccountDetailParamsSchema = Type.Object(
  {
    accountId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const AdminAccountDetailResultSchema = Type.Object(
  {
    detail: Type.Union([
      Type.Composite([
        AdminAccountListEntrySchema,
        Type.Object(
          {
            memberships: Type.Array(GroupMembershipSummarySchema),
          },
          { additionalProperties: false },
        ),
      ]),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const AdminAccountRoleUpdateParamsSchema = Type.Object(
  {
    accountId: NonEmptyString,
    globalRole: GlobalRoleSchema,
  },
  { additionalProperties: false },
);

export const GroupScopeSchema = Type.Object(
  {
    id: NonEmptyString,
    name: NonEmptyString,
    description: Type.Union([Type.String(), Type.Null()]),
    scopeType: ScopeTypeSchema,
    parentGroupId: Type.Union([NonEmptyString, Type.Null()]),
    parentGroupName: Type.Union([Type.String(), Type.Null()]),
    groupLevel: Type.Union([Type.Literal(1), Type.Literal(2)]),
    createdByAccountId: NonEmptyString,
    ownerAccountId: NonEmptyString,
    createdAt: NonEmptyString,
    updatedAt: NonEmptyString,
    archivedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const GroupMemberEntrySchema = Type.Object(
  {
    accountId: NonEmptyString,
    displayName: NonEmptyString,
    email: Type.Union([Type.String(), Type.Null()]),
    department: Type.Union([Type.String(), Type.Null()]),
    groupRole: GroupRoleSchema,
  },
  { additionalProperties: false },
);

export const GroupListEntrySchema = Type.Composite([
  GroupScopeSchema,
  Type.Object(
    {
      partCount: Type.Integer({ minimum: 0 }),
      memberCount: Type.Integer({ minimum: 0 }),
      leaderCount: Type.Integer({ minimum: 0 }),
      canManageMembers: Type.Boolean(),
      canEditMetadata: Type.Boolean(),
      canCreatePart: Type.Boolean(),
      canArchive: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
]);

export const GroupsListParamsSchema = Type.Object(
  {
    includeArchived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const GroupsListResultSchema = Type.Object(
  {
    entries: Type.Array(GroupListEntrySchema),
  },
  { additionalProperties: false },
);

export const GroupDetailParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    includeArchived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const GroupDetailResultSchema = Type.Object(
  {
    detail: Type.Union([
      Type.Object(
        {
          group: GroupListEntrySchema,
          members: Type.Array(GroupMemberEntrySchema),
          parts: Type.Array(
            Type.Composite([
              GroupListEntrySchema,
              Type.Object({ members: Type.Array(GroupMemberEntrySchema) }, { additionalProperties: false }),
            ]),
          ),
        },
        { additionalProperties: false },
      ),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const GroupCreateParamsSchema = Type.Object(
  {
    name: NonEmptyString,
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const GroupPartCreateParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    name: NonEmptyString,
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const GroupUpdateParamsSchema = Type.Object(
  {
    groupId: NonEmptyString,
    name: NonEmptyString,
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const GroupPartUpdateParamsSchema = Type.Object(
  {
    partId: NonEmptyString,
    name: NonEmptyString,
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const GroupScopeOptionSchema = Type.Object(
  {
    scopeType: ScopeTypeSchema,
    scopeId: NonEmptyString,
    label: NonEmptyString,
    archived: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const GroupScopesListParamsSchema = Type.Object(
  {
    includeArchived: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const GroupScopesListResultSchema = Type.Object(
  {
    entries: Type.Array(GroupScopeOptionSchema),
  },
  { additionalProperties: false },
);

export const GroupMembershipAddParamsSchema = Type.Object(
  {
    scopeType: ScopeTypeSchema,
    scopeId: NonEmptyString,
    accountId: NonEmptyString,
    groupRole: Type.Optional(GroupRoleSchema),
  },
  { additionalProperties: false },
);

export const GroupMembershipRemoveParamsSchema = Type.Object(
  {
    scopeType: ScopeTypeSchema,
    scopeId: NonEmptyString,
    accountId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const GroupArchiveParamsSchema = Type.Object(
  {
    scopeId: NonEmptyString,
  },
  { additionalProperties: false },
);

export const GroupMutationResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    message: NonEmptyString,
  },
  { additionalProperties: false },
);

export const SkillHubTransferOwnershipParamsSchema = Type.Object(
  {
    slug: NonEmptyString,
    targetAccountId: NonEmptyString,
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type AccountsSearchParams = Static<typeof AccountsSearchParamsSchema>;
export type AdminAccountsListParams = Static<typeof AdminAccountsListParamsSchema>;
export type AdminAccountDetailParams = Static<typeof AdminAccountDetailParamsSchema>;
export type AdminAccountRoleUpdateParams = Static<typeof AdminAccountRoleUpdateParamsSchema>;
export type GroupsListParams = Static<typeof GroupsListParamsSchema>;
export type GroupDetailParams = Static<typeof GroupDetailParamsSchema>;
export type GroupCreateParams = Static<typeof GroupCreateParamsSchema>;
export type GroupPartCreateParams = Static<typeof GroupPartCreateParamsSchema>;
export type GroupUpdateParams = Static<typeof GroupUpdateParamsSchema>;
export type GroupPartUpdateParams = Static<typeof GroupPartUpdateParamsSchema>;
export type GroupScopesListParams = Static<typeof GroupScopesListParamsSchema>;
export type GroupMembershipAddParams = Static<typeof GroupMembershipAddParamsSchema>;
export type GroupMembershipRemoveParams = Static<typeof GroupMembershipRemoveParamsSchema>;
export type GroupArchiveParams = Static<typeof GroupArchiveParamsSchema>;
export type SkillHubTransferOwnershipParams = Static<typeof SkillHubTransferOwnershipParamsSchema>;
