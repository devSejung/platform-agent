import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";
import { coerceUnsafeCronOriginDeliveryJob } from "../../cron/creation-safety.js";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import {
  readCronRunLogEntriesPage,
  readCronRunLogEntriesPageAll,
  resolveCronRunLogPath,
} from "../../cron/run-log.js";
import type { CronJobCreate, CronJobPatch } from "../../cron/types.js";
import { validateScheduleTimestamp } from "../../cron/validate-timestamp.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { GATEWAY_CLIENT_MODES, normalizeGatewayClientMode } from "../../utils/message-channel.js";
import {
  enforceEmployeeAgent,
  enforceEmployeeCronJob,
  enforceEmployeeSessionKey,
  filterEmployeeCronJobs,
  getEmployeeAgentId,
  resolveSessionAgentId,
} from "../employee-access.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateCronAddParams,
  validateCronListParams,
  validateCronRemoveParams,
  validateCronRunParams,
  validateCronRunsParams,
  validateCronStatusParams,
  validateCronUpdateParams,
  validateWakeParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function validateCronDeliveryOwnership(jobCreate: CronJobCreate): string | null {
  if (jobCreate.payload.kind !== "agentTurn" || jobCreate.sessionTarget === "main") {
    return null;
  }
  const sessionKey =
    typeof jobCreate.sessionKey === "string" && jobCreate.sessionKey.trim()
      ? jobCreate.sessionKey.trim()
      : "";
  const delivery = jobCreate.delivery;
  const deliveryMode = typeof delivery?.mode === "string" ? delivery.mode.trim().toLowerCase() : "";
  const deliveryChannel =
    typeof delivery?.channel === "string" ? delivery.channel.trim().toLowerCase() : "";

  if (deliveryMode === "origin" && !sessionKey) {
    return "sessionKey is required for origin cron delivery";
  }
  if (deliveryMode === "announce" && deliveryChannel === "last" && !sessionKey) {
    return "sessionKey is required for delivery.channel=last";
  }
  return null;
}

