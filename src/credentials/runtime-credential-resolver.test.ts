import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeSecretRedactionRegistryForTest,
  redactRegisteredRuntimeSecrets,
} from "./redaction-registry.js";
import { resolveRuntimeCredential } from "./runtime-credential-resolver.js";
import type { CredentialService, ResolvedCredential } from "./types.js";

function resolvedCredential(value: string): ResolvedCredential {
  return {
    id: "cred-1",
    definitionId: "def-1",
    definitionKey: "jira.default",
    type: "api_token",
    ownerType: "account",
    ownerId: "account-1",
    encryptionVersion: 1,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    value,
  };
}

describe("resolveRuntimeCredential", () => {
  afterEach(() => {
    clearRuntimeSecretRedactionRegistryForTest();
  });

  it("uses only runtime effective owner scope for lookup", async () => {
    const service = {
      getCredential: vi.fn(async () => resolvedCredential("jira-secret-token-1234567890")),
    } as unknown as CredentialService;

    const result = await resolveRuntimeCredential(
      { definitionKey: "jira.default" },
      {
        runId: "run-1",
        skillId: "jira",
        effectiveOwnerType: "account",
        effectiveOwnerId: "account-1",
        actorAccountId: "actor-1",
      },
      { service },
    );

    expect(service.getCredential).toHaveBeenCalledWith({
      definitionKey: "jira.default",
      scope: { ownerType: "account", ownerId: "account-1" },
    });
    expect(result.value).toBe("jira-secret-token-1234567890");
    expect(result.credential).not.toHaveProperty("ownerId");
    expect(redactRegisteredRuntimeSecrets(result.value)).toBe("jira-s…7890");
  });

  it("enforces runtime-supplied required permissions when provided", async () => {
    const service = {
      hasCredentialGrant: vi.fn(async () => false),
      getCredential: vi.fn(async () => resolvedCredential("jira-secret-token-1234567890")),
    } as unknown as CredentialService;

    await expect(
      resolveRuntimeCredential(
        { definitionKey: "jira.default", requiredPermission: "jira.write" },
        {
          runId: "run-1",
          skillId: "jira",
          effectiveOwnerType: "account",
          effectiveOwnerId: "account-1",
        },
        { service },
      ),
    ).rejects.toThrow("Credential grant is required");

    expect(service.hasCredentialGrant).toHaveBeenCalledWith({
      definitionKey: "jira.default",
      skillId: "jira",
      permission: "jira.write",
    });
    expect(service.getCredential).not.toHaveBeenCalled();
  });

  it("resolves after the runtime-supplied permission grant passes", async () => {
    const service = {
      hasCredentialGrant: vi.fn(async () => true),
      getCredential: vi.fn(async () => resolvedCredential("jira-secret-token-1234567890")),
    } as unknown as CredentialService;

    await expect(
      resolveRuntimeCredential(
        { definitionKey: "jira.default", requiredPermission: "jira.write" },
        {
          runId: "run-1",
          skillId: "jira",
          effectiveOwnerType: "account",
          effectiveOwnerId: "account-1",
        },
        { service },
      ),
    ).resolves.toMatchObject({ value: "jira-secret-token-1234567890" });
  });

  it("rejects missing runtime owner context", async () => {
    await expect(
      resolveRuntimeCredential(
        { definitionKey: "jira.default" },
        {
          runId: "run-1",
          skillId: "jira",
          effectiveOwnerType: "account",
          effectiveOwnerId: "",
        },
        { service: {} as CredentialService },
      ),
    ).rejects.toThrow(/effectiveOwnerId is required/);
  });
});
