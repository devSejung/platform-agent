import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EMPLOYEE_VOC_PATH } from "./employee-voc-contract.js";
import { readEmployeeSession } from "./employee-web-auth.js";

const MAX_VOC_TITLE_CHARS = 200;
const MAX_VOC_BODY_CHARS = 8000;
const MAX_VOC_JSON_BYTES = 64 * 1024;

const VOC_JIRA_CONFIG = {
  jiraBaseUrl: "https://jira.samsungds.net",
  createIssuePath: "/rest/api/2/issue",
  browseIssuePath: "/browse",
  projectKey: "SOCPE",
  parentIssueKey: "SOCPE-75195",
  issueTypeName: "Sub-task",
  componentName: "CLAW",
  assigneeName: "seungon.jung",
  coWorkerFieldId: "customfield_10733",
  coWorkerDefaults: ["hyeonho.jung"],
} as const;

const JIRA_AUTH_HEADER_ENV = "OPENCLAW_JIRA_AUTH_HEADER";
const JIRA_COOKIE_ENV = "OPENCLAW_JIRA_COOKIE";
const JIRA_ID_ENV = "OPENCLAW_JIRA_VOC_ID";
const JIRA_TOKEN_ENV = "OPENCLAW_JIRA_VOC_TOKEN";
const JIRA_EMAIL_ENV = "OPENCLAW_JIRA_EMAIL";
const JIRA_API_TOKEN_ENV = "OPENCLAW_JIRA_API_TOKEN";

type JsonBodyReader = (
  req: IncomingMessage,
  maxBytes: number,
) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;

type JiraCreateIssueResponse = {
  key: string;
};

type JiraVocPayload = {
  fields: Record<string, unknown>;
};

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function normalizeVocText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function buildCoWorkerFieldValue(coWorkers: readonly string[]) {
  return dedupe(coWorkers).map((name) => ({ name }));
}

function buildVocDescription(params: {
  body: string;
  reporterName?: string;
  reporterKnoxId: string;
}) {
  const reporterLabel = params.reporterName?.trim() || params.reporterKnoxId;
  return [
    params.body,
    "",
    "---",
    "Submitted from PlatformClaw VOC",
    `Reporter: ${reporterLabel}`,
    `Reporter Knox ID: ${params.reporterKnoxId}`,
    "Created via: Employee Web UI",
    `Parent: ${VOC_JIRA_CONFIG.parentIssueKey}`,
    `Component: ${VOC_JIRA_CONFIG.componentName}`,
  ].join("\n");
}

export function buildVocJiraPayload(params: {
  title: string;
  body: string;
  reporterKnoxId: string;
  reporterName?: string;
}): JiraVocPayload {
  const coWorkers = dedupe([...VOC_JIRA_CONFIG.coWorkerDefaults, params.reporterKnoxId]);
  return {
    fields: {
      project: { key: VOC_JIRA_CONFIG.projectKey },
      parent: { key: VOC_JIRA_CONFIG.parentIssueKey },
      summary: params.title,
      description: buildVocDescription({
        body: params.body,
        reporterKnoxId: params.reporterKnoxId,
        reporterName: params.reporterName,
      }),
      issuetype: { name: VOC_JIRA_CONFIG.issueTypeName },
      components: [{ name: VOC_JIRA_CONFIG.componentName }],
      assignee: { name: VOC_JIRA_CONFIG.assigneeName },
      [VOC_JIRA_CONFIG.coWorkerFieldId]: buildCoWorkerFieldValue(coWorkers),
    },
  };
}

function resolveJiraAuthHeaders(env: NodeJS.ProcessEnv = process.env): Headers {
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  const authHeader = env[JIRA_AUTH_HEADER_ENV]?.trim();
  if (authHeader) {
    headers.set("Authorization", authHeader);
    return headers;
  }
  const cookie = env[JIRA_COOKIE_ENV]?.trim();
  if (cookie) {
    headers.set("Cookie", cookie);
    return headers;
  }
  const id = env[JIRA_ID_ENV]?.trim() || env[JIRA_EMAIL_ENV]?.trim() || "";
  const token = env[JIRA_TOKEN_ENV]?.trim() || env[JIRA_API_TOKEN_ENV]?.trim() || "";
  if (id && token) {
    headers.set("Authorization", `Basic ${Buffer.from(`${id}:${token}`).toString("base64")}`);
    return headers;
  }
  throw new Error("Jira VOC credentials are not configured.");
}

export async function createVocJiraIssue(
  payload: JiraVocPayload,
  env: NodeJS.ProcessEnv = process.env,
) {
  const response = await fetch(`${VOC_JIRA_CONFIG.jiraBaseUrl}${VOC_JIRA_CONFIG.createIssuePath}`, {
    method: "POST",
    headers: resolveJiraAuthHeaders(env),
    body: JSON.stringify(payload),
  });
  let parsed: JiraCreateIssueResponse | null = null;
  try {
    parsed = (await response.json()) as JiraCreateIssueResponse;
  } catch {
    parsed = null;
  }
  if (!response.ok || !parsed?.key?.trim()) {
    throw new Error("Jira VOC issue creation failed.");
  }
  const issueKey = parsed.key.trim();
  return {
    issueKey,
    issueUrl: `${VOC_JIRA_CONFIG.jiraBaseUrl}${VOC_JIRA_CONFIG.browseIssuePath}/${issueKey}`,
  };
}

export async function handleEmployeeVocHttpRequest(params: {
  req: IncomingMessage;
  res: ServerResponse;
  readJsonBody: JsonBodyReader;
}): Promise<boolean> {
  const url = new URL(params.req.url ?? "/", "http://localhost");
  if (url.pathname !== EMPLOYEE_VOC_PATH) {
    return false;
  }

  const method = (params.req.method ?? "GET").toUpperCase();
  if (method !== "POST") {
    params.res.setHeader("Allow", "POST");
    sendJson(params.res, 405, { ok: false, error: "Method Not Allowed" });
    return true;
  }

  const session = readEmployeeSession(params.req);
  if (!session) {
    sendJson(params.res, 401, { ok: false, error: "Employee sign-in required." });
    return true;
  }

  const parsed = await params.readJsonBody(params.req, MAX_VOC_JSON_BYTES);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object") {
    sendJson(params.res, 400, { ok: false, error: "VOC 등록에 실패했습니다." });
    return true;
  }

  const title = normalizeVocText((parsed.value as { title?: unknown }).title);
  const body = normalizeVocText((parsed.value as { body?: unknown }).body);

  if (!title || !body || title.length > MAX_VOC_TITLE_CHARS || body.length > MAX_VOC_BODY_CHARS) {
    sendJson(params.res, 400, { ok: false, error: "VOC 등록에 실패했습니다." });
    return true;
  }

  const reporterKnoxId = session.employeeId?.trim();
  if (!reporterKnoxId) {
    sendJson(params.res, 400, { ok: false, error: "VOC 등록에 실패했습니다." });
    return true;
  }

  try {
    const payload = buildVocJiraPayload({
      title,
      body,
      reporterKnoxId,
      reporterName: session.name,
    });
    const result = await createVocJiraIssue(payload);
    sendJson(params.res, 200, { ok: true, ...result });
  } catch {
    sendJson(params.res, 502, { ok: false, error: "VOC 등록에 실패했습니다." });
  }
  return true;
}