export const cronHandlers: GatewayRequestHandlers = {
  wake: ({ params, respond, context }) => {
    if (!validateWakeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wake params: ${formatValidationErrors(validateWakeParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      mode: "now" | "next-heartbeat";
      text: string;
    };
    const result = context.cron.wake({ mode: p.mode, text: p.text });
    respond(true, result, undefined);
  },
  "cron.list": async ({ params, respond, context, client }) => {
    if (!validateCronListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.list params: ${formatValidationErrors(validateCronListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      includeDisabled?: boolean;
      limit?: number;
      offset?: number;
      query?: string;
      enabled?: "all" | "enabled" | "disabled";
      sortBy?: "nextRunAtMs" | "updatedAtMs" | "name";
      sortDir?: "asc" | "desc";
    };
    const page = await context.cron.listPage({
      includeDisabled: p.includeDisabled,
      limit: p.limit,
      offset: p.offset,
      query: p.query,
      enabled: p.enabled,
      sortBy: p.sortBy,
      sortDir: p.sortDir,
    });
    const jobs = filterEmployeeCronJobs(client, page.jobs ?? []);
    respond(true, { ...page, jobs, total: jobs.length }, undefined);
  },
  "cron.status": async ({ params, respond, context, client }) => {
    if (!validateCronStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.status params: ${formatValidationErrors(validateCronStatusParams.errors)}`,
        ),
      );
      return;
    }
    const status = await context.cron.status();
    if (getEmployeeAgentId(client)) {
      const employeeJobs = filterEmployeeCronJobs(
        client,
        await context.cron.list({ includeDisabled: true }),
      );
      if (employeeJobs.length !== status.jobs) {
        const nextWakeAtMs = status.enabled
          ? (employeeJobs
              .filter((job) => job.enabled)
              .map((job) => job.state.nextRunAtMs)
              .filter(
                (value): value is number => typeof value === "number" && Number.isFinite(value),
              )
              .toSorted((a, b) => a - b)[0] ?? null)
          : null;
        respond(true, { ...status, jobs: employeeJobs.length, nextWakeAtMs }, undefined);
        return;
      }
    }
    respond(true, status, undefined);
  },
  "cron.add": async ({ params, respond, context, client }) => {
    const sessionKey =
      typeof (params as { sessionKey?: unknown } | null)?.sessionKey === "string"
        ? (params as { sessionKey: string }).sessionKey
        : undefined;
    let normalized: unknown;
    const requestedAgentId =
      typeof (params as { agentId?: unknown } | null)?.agentId === "string"
        ? (params as { agentId: string }).agentId
        : null;
    if (!enforceEmployeeAgent(client, requestedAgentId, respond, "cron create")) {
      return;
    }
    if (!enforceEmployeeSessionKey(client, sessionKey, respond, "cron create")) {
      return;
    }
    try {
      normalized =
        normalizeCronJobCreate(params, {
          sessionContext: { sessionKey },
        }) ?? params;
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.add params: ${formatErrorMessage(err)}`,
        ),
      );
      return;
    }
    if (!validateCronAddParams(normalized)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.add params: ${formatValidationErrors(validateCronAddParams.errors)}`,
        ),
      );
      return;
    }
    const jobCreate = normalized as unknown as CronJobCreate;
    if (
      !enforceEmployeeAgent(
        client,
        typeof jobCreate.agentId === "string" ? jobCreate.agentId : null,
        respond,
        "cron create",
      )
    ) {
      return;
    }
    if (
      !enforceEmployeeSessionKey(
        client,
        typeof jobCreate.sessionKey === "string" ? jobCreate.sessionKey : undefined,
        respond,
        "cron create",
      )
    ) {
      return;
    }
    if (
      typeof jobCreate.agentId === "string" &&
      jobCreate.agentId.trim() &&
      typeof jobCreate.sessionKey === "string" &&
      jobCreate.sessionKey.trim() &&
      normalizeAgentId(jobCreate.agentId) !== resolveSessionAgentId(jobCreate.sessionKey)
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid cron.add params: agentId must match sessionKey agent",
        ),
      );
      return;
    }
    const employeeAgentId = getEmployeeAgentId(client);
    if (employeeAgentId && !(typeof jobCreate.agentId === "string" && jobCreate.agentId.trim())) {
      jobCreate.agentId = employeeAgentId;
    }
    const hasCronOwner =
      (typeof jobCreate.agentId === "string" && jobCreate.agentId.trim()) ||
      (typeof jobCreate.sessionKey === "string" && jobCreate.sessionKey.trim());
    const clientMode = normalizeGatewayClientMode(client?.connect?.client?.mode);
    if (
      !hasCronOwner &&
      (employeeAgentId ||
        clientMode === GATEWAY_CLIENT_MODES.CLI ||
        clientMode === GATEWAY_CLIENT_MODES.BACKEND ||
        clientMode === GATEWAY_CLIENT_MODES.WEBCHAT) &&
      (params as { global?: unknown }).global !== true
    ) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "invalid cron.add params: agentId or sessionKey is required for non-global cron creation",
        ),
      );
      return;
    }
    const defaultAgentId = resolveDefaultAgentId(loadConfig());
    const jobSessionKey =
      typeof jobCreate.sessionKey === "string" && jobCreate.sessionKey.trim()
        ? jobCreate.sessionKey.trim()
        : "";
    const jobOwnerAgentId =
      (typeof jobCreate.agentId === "string" && jobCreate.agentId.trim()) ||
      (jobSessionKey ? resolveSessionAgentId(jobSessionKey) : "");
    if (
      jobCreate.sessionTarget === "main" &&
      jobSessionKey &&
      jobOwnerAgentId &&
      normalizeAgentId(jobOwnerAgentId) !== normalizeAgentId(defaultAgentId) &&
      jobCreate.payload.kind === "systemEvent"
    ) {
      jobCreate.sessionTarget = "isolated";
      jobCreate.payload = { kind: "agentTurn", message: jobCreate.payload.text };
      if (!jobCreate.delivery) {
        jobCreate.delivery = { mode: "origin" };
      }
    }
    coerceUnsafeCronOriginDeliveryJob(jobCreate as unknown as Record<string, unknown>);
    const deliveryOwnershipError = validateCronDeliveryOwnership(jobCreate);
    if (deliveryOwnershipError) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.add params: ${deliveryOwnershipError}`,
        ),
      );
      return;
    }
    const timestampValidation = validateScheduleTimestamp(jobCreate.schedule);
    if (!timestampValidation.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
      );
      return;
    }
    const job = await context.cron.add(jobCreate);
    context.logGateway.info("cron: job created", { jobId: job.id, schedule: jobCreate.schedule });
    respond(true, job, undefined);
  },
  "cron.update": async ({ params, respond, context, client }) => {
    let normalizedPatch: ReturnType<typeof normalizeCronJobPatch>;
    try {
      normalizedPatch = normalizeCronJobPatch((params as { patch?: unknown } | null)?.patch);
    } catch (err) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.update params: ${formatErrorMessage(err)}`,
        ),
      );
      return;
    }
    const candidate =
      normalizedPatch && typeof params === "object" && params !== null
        ? { ...params, patch: normalizedPatch }
        : params;
    if (!validateCronUpdateParams(candidate)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.update params: ${formatValidationErrors(validateCronUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = candidate as {
      id?: string;
      jobId?: string;
      patch: Record<string, unknown>;
    };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.update params: missing id"),
      );
      return;
    }
    if (!enforceEmployeeCronJob(client, context.cron.getJob(jobId), respond)) {
      return;
    }
    const patch = p.patch as unknown as CronJobPatch;
    if (
      "agentId" in patch &&
      !enforceEmployeeAgent(
        client,
        typeof patch.agentId === "string" ? patch.agentId : null,
        respond,
        "cron update",
      )
    ) {
      return;
    }
    if (patch.schedule) {
      const timestampValidation = validateScheduleTimestamp(patch.schedule);
      if (!timestampValidation.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
        );
        return;
      }
    }
    const job = await context.cron.update(jobId, patch);
    context.logGateway.info("cron: job updated", { jobId });
    respond(true, job, undefined);
  },
  "cron.remove": async ({ params, respond, context, client }) => {
    if (!validateCronRemoveParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.remove params: ${formatValidationErrors(validateCronRemoveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.remove params: missing id"),
      );
      return;
    }
    if (!enforceEmployeeCronJob(client, context.cron.getJob(jobId), respond)) {
      return;
    }
    const result = await context.cron.remove(jobId);
    if (result.removed) {
      context.logGateway.info("cron: job removed", { jobId });
    }
    respond(true, result, undefined);
  },
  "cron.run": async ({ params, respond, context, client }) => {
    if (!validateCronRunParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.run params: ${formatValidationErrors(validateCronRunParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string; mode?: "due" | "force" };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.run params: missing id"),
      );
      return;
    }
    if (!enforceEmployeeCronJob(client, context.cron.getJob(jobId), respond)) {
      return;
    }
    let result: Awaited<ReturnType<typeof context.cron.enqueueRun>>;
    try {
      result = await context.cron.enqueueRun(jobId, p.mode ?? "force");
    } catch (error) {
      const message = formatErrorMessage(error);
      if (message === "invalid cron sessionTarget session id") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
        return;
      }
      throw error;
    }
    respond(true, result, undefined);
  },
  "cron.runs": async ({ params, respond, context, client }) => {
    if (!validateCronRunsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.runs params: ${formatValidationErrors(validateCronRunsParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      scope?: "job" | "all";
      id?: string;
      jobId?: string;
      limit?: number;
      offset?: number;
      statuses?: Array<"ok" | "error" | "skipped">;
      status?: "all" | "ok" | "error" | "skipped";
      deliveryStatuses?: Array<"delivered" | "not-delivered" | "unknown" | "not-requested">;
      deliveryStatus?: "delivered" | "not-delivered" | "unknown" | "not-requested";
      query?: string;
      sortDir?: "asc" | "desc";
    };
    const explicitScope = p.scope;
    const jobId = p.id ?? p.jobId;
    const scope: "job" | "all" = explicitScope ?? (jobId ? "job" : "all");
    if (scope === "job" && !jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: missing id"),
      );
      return;
    }
    if (jobId && !enforceEmployeeCronJob(client, context.cron.getJob(jobId), respond)) {
      return;
    }
    if (scope === "all") {
      const jobs = filterEmployeeCronJobs(
        client,
        await context.cron.list({ includeDisabled: true }),
      );
      const jobNameById = Object.fromEntries(
        jobs
          .filter((job) => typeof job.id === "string" && typeof job.name === "string")
          .map((job) => [job.id, job.name]),
      );
      const page = await readCronRunLogEntriesPageAll({
        storePath: context.cronStorePath,
        limit: p.limit,
        offset: p.offset,
        statuses: p.statuses,
        status: p.status,
        deliveryStatuses: p.deliveryStatuses,
        deliveryStatus: p.deliveryStatus,
        query: p.query,
        sortDir: p.sortDir,
        jobNameById,
      });
      const allowedJobIds = new Set(jobs.map((job) => job.id));
      const entries = page.entries.filter((entry) => allowedJobIds.has(entry.jobId));
      respond(true, { ...page, entries, total: entries.length }, undefined);
      return;
    }
    let logPath: string;
    try {
      logPath = resolveCronRunLogPath({
        storePath: context.cronStorePath,
        jobId: jobId as string,
      });
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: invalid id"),
      );
      return;
    }
    const page = await readCronRunLogEntriesPage(logPath, {
      limit: p.limit,
      offset: p.offset,
      jobId: jobId as string,
      statuses: p.statuses,
      status: p.status,
      deliveryStatuses: p.deliveryStatuses,
      deliveryStatus: p.deliveryStatus,
      query: p.query,
      sortDir: p.sortDir,
    });
    respond(true, page, undefined);
  },
};
