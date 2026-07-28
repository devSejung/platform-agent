import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EMPLOYEE_SSO_AUDIENCE,
  EMPLOYEE_SSO_AUTH_METHOD,
  EMPLOYEE_SSO_CONTRACT_VERSION,
  EMPLOYEE_SSO_ISSUER,
  inspectEmployeeBootstrapToken,
  signEmployeeBootstrapToken,
  signEmployeeSessionToken,
  signEmployeeSsoHandoffToken,
  verifyEmployeeBootstrapToken,
  verifyEmployeeSessionToken,
  verifyEmployeeSsoHandoffToken,
} from "./employee-auth.js";

describe("employee auth token separation", () => {
  const secret = "employee-test-secret";

  function signRawPayload(payload: Record<string, unknown>): string {
    const payloadJson = JSON.stringify(payload);
    const payloadPart = Buffer.from(payloadJson).toString("base64url");
    const signaturePart = createHmac("sha256", secret).update(payloadJson).digest("base64url");
    return `${payloadPart}.${signaturePart}`;
  }

  it("accepts session tokens only for session verification", () => {
    const sessionToken = signEmployeeSessionToken(
      {
        employeeId: "eon",
        agentId: "eon",
        sessionKey: "agent:eon:main",
        iat: 1_700_000_000,
        exp: 1_900_000_000,
      },
      secret,
    );

    expect(verifyEmployeeSessionToken(sessionToken, secret)?.kind).toBe("session");
    expect(verifyEmployeeBootstrapToken(sessionToken, secret)).toBeNull();
  });

  it("accepts bootstrap tokens only for bootstrap verification", () => {
    const bootstrapToken = signEmployeeBootstrapToken(
      {
        employeeId: "eon",
        agentId: "eon",
        sessionKey: "agent:eon:main",
        iat: 1_700_000_000,
        exp: 1_900_000_000,
      },
      secret,
    );

    expect(verifyEmployeeBootstrapToken(bootstrapToken, secret)?.kind).toBe("bootstrap");
    expect(verifyEmployeeSessionToken(bootstrapToken, secret)).toBeNull();
  });

  it("reports expired bootstrap tokens via diagnostics", () => {
    const bootstrapToken = signEmployeeBootstrapToken(
      {
        employeeId: "eon",
        agentId: "eon",
        sessionKey: "agent:eon:main",
        iat: 1,
        exp: 2,
      },
      secret,
    );

    expect(inspectEmployeeBootstrapToken(bootstrapToken, secret)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("keeps SSO handoff tokens separate and preserves the employee email", () => {
    const handoffToken = signEmployeeSsoHandoffToken(
      {
        contractVersion: EMPLOYEE_SSO_CONTRACT_VERSION,
        issuer: EMPLOYEE_SSO_ISSUER,
        audience: EMPLOYEE_SSO_AUDIENCE,
        employeeId: "eon",
        email: "eon@samsung.com",
        part: "Platform",
        confluenceSpace: "PLATFORM",
        agentId: "eon",
        authMethod: EMPLOYEE_SSO_AUTH_METHOD,
        iat: 1_700_000_000,
        exp: 1_900_000_000,
      },
      secret,
    );

    expect(verifyEmployeeSsoHandoffToken(handoffToken, secret)).toEqual(
      expect.objectContaining({
        kind: "sso",
        employeeId: "eon",
        email: "eon@samsung.com",
        part: "Platform",
        confluenceSpace: "PLATFORM",
        contractVersion: 1,
        issuer: "platformclaw-auth",
        audience: "platformclaw",
        authMethod: "saml",
      }),
    );
    expect(verifyEmployeeSessionToken(handoffToken, secret)).toBeNull();
  });

  it("accepts the finalized auth-server wire contract", () => {
    const token = signRawPayload({
      contractVersion: 1,
      kind: "sso",
      issuer: "platformclaw-auth",
      audience: "platformclaw",
      employeeId: "hyeonho.jung",
      name: "정현호",
      email: "hyeonho.jung@stage.samsung.com",
      department: "PE팀(S.LSI)",
      part: "",
      confluenceSpace: "",
      agentId: "hyeonho_jung",
      sessionKey: "agent:hyeonho_jung:main",
      authMethod: "saml",
      iat: 1_700_000_000,
      exp: 1_900_000_000,
    });

    expect(verifyEmployeeSsoHandoffToken(token, secret)).toEqual(
      expect.objectContaining({
        contractVersion: 1,
        kind: "sso",
        issuer: "platformclaw-auth",
        audience: "platformclaw",
        employeeId: "hyeonho.jung",
        name: "정현호",
        authMethod: "saml",
      }),
    );
  });

  it.each([
    ["contractVersion", 2],
    ["issuer", "other-auth"],
    ["audience", "other-app"],
    ["authMethod", "ldap"],
  ])("rejects an SSO handoff with invalid %s", (field, value) => {
    const token = signRawPayload({
      contractVersion: 1,
      kind: "sso",
      issuer: "platformclaw-auth",
      audience: "platformclaw",
      employeeId: "eon",
      agentId: "eon",
      sessionKey: "agent:eon:main",
      authMethod: "saml",
      iat: 1_700_000_000,
      exp: 1_900_000_000,
      [field]: value,
    });

    expect(verifyEmployeeSsoHandoffToken(token, secret)).toBeNull();
  });
});
