import { Type, type Static } from "@sinclair/typebox";
import { NonEmptyString } from "./primitives.js";

export const CredentialOwnerTypeSchema = Type.Union([
  Type.Literal("account"),
  Type.Literal("room"),
  Type.Literal("system"),
]);

export const CredentialOwnerPolicySchema = Type.Union([
  Type.Literal("account"),
  Type.Literal("room"),
  Type.Literal("system"),
  Type.Literal("mixed"),
]);

export const CredentialDefinitionSchema = Type.Object(
  {
    id: NonEmptyString,
    key: NonEmptyString,
    label: NonEmptyString,
    type: NonEmptyString,
    description: Type.Union([Type.String(), Type.Null()]),
    descriptionEn: Type.Union([Type.String(), Type.Null()]),
    usageHint: Type.Union([Type.String(), Type.Null()]),
    ownerPolicy: CredentialOwnerPolicySchema,
    rotationDays: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    required: Type.Boolean(),
    createdAt: NonEmptyString,
    updatedAt: NonEmptyString,
    archivedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const CredentialMetadataSchema = Type.Object(
  {
    id: NonEmptyString,
    definitionId: NonEmptyString,
    definitionKey: NonEmptyString,
    type: NonEmptyString,
    ownerType: CredentialOwnerTypeSchema,
    ownerId: NonEmptyString,
    encryptionVersion: Type.Integer({ minimum: 1 }),
    createdAt: NonEmptyString,
    updatedAt: NonEmptyString,
    lastUsedAt: Type.Union([Type.String(), Type.Null()]),
    expiresAt: Type.Union([Type.String(), Type.Null()]),
    revokedAt: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const CredentialDefinitionsListParamsSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const CredentialsStatusParamsSchema = Type.Object({}, { additionalProperties: false });

export const CredentialsStatusResultSchema = Type.Object(
  {
    encryptionReady: Type.Boolean(),
    keyName: NonEmptyString,
    message: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const CredentialDefinitionsListResultSchema = Type.Object(
  {
    entries: Type.Array(CredentialDefinitionSchema),
  },
  { additionalProperties: false },
);

export const CredentialDefinitionsUpsertParamsSchema = Type.Object(
  {
    key: NonEmptyString,
    label: NonEmptyString,
    type: NonEmptyString,
    description: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    descriptionEn: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    usageHint: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    ownerPolicy: Type.Optional(CredentialOwnerPolicySchema),
    rotationDays: Type.Optional(Type.Union([Type.Integer({ minimum: 1 }), Type.Null()])),
    required: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const CredentialDefinitionMutationResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    definition: CredentialDefinitionSchema,
  },
  { additionalProperties: false },
);

export const CredentialDefinitionDeleteParamsSchema = Type.Object(
  {
    key: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CredentialDefinitionDeleteResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
  },
  { additionalProperties: false },
);

export const CredentialsListParamsSchema = Type.Object({}, { additionalProperties: false });

export const CredentialsListResultSchema = Type.Object(
  {
    entries: Type.Array(CredentialMetadataSchema),
  },
  { additionalProperties: false },
);

export const CredentialUpsertParamsSchema = Type.Object(
  {
    definitionKey: NonEmptyString,
    value: NonEmptyString,
    expiresAt: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  },
  { additionalProperties: false },
);

export const CredentialMutationResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    credential: CredentialMetadataSchema,
  },
  { additionalProperties: false },
);

export const CredentialRevokeParamsSchema = Type.Object(
  {
    definitionKey: NonEmptyString,
  },
  { additionalProperties: false },
);

export const CredentialRevokeResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
  },
  { additionalProperties: false },
);

export type CredentialDefinitionsListParams = Static<typeof CredentialDefinitionsListParamsSchema>;
export type CredentialsStatusParams = Static<typeof CredentialsStatusParamsSchema>;
export type CredentialDefinitionsUpsertParams = Static<
  typeof CredentialDefinitionsUpsertParamsSchema
>;
export type CredentialDefinitionDeleteParams = Static<
  typeof CredentialDefinitionDeleteParamsSchema
>;
export type CredentialsListParams = Static<typeof CredentialsListParamsSchema>;
export type CredentialUpsertParams = Static<typeof CredentialUpsertParamsSchema>;
export type CredentialRevokeParams = Static<typeof CredentialRevokeParamsSchema>;
