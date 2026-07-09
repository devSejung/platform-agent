import { afterEach, describe, expect, it } from "vitest";
import {
  clearRuntimeSecretRedactionRegistryForTest,
  redactRegisteredRuntimeSecrets,
  registerRuntimeSecretForRedaction,
} from "./redaction-registry.js";

afterEach(() => {
  clearRuntimeSecretRedactionRegistryForTest();
});

describe("runtime credential redaction registry", () => {
  it("redacts exact runtime secrets from arbitrary text", () => {
    registerRuntimeSecretForRedaction("jira-secret-token-1234567890");

    expect(redactRegisteredRuntimeSecrets("token=jira-secret-token-1234567890")).toBe(
      "token=jira-s…7890",
    );
  });

  it("drops expired runtime secrets", () => {
    registerRuntimeSecretForRedaction("short-secret", { ttlMs: -1 });

    expect(redactRegisteredRuntimeSecrets("short-secret")).toBe("short-secret");
  });
});
