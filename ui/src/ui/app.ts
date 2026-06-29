import { LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type {
  EmployeeUiAccountSummary,
  EmployeeUiLoginNotice,
} from "../../../src/gateway/employee-ui-contract.ts";
import type { PlatformClawReleaseIndex } from "../../../src/platformclaw-release.ts";
import { i18n, I18nController, isSupportedLocale } from "../i18n/index.ts";
import {
  handleChannelConfigReload as handleChannelConfigReloadInternal,
  handleChannelConfigSave as handleChannelConfigSaveInternal,
  handleNostrProfileCancel as handleNostrProfileCancelInternal,
  handleNostrProfileEdit as handleNostrProfileEditInternal,
  handleNostrProfileFieldChange as handleNostrProfileFieldChangeInternal,
  handleNostrProfileImport as handleNostrProfileImportInternal,
  handleNostrProfileSave as handleNostrProfileSaveInternal,
  handleNostrProfileToggleAdvanced as handleNostrProfileToggleAdvancedInternal,
  handleWhatsAppLogout as handleWhatsAppLogoutInternal,
  handleWhatsAppStart as handleWhatsAppStartInternal,
  handleWhatsAppWait as handleWhatsAppWaitInternal,
} from "./app-channels.ts";
import {
  handleAbortChat as handleAbortChatInternal,
  handleSendChat as handleSendChatInternal,
  removeQueuedMessage as removeQueuedMessageInternal,
  retryFailedChatMessage as retryFailedChatMessageInternal,
} from "./app-chat.ts";
import { DEFAULT_CRON_FORM, DEFAULT_LOG_LEVEL_FILTERS } from "./app-defaults.ts";
import type { EventLogEntry } from "./app-events.ts";
import { connectGateway as connectGatewayInternal } from "./app-gateway.ts";
import {
  handleConnected,
  handleDisconnected,
  handleFirstUpdated,
  handleUpdated,
} from "./app-lifecycle.ts";
import { renderApp } from "./app-render.ts";
import {
  exportLogs as exportLogsInternal,
  handleChatScroll as handleChatScrollInternal,
  handleLogsScroll as handleLogsScrollInternal,
  resetChatScroll as resetChatScrollInternal,
  scheduleChatScroll as scheduleChatScrollInternal,
} from "./app-scroll.ts";
import {
  applySettings as applySettingsInternal,
  loadCron as loadCronInternal,
  loadOverview as loadOverviewInternal,
  setTab as setTabInternal,
  setTheme as setThemeInternal,
  setThemeMode as setThemeModeInternal,
  onPopState as onPopStateInternal,
} from "./app-settings.ts";
import {
  resetToolStream as resetToolStreamInternal,
  type ToolStreamEntry,
  type CompactionStatus,
  type FallbackStatus,
  type RunPhaseStatus,
} from "./app-tool-stream.ts";
import type { AppViewState } from "./app-view-state.ts";
import { normalizeAssistantIdentity } from "./assistant-identity.ts";
import type { ArtifactFocusItem } from "./chat/artifact-focus-viewer.ts";
import { exportChatMarkdown } from "./chat/export.ts";
import type { AccountDirectoryEntry } from "./controllers/accounts.ts";
import type { AdminAccountDetail, AdminAccountEntry } from "./controllers/admin-accounts.ts";
import {
  loadToolsEffective as loadToolsEffectiveInternal,
  refreshVisibleToolsEffectiveForCurrentSession as refreshVisibleToolsEffectiveForCurrentSessionInternal,
} from "./controllers/agents.ts";
import { loadAssistantIdentity as loadAssistantIdentityInternal } from "./controllers/assistant-identity.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { DreamingStatus } from "./controllers/dreaming.ts";
import {
  logoutEmployee,
  submitEmployeeAdSso,
  submitEmployeeLogin,
} from "./controllers/employee-login.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type { GroupDetail, GroupEntry, GroupScopeOption } from "./controllers/groups.ts";
import {
  confirmEmployeeReleaseNotesRead,
  loadEmployeeReleaseNotesStatus,
  loadPlatformClawReleaseIndex,
  loadPlatformClawReleaseMarkdown,
} from "./controllers/release-notes.ts";
import type { SkillHubDetail, SkillHubEntry, SkillHubScope } from "./controllers/skill-hub.ts";
import type {
  ClawHubSearchResult,
  ClawHubSkillDetail,
  SkillMessage,
} from "./controllers/skills.ts";
import {
  closeWorkspaceFilePreview,
  createWorkspaceFolderAction,
  deleteWorkspaceEntriesAction,
  downloadWorkspaceFiles,
  loadWorkspaceFiles,
  openWorkspaceFilePreview,
  renameWorkspaceEntryAction,
  setAllWorkspaceFileSelections,
  toggleWorkspaceFileSelection,
  uploadWorkspaceFilesAction,
  type WorkspaceFileUploadItem,
} from "./controllers/workspace-files.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import { resolveAgentIdFromSessionKey } from "./session-key.ts";
import { loadSettings, type UiSettings } from "./storage.ts";
import { VALID_THEME_NAMES, type ResolvedTheme, type ThemeMode, type ThemeName } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  ConfigSnapshot,
  ConfigUiHints,
  ChatModelOverride,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSummary,
  LogEntry,
  LogLevel,
  ModelCatalogEntry,
  PresenceEntry,
  ChannelsStatusSnapshot,
  SessionCompactionCheckpoint,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  NostrProfile,
  ToolsCatalogResult,
  ToolsEffectiveResult,
} from "./types.ts";
import {
  type ChatAttachment,
  type ChatQueueItem,
  type ChatSendDraft,
  type ChatSendFailure,
  type CronFormState,
} from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";

declare global {
  interface Window {
    __OPENCLAW_CONTROL_UI_BASE_PATH__?: string;
    __OPENCLAW_UI_MODE__?: "control" | "employee";
  }
}

const bootAssistantIdentity = normalizeAssistantIdentity({});

