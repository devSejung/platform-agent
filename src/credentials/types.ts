export type CredentialOwnerType = "account" | "room" | "system";

export type CredentialOwnerPolicy = CredentialOwnerType | "mixed";

export type CredentialScope = {
  ownerType: CredentialOwnerType;
  ownerId: string;
};

export type CredentialDefinition = {
  id: string;
  key: string;
  label: string;
  type: string;
  description: string | null;
  descriptionEn: string | null;
  usageHint: string | null;
  ownerPolicy: CredentialOwnerPolicy;
  rotationDays: number | null;
  required: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CredentialMetadata = {
  id: string;
  definitionId: string;
  definitionKey: string;
  type: string;
  ownerType: CredentialOwnerType;
  ownerId: string;
  encryptionVersion: number;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type ResolvedCredential = CredentialMetadata & {
  value: string;
};

export type CredentialGrant = {
  id: string;
  definitionId: string;
  definitionKey: string;
  skillId: string;
  permission: string;
  grantedByAccountId: string;
  createdAt: string;
  revokedAt: string | null;
};

export type CredentialAuditLog = {
  id: string;
  credentialId: string | null;
  definitionKey: string;
  ownerType: CredentialOwnerType;
  ownerId: string;
  actorAccountId: string | null;
  skillId: string | null;
  action: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
};

export type CreateCredentialDefinitionInput = {
  key: string;
  label: string;
  type: string;
  description?: string | null;
  descriptionEn?: string | null;
  usageHint?: string | null;
  ownerPolicy?: CredentialOwnerPolicy;
  rotationDays?: number | null;
  required?: boolean;
};

export type UpsertCredentialInput = {
  definitionKey: string;
  ownerType: CredentialOwnerType;
  ownerId: string;
  value: string;
  expiresAt?: string | null;
};

export type GetCredentialInput = {
  definitionKey: string;
  scope: CredentialScope;
};

export type GrantCredentialInput = {
  definitionKey: string;
  skillId: string;
  permission: string;
  grantedByAccountId: string;
};

export type RevokeCredentialGrantInput = {
  definitionKey: string;
  skillId: string;
  permission: string;
};

export type CredentialGrantCheckInput = {
  definitionKey: string;
  skillId: string;
  permission: string;
};

export type AuditCredentialInput = {
  credentialId?: string | null;
  definitionKey: string;
  scope: CredentialScope;
  actorAccountId?: string | null;
  skillId?: string | null;
  action: string;
  metadata?: Record<string, unknown> | null;
};

export type ListCredentialAuditLogsInput = {
  scope?: CredentialScope;
  definitionKey?: string | null;
  limit?: number;
};

export interface CredentialService {
  createDefinition(input: CreateCredentialDefinitionInput): Promise<CredentialDefinition>;
  archiveDefinition(key: string): Promise<void>;
  listDefinitions(): Promise<CredentialDefinition[]>;
  upsertCredential(input: UpsertCredentialInput): Promise<CredentialMetadata>;
  listCredentials(scope: CredentialScope): Promise<CredentialMetadata[]>;
  getCredential(input: GetCredentialInput): Promise<ResolvedCredential>;
  revokeCredential(input: GetCredentialInput): Promise<void>;
  grantCredential(input: GrantCredentialInput): Promise<CredentialGrant>;
  revokeCredentialGrant(input: RevokeCredentialGrantInput): Promise<void>;
  hasCredentialGrant(input: CredentialGrantCheckInput): Promise<boolean>;
  auditCredential(input: AuditCredentialInput): Promise<void>;
  listCredentialAuditLogs(input?: ListCredentialAuditLogsInput): Promise<CredentialAuditLog[]>;
}
