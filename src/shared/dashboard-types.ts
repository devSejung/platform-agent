export type DashboardRange = "today" | "7d" | "30d" | "total";

export type DashboardSortBy =
  | "name"
  | "part"
  | "agent"
  | "sessions"
  | "apiCalls"
  | "totalTokens"
  | "lastUsedAt";

export type DashboardSortDir = "asc" | "desc";

export type DashboardSummary = {
  activeAgents: number;
  sessions: number;
  apiCalls: number;
  totalTokens: number;
};

export type DashboardTimePoint = {
  label: string;
  start?: string;
  end?: string;
  apiCalls: number;
  totalTokens: number;
  sessions: number;
};

export type DashboardAgentUsageRow = {
  accountId?: string;
  name: string;
  part: string;
  agentId: string;
  agentName: string;
  sessions: number;
  apiCalls: number;
  totalTokens: number;
  lastUsedAt: string | null;
};

export type DashboardPartUsageRow = {
  part: string;
  activeAgents: number;
  sessions: number;
  apiCalls: number;
  totalTokens: number;
  share: number;
};

export type DashboardSummaryParams = {
  range: DashboardRange;
  sortBy?: DashboardSortBy;
  sortDir?: DashboardSortDir;
};

export type DashboardSummaryResult = {
  canSort: boolean;
  range: DashboardRange;
  generatedAt: number;
  summary: DashboardSummary;
  timeSeries: DashboardTimePoint[];
  agentUsage: DashboardAgentUsageRow[];
  partUsage: DashboardPartUsageRow[];
};
