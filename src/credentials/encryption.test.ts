import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CredentialMasterKeyError,
  decryptCredentialValue,
  encryptCredentialValue,
} from "./encryption.js";

function testEnv(key = randomBytes(32).toString("base64")): NodeJS.ProcessEnv {
  return {
    PLATFORMCLAW_MASTER_KEY: key,
  };
}

describe("credential encryption", () => {
  it("encrypts and decrypts values without storing plaintext", () => {
    const env = testEnv();
    const value = "jira-token-123";
    const encrypted = encryptCredentialValue({
      value,
      env,
      randomBytesFn: () => Buffer.alloc(12, 7),
    });

    expect(encrypted.encryptedValue).not.toContain(value);
    expect(decryptCredentialValue({ encryptedValue: encrypted.encryptedValue, env })).toBe(value);
  });

  it("round-trips with the same master key", () => {
    const env = testEnv();
    const encrypted = encryptCredentialValue({
      value: "mail-app-password",
      env,
    });

    expect(decryptCredentialValue({ encryptedValue: encrypted.encryptedValue, env })).toBe(
      "mail-app-password",
    );
  });

  it("requires a 32 byte master key", () => {
    expect(() => encryptCredentialValue({ value: "x", env: {} })).toThrow(CredentialMasterKeyError);
    expect(() =>
      encryptCredentialValue({
        value: "x",
        env: { PLATFORMCLAW_MASTER_KEY: Buffer.alloc(8).toString("base64") },
      }),
    ).toThrow(CredentialMasterKeyError);
  });
});
