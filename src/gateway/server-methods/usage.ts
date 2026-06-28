import fs from "node:fs";
import {
  resolveAccountIdByAlias,
  listAccountMembershipSummaries,
  resolveAccountIdByEmployeeId,
  resolveAccountDisplayName,
} from "../../accounts/account-store.js";
import { isAdminAccount } from "../../accounts/group-store.js";
import { loadConfig } from "../../config/config.js";
import {
  resolveSessionFilePath,
  resolveSessionFilePathOptions,
} from "../../config/sessions/paths.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { loadProviderUsageSummary } from "../../infra/provider-usage.js";
import type {
  CostUsageSummary,
  SessionDailyModelUsage,
  SessionMessageCounts,
  SessionModelUsage,
} from "../../infra/session-cost-usage.js";
import {
  loadCostUsageSummary,
  loadSessionCostSummary,
  loadSessionUsageTimeSeries,
  discoverAllSessions,
  resolveExistingUsageSessionFile,
  type DiscoveredSession,
} from "../../infra/session-cost-usage.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { resolvePreferredSessionKeyForSessionIdMatches } from "../../sessions/session-id-resolution.js";
import type {
  DashboardAgentUsageRow,
  DashboardPartUsageRow,
  DashboardRange,
  DashboardSortBy,
  DashboardSortDir,
  DashboardSummaryParams,
  DashboardSummaryResult,
  DashboardTimePoint,
} from "../../shared/dashboard-types.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import {
  buildUsageAggregateTail,
  mergeUsageDailyLatency,
  mergeUsageLatency,
} from "../../shared/usage-aggregates.js";
import type {
  SessionUsageEntry,
  SessionsUsageAggregates,
  SessionsUsageResult,
} from "../../shared/usage-types.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateDashboardSummaryParams,
  validateSessionsUsageParams,
} from "../protocol/index.js";
import {
  listAgentsForGateway,
  loadCombinedSessionStoreForGateway,
  loadSessionEntry,
} from "../session-utils.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

const COST_USAGE_CACHE_TTL_MS = 30_000;
const DASHBOARD_TOTAL_CACHE_TTL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type DateRange = { startMs: number; endMs: number };
type DateInterpretation =
  | { mode: "utc" | "gateway" }
  | { mode: "specific"; utcOffsetMinutes: number };

type CostUsageCacheEntry = {
  summary?: CostUsageSummary;
  updatedAt?: number;
  inFlight?: Promise<CostUsageSummary>;
};

const costUsageCache = new Map<string, CostUsageCacheEntry>();
let dashboardTotalCache:
  | {
      result?: DashboardSummaryResult;
      updatedAt?: number;
      inFlight?: Promise<DashboardSummaryResult>;
    }
  | undefined;

function resolveSessionUsageFileOrRespond(
  key: string,
  respond: RespondFn,
): {
  config: ReturnType<typeof loadConfig>;
  entry: SessionEntry | undefined;
  agentId: string | undefined;
  sessionId: string;
  sessionFile: string;
} | null {
  const config = loadConfig();
  const { entry, storePath } = loadSessionEntry(key);

  // For discovered sessions (not in store), try using key as sessionId directly
  const parsed = parseAgentSessionKey(key);
  const agentId = parsed?.agentId;
  const rawSessionId = parsed?.rest ?? key;
  const sessionId = entry?.sessionId ?? rawSessionId;
  let sessionFile: string;
  try {
    const pathOpts = resolveSessionFilePathOptions({ storePath, agentId });
    sessionFile = resolveSessionFilePath(sessionId, entry, pathOpts);
  } catch {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `Invalid session key: ${key}`),
    );
    return null;
  }

  return { config, entry, agentId, sessionId, sessionFile };
}

const parseDateParts = (
  raw: unknown,
): { year: number; monthIndex: number; day: number } | undefined => {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return undefined;
  }
  return { year, monthIndex, day };
};

/**
 * Parse a UTC offset string in the format UTC+H, UTC-H, UTC+HH, UTC-HH, UTC+H:MM, UTC-HH:MM.
 * Returns the UTC offset in minutes (east-positive), or undefined if invalid.
 */
const parseUtcOffsetToMinutes = (raw: unknown): number | undefined => {
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const match = /^UTC([+-])(\d{1,2})(?::([0-5]\d))?$/.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  const sign = match[1] === "+" ? 1 : -1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? "0");
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    return undefined;
  }
  if (hours > 14 || (hours === 14 && minutes !== 0)) {
    return undefined;
  }
  const totalMinutes = sign * (hours * 60 + minutes);
  if (totalMinutes < -12 * 60 || totalMinutes > 14 * 60) {
    return undefined;
  }
  return totalMinutes;
};

const resolveDateInterpretation = (params: {
  mode?: unknown;
  utcOffset?: unknown;
}): DateInterpretation => {
  if (params.mode === "gateway") {
    return { mode: "gateway" };
  }
  if (params.mode === "specific") {
    const utcOffsetMinutes = parseUtcOffsetToMinutes(params.utcOffset);
    if (utcOffsetMinutes !== undefined) {
      return { mode: "specific", utcOffsetMinutes };
    }
  }
  // Backward compatibility: when mode is missing (or invalid), keep current UTC interpretation.
  return { mode: "utc" };
};

/**
 * Parse a date string (YYYY-MM-DD) to start-of-day timestamp based on interpretation mode.
 * Returns undefined if invalid.
 */
