import { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signEmployeeSessionToken } from "./employee-auth.js";
import {
  buildCoWorkerFieldValue,
  buildVocJiraPayload,
  handleEmployeeVocHttpRequest,
} from "./employee-voc.js";
import { makeMockHttpResponse } from "./test-http-response.js";

function setVocEnv(overrides?: Partial<NodeJS.ProcessEnv>) {
  process.env.OPENCLAW_JIRA_URL = "https://jira.samsungds.net";
  process.env.OPENCLAW_JIRA_PROJECT_KEY = "SOCPE";
  process.env.OPENCLAW_JIRA_PARENT_ISSUE_KEY = "SOCPE-75195";
  process.env.OPENCLAW_JIRA_ISSUE_TYPE = "Sub-task";
  process.env.OPENCLAW_JIRA_ASSIGNEE = "seungon.jung";
  process.env.OPENCLAW_JIRA_DEFAULT_COMPONENTS = "CLAW";
  process.env.OPENCLAW_JIRA_COWORKER_FIELD = "customfield_10733";
  process.env.OPENCLAW_JIRA_DEFAULT_COWORKERS = "hyeonho.jung";
  Object.assign(process.env, overrides);
}

describe("handleEmployeeVocHttpRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET;
    delete process.env.OPENCLAW_JIRA_AUTH_HEADER;
    delete process.env.OPENCLAW_JIRA_COOKIE;
    delete process.env.OPENCLAW_JIRA_VOC_ID;
    delete process.env.OPENCLAW_JIRA_VOC_TOKEN;
    delete process.env.OPENCLAW_JIRA_EMAIL;
    delete process.env.OPENCLAW_JIRA_API_TOKEN;
    delete process.env.JIRA_USERNAME;
    delete process.env.JIRA_API_TOKEN;
    delete process.env.JIRA_URL;
    delete process.env.JIRA_PROJECT_KEY;
    delete process.env.JIRA_PARENT_ISSUE_KEY;
    delete process.env.JIRA_ISSUE_TYPE;
    delete process.env.JIRA_ASSIGNEE;
    delete process.env.JIRA_DEFAULT_COMPONENTS;
    delete process.env.JIRA_COWORKER_FIELD;
    delete process.env.JIRA_DEFAULT_COWORKERS;
    delete process.env.OPENCLAW_JIRA_URL;
    delete process.env.OPENCLAW_JIRA_PROJECT_KEY;
    delete process.env.OPENCLAW_JIRA_PARENT_ISSUE_KEY;
    delete process.env.OPENCLAW_JIRA_ISSUE_TYPE;
    delete process.env.OPENCLAW_JIRA_ASSIGNEE;
    delete process.env.OPENCLAW_JIRA_DEFAULT_COMPONENTS;
    delete process.env.OPENCLAW_JIRA_COWORKER_FIELD;
    delete process.env.OPENCLAW_JIRA_DEFAULT_COWORKERS;
  });

  it("rejects unauthenticated requests", async () => {
    const { res, end } = makeMockHttpResponse();

    const handled = await handleEmployeeVocHttpRequest({
      req: {
        url: "/employee/voc",
        method: "POST",
        headers: {},
      } as IncomingMessage,
      res,
      readJsonBody: async () => ({ ok: true as const, value: { title: "hello", body: "world" } }),
    });

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      ok: false,
      error: "Employee sign-in required.",
    });
  });

  it("rejects invalid payloads safely", async () => {
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-test-secret";
    const token = signEmployeeSessionToken(
      {
        employeeId: "eon",
        agentId: "eon",
      },
      process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET,
    );
    const { res, end } = makeMockHttpResponse();

    await handleEmployeeVocHttpRequest({
      req: {
        url: "/employee/voc",
        method: "POST",
        headers: { cookie: `openclaw_employee_session=${encodeURIComponent(token)}` },
      } as IncomingMessage,
      res,
      readJsonBody: async () => ({ ok: true as const, value: { title: "", body: "" } }),
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      ok: false,
      error: "VOC 등록에 실패했습니다.",
    });
  });

  it("allows enough JSON body bytes for the advertised Korean character limit", async () => {
    const { res } = makeMockHttpResponse();
    const readJsonBody = vi.fn(async () => ({
      ok: true as const,
      value: { title: "", body: "" },
    }));

    await handleEmployeeVocHttpRequest({
      req: {
        url: "/employee/voc",
        method: "POST",
        headers: {},
      } as IncomingMessage,
      res,
      readJsonBody,
    });

    expect(readJsonBody).not.toHaveBeenCalled();

    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-test-secret";
    const token = signEmployeeSessionToken(
      {
        employeeId: "eon",
        agentId: "eon",
      },
      process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET,
    );

    await handleEmployeeVocHttpRequest({
      req: {
        url: "/employee/voc",
        method: "POST",
        headers: { cookie: `openclaw_employee_session=${encodeURIComponent(token)}` },
      } as IncomingMessage,
      res,
      readJsonBody,
    });

    expect(readJsonBody).toHaveBeenCalledWith(expect.anything(), 64 * 1024);
  });

  it("creates a Jira sub-task and returns the issue URL", async () => {
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-test-secret";
    process.env.OPENCLAW_JIRA_VOC_ID = "jira-user";
    process.env.OPENCLAW_JIRA_VOC_TOKEN = "jira-token";
    setVocEnv();
    const token = signEmployeeSessionToken(
      {
        employeeId: "seungon.jung",
        name: "Seungon Jung",
        agentId: "eon",
      },
      process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET,
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "SOCPE-12345" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, end } = makeMockHttpResponse();

    await handleEmployeeVocHttpRequest({
      req: {
        url: "/employee/voc",
        method: "POST",
        headers: { cookie: `openclaw_employee_session=${encodeURIComponent(token)}` },
      } as IncomingMessage,
      res,
      readJsonBody: async () => ({
        ok: true as const,
        value: { title: "  Need better workspace chat  ", body: "  Please improve the flow.  " },
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.fields.project.key).toBe("SOCPE");
    expect(payload.fields.parent.key).toBe("SOCPE-75195");
    expect(payload.fields.issuetype.name).toBe("Sub-task");
    expect(payload.fields.components[0].name).toBe("CLAW");
    expect(payload.fields.assignee.name).toBe("seungon.jung");
    expect(payload.fields.customfield_10733).toEqual([
      { name: "hyeonho.jung" },
      { name: "seungon.jung" },
    ]);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      ok: true,
      issueKey: "SOCPE-12345",
      issueUrl: "https://jira.samsungds.net/browse/SOCPE-12345",
    });
  });

  it("accepts jira-omni legacy env names without remapping", async () => {
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-test-secret";
    process.env.JIRA_USERNAME = "jira-legacy-user";
    process.env.JIRA_API_TOKEN = "jira-legacy-token";
    process.env.JIRA_URL = "https://jira.company.example";
    process.env.JIRA_PROJECT_KEY = "VOC";
    process.env.JIRA_PARENT_ISSUE_KEY = "VOC-123";
    process.env.JIRA_ISSUE_TYPE = "Task";
    process.env.JIRA_ASSIGNEE = "jira-owner";
    process.env.JIRA_DEFAULT_COMPONENTS = "DMC,CLAW";
    process.env.JIRA_COWORKER_FIELD = "customfield_99999";
    process.env.JIRA_DEFAULT_COWORKERS = "hyeonho.jung,ops.owner";
    const token = signEmployeeSessionToken(
      {
        employeeId: "seungon.jung",
        name: "Seungon Jung",
        agentId: "eon",
      },
      process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET,
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "SOCPE-54321" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, end } = makeMockHttpResponse();

    await handleEmployeeVocHttpRequest({
      req: {
        url: "/employee/voc",
        method: "POST",
        headers: { cookie: `openclaw_employee_session=${encodeURIComponent(token)}` },
      } as IncomingMessage,
      res,
      readJsonBody: async () => ({
        ok: true as const,
        value: { title: "Legacy env flow", body: "Please improve the flow." },
      }),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://jira.company.example/rest/api/2/issue");
    expect((init.headers as Headers).get("Authorization")).toBe("Bearer jira-legacy-token");
    const payload = JSON.parse(String(init.body));
    expect(payload.fields.project.key).toBe("VOC");
    expect(payload.fields.parent.key).toBe("VOC-123");
    expect(payload.fields.issuetype.name).toBe("Task");
    expect(payload.fields.assignee.name).toBe("jira-owner");
    expect(payload.fields.components).toEqual([{ name: "DMC" }, { name: "CLAW" }]);
    expect(payload.fields.customfield_99999).toEqual([
      { name: "hyeonho.jung" },
      { name: "ops.owner" },
      { name: "jira-owner" },
      { name: "seungon.jung" },
    ]);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      ok: true,
      issueKey: "SOCPE-54321",
      issueUrl: "https://jira.company.example/browse/SOCPE-54321",
    });
  });

  it("prefers explicit OpenClaw credentials for basic auth", async () => {
    process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET = "employee-test-secret";
    process.env.OPENCLAW_JIRA_VOC_ID = "jira-user";
    process.env.OPENCLAW_JIRA_VOC_TOKEN = "jira-token";
    process.env.JIRA_API_TOKEN = "legacy-token";
    setVocEnv();
    const token = signEmployeeSessionToken(
      {
        employeeId: "seungon.jung",
        name: "Seungon Jung",
        agentId: "eon",
      },
      process.env.OPENCLAW_EMPLOYEE_AUTH_SECRET,
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ key: "SOCPE-77777" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res } = makeMockHttpResponse();

    await handleEmployeeVocHttpRequest({
      req: {
        url: "/employee/voc",
        method: "POST",
        headers: { cookie: `openclaw_employee_session=${encodeURIComponent(token)}` },
      } as IncomingMessage,
      res,
      readJsonBody: async () => ({
        ok: true as const,
        value: { title: "Basic auth wins", body: "Please improve the flow." },
      }),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get("Authorization")).toBe(
      `Basic ${Buffer.from("jira-user:jira-token").toString("base64")}`,
    );
  });
});

describe("VOC Jira helpers", () => {
  it("dedupes coworker values", () => {
    expect(buildCoWorkerFieldValue(["hyeonho.jung", "hyeonho.jung", "eon"])).toEqual([
      { name: "hyeonho.jung" },
      { name: "eon" },
    ]);
  });

  it("builds the expected VOC Jira payload", () => {
    setVocEnv();
    const payload = buildVocJiraPayload({
      title: "Need a better summary",
      body: "Please improve summaries.",
      reporterEmployeeId: "eon",
      reporterName: "Eon",
    });

    expect(payload.fields.project).toEqual({ key: "SOCPE" });
    expect(payload.fields.parent).toEqual({ key: "SOCPE-75195" });
    expect(payload.fields.issuetype).toEqual({ name: "Sub-task" });
    expect(payload.fields.components).toEqual([{ name: "CLAW" }]);
    expect(payload.fields.assignee).toEqual({ name: "seungon.jung" });
    expect(payload.fields.customfield_10733).toEqual([
      { name: "hyeonho.jung" },
      { name: "seungon.jung" },
      { name: "eon" },
    ]);
    expect(payload.fields.description).toContain("Reporter Employee ID: eon");
  });
});
