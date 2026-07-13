import { Buffer } from "node:buffer";
import type { IncomingMessage, ServerResponse } from "node:http";
import { EMPLOYEE_VOC_PATH } from "./employee-voc-contract.js";
import { readEmployeeSession } from "./employee-web-auth.js";

const MAX_VOC_TITLE_CHARS = 200;
const MAX_VOC_BODY_CHARS = 8000;
const MAX_VOC_JSON_BYTES = 64 * 1024;

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
const JIRA_PARENT_ISSUE_KEY_ENV = "OPENCLAW_JIRA_PARENT_ISSUE_KEY";
const JIRA_LEGACY_PARENT_ISSUE_KEY_ENV = "JIRA_PARENT_ISSUE_KEY";
const JIRA_ISSUE_TYPE_ENV = "OPENCLAW_JIRA_ISSUE_TYPE";
const JIRA_LEGACY_ISSUE_TYPE_ENV = "JIRA_ISSUE_TYPE";
const JIRA_ASSIGNEE_ENV = "OPENCLAW_JIRA_ASSIGNEE";
const JIRA_LEGACY_ASSIGNEE_ENV = "JIRA_ASSIGNEE";
const JIRA_LEGACY_DEFAULT_COMPONENTS_ENV = "JIRA_DEFAULT_COMPONENTS";
const JIRA_LEGACY_COWORKER_FIELD_ENV = "JIRA_COWORKER_FIELD";
const JIRA_DEFAULT_COMPONENTS_ENV = "OPENCLAW_JIRA_DEFAULT_COMPONENTS";
const JIRA_COWORKER_FIELD_ENV = "OPENCLAW_JIRA_COWORKER_FIELD";
const JIRA_DEFAULT_COWORKERS_ENV = "OPENCLAW_JIRA_DEFAULT_COWORKERS";
const JIRA_LEGACY_DEFAULT_COWORKERS_ENV = "JIRA_DEFAULT_COWORKERS";
const JIRA_URL_ENV = "OPENCLAW_JIRA_URL";
const JIRA_PROJECT_KEY_ENV = "OPENCLAW_JIRA_PROJECT_KEY";

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

type ResolvedVocJiraConfig = {
  jiraBaseUrl: string;
  createIssuePath: string;
  browseIssuePath: string;
  projectKey: string;
  parentIssueKey: string;
  issueTypeName: string;
  componentNames: string[];
  assigneeName: string;
  coWorkerFieldId: string;
  coWorkerDefaults: string[];
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

function resolveCsvEnv(
  env: NodeJS.ProcessEnv,
  preferredKey: string,
  legacyKey?: string,
): string[] {
  const raw = env[preferredKey]?.trim() || (legacyKey ? env[legacyKey]?.trim() : "") || "";
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function requireEnvValue(
  env: NodeJS.ProcessEnv,
  preferredKey: string,
  legacyKey?: string,
): string {
  const value = env[preferredKey]?.trim() || (legacyKey ? env[legacyKey]?.trim() : "") || "";
  if (!value) {
    throw new Error(`Missing Jira VOC config env: ${preferredKey}${legacyKey ? ` (or ${legacyKey})` : ""}`);
  }
  return value;
}

function resolveVocJiraConfig(env: NodeJS.ProcessEnv = process.env): ResolvedVocJiraConfig {
  const componentNames = resolveCsvEnv(
    env,
    JIRA_DEFAULT_COMPONENTS_ENV,
    JIRA_LEGACY_DEFAULT_COMPONENTS_ENV,
  );
  const coWorkerDefaults = resolveCsvEnv(
    env,
    JIRA_DEFAULT_COWORKERS_ENV,
    JIRA_LEGACY_DEFAULT_COWORKERS_ENV,
  );
  return {
    jiraBaseUrl: requireEnvValue(env, JIRA_URL_ENV, JIRA_LEGACY_URL_ENV),
    createIssuePath: "/rest/api/2/issue",
    browseIssuePath: "/browse",
    projectKey: requireEnvValue(env, JIRA_PROJECT_KEY_ENV, JIRA_LEGACY_PROJECT_KEY_ENV),
    parentIssueKey: requireEnvValue(env, JIRA_PARENT_ISSUE_KEY_ENV, JIRA_LEGACY_PARENT_ISSUE_KEY_ENV),
    issueTypeName: requireEnvValue(env, JIRA_ISSUE_TYPE_ENV, JIRA_LEGACY_ISSUE_TYPE_ENV),
    componentNames:
      componentNames.length > 0
        ? componentNames
        : [requireEnvValue(env, JIRA_DEFAULT_COMPONENTS_ENV, JIRA_LEGACY_DEFAULT_COMPONENTS_ENV)],
    assigneeName: requireEnvValue(env, JIRA_ASSIGNEE_ENV, JIRA_LEGACY_ASSIGNEE_ENV),
    coWorkerFieldId: requireEnvValue(env, JIRA_COWORKER_FIELD_ENV, JIRA_LEGACY_COWORKER_FIELD_ENV),
    coWorkerDefaults,
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
    `Components: ${config.componentNames.join(", ")}`,
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
  const coWorkers = dedupe([
    ...config.coWorkerDefaults,
    config.assigneeName,
    params.reporterEmployeeId,
  ]);
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
      components: config.componentNames.map((name) => ({ name })),
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
  const id = env[JIRA_ID_ENV]?.trim() || env[JIRA_EMAIL_ENV]?.trim() || "";
  const token = env[JIRA_TOKEN_ENV]?.trim() || env[JIRA_API_TOKEN_ENV]?.trim() || "";
  if (id && token) {
    headers.set("Authorization", `Basic ${Buffer.from(`${id}:${token}`).toString("base64")}`);
    return headers;
  }
  // Support the existing jira-omni env file without requiring extra export remapping.
  const legacyToken = env[JIRA_LEGACY_API_TOKEN_ENV]?.trim() || "";
  if (legacyToken) {
    headers.set("Authorization", `Bearer ${legacyToken}`);
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
