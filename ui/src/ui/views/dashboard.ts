import { html, nothing } from "lit";
import type {
  DashboardAgentUsageRow,
  DashboardRange,
  DashboardSortBy,
  DashboardSortDir,
  DashboardSummaryResult,
  DashboardTimePoint,
} from "../types.ts";

type DashboardViewProps = {
  loading: boolean;
  error: string | null;
  range: DashboardRange;
  result: DashboardSummaryResult | null;
  dashboardSortBy: DashboardSortBy;
  dashboardSortDir: DashboardSortDir;
  onRangeChange: (range: DashboardRange) => void;
  onRefresh: () => void;
  onSortChange: (sortBy: DashboardSortBy, sortDir: DashboardSortDir) => void;
};

const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "total", label: "Total" },
];

const RANGE_CAPTIONS: Record<DashboardRange, string> = {
  today: "Selected period · Today",
  "7d": "Selected period · Last 7 days",
  "30d": "Selected period · Last 30 days",
  total: "Selected period · All time",
};

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

function formatFullNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "—";
  }
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatLastUpdated(value: number): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return "—";
  }
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function trendTitleForRange(range: DashboardRange): string {
  switch (range) {
    case "today":
      return "Daily Token Usage · Today";
    case "7d":
      return "Daily Token Usage · Last 7 Days";
    case "30d":
      return "Daily Token Usage · Last 30 Days";
    case "total":
    default:
      return "Daily Token Usage · All Time";
  }
}

