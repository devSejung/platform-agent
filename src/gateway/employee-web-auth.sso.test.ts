import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetPlatformClawDatabaseForTests } from "../accounts/db.js";
import { signEmployeeSsoHandoffToken, verifyEmployeeSessionToken } from "./employee-auth.js";
import { handleEmployeeAdSsoRequest } from "./employee-web-auth.js";
import { makeMockHttpResponse } from "./test-http-response.js";

describe("employee SSO web auth", () => {
  const sessionSecret = "employee-session-secret";
  const ssoSecret = "employee-sso-secret";
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-sso-test-"));
    process.env.OPENCLAW_STATE_DIR = path.join(tempDir, "state");
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = sessionSecret;
    process.env.OPENCLAW_EMPLOYEE_AUTH_ADSSO_SECRET = ssoSecret;
    process.env.OPENCLAW_EMPLOYEE_ACTIVATION_PATH = path.join(tempDir, "activation.json");
    resetPlatformClawDatabaseForTests();
  });

  afterEach(async () => {
    resetPlatformClawDatabaseForTests();
    delete process.env.OPENCLAW_STATE_DIR;
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET;
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_ADSSO_SECRET;
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_ADSSO_URL;
    delete process.env.OPENCLAW_EMPLOYEE_ACTIVATION_PATH;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  function createResponse() {
    const response = makeMockHttpResponse();
    (response.res as ServerResponse).getHeader = () => undefined;
    return response;
  }

  function createHandoffToken() {
    const nowSec = Math.floor(Date.now() / 1000);
    return signEmployeeSsoHandoffToken(
      {
        employeeId: "eon",
        email: "eon@samsung.com",
        name: "Eon",
        department: "AI Platform",
        agentId: "eon",
        sessionKey: "agent:eon:main",
        iat: nowSec,
        exp: nowSec + 60,
      },
      ssoSecret,
    );
  }

  async function handle(url: string, accept = "text/html") {
    const response = createResponse();
    const handled = await handleEmployeeAdSsoRequest({
      req: {
        url,
        method: "GET",
        headers: { accept, "x-forwarded-proto": "https" },
        socket: {},
      } as unknown as IncomingMessage,
      res: response.res,
      config: { agents: { defaults: { workspace: path.join(tempDir, "workspaces") } } },
      readJsonBody: async () => ({ ok: true as const, value: {} }),
      context: { gatewayUrl: "wss://platform-claw.example.test" },
    });
    return { ...response, handled };
  }

  it("exchanges a signed handoff for a PlatformClaw session and redirects", async () => {
    const token = createHandoffToken();
    const { res, setHeader, handled } = await handle(
      `/employee/auth/sso-callback?token=${encodeURIComponent(token)}`,
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(302);
    expect(setHeader).toHaveBeenCalledWith("Location", "/employee");
    const cookie = String(setHeader.mock.calls.find((call) => call[0] === "Set-Cookie")?.[1] ?? "");
    expect(cookie).toContain("openclaw_employee_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    const sessionToken = decodeURIComponent(
      cookie.match(/openclaw_employee_session=([^;]+)/)?.[1] ?? "",
    );
    expect(verifyEmployeeSessionToken(sessionToken, sessionSecret)).toEqual(
      expect.objectContaining({ employeeId: "eon", agentId: "eon", kind: "session" }),
    );
  });

  it("returns JSON when the callback explicitly requests JSON", async () => {
    const token = createHandoffToken();
    const { res, end } = await handle(
      `/employee/auth/sso-callback?token=${encodeURIComponent(token)}`,
      "application/json",
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(end.mock.calls[0]?.[0]))).toEqual({ authenticated: true });
  });

  it("rejects unsigned identity query parameters", async () => {
    const { res, end } = await handle(
      "/employee/auth/sso-callback?employeeId=admin&agentId=admin",
      "application/json",
    );

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(String(end.mock.calls[0]?.[0]))).toEqual({
      authenticated: false,
      message: "invalid or expired SSO callback",
    });
  });

  it("rejects handoffs whose validity exceeds one minute", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signEmployeeSsoHandoffToken(
      {
        employeeId: "eon",
        agentId: "eon",
        iat: nowSec,
        exp: nowSec + 61,
      },
      ssoSecret,
    );
    const { res } = await handle(
      `/employee/auth/sso-callback?token=${encodeURIComponent(token)}`,
      "application/json",
    );

    expect(res.statusCode).toBe(401);
  });

  it("redirects the SSO start route to the configured login endpoint", async () => {
    process.env.OPENCLAW_EMPLOYEE_AUTH_ADSSO_URL =
      "https://platform-claw--ldap-login-prod.example.test/adsso";
    const { res, setHeader } = await handle("/employee/auth/adsso");

    expect(res.statusCode).toBe(302);
    expect(setHeader).toHaveBeenCalledWith(
      "Location",
      "https://platform-claw--ldap-login-prod.example.test/adsso/login",
    );
  });
});
