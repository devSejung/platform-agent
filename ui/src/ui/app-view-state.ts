import type {
  EmployeeUiAccountSummary,
  EmployeeUiLoginNotice,
  EmployeeMembershipGroupOption,
  EmployeeMembershipPartOption,
  EmployeeMembershipStatusResponse,
} from "../../../src/gateway/employee-ui-contract.ts";
import type { PlatformClawReleaseIndex } from "../../../src/platformclaw-release.ts";
import type { EventLogEntry } from "./app-events.ts";
import type { CompactionStatus, FallbackStatus, RunPhaseStatus } from "./app-tool-stream.ts";
import type { ArtifactFocusItem } from "./chat/artifact-focus-viewer.ts";
import type { ChatMessageCache } from "./chat/session-message-cache.ts";
import type { AccountDirectoryEntry } from "./controllers/accounts.ts";
import type { AdminAccountDetail, AdminAccountEntry } from "./controllers/admin-accounts.ts";
import type { CronModelSuggestionsState, CronState } from "./controllers/cron.ts";
import type { DevicePairingList } from "./controllers/devices.ts";
import type { ExecApprovalRequest } from "./controllers/exec-approval.ts";
import type { ExecApprovalsFile, ExecApprovalsSnapshot } from "./controllers/exec-approvals.ts";
import type {
  GroupDetail,
  GroupEntry,
  GroupJoinRequestEntry,
  GroupScopeOption,
} from "./controllers/groups.ts";
import type { SkillHubDetail, SkillHubEntry, SkillHubScope } from "./controllers/skill-hub.ts";
import type {
  ClawHubSearchResult,
  ClawHubSkillDetail,
  SkillMessage,
} from "./controllers/skills.ts";
import type { WorkspaceFileUploadItem } from "./controllers/workspace-files.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ResolvedTheme, ThemeMode, ThemeName } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  AttentionItem,
  ChannelsStatusSnapshot,
  ConfigSnapshot,
  ConfigUiHints,
  HealthSummary,
  LogEntry,
  LogLevel,
  ChatModelOverride,
  ModelCatalogEntry,
  NostrProfile,
  PresenceEntry,
  SessionsUsageResult,
  CostUsageSummary,
  SessionUsageTimeSeries,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
  ToolsCatalogResult,
} from "./types.ts";
import type { ChatAttachment, ChatQueueItem, ChatSendDraft, ChatSendFailure } from "./ui-types.ts";
import type { NostrProfileFormState } from "./views/channels.nostr-profile-form.ts";
import type { CronQuickCreateDraft, CronQuickCreateStep } from "./views/cron-quick-create.ts";
import type { SessionLogEntry } from "./views/usage.ts";

