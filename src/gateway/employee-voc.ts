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
const JIRA_LEGACY_USERNAME_ENV = "JIRA_USERNAME";
const JIRA_LEGACY_API_TOKEN_ENV = "JIRA_API_TOKEN";
const JIRA_LEGACY_URL_ENV = "JIRA_URL";
const JIRA_LEGACY_PROJECT_KEY_ENV = "JIRA_PROJECT_KEY";
const JIRA_LEGACY_DEFAULT_COMPONENTS_ENV = "JIRA_DEFAULT_COMPONENTS";
const JIRA_LEGACY_COWORKER_FIELD_ENV = "JIRA_COWORKER_FIELD";

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

type ResolvedVocJiraConfig = typeof VOC_JIRA_CONFIG;

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

function resolveVocJiraConfig(env: NodeJS.ProcessEnv = process.env): ResolvedVocJiraConfig {
  const jiraBaseUrl = env[JIRA_LEGACY_URL_ENV]?.trim() || VOC_JIRA_CONFIG.jiraBaseUrl;
  const projectKey = env[JIRA_LEGACY_PROJECT_KEY_ENV]?.trim() || VOC_JIRA_CONFIG.projectKey;
  const coWorkerFieldId =
    env[JIRA_LEGACY_COWORKER_FIELD_ENV]?.trim() || VOC_JIRA_CONFIG.coWorkerFieldId;
  const componentName =
    env[JIRA_LEGACY_DEFAULT_COMPONENTS_ENV]
      ?.split(",")
      .map((value) => value.trim())
      .find(Boolean) || VOC_JIRA_CONFIG.componentName;
  return {
    ...VOC_JIRA_CONFIG,
    jiraBaseUrl,
    projectKey,
    componentName,
    coWorkerFieldId,
  };
}

function buildVocDescription(params: {
  body: string;
  reporterName?: string;
  reporterEmployeeId: string;
  config?: ResolvedVocJiraConfig;
}) {
  const config = params.config ?? VOC_JIRA_CONFIG;
  const reporterLabel = params.reporterName?.trim() || params.reporterEmployeeId;
  return [
    params.body,
    "",
    "---",
    "Submitted from PlatformClaw VOC",
    `Reporter: ${reporterLabel}`,
    `Reporter Employee ID: ${params.reporterEmployeeId}`,
    "Created via: Employee Web UI",
    `Parent: ${config.parentIssueKey}`,
    `Component: ${config.componentName}`,
  ].join("\n");
}

export function buildVocJiraPayload(params: {
  title: string;
  body: string;
  reporterEmployeeId: string;
  reporterName?: string;
  env?: NodeJS.ProcessEnv;
}): JiraVocPayload {
  const config = resolveVocJiraConfig(params.env);
  const coWorkers = dedupe([...VOC_JIRA_CONFIG.coWorkerDefaults, params.reporterEmployeeId]);
  return {
    fields: {
      project: { key: config.projectKey },
      parent: { key: config.parentIssueKey },
      summary: params.title,
      description: buildVocDescription({
        body: params.body,
        reporterEmployeeId: params.reporterEmployeeId,
        reporterName: params.reporterName,
        config,
      }),
      issuetype: { name: config.issueTypeName },
      components: [{ name: config.componentName }],
      assignee: { name: config.assigneeName },
      [config.coWorkerFieldId]: buildCoWorkerFieldValue(coWorkers),
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
  // Support the existing jira-omni env file without requiring extra export remapping.
  const id =
    env[JIRA_ID_ENV]?.trim() ||
    env[JIRA_EMAIL_ENV]?.trim() ||
    env[JIRA_LEGACY_USERNAME_ENV]?.trim() ||
    "";
  const token =
    env[JIRA_TOKEN_ENV]?.trim() ||
    env[JIRA_API_TOKEN_ENV]?.trim() ||
    env[JIRA_LEGACY_API_TOKEN_ENV]?.trim() ||
    "";
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
  const config = resolveVocJiraConfig(env);
  const response = await fetch(`${config.jiraBaseUrl}${config.createIssuePath}`, {
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
    issueUrl: `${config.jiraBaseUrl}${config.browseIssuePath}/${issueKey}`,
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

  const reporterEmployeeId = session.employeeId?.trim();
  if (!reporterEmployeeId) {
    sendJson(params.res, 400, { ok: false, error: "VOC 등록에 실패했습니다." });
    return true;
  }

  try {
    const payload = buildVocJiraPayload({
      title,
      body,
      reporterEmployeeId,
      reporterName: session.name,
      env: process.env,
    });
    const result = await createVocJiraIssue(payload);
    sendJson(params.res, 200, { ok: true, ...result });
  } catch {
    sendJson(params.res, 502, { ok: false, error: "VOC 등록에 실패했습니다." });
  }
  return true;
}
