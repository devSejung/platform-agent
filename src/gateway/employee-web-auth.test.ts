import type { IncomingMessage } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeMockHttpResponse } from "./test-http-response.js";
import { handleEmployeeLoginRequest } from "./employee-web-auth.js";

describe("handleEmployeeLoginRequest", () => {
  const fetchMock = vi.fn();
  let tempDir: string;

  afterEach(async () => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_LOGIN_URL;
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET;
    delete process.env.OPENCLAW_EMPLOYEE_ACTIVATION_PATH;
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  it("rate limits employee sign-in attempts before calling external auth", async () => {
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENCLAW_EMPLOYEE_AUTH_LOGIN_URL = "http://auth.local/login";

    const { res, end, setHeader } = makeMockHttpResponse();
    const handled = await handleEmployeeLoginRequest({
      req: {
        url: "/employee/auth/login",
        method: "POST",
      } as IncomingMessage,
      res,
      config: {},
      readJsonBody: async () => ({
        ok: true,
        value: { identifier: "eon@samsung.com", password: "456123" },
      }),
      context: {
        clientIp: "203.0.113.10",
      },
      rateLimiter: {
        check: () => ({ allowed: false, remaining: 0, retryAfterMs: 15_000 }),
        recordFailure: vi.fn(),
        reset: vi.fn(),
        size: () => 0,
        prune: vi.fn(),
        dispose: vi.fn(),
      },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "15");
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      authenticated: false,
      message: "Too many sign-in attempts. Please try again later.",
    });
  });

  it("stores a session cookie after successful external auth", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-auth-test-"));
    const workspaceRoot = path.join(tempDir, "workspaces");
    const activationPath = path.join(tempDir, "employee-activation.json");
    vi.stubGlobal("fetch", fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        employeeId: "eon",
        email: "eon@samsung.com",
        name: "Eon",
        department: "Samsung",
        agentId: "eon",
        sessionKey: "agent:eon:main",
      }),
    }));
    process.env.OPENCLAW_EMPLOYEE_AUTH_LOGIN_URL = "http://auth.local/login";
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-test-secret";
    process.env.OPENCLAW_EMPLOYEE_ACTIVATION_PATH = activationPath;

    const reset = vi.fn();
    const { res, end, setHeader } = makeMockHttpResponse();
    (res as unknown as { getHeader: (name: string) => unknown }).getHeader = vi.fn(() => undefined);
    const handled = await handleEmployeeLoginRequest({
      req: {
        url: "/employee/auth/login",
        method: "POST",
        headers: {},
        socket: {},
      } as IncomingMessage,
      res,
      config: {
        agents: {
          defaults: {
            workspace: workspaceRoot,
          },
        },
      },
      readJsonBody: async () => ({
        ok: true,
        value: { identifier: "eon@samsung.com", password: "456123" },
      }),
      context: {
        clientIp: "203.0.113.10",
        gatewayUrl: "ws://127.0.0.1:19001",
      },
      rateLimiter: {
        check: () => ({ allowed: true, remaining: 9, retryAfterMs: 0 }),
        recordFailure: vi.fn(),
        reset,
        size: () => 0,
        prune: vi.fn(),
        dispose: vi.fn(),
      },
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(reset).toHaveBeenCalledWith("203.0.113.10", "employee-web-auth");
    const setCookieCall = setHeader.mock.calls.find((call) => call[0] === "Set-Cookie");
    expect(setCookieCall?.[1]).toEqual(expect.stringContaining("openclaw_employee_session="));
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      authenticated: true,
      notice: {
        title: "Workspace ready",
        body:
          "전용 workspace를 생성했습니다. USER.md에 사용자 기본 정보를 반영했습니다. Knox 연동을 위한 employee activation을 등록했습니다.",
      },
    });

    const userProfile = await fs.readFile(path.join(workspaceRoot, "eon", "USER.md"), "utf8");
    expect(userProfile).toContain("<!-- OPENCLAW_AUTO_USER_START -->");
    expect(userProfile).toContain("- Employee ID: eon");
    expect(userProfile).toContain("- Jira ID: eon");
    expect(userProfile).toContain("- Name: Eon");
    expect(userProfile).toContain("- Department: Samsung");
    expect(userProfile).toContain("- Email: eon@samsung.com");

    const activation = JSON.parse(await fs.readFile(activationPath, "utf8")) as {
      employees?: Record<string, { agentId?: string; name?: string; department?: string; email?: string }>;
    };
    expect(activation.employees?.eon).toEqual(
      expect.objectContaining({
        agentId: "eon",
        name: "Eon",
        department: "Samsung",
        email: "eon@samsung.com",
      }),
    );
  });

  it("does not emit a provisioning notice after the first successful login", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "employee-auth-repeat-test-"));
    const workspaceRoot = path.join(tempDir, "workspaces");
    const activationPath = path.join(tempDir, "employee-activation.json");
    vi.stubGlobal("fetch", fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        authenticated: true,
        employeeId: "eon",
        email: " eon@samsung.com ",
        name: " Eon ",
        department: " Samsung ",
        agentId: " eon ",
        sessionKey: " agent:eon:main ",
      }),
    }));
    process.env.OPENCLAW_EMPLOYEE_AUTH_LOGIN_URL = "http://auth.local/login";
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-test-secret";
    process.env.OPENCLAW_EMPLOYEE_ACTIVATION_PATH = activationPath;

    const makeContext = () =>
      ({
        req: {
          url: "/employee/auth/login",
          method: "POST",
          headers: {},
          socket: {},
        } as IncomingMessage,
        config: {
          agents: {
            defaults: {
              workspace: workspaceRoot,
            },
          },
        },
        readJsonBody: async () => ({
          ok: true,
          value: { identifier: "eon@samsung.com", password: "456123" },
        }),
        context: {
          clientIp: "203.0.113.10",
          gatewayUrl: "ws://127.0.0.1:19001",
        },
        rateLimiter: {
          check: () => ({ allowed: true, remaining: 9, retryAfterMs: 0 }),
          recordFailure: vi.fn(),
          reset: vi.fn(),
          size: () => 0,
          prune: vi.fn(),
          dispose: vi.fn(),
        },
      }) as const;

    const firstRes = makeMockHttpResponse();
    (firstRes.res as unknown as { getHeader: (name: string) => unknown }).getHeader = vi.fn(() => undefined);
    await handleEmployeeLoginRequest({
      ...makeContext(),
      res: firstRes.res,
    });
    expect(JSON.parse(String(firstRes.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      authenticated: true,
      notice: {
        title: "Workspace ready",
        body:
          "전용 workspace를 생성했습니다. USER.md에 사용자 기본 정보를 반영했습니다. Knox 연동을 위한 employee activation을 등록했습니다.",
      },
    });

    const secondRes = makeMockHttpResponse();
    (secondRes.res as unknown as { getHeader: (name: string) => unknown }).getHeader = vi.fn(() => undefined);
    await handleEmployeeLoginRequest({
      ...makeContext(),
      res: secondRes.res,
    });
    expect(JSON.parse(String(secondRes.end.mock.calls[0]?.[0] ?? ""))).toEqual({
      authenticated: true,
    });

    const userProfile = await fs.readFile(path.join(workspaceRoot, "eon", "USER.md"), "utf8");
    expect(userProfile).toContain("- Name: Eon");
    expect(userProfile).toContain("- Jira ID: eon");
    expect(userProfile).toContain("- Department: Samsung");
    expect(userProfile).toContain("- Email: eon@samsung.com");
  });
});
