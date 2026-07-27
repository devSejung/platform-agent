import { describe, expect, it } from "vitest";
import {
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
        employeeId: "eon",
        email: "eon@samsung.com",
        agentId: "eon",
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
      }),
    );
    expect(verifyEmployeeSessionToken(handoffToken, secret)).toBeNull();
  });
});
