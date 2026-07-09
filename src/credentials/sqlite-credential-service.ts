import { randomUUID } from "node:crypto";
import { getPlatformClawDatabase } from "../accounts/db.js";
import {
  currentCredentialEncryptionVersion,
  decryptCredentialValue,
  encryptCredentialValue,
} from "./encryption.js";
import type {
  CredentialDefinition,
  CredentialGrant,
  CredentialGrantCheckInput,
  CredentialMetadata,
  CredentialOwnerPolicy,
  CredentialOwnerType,
  CredentialScope,
  CredentialService,
  CreateCredentialDefinitionInput,
  GetCredentialInput,
  GrantCredentialInput,
  RevokeCredentialGrantInput,
  ResolvedCredential,
  UpsertCredentialInput,
} from "./types.js";

type CredentialDefinitionRow = {
  id: string;
  credential_key: string;
  label: string;
  type: string;
  description: string | null;
  description_en: string | null;
  usage_hint: string | null;
  owner_policy: CredentialOwnerPolicy;
  rotation_days: number | null;
  required: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type CredentialRow = {
  id: string;
  definition_id: string;
  definition_key: string;
  type: string;
  owner_type: CredentialOwnerType;
  owner_id: string;
  encrypted_value: string;
  encryption_version: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

type CredentialGrantRow = {
  id: string;
  definition_id: string;
  definition_key: string;
  skill_id: string;
  permission: string;
  granted_by_account_id: string;
  created_at: string;
  revoked_at: string | null;
};

const CREDENTIAL_OWNER_TYPES = new Set<CredentialOwnerType>(["account", "room", "system"]);
const CREDENTIAL_OWNER_POLICIES = new Set<CredentialOwnerPolicy>([
  "account",
  "room",
  "system",
  "mixed",
]);

function trimRequired(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function trimOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeOwnerType(ownerType: CredentialOwnerType): CredentialOwnerType {
  if (!CREDENTIAL_OWNER_TYPES.has(ownerType)) {
    throw new Error(`Unsupported credential owner type: ${String(ownerType)}`);
  }
  return ownerType;
}

function normalizeOwnerPolicy(
  ownerPolicy: CredentialOwnerPolicy | undefined,
): CredentialOwnerPolicy {
  const normalized = ownerPolicy ?? "account";
  if (!CREDENTIAL_OWNER_POLICIES.has(normalized)) {
    throw new Error(`Unsupported credential owner policy: ${String(ownerPolicy)}`);
  }
  return normalized;
}

function assertOwnerPolicyAllowsScope(params: {
  ownerPolicy: CredentialOwnerPolicy;
  scope: CredentialScope;
}) {
  if (params.ownerPolicy === "mixed" || params.ownerPolicy === params.scope.ownerType) {
    return;
  }
  throw new Error(
    `Credential owner policy "${params.ownerPolicy}" does not allow "${params.scope.ownerType}" scope.`,
  );
}

function normalizeRotationDays(rotationDays: number | null | undefined): number | null {
  if (rotationDays === null || rotationDays === undefined) {
    return null;
  }
  if (!Number.isInteger(rotationDays) || rotationDays <= 0) {
    throw new Error("rotationDays must be a positive integer when provided");
  }
  return rotationDays;
}

function normalizeOptionalTimestamp(
  value: string | null | undefined,
  field: string,
): string | null {
  const trimmed = trimOptional(value);
  if (!trimmed) {
    return null;
  }
  const timestampMs = Date.parse(trimmed);
  if (!Number.isFinite(timestampMs)) {
    throw new Error(`${field} must be a valid timestamp when provided`);
  }
  return trimmed;
}

function rowToDefinition(row: CredentialDefinitionRow): CredentialDefinition {
  return {
    id: row.id,
    key: row.credential_key,
    label: row.label,
    type: row.type,
    description: row.description,
    descriptionEn: row.description_en,
    usageHint: row.usage_hint,
    ownerPolicy: row.owner_policy,
    rotationDays: row.rotation_days,
    required: row.required === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function rowToMetadata(row: CredentialRow): CredentialMetadata {
  return {
    id: row.id,
    definitionId: row.definition_id,
    definitionKey: row.definition_key,
    type: row.type,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    encryptionVersion: row.encryption_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

function rowToGrant(row: CredentialGrantRow): CredentialGrant {
  return {
    id: row.id,
    definitionId: row.definition_id,
    definitionKey: row.definition_key,
    skillId: row.skill_id,
    permission: row.permission,
    grantedByAccountId: row.granted_by_account_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export class SQLiteCredentialService implements CredentialService {
  private readonly env: NodeJS.ProcessEnv;

  constructor(params: { env?: NodeJS.ProcessEnv } = {}) {
    this.env = params.env ?? process.env;
  }

  async createDefinition(input: CreateCredentialDefinitionInput): Promise<CredentialDefinition> {
    const now = new Date().toISOString();
    const key = trimRequired(input.key, "key");
    const label = trimRequired(input.label, "label");
    const type = trimRequired(input.type, "type");
    const description = trimOptional(input.description);
    const descriptionEn = trimOptional(input.descriptionEn);
    const usageHint = trimOptional(input.usageHint);
    const ownerPolicy = normalizeOwnerPolicy(input.ownerPolicy);
    const rotationDays = normalizeRotationDays(input.rotationDays);
    const { db } = getPlatformClawDatabase(this.env);
    const existing = this.getDefinitionRowByKey(key);
    if (existing) {
      db.prepare(
        `UPDATE credential_definitions
            SET label = @label,
                type = @type,
                description = @description,
                description_en = @description_en,
                usage_hint = @usage_hint,
                owner_policy = @owner_policy,
                rotation_days = @rotation_days,
                required = @required,
                updated_at = @updated_at,
                archived_at = NULL
          WHERE id = @id`,
      ).run({
        id: existing.id,
        label,
        type,
        description,
        description_en: descriptionEn,
        usage_hint: usageHint,
        owner_policy: ownerPolicy,
        rotation_days: rotationDays,
        required: input.required ? 1 : 0,
        updated_at: now,
      });
      return rowToDefinition(this.requireDefinitionRowByKey(key));
    }
    db.prepare(
      `INSERT INTO credential_definitions (
         id, credential_key, label, type, description, description_en, usage_hint, owner_policy, rotation_days,
         required, created_at, updated_at, archived_at
       ) VALUES (
         @id, @credential_key, @label, @type, @description, @description_en, @usage_hint, @owner_policy, @rotation_days,
         @required, @created_at, @updated_at, NULL
       )`,
    ).run({
      id: randomUUID(),
      credential_key: key,
      label,
      type,
      description,
      description_en: descriptionEn,
      usage_hint: usageHint,
      owner_policy: ownerPolicy,
      rotation_days: rotationDays,
      required: input.required ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
    return rowToDefinition(this.requireDefinitionRowByKey(key));
  }

  async listDefinitions(): Promise<CredentialDefinition[]> {
    const { db } = getPlatformClawDatabase(this.env);
    const rows = db
      .prepare(
        `SELECT id, credential_key, label, type, description, description_en, owner_policy, rotation_days,
                usage_hint, required, created_at, updated_at, archived_at
           FROM credential_definitions
          WHERE archived_at IS NULL
          ORDER BY credential_key ASC`,
      )
      .all() as CredentialDefinitionRow[];
    return rows.map(rowToDefinition);
  }

  async archiveDefinition(keyInput: string): Promise<void> {
    const key = trimRequired(keyInput, "key");
    const now = new Date().toISOString();
    const { db } = getPlatformClawDatabase(this.env);
    db.prepare(
      `UPDATE credential_definitions
          SET archived_at = ?,
              updated_at = ?
        WHERE credential_key = ?
          AND archived_at IS NULL`,
    ).run(now, now, key);
  }

  async upsertCredential(input: UpsertCredentialInput): Promise<CredentialMetadata> {
    const scope = this.normalizeScope({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
    });
    const definition = this.requireDefinitionRowByKey(input.definitionKey);
    assertOwnerPolicyAllowsScope({ ownerPolicy: definition.owner_policy, scope });
    const value = trimRequired(input.value, "value");
    const expiresAt = normalizeOptionalTimestamp(input.expiresAt, "expiresAt");
    const now = new Date().toISOString();
    const encrypted = encryptCredentialValue({ value, env: this.env });
    const { db } = getPlatformClawDatabase(this.env);
    const existing = this.getCredentialRow({
      definitionId: definition.id,
      scope,
      includeRevoked: true,
    });
    if (existing) {
      db.prepare(
        `UPDATE credentials
            SET encrypted_value = @encrypted_value,
                encryption_version = @encryption_version,
                updated_at = @updated_at,
                expires_at = @expires_at,
                revoked_at = NULL
          WHERE id = @id`,
      ).run({
        id: existing.id,
        encrypted_value: encrypted.encryptedValue,
        encryption_version: encrypted.encryptionVersion,
        updated_at: now,
        expires_at: expiresAt,
      });
      return rowToMetadata(this.requireCredentialRow({ definitionId: definition.id, scope }));
    }
    db.prepare(
      `INSERT INTO credentials (
         id, definition_id, owner_type, owner_id, encrypted_value, encryption_version,
         created_at, updated_at, last_used_at, expires_at, revoked_at
       ) VALUES (
         @id, @definition_id, @owner_type, @owner_id, @encrypted_value, @encryption_version,
         @created_at, @updated_at, NULL, @expires_at, NULL
       )`,
    ).run({
      id: randomUUID(),
      definition_id: definition.id,
      owner_type: scope.ownerType,
      owner_id: scope.ownerId,
      encrypted_value: encrypted.encryptedValue,
      encryption_version: encrypted.encryptionVersion,
      created_at: now,
      updated_at: now,
      expires_at: expiresAt,
    });
    return rowToMetadata(this.requireCredentialRow({ definitionId: definition.id, scope }));
  }

  async listCredentials(scopeInput: CredentialScope): Promise<CredentialMetadata[]> {
    const scope = this.normalizeScope(scopeInput);
    const { db } = getPlatformClawDatabase(this.env);
    const rows = db
      .prepare(
        `SELECT c.id, c.definition_id, d.credential_key AS definition_key, d.type,
                c.owner_type, c.owner_id, c.encrypted_value, c.encryption_version,
                c.created_at, c.updated_at, c.last_used_at, c.expires_at, c.revoked_at
           FROM credentials c
           JOIN credential_definitions d ON d.id = c.definition_id
          WHERE c.owner_type = ?
            AND c.owner_id = ?
            AND c.revoked_at IS NULL
            AND d.archived_at IS NULL
          ORDER BY d.credential_key ASC`,
      )
      .all(scope.ownerType, scope.ownerId) as CredentialRow[];
    return rows.map(rowToMetadata);
  }

  async getCredential(input: GetCredentialInput): Promise<ResolvedCredential> {
    const scope = this.normalizeScope(input.scope);
    const definition = this.requireDefinitionRowByKey(input.definitionKey);
    assertOwnerPolicyAllowsScope({ ownerPolicy: definition.owner_policy, scope });
    const row = this.requireCredentialRow({ definitionId: definition.id, scope });
    if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
      throw new Error(`Credential "${definition.credential_key}" is expired.`);
    }
    if (row.encryption_version !== currentCredentialEncryptionVersion()) {
      throw new Error(`Unsupported credential encryption version: ${row.encryption_version}`);
    }
    const value = decryptCredentialValue({ encryptedValue: row.encrypted_value, env: this.env });
    const now = new Date().toISOString();
    getPlatformClawDatabase(this.env)
      .db.prepare(`UPDATE credentials SET last_used_at = ? WHERE id = ?`)
      .run(now, row.id);
    return {
      ...rowToMetadata({
        ...row,
        last_used_at: now,
      }),
      value,
    };
  }

  async revokeCredential(input: GetCredentialInput): Promise<void> {
    const scope = this.normalizeScope(input.scope);
    const definition = this.requireDefinitionRowByKey(input.definitionKey);
    const now = new Date().toISOString();
    getPlatformClawDatabase(this.env)
      .db.prepare(
        `UPDATE credentials
            SET revoked_at = ?,
                updated_at = ?
          WHERE definition_id = ?
            AND owner_type = ?
            AND owner_id = ?
            AND revoked_at IS NULL`,
      )
      .run(now, now, definition.id, scope.ownerType, scope.ownerId);
  }

  async grantCredential(input: GrantCredentialInput): Promise<CredentialGrant> {
    const definition = this.requireDefinitionRowByKey(input.definitionKey);
    const skillId = trimRequired(input.skillId, "skillId");
    const permission = trimRequired(input.permission, "permission");
    const grantedByAccountId = trimRequired(input.grantedByAccountId, "grantedByAccountId");
    const now = new Date().toISOString();
    const { db } = getPlatformClawDatabase(this.env);
    const existing = this.getGrantRow({
      definitionId: definition.id,
      skillId,
      permission,
      includeRevoked: true,
    });
    if (existing) {
      db.prepare(
        `UPDATE credential_grants
            SET granted_by_account_id = @granted_by_account_id,
                created_at = @created_at,
                revoked_at = NULL
          WHERE id = @id`,
      ).run({
        id: existing.id,
        granted_by_account_id: grantedByAccountId,
        created_at: now,
      });
      return rowToGrant(this.requireGrantRow({ definitionId: definition.id, skillId, permission }));
    }
    db.prepare(
      `INSERT INTO credential_grants (
         id, definition_id, skill_id, permission, granted_by_account_id, created_at, revoked_at
       ) VALUES (
         @id, @definition_id, @skill_id, @permission, @granted_by_account_id, @created_at, NULL
       )`,
    ).run({
      id: randomUUID(),
      definition_id: definition.id,
      skill_id: skillId,
      permission,
      granted_by_account_id: grantedByAccountId,
      created_at: now,
    });
    return rowToGrant(this.requireGrantRow({ definitionId: definition.id, skillId, permission }));
  }

  async revokeCredentialGrant(input: RevokeCredentialGrantInput): Promise<void> {
    const definition = this.requireDefinitionRowByKey(input.definitionKey);
    const skillId = trimRequired(input.skillId, "skillId");
    const permission = trimRequired(input.permission, "permission");
    const now = new Date().toISOString();
    getPlatformClawDatabase(this.env)
      .db.prepare(
        `UPDATE credential_grants
            SET revoked_at = ?
          WHERE definition_id = ?
            AND skill_id = ?
            AND permission = ?
            AND revoked_at IS NULL`,
      )
      .run(now, definition.id, skillId, permission);
  }

  async hasCredentialGrant(input: CredentialGrantCheckInput): Promise<boolean> {
    const definition = this.requireDefinitionRowByKey(input.definitionKey);
    const skillId = trimRequired(input.skillId, "skillId");
    const permission = trimRequired(input.permission, "permission");
    return (
      this.getGrantRow({
        definitionId: definition.id,
        skillId,
        permission,
      }) !== null
    );
  }

  private normalizeScope(scope: CredentialScope): CredentialScope {
    return {
      ownerType: normalizeOwnerType(scope.ownerType),
      ownerId: trimRequired(scope.ownerId, "ownerId"),
    };
  }

  private getDefinitionRowByKey(keyInput: string): CredentialDefinitionRow | null {
    const key = trimRequired(keyInput, "key");
    const { db } = getPlatformClawDatabase(this.env);
    const row = db
      .prepare(
        `SELECT id, credential_key, label, type, description, description_en, owner_policy, rotation_days,
                usage_hint, required, created_at, updated_at, archived_at
           FROM credential_definitions
          WHERE credential_key = ?
            AND archived_at IS NULL
          LIMIT 1`,
      )
      .get(key) as CredentialDefinitionRow | undefined;
    return row ?? null;
  }

  private requireDefinitionRowByKey(key: string): CredentialDefinitionRow {
    const row = this.getDefinitionRowByKey(key);
    if (!row) {
      throw new Error(`Credential definition "${key}" was not found.`);
    }
    return row;
  }

  private getCredentialRow(params: {
    definitionId: string;
    scope: CredentialScope;
    includeRevoked?: boolean;
  }): CredentialRow | null {
    const revokedClause = params.includeRevoked ? "" : "AND c.revoked_at IS NULL";
    const { db } = getPlatformClawDatabase(this.env);
    const row = db
      .prepare(
        `SELECT c.id, c.definition_id, d.credential_key AS definition_key, d.type,
                c.owner_type, c.owner_id, c.encrypted_value, c.encryption_version,
                c.created_at, c.updated_at, c.last_used_at, c.expires_at, c.revoked_at
           FROM credentials c
           JOIN credential_definitions d ON d.id = c.definition_id
          WHERE c.definition_id = ?
            AND c.owner_type = ?
            AND c.owner_id = ?
            ${revokedClause}
            AND d.archived_at IS NULL
          LIMIT 1`,
      )
      .get(params.definitionId, params.scope.ownerType, params.scope.ownerId) as
      | CredentialRow
      | undefined;
    return row ?? null;
  }

  private requireCredentialRow(params: {
    definitionId: string;
    scope: CredentialScope;
  }): CredentialRow {
    const row = this.getCredentialRow(params);
    if (!row) {
      throw new Error("Credential was not found for the current scope.");
    }
    return row;
  }

  private getGrantRow(params: {
    definitionId: string;
    skillId: string;
    permission: string;
    includeRevoked?: boolean;
  }): CredentialGrantRow | null {
    const revokedClause = params.includeRevoked ? "" : "AND g.revoked_at IS NULL";
    const { db } = getPlatformClawDatabase(this.env);
    const row = db
      .prepare(
        `SELECT g.id, g.definition_id, d.credential_key AS definition_key,
                g.skill_id, g.permission, g.granted_by_account_id, g.created_at, g.revoked_at
           FROM credential_grants g
           JOIN credential_definitions d ON d.id = g.definition_id
          WHERE g.definition_id = ?
            AND g.skill_id = ?
            AND g.permission = ?
            ${revokedClause}
            AND d.archived_at IS NULL
          LIMIT 1`,
      )
      .get(params.definitionId, params.skillId, params.permission) as
      | CredentialGrantRow
      | undefined;
    return row ?? null;
  }

  private requireGrantRow(params: {
    definitionId: string;
    skillId: string;
    permission: string;
  }): CredentialGrantRow {
    const row = this.getGrantRow(params);
    if (!row) {
      throw new Error("Credential grant was not found.");
    }
    return row;
  }
}