const parseDateToMs = (
  raw: unknown,
  interpretation: DateInterpretation = { mode: "utc" },
): number | undefined => {
  const parts = parseDateParts(raw);
  if (!parts) {
    return undefined;
  }
  const { year, monthIndex, day } = parts;
  if (interpretation.mode === "gateway") {
    const ms = new Date(year, monthIndex, day).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  if (interpretation.mode === "specific") {
    const ms = Date.UTC(year, monthIndex, day) - interpretation.utcOffsetMinutes * 60 * 1000;
    return Number.isNaN(ms) ? undefined : ms;
  }
  const ms = Date.UTC(year, monthIndex, day);
  return Number.isNaN(ms) ? undefined : ms;
};

const getTodayStartMs = (now: Date, interpretation: DateInterpretation): number => {
  if (interpretation.mode === "gateway") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  if (interpretation.mode === "specific") {
    const shifted = new Date(now.getTime() + interpretation.utcOffsetMinutes * 60 * 1000);
    return (
      Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      interpretation.utcOffsetMinutes * 60 * 1000
    );
  }
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

const parseDays = (raw: unknown): number | undefined => {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return undefined;
};

/**
 * Get date range from params (startDate/endDate or days).
 * Falls back to last 30 days if not provided.
 */
const parseDateRange = (params: {
  startDate?: unknown;
  endDate?: unknown;
  days?: unknown;
  mode?: unknown;
  utcOffset?: unknown;
}): DateRange => {
  const now = new Date();
  const interpretation = resolveDateInterpretation(params);
  const todayStartMs = getTodayStartMs(now, interpretation);
  const todayEndMs = todayStartMs + DAY_MS - 1;

  const startMs = parseDateToMs(params.startDate, interpretation);
  const endMs = parseDateToMs(params.endDate, interpretation);

  if (startMs !== undefined && endMs !== undefined) {
    // endMs should be end of day
    return { startMs, endMs: endMs + DAY_MS - 1 };
  }

  const days = parseDays(params.days);
  if (days !== undefined) {
    const clampedDays = Math.max(1, days);
    const start = todayStartMs - (clampedDays - 1) * DAY_MS;
    return { startMs: start, endMs: todayEndMs };
  }

  // Default to last 30 days
  const defaultStartMs = todayStartMs - 29 * DAY_MS;
  return { startMs: defaultStartMs, endMs: todayEndMs };
};

type DiscoveredSessionWithAgent = DiscoveredSession & { agentId: string };

type DashboardBucket = {
  key: string;
  label: string;
  start?: string;
  end?: string;
  sessions: number;
  apiCalls: number;
  totalTokens: number;
};

function resolveDashboardCanSort(
  client: Parameters<GatewayRequestHandlers[string]>[0]["client"],
): boolean {
  if (client?.connect?.role === "operator") {
    return true;
  }
  if (client?.connect?.role !== "employee") {
    return false;
  }
  const employeeId = client.internal?.employee?.employeeId?.trim();
  return employeeId ? isAdminAccount(employeeId) : false;
}

function isoDayFromMs(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthKeyFromDate(dateKey: string): string {
  return dateKey.slice(0, 7);
}

function monthLabelFromKey(monthKey: string): string {
  const [year, month] = monthKey.split("-").map((part) => Number(part));
  const date = new Date(year, Math.max(0, month - 1), 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function ensureMonthlyBucket(buckets: Map<string, DashboardBucket>, dateKey: string): string {
  const monthKey = monthKeyFromDate(dateKey);
  if (!buckets.has(monthKey)) {
    buckets.set(monthKey, {
      key: monthKey,
      label: monthLabelFromKey(monthKey),
      start: `${monthKey}-01T00:00:00.000Z`,
      end: undefined,
      sessions: 0,
      apiCalls: 0,
      totalTokens: 0,
    });
  }
  return monthKey;
}

function addBucketMetric(
  buckets: Map<string, DashboardBucket>,
  key: string,
  metric: Partial<Pick<DashboardBucket, "sessions" | "apiCalls" | "totalTokens">>,
) {
  const bucket = buckets.get(key);
  if (!bucket) {
    return;
  }
  bucket.sessions += metric.sessions ?? 0;
  bucket.apiCalls += metric.apiCalls ?? 0;
  bucket.totalTokens += metric.totalTokens ?? 0;
}

function buildDashboardBuckets(range: DashboardRange, nowMs: number): Map<string, DashboardBucket> {
  const buckets = new Map<string, DashboardBucket>();
  const now = new Date(nowMs);
  if (range === "today") {
    for (let hour = 0; hour < 24; hour += 1) {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60 * 1000 - 1);
      const key = String(hour).padStart(2, "0");
      buckets.set(key, {
        key,
        label: String(hour).padStart(2, "0"),
        start: start.toISOString(),
        end: end.toISOString(),
        sessions: 0,
        apiCalls: 0,
        totalTokens: 0,
      });
    }
    return buckets;
  }

  const days = range === "7d" ? 7 : 30;
  if (range === "7d" || range === "30d") {
    for (let offset = days - 1; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      const key = isoDayFromMs(date.getTime());
      buckets.set(key, {
        key,
        label:
          range === "7d"
            ? date.toLocaleDateString("en-US", { weekday: "short" })
            : date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        start: new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          0,
          0,
          0,
          0,
        ).toISOString(),
        end: new Date(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          23,
          59,
          59,
          999,
        ).toISOString(),
        sessions: 0,
        apiCalls: 0,
        totalTokens: 0,
      });
    }
  }
  return buckets;
}

function resolveDashboardWindow(range: DashboardRange): DateRange {
  if (range === "total") {
    return { startMs: 0, endMs: Date.now() };
  }
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  return parseDateRange({ days, mode: "gateway" });
}

function resolveDashboardParts(accountId?: string): string[] {
  if (!accountId) {
    return ["Unassigned"];
  }
  const parts = listAccountMembershipSummaries(accountId)
    .filter((entry) => entry.scopeType === "part" && !entry.archived)
    .map((entry) => entry.scopeName.trim())
    .filter(Boolean);
  return parts.length > 0 ? Array.from(new Set(parts)).toSorted() : ["Unassigned"];
}

function resolveDashboardAccountId(params: {
  accountCandidate?: string;
  agentId: string;
}): string | undefined {
  const normalizedAgentId = params.agentId.trim();
  if (normalizedAgentId) {
    const directAgentMatch = resolveAccountIdByAlias({
      aliasType: "agent_id",
      aliasValue: normalizedAgentId,
    });
    if (directAgentMatch) {
      return directAgentMatch;
    }
    if (!normalizedAgentId.startsWith("test_") && normalizedAgentId.includes("_")) {
      const dottedAgentId = normalizedAgentId.replaceAll("_", ".");
      const dottedAgentMatch = resolveAccountIdByAlias({
        aliasType: "agent_id",
        aliasValue: dottedAgentId,
      });
      if (dottedAgentMatch) {
        return dottedAgentMatch;
      }
    }
  }

  const normalizedCandidate = params.accountCandidate?.trim();
  if (normalizedCandidate) {
    return (
      resolveAccountIdByEmployeeId(normalizedCandidate) ??
      resolveAccountIdByAlias({
        aliasType: "employee_id",
        aliasValue: normalizedCandidate,
      }) ??
      normalizedCandidate
    );
  }
  return undefined;
}

function resolveDashboardName(params: {
  accountId?: string;
  originLabel?: string;
  originFrom?: string;
  agentName: string;
  sessionId?: string;
}): string {
  if (params.accountId) {
    return resolveAccountDisplayName(params.accountId) ?? params.accountId;
  }
  if (params.originLabel?.trim()) {
    return params.originLabel.trim();
  }
  if (params.originFrom?.trim()) {
    return params.originFrom.trim();
  }
  return params.agentName;
}

function resolveDashboardIdentityKey(params: {
  accountId?: string;
  originLabel?: string;
  originFrom?: string;
  agentId: string;
}): string {
  if (params.accountId?.trim()) {
    return `account:${params.accountId.trim()}`;
  }
  if (params.originLabel?.trim()) {
    return `label:${params.originLabel.trim().toLowerCase()}`;
  }
  if (params.originFrom?.trim()) {
    return `from:${params.originFrom.trim().toLowerCase()}`;
  }
  return `agent:${params.agentId}`;
}

function sortDashboardAgentUsage(
  rows: DashboardAgentUsageRow[],
  sortBy: DashboardSortBy | undefined,
  sortDir: DashboardSortDir | undefined,
) {
  const direction = sortDir === "asc" ? 1 : -1;
  const effectiveSort = sortBy ?? "totalTokens";
  rows.sort((left, right) => {
    let result = 0;
    switch (effectiveSort) {
      case "name":
        result = left.name.localeCompare(right.name);
        break;
      case "part":
        result = left.part.localeCompare(right.part);
        break;
      case "agent":
        result = left.agentName.localeCompare(right.agentName);
        break;
      case "sessions":
        result = left.sessions - right.sessions;
        break;
      case "apiCalls":
        result = left.apiCalls - right.apiCalls;
        break;
      case "lastUsedAt":
        result =
          (left.lastUsedAt ? Date.parse(left.lastUsedAt) : 0) -
          (right.lastUsedAt ? Date.parse(right.lastUsedAt) : 0);
        break;
      case "totalTokens":
      default:
        result = left.totalTokens - right.totalTokens;
        break;
    }
    if (result !== 0) {
      return result * direction;
    }
    return (
      left.name.localeCompare(right.name) ||
      left.part.localeCompare(right.part) ||
      left.agentName.localeCompare(right.agentName)
    );
  });
}

function cloneDashboardSummary(result: DashboardSummaryResult): DashboardSummaryResult {
  return {
    ...result,
    summary: { ...result.summary },
    timeSeries: result.timeSeries.map((entry) => ({ ...entry })),
    agentUsage: result.agentUsage.map((entry) => ({ ...entry })),
    partUsage: result.partUsage.map((entry) => ({ ...entry })),
  };
}

function buildStoreBySessionId(
  store: Record<string, SessionEntry>,
): Map<string, { key: string; entry: SessionEntry }> {
  const matchesBySessionId = new Map<string, Array<[string, SessionEntry]>>();
  for (const [key, entry] of Object.entries(store)) {
    if (!entry?.sessionId) {
      continue;
    }
    const matches = matchesBySessionId.get(entry.sessionId) ?? [];
    matches.push([key, entry]);
    matchesBySessionId.set(entry.sessionId, matches);
  }

  const storeBySessionId = new Map<string, { key: string; entry: SessionEntry }>();
  for (const [sessionId, matches] of matchesBySessionId) {
    const preferredKey = resolvePreferredSessionKeyForSessionIdMatches(matches, sessionId);
    if (!preferredKey) {
      continue;
    }
    const preferredEntry = store[preferredKey];
    if (preferredEntry) {
      storeBySessionId.set(sessionId, { key: preferredKey, entry: preferredEntry });
    }
  }
  return storeBySessionId;
}

async function discoverAllSessionsForUsage(params: {
  config: ReturnType<typeof loadConfig>;
  startMs: number;
  endMs: number;
}): Promise<DiscoveredSessionWithAgent[]> {
  const agents = listAgentsForGateway(params.config).agents;
  const results = await Promise.all(
    agents.map(async (agent) => {
      const sessions = await discoverAllSessions({
        agentId: agent.id,
        startMs: params.startMs,
        endMs: params.endMs,
      });
      return sessions.map((session) => ({ ...session, agentId: agent.id }));
    }),
  );
  return results.flat().toSorted((a, b) => b.mtime - a.mtime);
}

async function buildDashboardSummaryBase(params: {
  range: DashboardRange;
}): Promise<DashboardSummaryResult> {
  const config = loadConfig();
  const { startMs, endMs } = resolveDashboardWindow(params.range);
  const discoveredSessions = await discoverAllSessionsForUsage({ config, startMs, endMs });
  const { store } = loadCombinedSessionStoreForGateway(config);
  const storeBySessionId = buildStoreBySessionId(store);
  const agentMeta = new Map(
    listAgentsForGateway(config).agents.map(
      (agent) => [agent.id, agent.name?.trim() || agent.id] as const,
    ),
  );
  const summary = {
    activeAgents: 0,
    sessions: 0,
    apiCalls: 0,
    totalTokens: 0,
  };
  const activeAgents = new Set<string>();
  const rangeBuckets = buildDashboardBuckets(params.range, endMs);
  const totalMonthlyBuckets = new Map<string, DashboardBucket>();
  const agentUsageMap = new Map<string, DashboardAgentUsageRow>();
  const partUsageMap = new Map<string, DashboardPartUsageRow & { _activeAgents: Set<string> }>();

  for (const discovered of discoveredSessions) {
    const storeMatch = storeBySessionId.get(discovered.sessionId);
    const storeEntry = storeMatch?.entry;
    const usage = await loadSessionCostSummary({
      sessionId: discovered.sessionId,
      sessionEntry: storeEntry,
      sessionFile: discovered.sessionFile,
      config,
      agentId: discovered.agentId,
      startMs,
      endMs,
    });
    if (!usage) {
      continue;
    }

    const sessionApiCalls = (usage.modelUsage ?? []).reduce((sum, entry) => sum + entry.count, 0);
    const lastUsedAt = usage.lastActivity
      ? new Date(usage.lastActivity).toISOString()
      : new Date(discovered.mtime).toISOString();
    const accountId = resolveDashboardAccountId({
      accountCandidate:
        storeEntry?.origin?.accountId ??
        storeEntry?.lastAccountId ??
        storeEntry?.deliveryContext?.accountId ??
        undefined,
      agentId: discovered.agentId,
    });
    const agentName = agentMeta.get(discovered.agentId) ?? discovered.agentId;
    const name = resolveDashboardName({
      accountId,
      originLabel: storeEntry?.origin?.label,
      originFrom: storeEntry?.origin?.from,
      agentName,
    });
    const identityKey = resolveDashboardIdentityKey({
      accountId,
      originLabel: storeEntry?.origin?.label,
      originFrom: storeEntry?.origin?.from,
      agentId: discovered.agentId,
    });
    const parts = resolveDashboardParts(accountId);

    summary.sessions += 1;
    summary.apiCalls += sessionApiCalls;
    summary.totalTokens += usage.totalTokens;
    activeAgents.add(discovered.agentId);

    if (params.range === "today") {
      const timeSeries = await loadSessionUsageTimeSeries({
        sessionId: discovered.sessionId,
        sessionEntry: storeEntry,
        sessionFile: discovered.sessionFile,
        config,
        agentId: discovered.agentId,
        maxPoints: Number.MAX_SAFE_INTEGER,
      });
      for (const point of timeSeries?.points ?? []) {
        if (point.timestamp < startMs || point.timestamp > endMs) {
          continue;
        }
        const hourKey = String(new Date(point.timestamp).getHours()).padStart(2, "0");
        addBucketMetric(rangeBuckets, hourKey, {
          totalTokens: point.totalTokens,
          apiCalls: 1,
        });
      }
      addBucketMetric(rangeBuckets, String(new Date(lastUsedAt).getHours()).padStart(2, "0"), {
        sessions: 1,
      });
    } else {
      for (const day of usage.dailyBreakdown ?? []) {
        addBucketMetric(rangeBuckets, day.date, {
          totalTokens: day.tokens,
        });
        const monthKey = ensureMonthlyBucket(totalMonthlyBuckets, day.date);
        addBucketMetric(totalMonthlyBuckets, monthKey, { totalTokens: day.tokens });
      }
      for (const day of usage.dailyModelUsage ?? []) {
        ensureMonthlyBucket(totalMonthlyBuckets, day.date);
        addBucketMetric(rangeBuckets, day.date, { apiCalls: day.count });
        addBucketMetric(totalMonthlyBuckets, monthKeyFromDate(day.date), { apiCalls: day.count });
      }
      for (const dayKey of usage.activityDates ?? []) {
        ensureMonthlyBucket(totalMonthlyBuckets, dayKey);
        addBucketMetric(rangeBuckets, dayKey, { sessions: 1 });
        addBucketMetric(totalMonthlyBuckets, monthKeyFromDate(dayKey), { sessions: 1 });
      }
    }

    for (const part of parts) {
      const agentRowKey = `${identityKey}::${part}::${discovered.agentId}`;
      const existingAgentRow = agentUsageMap.get(agentRowKey) ?? {
        accountId,
        name,
        part,
        agentId: discovered.agentId,
        agentName,
        sessions: 0,
        apiCalls: 0,
        totalTokens: 0,
        lastUsedAt: null,
      };
      existingAgentRow.sessions += 1;
      existingAgentRow.apiCalls += sessionApiCalls;
      existingAgentRow.totalTokens += usage.totalTokens;
      if (
        lastUsedAt &&
        (!existingAgentRow.lastUsedAt ||
          Date.parse(lastUsedAt) > Date.parse(existingAgentRow.lastUsedAt))
      ) {
        existingAgentRow.lastUsedAt = lastUsedAt;
      }
      agentUsageMap.set(agentRowKey, existingAgentRow);

      const existingPartRow = partUsageMap.get(part) ?? {
        part,
        activeAgents: 0,
        sessions: 0,
        apiCalls: 0,
        totalTokens: 0,
        share: 0,
        _activeAgents: new Set<string>(),
      };
      existingPartRow._activeAgents.add(discovered.agentId);
      existingPartRow.sessions += 1;
      existingPartRow.apiCalls += sessionApiCalls;
      existingPartRow.totalTokens += usage.totalTokens;
      partUsageMap.set(part, existingPartRow);
    }
  }

  summary.activeAgents = activeAgents.size;

  const agentUsage = Array.from(agentUsageMap.values());
  sortDashboardAgentUsage(agentUsage, undefined, "desc");

  const partRows = Array.from(partUsageMap.values())
    .map((row) => ({
      part: row.part,
      activeAgents: row._activeAgents.size,
      sessions: row.sessions,
      apiCalls: row.apiCalls,
      totalTokens: row.totalTokens,
      share: 0,
    }))
    .toSorted((a, b) => b.totalTokens - a.totalTokens || a.part.localeCompare(b.part));
  const totalPartTokens = partRows.reduce((sum, row) => sum + row.totalTokens, 0);
  for (const row of partRows) {
    row.share = totalPartTokens > 0 ? row.totalTokens / totalPartTokens : 0;
  }

  return {
    canSort: false,
    range: params.range,
    generatedAt: Date.now(),
    summary,
    timeSeries: (params.range === "total"
      ? Array.from(totalMonthlyBuckets.values())
      : Array.from(rangeBuckets.values())
    )
      .toSorted((a, b) => a.key.localeCompare(b.key))
      .map(
        (bucket): DashboardTimePoint => ({
          label: bucket.label,
          start: bucket.start,
          end: bucket.end,
          sessions: Math.round(bucket.sessions),
          apiCalls: Math.round(bucket.apiCalls),
          totalTokens: Math.round(bucket.totalTokens),
        }),
      ),
    agentUsage,
    partUsage: partRows,
  };
}

async function loadDashboardSummaryCached(range: DashboardRange): Promise<DashboardSummaryResult> {
  if (range !== "total") {
    return await buildDashboardSummaryBase({ range });
  }
  const now = Date.now();
  const cached = dashboardTotalCache;
  if (cached?.result && cached.updatedAt && now - cached.updatedAt < DASHBOARD_TOTAL_CACHE_TTL_MS) {
    return cached.result;
  }
  if (cached?.inFlight) {
    if (cached.result) {
      return cached.result;
    }
    return await cached.inFlight;
  }
  const entry = cached ?? {};
  const inFlight = buildDashboardSummaryBase({ range: "total" })
    .then((result) => {
      dashboardTotalCache = { result, updatedAt: Date.now() };
      return result;
    })
    .catch((error) => {
      if (entry.result) {
        return entry.result;
      }
      throw error;
    })
    .finally(() => {
      if (dashboardTotalCache?.inFlight === inFlight) {
        dashboardTotalCache = {
          result: dashboardTotalCache.result,
          updatedAt: dashboardTotalCache.updatedAt,
        };
      }
    });
  dashboardTotalCache = {
    result: entry.result,
    updatedAt: entry.updatedAt,
    inFlight,
  };
  if (entry.result) {
    return entry.result;
  }
  return await inFlight;
}

async function loadCostUsageSummaryCached(params: {
  startMs: number;
  endMs: number;
  config: ReturnType<typeof loadConfig>;
}): Promise<CostUsageSummary> {
  const cacheKey = `${params.startMs}-${params.endMs}`;
  const now = Date.now();
  const cached = costUsageCache.get(cacheKey);
  if (cached?.summary && cached.updatedAt && now - cached.updatedAt < COST_USAGE_CACHE_TTL_MS) {
    return cached.summary;
  }

  if (cached?.inFlight) {
    if (cached.summary) {
      return cached.summary;
    }
    return await cached.inFlight;
  }

  const entry: CostUsageCacheEntry = cached ?? {};
  const inFlight = loadCostUsageSummary({
    startMs: params.startMs,
    endMs: params.endMs,
    config: params.config,
  })
    .then((summary) => {
      costUsageCache.set(cacheKey, { summary, updatedAt: Date.now() });
      return summary;
    })
    .catch((err) => {
      if (entry.summary) {
        return entry.summary;
      }
      throw err;
    })
    .finally(() => {
      const current = costUsageCache.get(cacheKey);
      if (current?.inFlight === inFlight) {
        current.inFlight = undefined;
        costUsageCache.set(cacheKey, current);
      }
    });

  entry.inFlight = inFlight;
  costUsageCache.set(cacheKey, entry);

  if (entry.summary) {
    return entry.summary;
  }
  return await inFlight;
}

// Exposed for unit tests (kept as a single export to avoid widening the public API surface).
export const __test = {
  parseDateParts,
  parseUtcOffsetToMinutes,
  resolveDateInterpretation,
  parseDateToMs,
  getTodayStartMs,
  parseDays,
  parseDateRange,
  discoverAllSessionsForUsage,
  loadCostUsageSummaryCached,
  costUsageCache,
};

export type { SessionUsageEntry, SessionsUsageAggregates, SessionsUsageResult };

export const usageHandlers: GatewayRequestHandlers = {
  "usage.status": async ({ respond }) => {
    const summary = await loadProviderUsageSummary();
    respond(true, summary, undefined);
  },
  "dashboard.summary": async ({ respond, params, client }) => {
    if (!validateDashboardSummaryParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid dashboard.summary params: ${formatValidationErrors(validateDashboardSummaryParams.errors)}`,
        ),
      );
      return;
    }
    const dashboardParams = params as DashboardSummaryParams;
    const canSort = resolveDashboardCanSort(client);
    const result = cloneDashboardSummary(await loadDashboardSummaryCached(dashboardParams.range));
    if (canSort) {
      sortDashboardAgentUsage(result.agentUsage, dashboardParams.sortBy, dashboardParams.sortDir);
    }
    result.canSort = canSort;
    respond(true, result, undefined);
  },
  "usage.cost": async ({ respond, params }) => {
    const config = loadConfig();
    const { startMs, endMs } = parseDateRange({
      startDate: params?.startDate,
      endDate: params?.endDate,
      days: params?.days,
      mode: params?.mode,
      utcOffset: params?.utcOffset,
    });
    const summary = await loadCostUsageSummaryCached({ startMs, endMs, config });
    respond(true, summary, undefined);
  },
  "sessions.usage": async ({ respond, params }) => {
    if (!validateSessionsUsageParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid sessions.usage params: ${formatValidationErrors(validateSessionsUsageParams.errors)}`,
        ),
      );
      return;
    }

    const p = params;
    const config = loadConfig();
    const { startMs, endMs } = parseDateRange({
      startDate: p.startDate,
      endDate: p.endDate,
      mode: p.mode,
      utcOffset: p.utcOffset,
    });
    const limit = typeof p.limit === "number" && Number.isFinite(p.limit) ? p.limit : 50;
    const includeContextWeight = p.includeContextWeight ?? false;
    const specificKey = normalizeOptionalString(p.key) ?? null;

    // Load session store for named sessions
    const { storePath, store } = loadCombinedSessionStoreForGateway(config);
    const now = Date.now();

    // Merge discovered sessions with store entries
    type MergedEntry = {
      key: string;
      sessionId: string;
      sessionFile: string;
      label?: string;
      updatedAt: number;
      storeEntry?: SessionEntry;
      firstUserMessage?: string;
    };

    const mergedEntries: MergedEntry[] = [];

    // Optimization: If a specific key is requested, skip full directory scan
    if (specificKey) {
      const parsed = parseAgentSessionKey(specificKey);
      const agentIdFromKey = parsed?.agentId;
      const keyRest = parsed?.rest ?? specificKey;

      // Prefer the store entry when available, even if the caller provides a discovered key
      // (`agent:<id>:<sessionId>`) for a session that now has a canonical store key.
      const storeBySessionId = buildStoreBySessionId(store);

      const storeMatch = store[specificKey]
        ? { key: specificKey, entry: store[specificKey] }
        : null;
      const storeByIdMatch = storeBySessionId.get(keyRest) ?? null;
      const resolvedStoreKey = storeMatch?.key ?? storeByIdMatch?.key ?? specificKey;
      const storeEntry = storeMatch?.entry ?? storeByIdMatch?.entry;
      const sessionId = storeEntry?.sessionId ?? keyRest;

      // Resolve the session file path
      let sessionFile: string | undefined;
      try {
        const pathOpts = resolveSessionFilePathOptions({
          storePath: storePath !== "(multiple)" ? storePath : undefined,
          agentId: agentIdFromKey,
        });
        sessionFile = resolveExistingUsageSessionFile({
          sessionId,
          sessionEntry: storeEntry,
          sessionFile: resolveSessionFilePath(sessionId, storeEntry, pathOpts),
          agentId: agentIdFromKey,
        });
      } catch {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `Invalid session reference: ${specificKey}`),
        );
        return;
      }

      if (sessionFile) {
        try {
          const stats = fs.statSync(sessionFile);
          if (stats.isFile()) {
            mergedEntries.push({
              key: resolvedStoreKey,
              sessionId,
              sessionFile,
              label: storeEntry?.label,
              updatedAt: storeEntry?.updatedAt ?? stats.mtimeMs,
              storeEntry,
            });
          }
        } catch {
          // File doesn't exist - no results for this key
        }
      }
    } else {
      // Full discovery for list view
      const discoveredSessions = await discoverAllSessionsForUsage({
        config,
        startMs,
        endMs,
      });

      // Build a map of sessionId -> store entry for quick lookup
      const storeBySessionId = buildStoreBySessionId(store);

      for (const discovered of discoveredSessions) {
        const storeMatch = storeBySessionId.get(discovered.sessionId);
        if (storeMatch) {
          // Named session from store
          mergedEntries.push({
            key: storeMatch.key,
            sessionId: discovered.sessionId,
            sessionFile: discovered.sessionFile,
            label: storeMatch.entry.label,
            updatedAt: storeMatch.entry.updatedAt ?? discovered.mtime,
            storeEntry: storeMatch.entry,
          });
        } else {
          // Unnamed session - use session ID as key, no label
          mergedEntries.push({
            // Keep agentId in the key so the dashboard can attribute sessions and later fetch logs.
            key: `agent:${discovered.agentId}:${discovered.sessionId}`,
            sessionId: discovered.sessionId,
            sessionFile: discovered.sessionFile,
            label: undefined, // No label for unnamed sessions
            updatedAt: discovered.mtime,
          });
        }
      }
    }

    // Sort by most recent first
    mergedEntries.sort((a, b) => b.updatedAt - a.updatedAt);

    // Apply limit
    const limitedEntries = mergedEntries.slice(0, limit);

    // Load usage for each session
    const sessions: SessionUsageEntry[] = [];
    const aggregateTotals = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    };
    const aggregateMessages: SessionMessageCounts = {
      total: 0,
      user: 0,
      assistant: 0,
      toolCalls: 0,
      toolResults: 0,
      errors: 0,
    };
    const toolAggregateMap = new Map<string, number>();
    const byModelMap = new Map<string, SessionModelUsage>();
    const byProviderMap = new Map<string, SessionModelUsage>();
    const byAgentMap = new Map<string, CostUsageSummary["totals"]>();
    const byChannelMap = new Map<string, CostUsageSummary["totals"]>();
    const dailyAggregateMap = new Map<
      string,
      {
        date: string;
        tokens: number;
        cost: number;
        messages: number;
        toolCalls: number;
        errors: number;
      }
    >();
    const latencyTotals = {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: 0,
      p95Max: 0,
    };
    const dailyLatencyMap = new Map<
      string,
      { date: string; count: number; sum: number; min: number; max: number; p95Max: number }
    >();
    const modelDailyMap = new Map<string, SessionDailyModelUsage>();

    const emptyTotals = (): CostUsageSummary["totals"] => ({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      missingCostEntries: 0,
    });
    const mergeTotals = (
      target: CostUsageSummary["totals"],
      source: CostUsageSummary["totals"],
    ) => {
      target.input += source.input;
      target.output += source.output;
      target.cacheRead += source.cacheRead;
      target.cacheWrite += source.cacheWrite;
      target.totalTokens += source.totalTokens;
      target.totalCost += source.totalCost;
      target.inputCost += source.inputCost;
      target.outputCost += source.outputCost;
      target.cacheReadCost += source.cacheReadCost;
      target.cacheWriteCost += source.cacheWriteCost;
      target.missingCostEntries += source.missingCostEntries;
    };

    for (const merged of limitedEntries) {
      const agentId = parseAgentSessionKey(merged.key)?.agentId;
      const usage = await loadSessionCostSummary({
        sessionId: merged.sessionId,
        sessionEntry: merged.storeEntry,
        sessionFile: merged.sessionFile,
        config,
        agentId,
        startMs,
        endMs,
      });

      if (usage) {
        aggregateTotals.input += usage.input;
        aggregateTotals.output += usage.output;
        aggregateTotals.cacheRead += usage.cacheRead;
        aggregateTotals.cacheWrite += usage.cacheWrite;
        aggregateTotals.totalTokens += usage.totalTokens;
        aggregateTotals.totalCost += usage.totalCost;
        aggregateTotals.inputCost += usage.inputCost;
        aggregateTotals.outputCost += usage.outputCost;
        aggregateTotals.cacheReadCost += usage.cacheReadCost;
        aggregateTotals.cacheWriteCost += usage.cacheWriteCost;
        aggregateTotals.missingCostEntries += usage.missingCostEntries;
      }

      const channel = merged.storeEntry?.channel ?? merged.storeEntry?.origin?.provider;
      const chatType = merged.storeEntry?.chatType ?? merged.storeEntry?.origin?.chatType;

      if (usage) {
        if (usage.messageCounts) {
          aggregateMessages.total += usage.messageCounts.total;
          aggregateMessages.user += usage.messageCounts.user;
          aggregateMessages.assistant += usage.messageCounts.assistant;
          aggregateMessages.toolCalls += usage.messageCounts.toolCalls;
          aggregateMessages.toolResults += usage.messageCounts.toolResults;
          aggregateMessages.errors += usage.messageCounts.errors;
        }

        if (usage.toolUsage) {
          for (const tool of usage.toolUsage.tools) {
            toolAggregateMap.set(tool.name, (toolAggregateMap.get(tool.name) ?? 0) + tool.count);
          }
        }

        if (usage.modelUsage) {
          for (const entry of usage.modelUsage) {
            const modelKey = `${entry.provider ?? "unknown"}::${entry.model ?? "unknown"}`;
            const modelExisting =
              byModelMap.get(modelKey) ??
              ({
                provider: entry.provider,
                model: entry.model,
                count: 0,
                totals: emptyTotals(),
              } as SessionModelUsage);
            modelExisting.count += entry.count;
            mergeTotals(modelExisting.totals, entry.totals);
            byModelMap.set(modelKey, modelExisting);

            const providerKey = entry.provider ?? "unknown";
            const providerExisting =
              byProviderMap.get(providerKey) ??
              ({
                provider: entry.provider,
                model: undefined,
                count: 0,
                totals: emptyTotals(),
              } as SessionModelUsage);
            providerExisting.count += entry.count;
            mergeTotals(providerExisting.totals, entry.totals);
            byProviderMap.set(providerKey, providerExisting);
          }
        }

        mergeUsageLatency(latencyTotals, usage.latency);
        mergeUsageDailyLatency(dailyLatencyMap, usage.dailyLatency);

        if (usage.dailyModelUsage) {
          for (const entry of usage.dailyModelUsage) {
            const key = `${entry.date}::${entry.provider ?? "unknown"}::${entry.model ?? "unknown"}`;
            const existing =
              modelDailyMap.get(key) ??
              ({
                date: entry.date,
                provider: entry.provider,
                model: entry.model,
                tokens: 0,
                cost: 0,
                count: 0,
              } as SessionDailyModelUsage);
            existing.tokens += entry.tokens;
            existing.cost += entry.cost;
            existing.count += entry.count;
            modelDailyMap.set(key, existing);
          }
        }

        if (agentId) {
          const agentTotals = byAgentMap.get(agentId) ?? emptyTotals();
          mergeTotals(agentTotals, usage);
          byAgentMap.set(agentId, agentTotals);
        }

        if (channel) {
          const channelTotals = byChannelMap.get(channel) ?? emptyTotals();
          mergeTotals(channelTotals, usage);
          byChannelMap.set(channel, channelTotals);
        }

        if (usage.dailyBreakdown) {
          for (const day of usage.dailyBreakdown) {
            const daily = dailyAggregateMap.get(day.date) ?? {
              date: day.date,
              tokens: 0,
              cost: 0,
              messages: 0,
              toolCalls: 0,
              errors: 0,
            };
            daily.tokens += day.tokens;
            daily.cost += day.cost;
            dailyAggregateMap.set(day.date, daily);
          }
        }

        if (usage.dailyMessageCounts) {
          for (const day of usage.dailyMessageCounts) {
            const daily = dailyAggregateMap.get(day.date) ?? {
              date: day.date,
              tokens: 0,
              cost: 0,
              messages: 0,
              toolCalls: 0,
              errors: 0,
            };
            daily.messages += day.total;
            daily.toolCalls += day.toolCalls;
            daily.errors += day.errors;
            dailyAggregateMap.set(day.date, daily);
          }
        }
      }

      sessions.push({
        key: merged.key,
        label: merged.label,
        sessionId: merged.sessionId,
        updatedAt: merged.updatedAt,
        agentId,
        channel,
        chatType,
        origin: merged.storeEntry?.origin,
        modelOverride: merged.storeEntry?.modelOverride,
        providerOverride: merged.storeEntry?.providerOverride,
        modelProvider: merged.storeEntry?.modelProvider,
        model: merged.storeEntry?.model,
        usage,
        contextWeight: includeContextWeight
          ? (merged.storeEntry?.systemPromptReport ?? null)
          : undefined,
      });
    }

    // Format dates back to YYYY-MM-DD strings
    const formatDateStr = (ms: number) => {
      const d = new Date(ms);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    const tail = buildUsageAggregateTail({
      byChannelMap: byChannelMap,
      latencyTotals,
      dailyLatencyMap,
      modelDailyMap,
      dailyMap: dailyAggregateMap,
    });

    const aggregates: SessionsUsageAggregates = {
      messages: aggregateMessages,
      tools: {
        totalCalls: Array.from(toolAggregateMap.values()).reduce((sum, count) => sum + count, 0),
        uniqueTools: toolAggregateMap.size,
        tools: Array.from(toolAggregateMap.entries())
          .map(([name, count]) => ({ name, count }))
          .toSorted((a, b) => b.count - a.count),
      },
      byModel: Array.from(byModelMap.values()).toSorted((a, b) => {
        const costDiff = (b.totals?.totalCost ?? 0) - (a.totals?.totalCost ?? 0);
        if (costDiff !== 0) {
          return costDiff;
        }
        return (b.totals?.totalTokens ?? 0) - (a.totals?.totalTokens ?? 0);
      }),
      byProvider: Array.from(byProviderMap.values()).toSorted((a, b) => {
        const costDiff = (b.totals?.totalCost ?? 0) - (a.totals?.totalCost ?? 0);
        if (costDiff !== 0) {
          return costDiff;
        }
        return (b.totals?.totalTokens ?? 0) - (a.totals?.totalTokens ?? 0);
      }),
      byAgent: Array.from(byAgentMap.entries())
        .map(([id, totals]) => ({ agentId: id, totals }))
        .toSorted((a, b) => (b.totals?.totalCost ?? 0) - (a.totals?.totalCost ?? 0)),
      ...tail,
    };

    const result: SessionsUsageResult = {
      updatedAt: now,
      startDate: formatDateStr(startMs),
      endDate: formatDateStr(endMs),
      sessions,
      totals: aggregateTotals,
      aggregates,
    };

    respond(true, result, undefined);
  },
  "sessions.usage.timeseries": async ({ respond, params }) => {
    const key = normalizeOptionalString(params?.key) ?? null;
    if (!key) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "key is required for timeseries"),
      );
      return;
    }

    const resolved = resolveSessionUsageFileOrRespond(key, respond);
    if (!resolved) {
      return;
    }
    const { config, entry, agentId, sessionId, sessionFile } = resolved;

    const timeseries = await loadSessionUsageTimeSeries({
      sessionId,
      sessionEntry: entry,
      sessionFile,
      config,
      agentId,
      maxPoints: 200,
    });

    if (!timeseries) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `No transcript found for session: ${key}`),
      );
      return;
    }

    respond(true, timeseries, undefined);
  },
  "sessions.usage.logs": async ({ respond, params }) => {
    const key = normalizeOptionalString(params?.key) ?? null;
    if (!key) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "key is required for logs"));
      return;
    }

    const limit =
      typeof params?.limit === "number" && Number.isFinite(params.limit)
        ? Math.min(params.limit, 1000)
        : 200;

    const resolved = resolveSessionUsageFileOrRespond(key, respond);
    if (!resolved) {
      return;
    }
    const { config, entry, agentId, sessionId, sessionFile } = resolved;

    const { loadSessionLogs } = await import("../../infra/session-cost-usage.js");
    const logs = await loadSessionLogs({
      sessionId,
      sessionEntry: entry,
      sessionFile,
      config,
      agentId,
      limit,
    });

    respond(true, { logs: logs ?? [] }, undefined);
  },
};