export type AppViewState = {
  settings: UiSettings;
  employeeMode: boolean;
  employeeBootstrapToken: string | null;
  employeeBootstrapReady: boolean;
  employeeBootstrapError: string | null;
  employeeLoginNotice: EmployeeUiLoginNotice | null;
  employeeLoginIdentifier: string;
  employeeLoginPassword: string;
  employeeLoginSubmitting: boolean;
  employeeUi: {
    docsUrl: string | null;
    vocUrl: string | null;
    announcementTitle: string | null;
    announcementBody: string | null;
    announcementLinkLabel: string | null;
    announcementLinkUrl: string | null;
  };
  employeeVocModalOpen: boolean;
  employeeVocTitle: string;
  employeeVocBody: string;
  employeeVocSubmitting: boolean;
  employeeVocError: string | null;
  employeeVocResult: { issueKey: string; issueUrl: string } | null;
  employeeMembershipBootstrapOpen: boolean;
  employeeMembershipBootstrapLoading: boolean;
  employeeMembershipBootstrapSubmitting: boolean;
  employeeMembershipBootstrapError: string | null;
  employeeMembershipBootstrapGroups: EmployeeMembershipGroupOption[];
  employeeMembershipBootstrapParts: EmployeeMembershipPartOption[];
  employeeMembershipBootstrapSelectedGroupId: string | null;
  employeeMembershipBootstrapSelectedPartId: string | null;
  employeeMembershipBootstrapStatus: EmployeeMembershipStatusResponse | null;
  employeeProfile: {
    employeeId: string | null;
    name: string | null;
    department: string | null;
    agentId: string | null;
  };
  employeeAccountSummary: EmployeeUiAccountSummary | null;
  password: string;
  loginShowGatewayToken: boolean;
  loginShowGatewayPassword: boolean;
  tab: Tab;
  onboarding: boolean;
  basePath: string;
  connected: boolean;
  theme: ThemeName;
  themeMode: ThemeMode;
  themeResolved: ResolvedTheme;
  themeOrder: ThemeName[];
  hello: GatewayHelloOk | null;
  releaseNotesOpen: boolean;
  releaseNotesLoading: boolean;
  releaseNotesError: string | null;
  releaseNotesIndex: PlatformClawReleaseIndex | null;
  releaseNotesSelectedVersion: string | null;
  releaseNotesMarkdownByVersion: Record<string, string>;
  releaseNotesReadVersion: string | null;
  releaseNotesAutoMode: boolean;
  releaseNotesMobileDetail: boolean;
  releaseNotesReadSubmitting: boolean;
  lastError: string | null;
  lastErrorCode: string | null;
  eventLog: EventLogEntry[];
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  sessionKey: string;
  chatLoading: boolean;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  artifactFocus: ArtifactFocusItem | null;
  chatMessages: unknown[];
  chatMessagesBySession?: ChatMessageCache;
  chatToolMessages: unknown[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatRunId: string | null;
  compactionStatus: CompactionStatus | null;
  runPhaseStatus: RunPhaseStatus | null;
  fallbackStatus: FallbackStatus | null;
  chatAvatarUrl: string | null;
  chatThinkingLevel: string | null;
  chatModelOverrides: Record<string, ChatModelOverride | null>;
  modelAuthStatusResult?: unknown;
  chatModelsLoading: boolean;
  chatModelCatalog: ModelCatalogEntry[];
  chatQueue: ChatQueueItem[];
  chatSendDrafts: Record<string, ChatSendDraft>;
  chatSendFailures: Record<string, ChatSendFailure>;
  chatManualRefreshInFlight: boolean;
  workspaceFilesLoading: boolean;
  workspaceFilesUploading: boolean;
  workspaceFilesError: string | null;
  workspaceFilesMessage: { kind: "success" | "error"; text: string } | null;
  workspaceFilesCurrentPath: string;
  workspaceFilesParentPath: string | null;
  workspaceFilesBreadcrumbs: import("../../../src/gateway/employee-workspace-files-contract.ts").WorkspaceFilesBreadcrumbEntry[];
  workspaceFilesEntries: import("../../../src/gateway/employee-workspace-files-contract.ts").WorkspaceFilesEntry[];
  workspaceFilesSelectedPaths: string[];
  workspaceFilesUploads: WorkspaceFileUploadItem[];
  workspaceFilesPreviewLoading: boolean;
  workspaceFilesPreviewError: string | null;
  workspaceFilesPreview:
    | import("../../../src/gateway/employee-workspace-files-contract.ts").WorkspaceFilePreviewResponse
    | null;
  nodesLoading: boolean;
  nodes: Array<Record<string, unknown>>;
  chatNewMessagesBelow: boolean;
  navDrawerOpen: boolean;
  sidebarOpen: boolean;
  sidebarContent: string | null;
  sidebarError: string | null;
  splitRatio: number;
  scrollToBottom: (opts?: { smooth?: boolean }) => void;
  devicesLoading: boolean;
  devicesError: string | null;
  devicesList: DevicePairingList | null;
  execApprovalsLoading: boolean;
  execApprovalsSaving: boolean;
  execApprovalsDirty: boolean;
  execApprovalsSnapshot: ExecApprovalsSnapshot | null;
  execApprovalsForm: ExecApprovalsFile | null;
  execApprovalsSelectedAgent: string | null;
  execApprovalsTarget: "gateway" | "node";
  execApprovalsTargetNodeId: string | null;
  execApprovalQueue: ExecApprovalRequest[];
  execApprovalBusy: boolean;
  execApprovalError: string | null;
  pendingGatewayUrl: string | null;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  applySessionKey: string;
  configSnapshot: ConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  dreamingStatusLoading: boolean;
  dreamingStatusError: string | null;
  dreamingStatus: import("./controllers/dreaming.js").DreamingStatus | null;
  dreamingModeSaving: boolean;
  dreamDiaryLoading: boolean;
  dreamDiaryActionLoading: boolean;
  dreamDiaryError: string | null;
  dreamDiaryPath: string | null;
  dreamDiaryContent: string | null;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;
  communicationsFormMode: "form" | "raw";
  communicationsSearchQuery: string;
  communicationsActiveSection: string | null;
  communicationsActiveSubsection: string | null;
  appearanceFormMode: "form" | "raw";
  appearanceSearchQuery: string;
  appearanceActiveSection: string | null;
  appearanceActiveSubsection: string | null;
  automationFormMode: "form" | "raw";
  automationSearchQuery: string;
  automationActiveSection: string | null;
  automationActiveSubsection: string | null;
  infrastructureFormMode: "form" | "raw";
  infrastructureSearchQuery: string;
  infrastructureActiveSection: string | null;
  infrastructureActiveSubsection: string | null;
  aiAgentsFormMode: "form" | "raw";
  aiAgentsSearchQuery: string;
  aiAgentsActiveSection: string | null;
  aiAgentsActiveSubsection: string | null;
  channelsLoading: boolean;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsError: string | null;
  channelsLastSuccess: number | null;
  whatsappLoginMessage: string | null;
  whatsappLoginQrDataUrl: string | null;
  whatsappLoginConnected: boolean | null;
  whatsappBusy: boolean;
  nostrProfileFormState: NostrProfileFormState | null;
  nostrProfileAccountId: string | null;
  configFormDirty: boolean;
  presenceLoading: boolean;
  presenceEntries: PresenceEntry[];
  presenceError: string | null;
  presenceStatus: string | null;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  agentsSelectedId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  toolsEffectiveLoading: boolean;
  toolsEffectiveLoadingKey: string | null;
  toolsEffectiveResultKey: string | null;
  toolsEffectiveError: string | null;
  toolsEffectiveResult: import("./types.js").ToolsEffectiveResult | null;
  agentsPanel: "overview" | "files" | "tools" | "skills" | "channels" | "cron";
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileActive: string | null;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsError: string | null;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsAgentId: string | null;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  sessionsHideCron: boolean;
  sessionsSearchQuery: string;
  employeeChatSessionSearch: string;
  employeeChatSessionRenameKey: string | null;
  employeeChatSessionRenameValue: string;
  employeeChatSessionRenameBusy: boolean;
  employeeChatSessionRenameError: string | null;
  employeeChatSessionActionMenuKey: string | null;
  employeeChatSessionDeleteBusyKey: string | null;
  employeeChatSessionDeleteError: string | null;
  employeeChatSessionsCollapsed: boolean;
  sessionsSortColumn: "key" | "kind" | "updated" | "tokens";
  sessionsSortDir: "asc" | "desc";
  sessionsPage: number;
  sessionsPageSize: number;
  sessionsSelectedKeys: Set<string>;
  sessionsExpandedCheckpointKey: string | null;
  sessionsCheckpointItemsByKey: Record<string, import("./types.ts").SessionCompactionCheckpoint[]>;
  sessionsCheckpointLoadingKey: string | null;
  sessionsCheckpointBusyKey: string | null;
  sessionsCheckpointErrorByKey: Record<string, string>;
  usageLoading: boolean;
  usageResult: SessionsUsageResult | null;
  usageCostSummary: CostUsageSummary | null;
  usageError: string | null;
  dashboardLoading: boolean;
  dashboardError: string | null;
  dashboardRange: import("./types.ts").DashboardRange;
  dashboardResult: import("./types.ts").DashboardSummaryResult | null;
  dashboardSortBy: import("./types.ts").DashboardSortBy;
  dashboardSortDir: import("./types.ts").DashboardSortDir;
  usageStartDate: string;
  usageEndDate: string;
  usageSelectedSessions: string[];
  usageSelectedDays: string[];
  usageSelectedHours: number[];
  usageChartMode: "tokens" | "cost";
  usageDailyChartMode: "total" | "by-type";
  usageTimeSeriesMode: "cumulative" | "per-turn";
  usageTimeSeriesBreakdownMode: "total" | "by-type";
  usageTimeSeries: SessionUsageTimeSeries | null;
  usageTimeSeriesLoading: boolean;
  usageTimeSeriesCursorStart: number | null;
  usageTimeSeriesCursorEnd: number | null;
  usageSessionLogs: SessionLogEntry[] | null;
  usageSessionLogsLoading: boolean;
  usageSessionLogsExpanded: boolean;
  usageQuery: string;
  usageQueryDraft: string;
  usageQueryDebounceTimer: number | null;
  usageSessionSort: "tokens" | "cost" | "recent" | "messages" | "errors";
  usageSessionSortDir: "asc" | "desc";
  usageRecentSessions: string[];
  usageTimeZone: "local" | "utc";
  usageContextExpanded: boolean;
  usageHeaderPinned: boolean;
  usageSessionsTab: "all" | "recent";
  usageVisibleColumns: string[];
  usageLogFilterRoles: import("./views/usage.js").SessionLogRole[];
  usageLogFilterTools: string[];
  usageLogFilterHasTools: boolean;
  usageLogFilterQuery: string;
} & Pick<
  CronState,
  | "cronLoading"
  | "cronJobsLoadingMore"
  | "cronJobs"
  | "cronJobsTotal"
  | "cronJobsHasMore"
  | "cronJobsNextOffset"
  | "cronJobsLimit"
  | "cronJobsQuery"
  | "cronJobsEnabledFilter"
  | "cronJobsScheduleKindFilter"
  | "cronJobsLastStatusFilter"
  | "cronJobsSortBy"
  | "cronJobsSortDir"
  | "cronStatus"
  | "cronError"
  | "cronForm"
  | "cronFormCollapsed"
  | "cronFieldErrors"
  | "cronEditingJobId"
  | "cronRunsJobId"
  | "cronRunsLoadingMore"
  | "cronRuns"
  | "cronRunsTotal"
  | "cronRunsHasMore"
  | "cronRunsNextOffset"
  | "cronRunsLimit"
  | "cronRunsScope"
  | "cronRunsStatuses"
  | "cronRunsDeliveryStatuses"
  | "cronRunsStatusFilter"
  | "cronRunsQuery"
  | "cronRunsSortDir"
  | "cronBusy"
> &
  Pick<CronModelSuggestionsState, "cronModelSuggestions"> & {
    cronQuickCreateOpen: boolean;
    cronQuickCreateStep: CronQuickCreateStep;
    cronQuickCreateDraft: CronQuickCreateDraft | null;
    skillsLoading: boolean;
    skillsReport: SkillStatusReport | null;
    skillsError: string | null;
    skillsFilter: string;
    skillsStatusFilter: "all" | "ready" | "needs-setup" | "disabled";
    skillEdits: Record<string, string>;
    skillMessages: Record<string, SkillMessage>;
    skillsBusyKey: string | null;
    skillsDetailKey: string | null;
    clawhubSearchQuery: string;
    clawhubSearchResults: ClawHubSearchResult[] | null;
    clawhubSearchLoading: boolean;
    clawhubSearchError: string | null;
    clawhubDetail: ClawHubSkillDetail | null;
    clawhubDetailSlug: string | null;
    clawhubDetailLoading: boolean;
    clawhubDetailError: string | null;
    clawhubInstallSlug: string | null;
    clawhubInstallMessage: { kind: "success" | "error"; text: string } | null;
    skillHubLoading: boolean;
    skillHubEntries: SkillHubEntry[];
    skillHubError: string | null;
    skillHubScope: SkillHubScope;
    skillHubSort: import("./controllers/skill-hub.ts").SkillHubSort;
    skillHubCategory: import("./controllers/skill-hub.ts").SkillHubCategoryFilter;
    skillHubQuery: string;
    skillHubDetail: SkillHubDetail | null;
    skillHubDetailSlug: string | null;
    skillHubDetailLoading: boolean;
    skillHubDetailError: string | null;
    skillHubBusySlug: string | null;
    skillHubMessage: { kind: "success" | "error"; text: string } | null;
    skillHubWorkspacePublishing: boolean;
    skillHubWorkspacePendingKeys: string[];
    skillHubWorkspacePublishEntries: import("./controllers/skill-hub.ts").WorkspacePublishEntry[];
    skillHubOverview: import("./controllers/skill-hub.ts").SkillHubOverview | null;
    skillHubUploading: boolean;
    skillHubWorkspacePanelOpen: boolean;
    skillHubEditorOpen: boolean;
    skillHubEditorMode: "publish" | "upload" | "edit-metadata" | null;
    skillHubEditorSlug: string | null;
    skillHubEditorTitle: string | null;
    skillHubEditorSkillName: string | null;
    skillHubEditorFile: File | null;
    skillHubEditorIconFile: File | null;
    skillHubEditorIconReset: boolean;
    skillHubEditorDescription: string;
    skillHubEditorDisplayName: string;
    skillHubEditorCategory: import("./controllers/skill-hub.ts").SkillCategory | "";
    skillHubEditorRevision: number;
    skillHubEditorPrompts: string[];
    skillHubEditorError: string | null;
    skillHubEditorLoading: boolean;
    skillHubTransferOpen: boolean;
    skillHubTransferSlug: string | null;
    skillHubTransferTitle: string | null;
    skillHubTransferQuery: string;
    skillHubTransferResults: AccountDirectoryEntry[];
    skillHubTransferTargetAccountId: string | null;
    skillHubTransferReason: string;
    skillHubTransferLoading: boolean;
    skillHubTransferError: string | null;
    groupsLoading: boolean;
    groupsEntries: GroupEntry[];
    groupsError: string | null;
    groupsIncludeArchived: boolean;
    groupsDetailGroupId: string | null;
    groupsDetailLoading: boolean;
    groupsDetail: GroupDetail | null;
    groupsDetailError: string | null;
    groupsScopeOptions: GroupScopeOption[];
    groupsMessage: { kind: "success" | "error"; text: string } | null;
    groupsJoinRequests: GroupJoinRequestEntry[];
    groupsJoinRequestsLoading: boolean;
    groupsJoinRequestsError: string | null;
    groupsJoinRequestsPendingCount: number;
    groupsCreateOpen: boolean;
    groupsCreateName: string;
    groupsCreateDescription: string;
    groupsCreateSubmitting: boolean;
    groupsPartCreateOpen: boolean;
    groupsPartCreateParentId: string | null;
    groupsPartCreateName: string;
    groupsPartCreateDescription: string;
    groupsPartCreateSubmitting: boolean;
    groupsEditOpen: boolean;
    groupsEditScopeType: "group" | "part";
    groupsEditScopeId: string | null;
    groupsEditParentGroupId: string | null;
    groupsEditTitle: string | null;
    groupsEditName: string;
    groupsEditDescription: string;
    groupsEditSubmitting: boolean;
    groupsMemberModalOpen: boolean;
    groupsMemberModalScopeType: "group" | "part";
    groupsMemberModalScopeId: string | null;
    groupsMemberModalScopeLabel: string | null;
    groupsMemberModalQuery: string;
    groupsMemberModalResults: AccountDirectoryEntry[];
    groupsMemberModalSelectedAccountId: string | null;
    groupsMemberModalRole: "member" | "leader";
    groupsMemberModalError: string | null;
    groupsMemberModalLoading: boolean;
    adminAccountsLoading: boolean;
    adminAccountsEntries: AdminAccountEntry[];
    adminAccountsError: string | null;
    adminAccountsQuery: string;
    adminAccountDetailLoading: boolean;
    adminAccountDetail: AdminAccountDetail | null;
    adminAccountDetailError: string | null;
    adminAccountDetailAccountId: string | null;
    adminAccountMessage: { kind: "success" | "error"; text: string } | null;
    adminRoleModalOpen: boolean;
    adminRoleModalAccountId: string | null;
    adminRoleModalAccountName: string | null;
    adminRoleModalNextRole: "member" | "admin";
    healthLoading: boolean;
    healthResult: HealthSummary | null;
    healthError: string | null;
    debugLoading: boolean;
    debugStatus: StatusSummary | null;
    debugHealth: HealthSummary | null;
    debugModels: ModelCatalogEntry[];
    debugHeartbeat: unknown;
    debugCallMethod: string;
    debugCallParams: string;
    debugCallResult: string | null;
    debugCallError: string | null;
    logsLoading: boolean;
    logsError: string | null;
    logsFile: string | null;
    logsEntries: LogEntry[];
    logsFilterText: string;
    logsLevelFilters: Record<LogLevel, boolean>;
    logsAutoFollow: boolean;
    logsTruncated: boolean;
    logsCursor: number | null;
    logsLastFetchAt: number | null;
    logsLimit: number;
    logsMaxBytes: number;
    logsAtBottom: boolean;
    updateAvailable: import("./types.js").UpdateAvailable | null;
    attentionItems: AttentionItem[];
    paletteOpen: boolean;
    paletteQuery: string;
    paletteActiveIndex: number;
    streamMode: boolean;
    overviewShowGatewayToken: boolean;
    overviewShowGatewayPassword: boolean;
    overviewLogLines: string[];
    overviewLogCursor: number;
    client: GatewayBrowserClient | null;
    refreshSessionsAfterChat: Set<string>;
    connect: () => void;
    setTab: (tab: Tab) => void;
    setTheme: (theme: ThemeName, context?: ThemeTransitionContext) => void;
    setThemeMode: (mode: ThemeMode, context?: ThemeTransitionContext) => void;
    setBorderRadius: (value: number) => void;
    applySettings: (next: UiSettings) => void;
    loadOverview: () => Promise<void>;
    loadAssistantIdentity: () => Promise<void>;
    loadCron: () => Promise<void>;
    loadWorkspaceFiles: (path?: string) => Promise<void>;
    openWorkspaceFilePreview: (relativePath: string) => Promise<void>;
    closeWorkspaceFilePreview: () => void;
    toggleWorkspaceFileSelection: (relativePath: string, selected: boolean) => void;
    setAllWorkspaceFileSelections: (relativePaths: string[], selected: boolean) => void;
    downloadWorkspaceFiles: (relativePaths: string[]) => void;
    createWorkspaceFolder: (name: string) => Promise<void>;
    renameWorkspaceEntry: (relativePath: string, nextName: string) => Promise<void>;
    deleteWorkspaceEntries: (relativePaths: string[]) => Promise<void>;
    uploadWorkspaceFiles: (files: File[]) => Promise<void>;
    handleWhatsAppStart: (force: boolean) => Promise<void>;
    handleWhatsAppWait: () => Promise<void>;
    handleWhatsAppLogout: () => Promise<void>;
    handleChannelConfigSave: () => Promise<void>;
    handleChannelConfigReload: () => Promise<void>;
    handleNostrProfileEdit: (accountId: string, profile: NostrProfile | null) => void;
    handleNostrProfileCancel: () => void;
    handleNostrProfileFieldChange: (field: keyof NostrProfile, value: string) => void;
    handleNostrProfileSave: () => Promise<void>;
    handleNostrProfileImport: () => Promise<void>;
    handleNostrProfileToggleAdvanced: () => void;
    handleExecApprovalDecision: (decision: "allow-once" | "allow-always" | "deny") => Promise<void>;
    handleGatewayUrlConfirm: () => void;
    handleGatewayUrlCancel: () => void;
    handleEmployeeLogin: () => Promise<void>;
    handleEmployeeAdSso: () => Promise<void>;
    handleEmployeeLogout: () => Promise<void>;
    handleEmployeeVocSubmit: () => Promise<void>;
    handleEmployeeMembershipBootstrapGroupChange: (groupId: string) => Promise<void>;
    handleEmployeeMembershipBootstrapConfirm: () => Promise<void>;
    handleEmployeeMembershipBootstrapCancel: () => Promise<void>;
    handleEmployeeMembershipBootstrapSkip: () => Promise<void>;
    handleConfigLoad: () => Promise<void>;
    handleConfigSave: () => Promise<void>;
    handleConfigApply: () => Promise<void>;
    handleConfigFormUpdate: (path: string, value: unknown) => void;
    handleConfigFormModeChange: (mode: "form" | "raw") => void;
    handleConfigRawChange: (raw: string) => void;
    handleInstallSkill: (key: string) => Promise<void>;
    handleUpdateSkill: (key: string) => Promise<void>;
    handleToggleSkillEnabled: (key: string, enabled: boolean) => Promise<void>;
    handleUpdateSkillEdit: (key: string, value: string) => void;
    handleSaveSkillApiKey: (key: string, apiKey: string) => Promise<void>;
    handleCronToggle: (jobId: string, enabled: boolean) => Promise<void>;
    handleCronRun: (jobId: string) => Promise<void>;
    handleCronRemove: (jobId: string) => Promise<void>;
    handleCronAdd: () => Promise<void>;
    handleCronRunsLoad: (jobId: string) => Promise<void>;
    handleCronFormUpdate: (path: string, value: unknown) => void;
    handleSessionsLoad: () => Promise<void>;
    handleSessionsPatch: (key: string, patch: unknown) => Promise<void>;
    handleLoadNodes: () => Promise<void>;
    handleLoadPresence: () => Promise<void>;
    handleLoadSkills: () => Promise<void>;
    handleLoadDebug: () => Promise<void>;
    handleLoadLogs: () => Promise<void>;
    handleDebugCall: () => Promise<void>;
    handleRunUpdate: () => Promise<void>;
    setPassword: (next: string) => void;
    setChatMessage: (next: string) => void;
    handleSendChat: (messageOverride?: string, opts?: { restoreDraft?: boolean }) => Promise<void>;
    retryFailedChatMessage: (runId: string) => Promise<void>;
    handleAbortChat: () => Promise<void>;
    removeQueuedMessage: (id: string) => void;
    handleChatScroll: (event: Event) => void;
    handleContentScroll: () => void;
    resetToolStream: () => void;
    resetChatScroll: () => void;
    exportLogs: (lines: string[], label: string) => void;
    handleLogsScroll: (event: Event) => void;
    handleOpenSidebar: (content: string) => void;
    handleCloseSidebar: () => void;
    handleSplitRatioChange: (ratio: number) => void;
    handleOpenReleaseNotes: (options?: { auto?: boolean }) => Promise<void>;
    handleSelectReleaseNotesVersion: (
      version: string,
      options?: { showMobileDetail?: boolean },
    ) => Promise<void>;
    handleConfirmReleaseNotes: () => Promise<void>;
    handleReleaseNotesBackToList: () => void;
    handleCloseReleaseNotes: () => void;
  };