function resolveOnboardingMode(): boolean {
  if (!window.location.search) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("onboarding");
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function resolveUiMode(): "control" | "employee" {
  if (window.__OPENCLAW_UI_MODE__ === "employee") {
    return "employee";
  }
  const pathname = typeof window.location?.pathname === "string" ? window.location.pathname : "";
  if (pathname === "/" || /^\/employee(?:\/|$)/.test(pathname)) {
    return "employee";
  }
  return "control";
}

@customElement("openclaw-app")
export class OpenClawApp extends LitElement {
  private i18nController = new I18nController(this);
  clientInstanceId = generateUUID();
  connectGeneration = 0;
  @state() settings: UiSettings = loadSettings();
  @state() employeeMode = resolveUiMode() === "employee";
  constructor() {
    super();
    if (this.employeeMode && this.settings.theme === "claw") {
      this.settings = { ...this.settings, theme: "knot" };
      this.theme = "knot";
      this.themeOrder = this.buildThemeOrder(this.theme);
    }
    if (isSupportedLocale(this.settings.locale)) {
      void i18n.setLocale(this.settings.locale);
    }
  }
  @state() password = "";
  @state() loginShowGatewayToken = false;
  @state() loginShowGatewayPassword = false;
  @state() employeeBootstrapToken: string | null = null;
  @state() employeeBootstrapReady = false;
  @state() employeeBootstrapError: string | null = null;
  @state() employeeLoginNotice: EmployeeUiLoginNotice | null = null;
  @state() employeeLoginIdentifier = "";
  @state() employeeLoginPassword = "";
  @state() employeeLoginSubmitting = false;
  @state() employeeUi = {
    docsUrl: null as string | null,
    announcementTitle: null as string | null,
    announcementBody: null as string | null,
    announcementLinkLabel: null as string | null,
    announcementLinkUrl: null as string | null,
  };
  @state() employeeProfile = {
    employeeId: null as string | null,
    name: null as string | null,
    department: null as string | null,
    agentId: null as string | null,
  };
  @state() employeeAccountSummary: EmployeeUiAccountSummary | null = null;
  @state() tab: Tab = "chat";
  @state() onboarding = resolveOnboardingMode();
  @state() connected = false;
  @state() theme: ThemeName = this.settings.theme ?? "claw";
  @state() themeMode: ThemeMode = this.settings.themeMode ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() themeOrder: ThemeName[] = this.buildThemeOrder(this.theme);
  @state() hello: GatewayHelloOk | null = null;
  @state() releaseNotesOpen = false;
  @state() releaseNotesLoading = false;
  @state() releaseNotesError: string | null = null;
  @state() releaseNotesIndex: PlatformClawReleaseIndex | null = null;
  @state() releaseNotesSelectedVersion: string | null = null;
  @state() releaseNotesMarkdownByVersion: Record<string, string> = {};
  @state() releaseNotesReadVersion: string | null = null;
  @state() releaseNotesAutoMode = false;
  @state() releaseNotesMobileDetail = false;
  @state() releaseNotesReadSubmitting = false;
  private releaseNotesLoadGeneration = 0;
  private releaseNotesAutoCheckEmployeeId: string | null = null;
  private releaseNotesAutoCheckPromise: Promise<void> | null = null;
  @state() lastError: string | null = null;
  @state() lastErrorCode: string | null = null;
  @state() eventLog: EventLogEntry[] = [];
  private eventLogBuffer: EventLogEntry[] = [];
  private toolStreamSyncTimer: number | null = null;
  private sidebarCloseTimer: number | null = null;

  @state() assistantName = bootAssistantIdentity.name;
  @state() assistantAvatar = bootAssistantIdentity.avatar;
  @state() assistantAgentId = bootAssistantIdentity.agentId ?? null;
  @state() serverVersion: string | null = null;

  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  chatMessagesBySession = new Map<string, unknown[]>();
  @state() chatToolMessages: unknown[] = [];
  @state() chatStreamSegments: Array<{ text: string; ts: number }> = [];
  @state() chatStream: string | null = null;
  @state() chatStreamStartedAt: number | null = null;
  @state() chatRunId: string | null = null;
  pendingAbort: { runId?: string | null; sessionKey: string } | null = null;
  @state() compactionStatus: CompactionStatus | null = null;
  @state() runPhaseStatus: RunPhaseStatus | null = null;
  @state() fallbackStatus: FallbackStatus | null = null;
  @state() chatAvatarUrl: string | null = null;
  @state() chatThinkingLevel: string | null = null;
  @state() chatModelOverrides: Record<string, ChatModelOverride | null> = {};
  @state() chatModelsLoading = false;
  @state() chatModelCatalog: ModelCatalogEntry[] = [];
  @state() chatQueue: ChatQueueItem[] = [];
  @state() chatAttachments: ChatAttachment[] = [];
  @state() artifactFocus: ArtifactFocusItem | null = null;
  @state() chatSendDrafts: Record<string, ChatSendDraft> = {};
  @state() chatSendFailures: Record<string, ChatSendFailure> = {};
  @state() chatManualRefreshInFlight = false;
  @state() workspaceFilesLoading = false;
  @state() workspaceFilesUploading = false;
  @state() workspaceFilesError: string | null = null;
  @state() workspaceFilesMessage: { kind: "success" | "error"; text: string } | null = null;
  @state() workspaceFilesCurrentPath = "";
  @state() workspaceFilesParentPath: string | null = null;
  @state()
  workspaceFilesBreadcrumbs: import("../../../src/gateway/employee-workspace-files-contract.ts").WorkspaceFilesBreadcrumbEntry[] =
    [];
  @state()
  workspaceFilesEntries: import("../../../src/gateway/employee-workspace-files-contract.ts").WorkspaceFilesEntry[] =
    [];
  @state() workspaceFilesSelectedPaths: string[] = [];
  @state() workspaceFilesUploads: WorkspaceFileUploadItem[] = [];
  @state() workspaceFilesPreviewLoading = false;
  @state() workspaceFilesPreviewError: string | null = null;
  @state() workspaceFilesPreview:
    | import("../../../src/gateway/employee-workspace-files-contract.ts").WorkspaceFilePreviewResponse
    | null = null;
  @state() navDrawerOpen = false;

  onSlashAction?: (action: string) => void;

  // Sidebar state for tool output viewing
  @state() sidebarOpen = false;
  @state() sidebarContent: string | null = null;
  @state() sidebarError: string | null = null;
  @state() splitRatio = this.settings.splitRatio;

  @state() nodesLoading = false;
  @state() nodes: Array<Record<string, unknown>> = [];
  @state() devicesLoading = false;
  @state() devicesError: string | null = null;
  @state() devicesList: DevicePairingList | null = null;
  @state() execApprovalsLoading = false;
  @state() execApprovalsSaving = false;
  @state() execApprovalsDirty = false;
  @state() execApprovalsSnapshot: ExecApprovalsSnapshot | null = null;
  @state() execApprovalsForm: ExecApprovalsFile | null = null;
  @state() execApprovalsSelectedAgent: string | null = null;
  @state() execApprovalsTarget: "gateway" | "node" = "gateway";
  @state() execApprovalsTargetNodeId: string | null = null;
  @state() execApprovalQueue: ExecApprovalRequest[] = [];
  @state() execApprovalBusy = false;
  @state() execApprovalError: string | null = null;
  @state() pendingGatewayUrl: string | null = null;
  pendingGatewayToken: string | null = null;

  @state() configLoading = false;
  @state() configRaw = "{\n}\n";
  @state() configRawOriginal = "";
  @state() configValid: boolean | null = null;
  @state() configIssues: unknown[] = [];
  @state() configSaving = false;
  @state() configApplying = false;
  @state() updateRunning = false;
  @state() applySessionKey = this.settings.lastActiveSessionKey;
  @state() configSnapshot: ConfigSnapshot | null = null;
  @state() configSchema: unknown = null;
  @state() configSchemaVersion: string | null = null;
  @state() configSchemaLoading = false;
  @state() configUiHints: ConfigUiHints = {};
  @state() configForm: Record<string, unknown> | null = null;
  @state() configFormOriginal: Record<string, unknown> | null = null;
  @state() dreamingStatusLoading = false;
  @state() dreamingStatusError: string | null = null;
  @state() dreamingStatus: DreamingStatus | null = null;
  @state() dreamingModeSaving = false;
  @state() dreamDiaryLoading = false;
  @state() dreamDiaryActionLoading = false;
  @state() dreamDiaryError: string | null = null;
  @state() dreamDiaryPath: string | null = null;
  @state() dreamDiaryContent: string | null = null;
  @state() configFormDirty = false;
  @state() configFormMode: "form" | "raw" = "form";
  @state() configSearchQuery = "";
  @state() configActiveSection: string | null = null;
  @state() configActiveSubsection: string | null = null;
  @state() communicationsFormMode: "form" | "raw" = "form";
  @state() communicationsSearchQuery = "";
  @state() communicationsActiveSection: string | null = null;
  @state() communicationsActiveSubsection: string | null = null;
  @state() appearanceFormMode: "form" | "raw" = "form";
  @state() appearanceSearchQuery = "";
  @state() appearanceActiveSection: string | null = null;
  @state() appearanceActiveSubsection: string | null = null;
  @state() automationFormMode: "form" | "raw" = "form";
  @state() automationSearchQuery = "";
  @state() automationActiveSection: string | null = null;
  @state() automationActiveSubsection: string | null = null;
  @state() infrastructureFormMode: "form" | "raw" = "form";
  @state() infrastructureSearchQuery = "";
  @state() infrastructureActiveSection: string | null = null;
  @state() infrastructureActiveSubsection: string | null = null;
  @state() aiAgentsFormMode: "form" | "raw" = "form";
  @state() aiAgentsSearchQuery = "";
  @state() aiAgentsActiveSection: string | null = null;
  @state() aiAgentsActiveSubsection: string | null = null;

  @state() channelsLoading = false;
  @state() channelsSnapshot: ChannelsStatusSnapshot | null = null;
  @state() channelsError: string | null = null;
  @state() channelsLastSuccess: number | null = null;
  @state() whatsappLoginMessage: string | null = null;
  @state() whatsappLoginQrDataUrl: string | null = null;
  @state() whatsappLoginConnected: boolean | null = null;
  @state() whatsappBusy = false;
  @state() nostrProfileFormState: NostrProfileFormState | null = null;
  @state() nostrProfileAccountId: string | null = null;

  @state() presenceLoading = false;
  @state() presenceEntries: PresenceEntry[] = [];
  @state() presenceError: string | null = null;
  @state() presenceStatus: string | null = null;

  @state() agentsLoading = false;
  @state() agentsList: AgentsListResult | null = null;
  @state() agentsError: string | null = null;
  @state() agentsSelectedId: string | null = null;
  @state() toolsCatalogLoading = false;
  @state() toolsCatalogError: string | null = null;
  @state() toolsCatalogResult: ToolsCatalogResult | null = null;
  @state() toolsEffectiveLoading = false;
  @state() toolsEffectiveLoadingKey: string | null = null;
  @state() toolsEffectiveResultKey: string | null = null;
  @state() toolsEffectiveError: string | null = null;
  @state() toolsEffectiveResult: ToolsEffectiveResult | null = null;
  @state() agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron" = "files";
  @state() agentFilesLoading = false;
  @state() agentFilesError: string | null = null;
  @state() agentFilesList: AgentsFilesListResult | null = null;
  @state() agentFileContents: Record<string, string> = {};
  @state() agentFileDrafts: Record<string, string> = {};
  @state() agentFileActive: string | null = null;
  @state() agentFileSaving = false;
  @state() agentIdentityLoading = false;
  @state() agentIdentityError: string | null = null;
  @state() agentIdentityById: Record<string, AgentIdentityResult> = {};
  @state() agentSkillsLoading = false;
  @state() agentSkillsError: string | null = null;
  @state() agentSkillsReport: SkillStatusReport | null = null;
  @state() agentSkillsAgentId: string | null = null;

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() sessionsFilterActive = "120";
  @state() sessionsFilterLimit = "50";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;
  @state() sessionsHideCron = true;
  @state() sessionsSearchQuery = "";
  @state() employeeChatSessionSearch = "";
  @state() employeeChatSessionsCollapsed = false;
  @state() sessionsSortColumn: "key" | "kind" | "updated" | "tokens" = "updated";
  @state() sessionsSortDir: "asc" | "desc" = "desc";
  @state() sessionsPage = 0;
  @state() sessionsPageSize = 25;
  @state() sessionsSelectedKeys: Set<string> = new Set();
  @state() sessionsExpandedCheckpointKey: string | null = null;
  @state() sessionsCheckpointItemsByKey: Record<string, SessionCompactionCheckpoint[]> = {};
  @state() sessionsCheckpointLoadingKey: string | null = null;
  @state() sessionsCheckpointBusyKey: string | null = null;
  @state() sessionsCheckpointErrorByKey: Record<string, string> = {};

  @state() usageLoading = false;
  @state() usageResult: import("./types.js").SessionsUsageResult | null = null;
  @state() usageCostSummary: import("./types.js").CostUsageSummary | null = null;
  @state() usageError: string | null = null;
  @state() dashboardLoading = false;
  @state() dashboardError: string | null = null;
  @state() dashboardRange: import("./types.js").DashboardRange = "7d";
  @state() dashboardResult: import("./types.js").DashboardSummaryResult | null = null;
  @state() dashboardSortBy: import("./types.js").DashboardSortBy = "totalTokens";
  @state() dashboardSortDir: import("./types.js").DashboardSortDir = "desc";
  @state() usageStartDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  @state() usageEndDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  @state() usageSelectedSessions: string[] = [];
  @state() usageSelectedDays: string[] = [];
  @state() usageSelectedHours: number[] = [];
  @state() usageChartMode: "tokens" | "cost" = "tokens";
  @state() usageDailyChartMode: "total" | "by-type" = "by-type";
  @state() usageTimeSeriesMode: "cumulative" | "per-turn" = "per-turn";
  @state() usageTimeSeriesBreakdownMode: "total" | "by-type" = "by-type";
  @state() usageTimeSeries: import("./types.js").SessionUsageTimeSeries | null = null;
  @state() usageTimeSeriesLoading = false;
  @state() usageTimeSeriesCursorStart: number | null = null;
  @state() usageTimeSeriesCursorEnd: number | null = null;
  @state() usageSessionLogs: import("./views/usage.js").SessionLogEntry[] | null = null;
  @state() usageSessionLogsLoading = false;
  @state() usageSessionLogsExpanded = false;
  // Applied query (used to filter the already-loaded sessions list client-side).
  @state() usageQuery = "";
  // Draft query text (updates immediately as the user types; applied via debounce or "Search").
  @state() usageQueryDraft = "";
  @state() usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors" = "recent";
  @state() usageSessionSortDir: "desc" | "asc" = "desc";
  @state() usageRecentSessions: string[] = [];
  @state() usageTimeZone: "local" | "utc" = "local";
  @state() usageContextExpanded = false;
  @state() usageHeaderPinned = false;
  @state() usageSessionsTab: "all" | "recent" = "all";
  @state() usageVisibleColumns: string[] = [
    "channel",
    "agent",
    "provider",
    "model",
    "messages",
    "tools",
    "errors",
    "duration",
  ];
  @state() usageLogFilterRoles: import("./views/usage.js").SessionLogRole[] = [];
  @state() usageLogFilterTools: string[] = [];
  @state() usageLogFilterHasTools = false;
  @state() usageLogFilterQuery = "";

  // Non-reactive (don’t trigger renders just for timer bookkeeping).
  usageQueryDebounceTimer: number | null = null;

  @state() cronLoading = false;
  @state() cronJobsLoadingMore = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronJobsTotal = 0;
  @state() cronJobsHasMore = false;
  @state() cronJobsNextOffset: number | null = null;
  @state() cronJobsLimit = 50;
  @state() cronJobsQuery = "";
  @state() cronJobsEnabledFilter: import("./types.js").CronJobsEnabledFilter = "all";
  @state() cronJobsScheduleKindFilter: import("./controllers/cron.js").CronJobsScheduleKindFilter =
    "all";
  @state() cronJobsLastStatusFilter: import("./controllers/cron.js").CronJobsLastStatusFilter =
    "all";
  @state() cronJobsSortBy: import("./types.js").CronJobsSortBy = "nextRunAtMs";
  @state() cronJobsSortDir: import("./types.js").CronSortDir = "asc";
  @state() cronStatus: CronStatus | null = null;
  @state() cronError: string | null = null;
  @state() cronForm: CronFormState = { ...DEFAULT_CRON_FORM };
  @state() cronFieldErrors: import("./controllers/cron.js").CronFieldErrors = {};
  @state() cronEditingJobId: string | null = null;
  @state() cronRunsJobId: string | null = null;
  @state() cronRunsLoadingMore = false;
  @state() cronRuns: CronRunLogEntry[] = [];
  @state() cronRunsTotal = 0;
  @state() cronRunsHasMore = false;
  @state() cronRunsNextOffset: number | null = null;
  @state() cronRunsLimit = 50;
  @state() cronRunsScope: import("./types.js").CronRunScope = "all";
  @state() cronRunsStatuses: import("./types.js").CronRunsStatusValue[] = [];
  @state() cronRunsDeliveryStatuses: import("./types.js").CronDeliveryStatus[] = [];
  @state() cronRunsStatusFilter: import("./types.js").CronRunsStatusFilter = "all";
  @state() cronRunsQuery = "";
  @state() cronRunsSortDir: import("./types.js").CronSortDir = "desc";
  @state() cronModelSuggestions: string[] = [];
  @state() cronBusy = false;

  @state() updateAvailable: import("./types.js").UpdateAvailable | null = null;

  // Overview dashboard state
  @state() attentionItems: import("./types.js").AttentionItem[] = [];
  @state() paletteOpen = false;
  @state() paletteQuery = "";
  @state() paletteActiveIndex = 0;
  @state() overviewShowGatewayToken = false;
  @state() overviewShowGatewayPassword = false;
  @state() overviewLogLines: string[] = [];
  @state() overviewLogCursor = 0;

  @state() skillsLoading = false;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() skillsError: string | null = null;
  @state() skillsFilter = "";
  @state() skillsStatusFilter: "all" | "ready" | "needs-setup" | "disabled" = "all";
  @state() skillEdits: Record<string, string> = {};
  @state() skillsBusyKey: string | null = null;
  @state() skillMessages: Record<string, SkillMessage> = {};
  @state() skillsDetailKey: string | null = null;
  @state() clawhubSearchQuery = "";
  @state() clawhubSearchResults: ClawHubSearchResult[] | null = null;
  @state() clawhubSearchLoading = false;
  @state() clawhubSearchError: string | null = null;
  @state() clawhubDetail: ClawHubSkillDetail | null = null;
  @state() clawhubDetailSlug: string | null = null;
  @state() clawhubDetailLoading = false;
  @state() clawhubDetailError: string | null = null;
  @state() clawhubInstallSlug: string | null = null;
  @state() clawhubInstallMessage: { kind: "success" | "error"; text: string } | null = null;
  @state() skillHubLoading = false;
  @state() skillHubEntries: SkillHubEntry[] = [];
  @state() skillHubError: string | null = null;
  @state() skillHubScope: SkillHubScope = "discover";
  @state() skillHubSort: import("./controllers/skill-hub.ts").SkillHubSort = "recent";
  @state() skillHubCategory: import("./controllers/skill-hub.ts").SkillHubCategoryFilter = "all";
  @state() skillHubQuery = "";
  @state() skillHubDetail: SkillHubDetail | null = null;
  @state() skillHubDetailSlug: string | null = null;
  @state() skillHubDetailLoading = false;
  @state() skillHubDetailError: string | null = null;
  @state() skillHubBusySlug: string | null = null;
  @state() skillHubMessage: { kind: "success" | "error"; text: string } | null = null;
  @state() skillHubWorkspacePublishing = false;
  @state() skillHubWorkspacePendingKeys: string[] = [];
  @state()
  skillHubWorkspacePublishEntries: import("./controllers/skill-hub.ts").WorkspacePublishEntry[] =
    [];
  @state() skillHubOverview: import("./controllers/skill-hub.ts").SkillHubOverview | null = null;
  @state() skillHubUploading = false;
  @state() skillHubWorkspacePanelOpen = false;
  @state() skillHubEditorOpen = false;
  @state() skillHubEditorMode: "publish" | "upload" | "edit-metadata" | null = null;
  @state() skillHubEditorSlug: string | null = null;
  @state() skillHubEditorTitle: string | null = null;
  @state() skillHubEditorSkillName: string | null = null;
  @state() skillHubEditorFile: File | null = null;
  @state() skillHubEditorIconFile: File | null = null;
  @state() skillHubEditorIconReset = false;
  @state() skillHubEditorDescription = "";
  @state() skillHubEditorDisplayName = "";
  @state() skillHubEditorCategory: import("./controllers/skill-hub.ts").SkillCategory | "" = "";
  @state() skillHubEditorRevision = 0;
  @state() skillHubEditorPrompts = ["", "", ""];
  @state() skillHubEditorError: string | null = null;
  @state() skillHubEditorLoading = false;
  @state() skillHubTransferOpen = false;
  @state() skillHubTransferSlug: string | null = null;
  @state() skillHubTransferTitle: string | null = null;
  @state() skillHubTransferQuery = "";
  @state() skillHubTransferResults: AccountDirectoryEntry[] = [];
  @state() skillHubTransferTargetAccountId: string | null = null;
  @state() skillHubTransferReason = "";
  @state() skillHubTransferLoading = false;
  @state() skillHubTransferError: string | null = null;

  @state() groupsLoading = false;
  @state() groupsEntries: GroupEntry[] = [];
  @state() groupsError: string | null = null;
  @state() groupsIncludeArchived = false;
  @state() groupsDetailGroupId: string | null = null;
  @state() groupsDetailLoading = false;
  @state() groupsDetail: GroupDetail | null = null;
  @state() groupsDetailError: string | null = null;
  @state() groupsScopeOptions: GroupScopeOption[] = [];
  @state() groupsMessage: { kind: "success" | "error"; text: string } | null = null;
  @state() groupsCreateOpen = false;
  @state() groupsCreateName = "";
  @state() groupsCreateDescription = "";
  @state() groupsCreateSubmitting = false;
  @state() groupsPartCreateOpen = false;
  @state() groupsPartCreateParentId: string | null = null;
  @state() groupsPartCreateName = "";
  @state() groupsPartCreateDescription = "";
  @state() groupsPartCreateSubmitting = false;
  @state() groupsEditOpen = false;
  @state() groupsEditScopeType: "group" | "part" = "group";
  @state() groupsEditScopeId: string | null = null;
  @state() groupsEditParentGroupId: string | null = null;
  @state() groupsEditTitle: string | null = null;
  @state() groupsEditName = "";
  @state() groupsEditDescription = "";
  @state() groupsEditSubmitting = false;
  @state() groupsMemberModalOpen = false;
  @state() groupsMemberModalScopeType: "group" | "part" = "group";
  @state() groupsMemberModalScopeId: string | null = null;
  @state() groupsMemberModalScopeLabel: string | null = null;
  @state() groupsMemberModalQuery = "";
  @state() groupsMemberModalResults: AccountDirectoryEntry[] = [];
  @state() groupsMemberModalSelectedAccountId: string | null = null;
  @state() groupsMemberModalRole: "member" | "leader" = "member";
  @state() groupsMemberModalError: string | null = null;
  @state() groupsMemberModalLoading = false;

  @state() adminAccountsLoading = false;
  @state() adminAccountsEntries: AdminAccountEntry[] = [];
  @state() adminAccountsError: string | null = null;
  @state() adminAccountsQuery = "";
  @state() adminAccountDetailLoading = false;
  @state() adminAccountDetail: AdminAccountDetail | null = null;
  @state() adminAccountDetailError: string | null = null;
  @state() adminAccountDetailAccountId: string | null = null;
  @state() adminAccountMessage: { kind: "success" | "error"; text: string } | null = null;
  @state() adminRoleModalOpen = false;
  @state() adminRoleModalAccountId: string | null = null;
  @state() adminRoleModalAccountName: string | null = null;
  @state() adminRoleModalNextRole: "member" | "admin" = "member";

  @state() healthLoading = false;
  @state() healthResult: HealthSummary | null = null;
  @state() healthError: string | null = null;

  @state() debugLoading = false;
  @state() debugStatus: StatusSummary | null = null;
  @state() debugHealth: HealthSummary | null = null;
  @state() debugModels: ModelCatalogEntry[] = [];
  @state() debugHeartbeat: unknown = null;
  @state() debugCallMethod = "";
  @state() debugCallParams = "{}";
  @state() debugCallResult: string | null = null;
  @state() debugCallError: string | null = null;

  @state() logsLoading = false;
  @state() logsError: string | null = null;
  @state() logsFile: string | null = null;
  @state() logsEntries: LogEntry[] = [];
  @state() logsFilterText = "";
  @state() logsLevelFilters: Record<LogLevel, boolean> = {
    ...DEFAULT_LOG_LEVEL_FILTERS,
  };
  @state() logsAutoFollow = true;
  @state() logsTruncated = false;
  @state() logsCursor: number | null = null;
  @state() logsLastFetchAt: number | null = null;
  @state() logsLimit = 500;
  @state() logsMaxBytes = 250_000;
  @state() logsAtBottom = true;

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private chatScrollTimeout: number | null = null;
  private chatHasAutoScrolled = false;
  private chatUserNearBottom = true;
  @state() chatNewMessagesBelow = false;
  private employeeBootstrapPollInterval: number | null = null;
  private nodesPollInterval: number | null = null;
  private logsPollInterval: number | null = null;
  private debugPollInterval: number | null = null;
  private heartbeatPollInterval: number | null = null;
  private requestStatusPollInterval: number | null = null;
  private logsScrollFrame: number | null = null;
  private toolStreamById = new Map<string, ToolStreamEntry>();
  private toolStreamOrder: string[] = [];
  refreshSessionsAfterChat = new Set<string>();
  basePath = "";
  private popStateHandler = () =>
    onPopStateInternal(this as unknown as Parameters<typeof onPopStateInternal>[0]);
  private topbarObserver: ResizeObserver | null = null;
  private globalKeydownHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.artifactFocus) {
      e.preventDefault();
      this.artifactFocus = null;
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "k") {
      e.preventDefault();
      this.paletteOpen = !this.paletteOpen;
      if (this.paletteOpen) {
        this.paletteQuery = "";
        this.paletteActiveIndex = 0;
      }
    }
  };

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.onSlashAction = (action: string) => {
      switch (action) {
        case "toggle-focus":
          this.applySettings({
            ...this.settings,
            chatFocusMode: !this.settings.chatFocusMode,
          });
          break;
        case "export":
          exportChatMarkdown(this.chatMessages, this.assistantName);
          break;
        case "refresh-tools-effective": {
          void refreshVisibleToolsEffectiveForCurrentSessionInternal(this);
          break;
        }
      }
    };
    document.addEventListener("keydown", this.globalKeydownHandler);
    handleConnected(this as unknown as Parameters<typeof handleConnected>[0]);
  }

  protected firstUpdated() {
    handleFirstUpdated(this as unknown as Parameters<typeof handleFirstUpdated>[0]);
  }

  disconnectedCallback() {
    document.removeEventListener("keydown", this.globalKeydownHandler);
    handleDisconnected(this as unknown as Parameters<typeof handleDisconnected>[0]);
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    handleUpdated(this as unknown as Parameters<typeof handleUpdated>[0], changed);
    if (!changed.has("sessionKey") || this.agentsPanel !== "tools") {
      return;
    }
    const activeSessionAgentId = resolveAgentIdFromSessionKey(this.sessionKey);
    if (this.agentsSelectedId && this.agentsSelectedId === activeSessionAgentId) {
      void loadToolsEffectiveInternal(this, {
        agentId: this.agentsSelectedId,
        sessionKey: this.sessionKey,
      });
      return;
    }
    this.toolsEffectiveResult = null;
    this.toolsEffectiveResultKey = null;
    this.toolsEffectiveError = null;
    this.toolsEffectiveLoading = false;
    this.toolsEffectiveLoadingKey = null;
  }

  connect() {
    connectGatewayInternal(this as unknown as Parameters<typeof connectGatewayInternal>[0]);
  }

  async handleEmployeeLogin() {
    await submitEmployeeLogin(this as unknown as Parameters<typeof submitEmployeeLogin>[0]);
  }

  async handleEmployeeAdSso() {
    await submitEmployeeAdSso(this as unknown as Parameters<typeof submitEmployeeAdSso>[0]);
  }

  async handleEmployeeLogout() {
    await logoutEmployee(this as unknown as Parameters<typeof logoutEmployee>[0]);
  }

  handleChatScroll(event: Event) {
    handleChatScrollInternal(
      this as unknown as Parameters<typeof handleChatScrollInternal>[0],
      event,
    );
  }

  handleLogsScroll(event: Event) {
    handleLogsScrollInternal(
      this as unknown as Parameters<typeof handleLogsScrollInternal>[0],
      event,
    );
  }

  exportLogs(lines: string[], label: string) {
    exportLogsInternal(lines, label);
  }

  resetToolStream() {
    resetToolStreamInternal(this as unknown as Parameters<typeof resetToolStreamInternal>[0]);
  }

  resetChatScroll() {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
  }

  scrollToBottom(opts?: { smooth?: boolean }) {
    resetChatScrollInternal(this as unknown as Parameters<typeof resetChatScrollInternal>[0]);
    scheduleChatScrollInternal(
      this as unknown as Parameters<typeof scheduleChatScrollInternal>[0],
      true,
      Boolean(opts?.smooth),
    );
  }

  async loadAssistantIdentity() {
    await loadAssistantIdentityInternal(this);
  }

  applySettings(next: UiSettings) {
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], next);
  }

  setTab(next: Tab) {
    if (next !== "chat") {
      this.artifactFocus = null;
    }
    setTabInternal(this as unknown as Parameters<typeof setTabInternal>[0], next);
    this.navDrawerOpen = false;
  }

  setTheme(next: ThemeName, context?: Parameters<typeof setThemeInternal>[2]) {
    setThemeInternal(this as unknown as Parameters<typeof setThemeInternal>[0], next, context);
    this.themeOrder = this.buildThemeOrder(next);
  }

  setThemeMode(next: ThemeMode, context?: Parameters<typeof setThemeModeInternal>[2]) {
    setThemeModeInternal(
      this as unknown as Parameters<typeof setThemeModeInternal>[0],
      next,
      context,
    );
  }

  setBorderRadius(value: number) {
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], {
      ...this.settings,
      borderRadius: value,
    });
    this.requestUpdate();
  }

  buildThemeOrder(active: ThemeName): ThemeName[] {
    const all = [...VALID_THEME_NAMES];
    const rest = all.filter((id) => id !== active);
    return [active, ...rest];
  }

  async loadOverview() {
    await loadOverviewInternal(this as unknown as Parameters<typeof loadOverviewInternal>[0]);
  }

  async loadCron() {
    await loadCronInternal(this as unknown as Parameters<typeof loadCronInternal>[0]);
  }

  async handleAbortChat() {
    await handleAbortChatInternal(this as unknown as Parameters<typeof handleAbortChatInternal>[0]);
  }

  async loadWorkspaceFiles(path?: string) {
    await loadWorkspaceFiles(this as unknown as Parameters<typeof loadWorkspaceFiles>[0], path);
  }

  async openWorkspaceFilePreview(relativePath: string) {
    await openWorkspaceFilePreview(
      this as unknown as Parameters<typeof openWorkspaceFilePreview>[0],
      relativePath,
    );
  }

  closeWorkspaceFilePreview() {
    closeWorkspaceFilePreview(this as unknown as Parameters<typeof closeWorkspaceFilePreview>[0]);
  }

  toggleWorkspaceFileSelection(relativePath: string, selected: boolean) {
    toggleWorkspaceFileSelection(
      this as unknown as Parameters<typeof toggleWorkspaceFileSelection>[0],
      relativePath,
      selected,
    );
  }

  setAllWorkspaceFileSelections(relativePaths: string[], selected: boolean) {
    setAllWorkspaceFileSelections(
      this as unknown as Parameters<typeof setAllWorkspaceFileSelections>[0],
      relativePaths,
      selected,
    );
  }

  downloadWorkspaceFiles(relativePaths: string[]) {
    downloadWorkspaceFiles(relativePaths);
  }

  async createWorkspaceFolder(name: string) {
    await createWorkspaceFolderAction(
      this as unknown as Parameters<typeof createWorkspaceFolderAction>[0],
      name,
    );
  }

  async renameWorkspaceEntry(relativePath: string, nextName: string) {
    await renameWorkspaceEntryAction(
      this as unknown as Parameters<typeof renameWorkspaceEntryAction>[0],
      relativePath,
      nextName,
    );
  }

  async deleteWorkspaceEntries(relativePaths: string[]) {
    await deleteWorkspaceEntriesAction(
      this as unknown as Parameters<typeof deleteWorkspaceEntriesAction>[0],
      relativePaths,
    );
  }

  async uploadWorkspaceFiles(files: File[]) {
    await uploadWorkspaceFilesAction(
      this as unknown as Parameters<typeof uploadWorkspaceFilesAction>[0],
      files,
      (fileName) => window.confirm(`'${fileName}' already exists. Overwrite it?`),
    );
  }

  removeQueuedMessage(id: string) {
    removeQueuedMessageInternal(
      this as unknown as Parameters<typeof removeQueuedMessageInternal>[0],
      id,
    );
  }

  async handleSendChat(
    messageOverride?: string,
    opts?: Parameters<typeof handleSendChatInternal>[2],
  ) {
    await handleSendChatInternal(
      this as unknown as Parameters<typeof handleSendChatInternal>[0],
      messageOverride,
      opts,
    );
  }

  async retryFailedChatMessage(runId: string) {
    await retryFailedChatMessageInternal(
      this as unknown as Parameters<typeof retryFailedChatMessageInternal>[0],
      runId,
    );
  }

  async handleWhatsAppStart(force: boolean) {
    await handleWhatsAppStartInternal(this, force);
  }

  async handleWhatsAppWait() {
    await handleWhatsAppWaitInternal(this);
  }

  async handleWhatsAppLogout() {
    await handleWhatsAppLogoutInternal(this);
  }

  async handleChannelConfigSave() {
    await handleChannelConfigSaveInternal(this);
  }

  async handleChannelConfigReload() {
    await handleChannelConfigReloadInternal(this);
  }

  handleNostrProfileEdit(accountId: string, profile: NostrProfile | null) {
    handleNostrProfileEditInternal(this, accountId, profile);
  }

  handleNostrProfileCancel() {
    handleNostrProfileCancelInternal(this);
  }

  handleNostrProfileFieldChange(field: keyof NostrProfile, value: string) {
    handleNostrProfileFieldChangeInternal(this, field, value);
  }

  async handleNostrProfileSave() {
    await handleNostrProfileSaveInternal(this);
  }

  async handleNostrProfileImport() {
    await handleNostrProfileImportInternal(this);
  }

  handleNostrProfileToggleAdvanced() {
    handleNostrProfileToggleAdvancedInternal(this);
  }

  async handleExecApprovalDecision(decision: "allow-once" | "allow-always" | "deny") {
    const active = this.execApprovalQueue[0];
    if (!active || !this.client || this.execApprovalBusy) {
      return;
    }
    this.execApprovalBusy = true;
    this.execApprovalError = null;
    try {
      const method = active.kind === "plugin" ? "plugin.approval.resolve" : "exec.approval.resolve";
      await this.client.request(method, {
        id: active.id,
        decision,
      });
      this.execApprovalQueue = this.execApprovalQueue.filter((entry) => entry.id !== active.id);
    } catch (err) {
      this.execApprovalError = `Approval failed: ${String(err)}`;
    } finally {
      this.execApprovalBusy = false;
    }
  }

  handleGatewayUrlConfirm() {
    const nextGatewayUrl = this.pendingGatewayUrl;
    if (!nextGatewayUrl) {
      return;
    }
    const nextToken = this.pendingGatewayToken?.trim() || "";
    this.pendingGatewayUrl = null;
    this.pendingGatewayToken = null;
    applySettingsInternal(this as unknown as Parameters<typeof applySettingsInternal>[0], {
      ...this.settings,
      gatewayUrl: nextGatewayUrl,
      token: nextToken,
    });
    this.connect();
  }

  handleGatewayUrlCancel() {
    this.pendingGatewayUrl = null;
    this.pendingGatewayToken = null;
  }

  // Sidebar handlers for tool output viewing
  handleOpenSidebar(content: string) {
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
      this.sidebarCloseTimer = null;
    }
    this.sidebarContent = content;
    this.sidebarError = null;
    this.sidebarOpen = true;
  }

  handleCloseSidebar() {
    this.sidebarOpen = false;
    // Clear content after transition
    if (this.sidebarCloseTimer != null) {
      window.clearTimeout(this.sidebarCloseTimer);
    }
    this.sidebarCloseTimer = window.setTimeout(() => {
      if (this.sidebarOpen) {
        return;
      }
      this.sidebarContent = null;
      this.sidebarError = null;
      this.sidebarCloseTimer = null;
    }, 200);
  }

  handleSplitRatioChange(ratio: number) {
    const newRatio = Math.max(0.4, Math.min(0.7, ratio));
    this.splitRatio = newRatio;
    this.applySettings({ ...this.settings, splitRatio: newRatio });
  }

  async handleOpenReleaseNotes(options?: { auto?: boolean }) {
    this.releaseNotesOpen = true;
    this.releaseNotesAutoMode = options?.auto === true;
    this.releaseNotesMobileDetail = options?.auto === true;
    this.releaseNotesError = null;
    if (!this.releaseNotesIndex) {
      this.releaseNotesLoading = true;
    }
    try {
      const index = this.releaseNotesIndex ?? (await loadPlatformClawReleaseIndex(this.basePath));
      this.releaseNotesIndex = index;
      await this.handleSelectReleaseNotesVersion(index.latest, {
        showMobileDetail: options?.auto === true,
      });
    } catch (error) {
      this.releaseNotesError = error instanceof Error ? error.message : String(error);
      this.releaseNotesLoading = false;
    }
  }

  async handleSelectReleaseNotesVersion(version: string, options?: { showMobileDetail?: boolean }) {
    const release = this.releaseNotesIndex?.releases.find((entry) => entry.version === version);
    if (!release) {
      return;
    }
    this.releaseNotesSelectedVersion = version;
    this.releaseNotesMobileDetail = options?.showMobileDetail ?? true;
    this.releaseNotesError = null;
    const generation = ++this.releaseNotesLoadGeneration;
    if (this.releaseNotesMarkdownByVersion[version]) {
      this.releaseNotesLoading = false;
      return;
    }
    this.releaseNotesLoading = true;
    try {
      const markdown = await loadPlatformClawReleaseMarkdown(this.basePath, version);
      if (generation !== this.releaseNotesLoadGeneration) {
        return;
      }
      this.releaseNotesMarkdownByVersion = {
        ...this.releaseNotesMarkdownByVersion,
        [version]: markdown,
      };
    } catch (error) {
      if (generation === this.releaseNotesLoadGeneration) {
        this.releaseNotesError = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (generation === this.releaseNotesLoadGeneration) {
        this.releaseNotesLoading = false;
      }
    }
  }

  async maybeOpenUnreadReleaseNotes(): Promise<void> {
    if (!this.employeeMode) {
      return;
    }
    const employeeId = this.employeeProfile.employeeId?.trim();
    if (!employeeId || this.releaseNotesAutoCheckEmployeeId === employeeId) {
      return;
    }
    if (this.releaseNotesAutoCheckPromise) {
      await this.releaseNotesAutoCheckPromise;
      return this.maybeOpenUnreadReleaseNotes();
    }
    const check = async () => {
      try {
        const status = await loadEmployeeReleaseNotesStatus();
        if (this.employeeProfile.employeeId?.trim() !== employeeId) {
          return;
        }
        this.releaseNotesAutoCheckEmployeeId = employeeId;
        this.releaseNotesReadVersion = status.readVersion;
        if (status.shouldAutoOpen) {
          await this.handleOpenReleaseNotes({ auto: true });
        }
      } catch (error) {
        // Release note status must never block employee login.
        console.warn("[release-notes] automatic check failed", error);
      }
    };
    this.releaseNotesAutoCheckPromise = check();
    try {
      await this.releaseNotesAutoCheckPromise;
    } finally {
      this.releaseNotesAutoCheckPromise = null;
    }
  }

  async handleConfirmReleaseNotes() {
    const latestVersion = this.releaseNotesIndex?.latest;
    const employeeId = this.employeeProfile.employeeId?.trim();
    if (
      !this.employeeMode ||
      !employeeId ||
      !latestVersion ||
      this.releaseNotesSelectedVersion !== latestVersion ||
      this.releaseNotesReadSubmitting
    ) {
      return;
    }
    this.releaseNotesReadSubmitting = true;
    this.releaseNotesError = null;
    try {
      const status = await confirmEmployeeReleaseNotesRead(latestVersion);
      if (this.employeeProfile.employeeId?.trim() !== employeeId) {
        return;
      }
      this.releaseNotesReadVersion = status.readVersion;
      this.handleCloseReleaseNotes();
    } catch (error) {
      this.releaseNotesError = error instanceof Error ? error.message : String(error);
    } finally {
      this.releaseNotesReadSubmitting = false;
    }
  }

  handleReleaseNotesBackToList() {
    this.releaseNotesMobileDetail = false;
  }

  resetReleaseNotesSession() {
    this.releaseNotesAutoCheckEmployeeId = null;
    this.releaseNotesAutoCheckPromise = null;
    this.releaseNotesReadVersion = null;
    this.releaseNotesAutoMode = false;
    this.releaseNotesOpen = false;
  }

  handleCloseReleaseNotes() {
    this.releaseNotesOpen = false;
    this.releaseNotesAutoMode = false;
  }

  render() {
    return renderApp(this as unknown as AppViewState);
  }
}
