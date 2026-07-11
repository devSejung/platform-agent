import { registerRuntimeSecretForRedaction } from "./redaction-registry.js";
import { SQLiteCredentialService } from "./sqlite-credential-service.js";
import type { CredentialOwnerType, CredentialService, ResolvedCredential } from "./types.js";

export type CredentialRuntimeContext = {
  runId: string;
  skillId: string;
  effectiveOwnerType: CredentialOwnerType;
  effectiveOwnerId: string;
  actorAccountId?: string | null;
  sessionId?: string | null;
  roomId?: string | null;
  channel?: string | null;
};

export type RuntimeCredentialRequest = {
  definitionKey: string;
  requiredPermission?: string | null;
};

export type RuntimeCredentialResolution = {
  definitionKey: string;
  value: string;
  credential: Omit<ResolvedCredential, "value" | "ownerId">;
};

function normalizeRequired(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function assertRuntimeContext(context: CredentialRuntimeContext): void {
  normalizeRequired(context.runId, "runId");
  normalizeRequired(context.skillId, "skillId");
  normalizeRequired(context.effectiveOwnerId, "effectiveOwnerId");
  if (
    context.effectiveOwnerType !== "account" &&
    context.effectiveOwnerType !== "room" &&
    context.effectiveOwnerType !== "system"
  ) {
    throw new Error(`Unsupported effectiveOwnerType: ${String(context.effectiveOwnerType)}`);
  }
}

async function recordRuntimeCredentialAudit(params: {
  service: CredentialService;
  definitionKey: string;
  context: CredentialRuntimeContext;
  action: "runtime_get_success" | "runtime_get_failure";
  credentialId?: string | null;
  requiredPermission?: string | null;
  error?: unknown;
}): Promise<void> {
  try {
    await params.service.auditCredential({
      credentialId: params.credentialId,
      definitionKey: params.definitionKey,
      scope: {
        ownerType: params.context.effectiveOwnerType,
        ownerId: params.context.effectiveOwnerId,
      },
      actorAccountId: params.context.actorAccountId ?? params.context.effectiveOwnerId,
      skillId: params.context.skillId,
      action: params.action,
      metadata: {
        runId: params.context.runId,
        sessionId: params.context.sessionId ?? null,
        roomId: params.context.roomId ?? null,
        channel: params.context.channel ?? null,
        requiredPermission: params.requiredPermission ?? null,
        error: params.error instanceof Error ? params.error.message : null,
      },
    });
  } catch {
    // Audit is best-effort. Credential resolution success/failure must keep its
    // original behavior even if the audit table is unavailable.
  }
}

export async function resolveRuntimeCredential(
  input: RuntimeCredentialRequest,
  context: CredentialRuntimeContext,
  opts: { service?: CredentialService } = {},
): Promise<RuntimeCredentialResolution> {
  assertRuntimeContext(context);
  const definitionKey = normalizeRequired(input.definitionKey, "definitionKey");
  const requiredPermission = input.requiredPermission?.trim() || null;
  const service = opts.service ?? new SQLiteCredentialService();
  try {
    if (requiredPermission) {
      const allowed = await service.hasCredentialGrant({
        definitionKey,
        skillId: context.skillId,
        permission: requiredPermission,
      });
      if (!allowed) {
        throw new Error(
          `Credential grant is required for "${context.skillId}" to use "${definitionKey}" with "${requiredPermission}".`,
        );
      }
    }
    const resolved = await service.getCredential({
      definitionKey,
      scope: {
        ownerType: context.effectiveOwnerType,
        ownerId: context.effectiveOwnerId,
      },
    });
    await recordRuntimeCredentialAudit({
      service,
      definitionKey,
      context,
      action: "runtime_get_success",
      credentialId: resolved.id,
      requiredPermission,
    });
    registerRuntimeSecretForRedaction(resolved.value);
    const { value, ownerId: _ownerId, ...metadata } = resolved;
    return {
      definitionKey,
      value,
      credential: metadata,
    };
  } catch (err) {
    await recordRuntimeCredentialAudit({
      service,
      definitionKey,
      context,
      action: "runtime_get_failure",
      requiredPermission,
      error: err,
    });
    throw err;
  }
}