function pointLabel(
  point: DashboardTimePoint,
  range: DashboardRange,
): {
  primary: string;
  secondary?: string;
} {
  if (!point.start) {
    return { primary: point.label };
  }
  const parsed = new Date(point.start);
  if (Number.isNaN(parsed.valueOf())) {
    return { primary: point.label };
  }
  if (range === "today") {
    return { primary: point.label };
  }
  if (range === "7d") {
    return {
      primary: point.label,
      secondary: parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  }
  if (range === "30d") {
    return {
      primary: parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
  }
  return {
    primary: point.label,
  };
}

function shouldRenderChartLabel(range: DashboardRange, index: number, total: number): boolean {
  if (range === "7d") {
    return true;
  }
  if (range === "today") {
    return index % 3 === 0 || index === total - 1;
  }
  if (range === "30d") {
    return index === 0 || index === total - 1 || index % 5 === 0;
  }
  return total <= 8 || index === 0 || index === total - 1 || index % 2 === 0;
}

function trendSubtitleForRange(range: DashboardRange, sessions: number): string {
  const periodLabel = range === "today" ? "hour" : range === "total" ? "period" : "day";
  return `Token trend by ${periodLabel} · ${formatCompactNumber(sessions)} active ${sessions === 1 ? "session" : "sessions"}`;
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  if (parts.length === 1) {
    return (parts[0] ?? "").slice(0, 2).toUpperCase();
  }
  const first = parts[0] ?? "";
  const second = parts[1] ?? "";
  return `${first[0] ?? ""}${second[0] ?? ""}`.toUpperCase();
}

function buildSparklinePoints(values: number[]): string {
  if (values.length === 0) {
    return "";
  }
  const width = 100;
  const height = 24;
  const padding = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (values.length === 1) {
    return `0,${height / 2} ${width},${height / 2}`;
  }

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y =
        range === 0 ? height / 2 : padding + ((max - value) / range) * (height - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function sortIndicator(canSort: boolean, active: boolean, dir: DashboardSortDir) {
  if (!canSort) {
    return nothing;
  }
  return html`
    <span class="dashboard-table__sort ${active ? "dashboard-table__sort--active" : ""}">
      ${dir === "asc" ? "↑" : "↓"}
    </span>
  `;
}

function renderRangeFilters(props: DashboardViewProps) {
  return html`
    <div class="dashboard-range-filter" role="tablist" aria-label="Dashboard range">
      ${RANGE_OPTIONS.map(
        (option) => html`
          <button
            class="dashboard-range-filter__chip ${props.range === option.value
              ? "dashboard-range-filter__chip--active"
              : ""}"
            type="button"
            @click=${() => props.onRangeChange(option.value)}
          >
            ${option.label}
          </button>
        `,
      )}
    </div>
  `;
}

function renderUsageOverviewCard(props: DashboardViewProps, result: DashboardSummaryResult) {
  const points = result.timeSeries;
  const tokenPoints = buildSparklinePoints(points.map((point) => point.totalTokens));
  const apiCallPoints = buildSparklinePoints(points.map((point) => point.apiCalls));
  const tokenPeakPoint = points.reduce<DashboardTimePoint | null>((best, point) => {
    if (!best || point.totalTokens > best.totalTokens) {
      return point;
    }
    return best;
  }, null);
  const apiPeakPoint = points.reduce<DashboardTimePoint | null>((best, point) => {
    if (!best || point.apiCalls > best.apiCalls) {
      return point;
    }
    return best;
  }, null);
  const tokenPeakLabel = tokenPeakPoint ? pointLabel(tokenPeakPoint, props.range) : null;
  const apiPeakLabel = apiPeakPoint ? pointLabel(apiPeakPoint, props.range) : null;
  return html`
    <article class="card dashboard-overview-card">
      <div class="dashboard-overview-card__top">
        <div class="dashboard-overview-card__copy">
          <h2 class="dashboard-overview-card__title">Usage Overview</h2>
          <p class="dashboard-overview-card__sub">
            Employee, agent, and part usage across the workspace.
          </p>
        </div>
        <div class="dashboard-overview-card__controls">
          <div class="dashboard-overview-card__updated">
            Last updated: ${formatLastUpdated(result.generatedAt)}
          </div>
          ${renderRangeFilters(props)}
          <button
            class="btn btn--sm"
            type="button"
            ?disabled=${props.loading}
            @click=${props.onRefresh}
          >
            ${props.loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      <div class="dashboard-overview-card__body">
        <section class="dashboard-period-panel">
          <div class="dashboard-period-panel__label">This period</div>
          <div class="dashboard-period-panel__value">
            ${formatCompactNumber(result.summary.totalTokens)} tokens
          </div>
          <div class="dashboard-period-panel__meta">
            <span>${formatCompactNumber(result.summary.sessions)} sessions</span>
            <span>${formatCompactNumber(result.summary.activeAgents)} active agents</span>
            <span>${formatCompactNumber(result.summary.apiCalls)} API calls</span>
          </div>
          <div class="dashboard-sparkline-list" aria-hidden="true">
            <div class="dashboard-sparkline-row">
              <span class="dashboard-sparkline-row__label">Token usage</span>
              <svg
                class="dashboard-sparkline-row__svg"
                viewBox="0 0 100 24"
                preserveAspectRatio="none"
              >
                <polyline
                  class="dashboard-sparkline-row__line dashboard-sparkline-row__line--tokens"
                  points=${tokenPoints}
                ></polyline>
              </svg>
            </div>
            <div class="dashboard-sparkline-row">
              <span class="dashboard-sparkline-row__label">API calls</span>
              <svg
                class="dashboard-sparkline-row__svg"
                viewBox="0 0 100 24"
                preserveAspectRatio="none"
              >
                <polyline
                  class="dashboard-sparkline-row__line dashboard-sparkline-row__line--calls"
                  points=${apiCallPoints}
                ></polyline>
              </svg>
            </div>
          </div>
        </section>
        <section class="dashboard-peak-panel">
          <div class="dashboard-peak-panel__label">Usage peak</div>
          <div class="dashboard-peak-panel__group">
            <div class="dashboard-peak-panel__group-label">Token usage peak</div>
            <div class="dashboard-peak-panel__value">
              ${tokenPeakLabel
                ? `${tokenPeakLabel.primary}${tokenPeakLabel.secondary ? ` ${tokenPeakLabel.secondary}` : ""}`
                : "—"}
            </div>
            <div class="dashboard-peak-panel__tokens">
              ${tokenPeakPoint
                ? `${formatCompactNumber(tokenPeakPoint.totalTokens)} tokens`
                : "No usage in range"}
            </div>
          </div>
          <div class="dashboard-peak-panel__group">
            <div class="dashboard-peak-panel__group-label">API calls peak</div>
            <div class="dashboard-peak-panel__value">
              ${apiPeakLabel
                ? `${apiPeakLabel.primary}${apiPeakLabel.secondary ? ` ${apiPeakLabel.secondary}` : ""}`
                : "—"}
            </div>
            <div class="dashboard-peak-panel__tokens">
              ${apiPeakPoint
                ? `${formatCompactNumber(apiPeakPoint.apiCalls)} calls`
                : "No usage in range"}
            </div>
          </div>
        </section>
      </div>
    </article>
  `;
}

function renderOverviewCards(result: DashboardSummaryResult, range: DashboardRange) {
  const cards = [
    { label: "Active Agents", value: result.summary.activeAgents },
    { label: "Sessions", value: result.summary.sessions },
    { label: "API Calls", value: result.summary.apiCalls },
    { label: "Total Tokens", value: result.summary.totalTokens },
  ];
  return html`
    <section class="dashboard-kpis">
      ${cards.map(
        (card) => html`
          <article class="card dashboard-kpi-card">
            <div class="dashboard-kpi-card__label">${card.label}</div>
            <div class="dashboard-kpi-card__value">${formatCompactNumber(card.value)}</div>
            <div class="dashboard-kpi-card__caption">${RANGE_CAPTIONS[range]}</div>
          </article>
        `,
      )}
    </section>
  `;
}

function renderTrendCard(range: DashboardRange, points: DashboardTimePoint[], sessions: number) {
  const maxTokens = Math.max(...points.map((point) => point.totalTokens), 0);
  const hasUsage = maxTokens > 0;
  const totalTokens = points.reduce((sum, point) => sum + point.totalTokens, 0);
  return html`
    <article class="dashboard-trend-card">
      <div class="dashboard-trend-card__header">
        <div>
          <div class="dashboard-trend-card__title">${trendTitleForRange(range)}</div>
          <div class="dashboard-trend-card__metric">${formatCompactNumber(totalTokens)}</div>
          <div class="dashboard-trend-card__subtitle">
            ${trendSubtitleForRange(range, sessions)}
          </div>
        </div>
      </div>
      ${hasUsage
        ? html`
            <div class="dashboard-chart">
              ${points.map((point, index) => {
                const height =
                  point.totalTokens > 0 ? Math.max((point.totalTokens / maxTokens) * 100, 14) : 3;
                const label = pointLabel(point, range);
                const showLabel = shouldRenderChartLabel(range, index, points.length);
                return html`
                  <div
                    class="dashboard-chart__bar-wrap"
                    title=${`${label.primary}${label.secondary ? ` ${label.secondary}` : ""}: ${formatFullNumber(point.totalTokens)} tokens`}
                  >
                    <div class="dashboard-chart__bar-track">
                      <div
                        class="dashboard-chart__bar ${point.totalTokens > 0
                          ? "dashboard-chart__bar--active"
                          : "dashboard-chart__bar--idle"}"
                        style=${`height:${height}%;`}
                      ></div>
                    </div>
                    <div class="dashboard-chart__label">
                      <span class="dashboard-chart__label-main"
                        >${showLabel ? label.primary : ""}</span
                      >
                      ${showLabel && label.secondary
                        ? html`<span class="dashboard-chart__label-sub">${label.secondary}</span>`
                        : nothing}
                    </div>
                  </div>
                `;
              })}
            </div>
          `
        : html`
            <div class="dashboard-chart dashboard-chart--empty">
              <div class="dashboard-chart__empty">No token activity in this period.</div>
            </div>
          `}
    </article>
  `;
}

function renderPartUsageCard(result: DashboardSummaryResult) {
  const hasUnassigned = result.partUsage.some((row) => row.part === "Unassigned");
  const totalPartTokens = result.partUsage.reduce((sum, row) => sum + row.totalTokens, 0);
  const totalPartAgents = result.partUsage.reduce((sum, row) => sum + row.activeAgents, 0);
  return html`
    <article class="card dashboard-part-card">
      <div class="dashboard-section-head">
        <div>
          <div class="dashboard-section-head__title">Part Usage</div>
          <div class="dashboard-section-head__subtitle">Organization-wide usage by part</div>
        </div>
      </div>
      <div class="dashboard-part-summary">
        <div class="dashboard-part-summary__item">
          <span class="dashboard-part-summary__label">Parts</span>
          <span class="dashboard-part-summary__value"
            >${formatCompactNumber(result.partUsage.length)}</span
          >
        </div>
        <div class="dashboard-part-summary__item">
          <span class="dashboard-part-summary__label">Active Agents</span>
          <span class="dashboard-part-summary__value">${formatCompactNumber(totalPartAgents)}</span>
        </div>
        <div class="dashboard-part-summary__item">
          <span class="dashboard-part-summary__label">Total Tokens</span>
          <span class="dashboard-part-summary__value">${formatCompactNumber(totalPartTokens)}</span>
        </div>
      </div>
      <div class="dashboard-part-list">
        ${result.partUsage.length > 0
          ? result.partUsage.map(
              (row) => html`
                <div class="dashboard-part-row">
                  <div class="dashboard-part-row__head">
                    <div>
                      <div class="dashboard-part-row__name">${row.part}</div>
                      <div class="dashboard-part-row__meta">
                        ${formatCompactNumber(row.activeAgents)} active agents ·
                        ${formatCompactNumber(row.sessions)} sessions
                      </div>
                    </div>
                    <div class="dashboard-part-row__value">
                      ${formatCompactNumber(row.totalTokens)} tokens
                    </div>
                  </div>
                  <div class="dashboard-part-row__bar">
                    <div
                      class="dashboard-part-row__bar-fill"
                      style=${`width:${Math.max(row.share * 100, row.share > 0 ? 4 : 0)}%`}
                    ></div>
                  </div>
                  <div class="dashboard-part-row__stats">
                    <span class="dashboard-metric-pill"
                      >${formatCompactNumber(row.totalTokens)} tokens</span
                    >
                    <span class="dashboard-metric-pill"
                      >${formatCompactNumber(row.apiCalls)} calls</span
                    >
                    <span class="dashboard-metric-pill"
                      >${formatCompactNumber(row.sessions)} sessions</span
                    >
                    <span class="dashboard-metric-pill">${formatPercentage(row.share)} share</span>
                  </div>
                </div>
              `,
            )
          : html`<div class="dashboard-empty-inline">No part usage data available.</div>`}
      </div>
      ${result.partUsage.length === 1
        ? html`
            <div class="dashboard-part-note">Only 1 part has usage in the selected period.</div>
          `
        : nothing}
      ${hasUnassigned
        ? html`
            <div class="dashboard-part-note">
              Part metadata is not available for some users, so usage is grouped as Unassigned.
            </div>
          `
        : nothing}
    </article>
  `;
}

function renderAgentUsageTable(props: DashboardViewProps, rows: DashboardAgentUsageRow[]) {
  const canSort = Boolean(props.result?.canSort);
  const sortBy = props.dashboardSortBy;
  const sortDir = props.dashboardSortDir;
  return html`
    <article class="card dashboard-table-card">
      <div class="dashboard-section-head">
        <div>
          <div class="dashboard-section-head__title">직원 / Agent별 사용량</div>
        </div>
        <span class="dashboard-section-head__badge">Usage</span>
      </div>
      <div class="dashboard-table-wrap">
        <table class="dashboard-table">
          <colgroup>
            <col class="dashboard-table__col dashboard-table__col--rank" />
            <col class="dashboard-table__col dashboard-table__col--name" />
            <col class="dashboard-table__col dashboard-table__col--part" />
            <col class="dashboard-table__col dashboard-table__col--agent" />
            <col class="dashboard-table__col dashboard-table__col--sessions" />
            <col class="dashboard-table__col dashboard-table__col--calls" />
            <col class="dashboard-table__col dashboard-table__col--tokens" />
            <col class="dashboard-table__col dashboard-table__col--last-used" />
          </colgroup>
          <thead>
            <tr>
              <th class="dashboard-table__col--rank">NO.</th>
              <th class="dashboard-table__col--name">
                ${canSort
                  ? html`
                      <button
                        class="dashboard-table__sort-btn"
                        type="button"
                        @click=${() =>
                          props.onSortChange(
                            "name",
                            sortBy === "name" && sortDir === "desc" ? "asc" : "desc",
                          )}
                      >
                        <span>Name</span>
                        ${sortIndicator(canSort, sortBy === "name", sortDir)}
                      </button>
                    `
                  : "Name"}
              </th>
              <th class="dashboard-table__col--part">
                ${canSort
                  ? html`
                      <button
                        class="dashboard-table__sort-btn"
                        type="button"
                        @click=${() =>
                          props.onSortChange(
                            "part",
                            sortBy === "part" && sortDir === "desc" ? "asc" : "desc",
                          )}
                      >
                        <span>Part</span>
                        ${sortIndicator(canSort, sortBy === "part", sortDir)}
                      </button>
                    `
                  : "Part"}
              </th>
              <th class="dashboard-table__col--agent">
                ${canSort
                  ? html`
                      <button
                        class="dashboard-table__sort-btn"
                        type="button"
                        @click=${() =>
                          props.onSortChange(
                            "agent",
                            sortBy === "agent" && sortDir === "desc" ? "asc" : "desc",
                          )}
                      >
                        <span>Agent</span>
                        ${sortIndicator(canSort, sortBy === "agent", sortDir)}
                      </button>
                    `
                  : "Agent"}
              </th>
              <th class="dashboard-table__col--sessions dashboard-table__num">
                ${canSort
                  ? html`
                      <button
                        class="dashboard-table__sort-btn dashboard-table__sort-btn--num"
                        type="button"
                        @click=${() =>
                          props.onSortChange(
                            "sessions",
                            sortBy === "sessions" && sortDir === "desc" ? "asc" : "desc",
                          )}
                      >
                        <span>Sessions</span>
                        ${sortIndicator(canSort, sortBy === "sessions", sortDir)}
                      </button>
                    `
                  : "Sessions"}
              </th>
              <th class="dashboard-table__col--calls dashboard-table__num">
                ${canSort
                  ? html`
                      <button
                        class="dashboard-table__sort-btn dashboard-table__sort-btn--num"
                        type="button"
                        @click=${() =>
                          props.onSortChange(
                            "apiCalls",
                            sortBy === "apiCalls" && sortDir === "desc" ? "asc" : "desc",
                          )}
                      >
                        <span>API Calls</span>
                        ${sortIndicator(canSort, sortBy === "apiCalls", sortDir)}
                      </button>
                    `
                  : "API Calls"}
              </th>
              <th class="dashboard-table__col--tokens dashboard-table__num">
                ${canSort
                  ? html`
                      <button
                        class="dashboard-table__sort-btn dashboard-table__sort-btn--num"
                        type="button"
                        @click=${() =>
                          props.onSortChange(
                            "totalTokens",
                            sortBy === "totalTokens" && sortDir === "desc" ? "asc" : "desc",
                          )}
                      >
                        <span>Total Tokens</span>
                        ${sortIndicator(canSort, sortBy === "totalTokens", sortDir)}
                      </button>
                    `
                  : "Total Tokens"}
              </th>
              <th class="dashboard-table__col--last-used">
                ${canSort
                  ? html`
                      <button
                        class="dashboard-table__sort-btn"
                        type="button"
                        @click=${() =>
                          props.onSortChange(
                            "lastUsedAt",
                            sortBy === "lastUsedAt" && sortDir === "desc" ? "asc" : "desc",
                          )}
                      >
                        <span>Last Used</span>
                        ${sortIndicator(canSort, sortBy === "lastUsedAt", sortDir)}
                      </button>
                    `
                  : "Last Used"}
              </th>
            </tr>
          </thead>
          <tbody>
            ${rows.length > 0
              ? rows.map(
                  (row, index) => html`
                    <tr>
                      <td class="dashboard-table__col--rank">
                        <span class="dashboard-table__rank">${index + 1}</span>
                      </td>
                      <td class="dashboard-table__col--name">
                        <div class="dashboard-table__name-cell">
                          <span class="dashboard-table__avatar">${initialsForName(row.name)}</span>
                          <span class="dashboard-table__name-block">
                            <span class="dashboard-table__name">${row.name}</span>
                            <span class="dashboard-table__subname">
                              ${row.part === "Unassigned"
                                ? "Part metadata unavailable"
                                : `${row.part} part`}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td class="dashboard-table__col--part">
                        <span class="dashboard-tag">${row.part}</span>
                      </td>
                      <td class="dashboard-table__col--agent">
                        <span class="dashboard-tag dashboard-tag--agent">
                          <span class="dashboard-tag__dot"></span>
                          ${row.agentName}
                        </span>
                      </td>
                      <td class="dashboard-table__col--sessions dashboard-table__num">
                        ${formatCompactNumber(row.sessions)}
                      </td>
                      <td class="dashboard-table__col--calls dashboard-table__num">
                        ${formatCompactNumber(row.apiCalls)}
                      </td>
                      <td class="dashboard-table__col--tokens dashboard-table__num">
                        ${formatCompactNumber(row.totalTokens)}
                      </td>
                      <td class="dashboard-table__col--last-used dashboard-table__muted">
                        ${formatDateTime(row.lastUsedAt)}
                      </td>
                    </tr>
                  `,
                )
              : html`
                  <tr>
                    <td colspan="8" class="dashboard-table__empty">No usage data available.</td>
                  </tr>
                `}
          </tbody>
        </table>
      </div>
      ${rows.length === 1
        ? html`
            <div class="dashboard-table-note">Only 1 agent has usage in the selected period.</div>
          `
        : nothing}
    </article>
  `;
}

export function renderDashboard(props: DashboardViewProps) {
  const result = props.result;
  return html`
    <section class="dashboard-page">
      ${props.error
        ? html`<div class="card dashboard-state-card dashboard-state-card--error">
            ${props.error}
          </div>`
        : nothing}
      ${props.loading && !result
        ? html`<div class="card dashboard-state-card">Loading dashboard data…</div>`
        : nothing}
      ${result
        ? html`
            <div class="dashboard-top-grid">
              ${renderUsageOverviewCard(props, result)}
              ${renderTrendCard(props.range, result.timeSeries, result.summary.sessions)}
            </div>
            ${renderOverviewCards(result, props.range)}
            <div class="dashboard-detail-grid">
              ${renderAgentUsageTable(props, result.agentUsage)} ${renderPartUsageCard(result)}
            </div>
          `
        : !props.loading
          ? html`<div class="card dashboard-state-card">No dashboard data available yet.</div>`
          : nothing}
    </section>
  `;
}
