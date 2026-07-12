import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startRuntimeCredentialHttpServer,
  stopRuntimeCredentialHttpServerForTest,
} from "./runtime-credential-http.js";
import type { CredentialService, ResolvedCredential } from "./types.js";

vi.mock("./sqlite-credential-service.js", () => ({
  SQLiteCredentialService: class {
    async getCredential(): Promise<ResolvedCredential> {
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
        value: "jira-secret-token-1234567890",
      };
    }
  } satisfies new () => Pick<CredentialService, "getCredential">,
}));

afterEach(async () => {
  await stopRuntimeCredentialHttpServerForTest();
});

describe("runtime credential HTTP server", () => {
  it("creates a separate Docker sandbox endpoint without changing the host endpoint", async () => {
    const hostServer = await startRuntimeCredentialHttpServer();
    const sandboxServer = await startRuntimeCredentialHttpServer({
      listenHost: "127.0.0.1",
      endpointHost: "host.docker.internal",
    });

    expect(hostServer.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
    expect(sandboxServer.endpoint).toBe(hostServer.endpoint);

    const externalSandboxServer = await startRuntimeCredentialHttpServer({
      listenHost: "0.0.0.0",
      endpointHost: "host.docker.internal",
    });
    expect(externalSandboxServer.endpoint).toMatch(/^http:\/\/host\.docker\.internal:\d+$/u);
    expect(externalSandboxServer.listenHost).toBe("0.0.0.0");
    expect(externalSandboxServer.endpoint).not.toBe(hostServer.endpoint);
  });

  it("returns credentials only with a registered runtime token", async () => {
    const server = await startRuntimeCredentialHttpServer();
    const token = server.registerSession({
      runId: "run-1",
      skillId: "jira",
      effectiveOwnerType: "account",
      effectiveOwnerId: "account-1",
    });

    const res = await fetch(`${server.endpoint}/credentials/get`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ definitionKey: "jira.default" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      value: "jira-secret-token-1234567890",
    });
  });

  it("rejects SDK requests that try to choose an owner", async () => {
    const server = await startRuntimeCredentialHttpServer();
    const token = server.registerSession({
      runId: "run-1",
      skillId: "jira",
      effectiveOwnerType: "account",
      effectiveOwnerId: "account-1",
    });

    const res = await fetch(`${server.endpoint}/credentials/get`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ definitionKey: "jira.default", accountId: "other" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("not allowed"),
    });
  });
});
