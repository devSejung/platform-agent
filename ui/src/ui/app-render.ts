import { html, nothing } from "lit";
import { ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { i18n, t, type Locale } from "../i18n/index.ts";
import { getSafeLocalStorage } from "../local-storage.ts";
import { hasAbortableSessionRun, refreshChatAvatar } from "./app-chat.ts";
import { DEFAULT_CRON_FORM } from "./app-defaults.ts";
import { renderUsageTab } from "./app-render-usage-tab.ts";
import {
  renderChatControls,
  renderChatMobileToggle,
  renderChatSessionSelect,
  renderTab,
  renderSidebarConnectionStatus,
  renderTopbarThemeModeToggle,
  resolveSessionDisplayName,
  switchChatSession,
} from "./app-render.helpers.ts";
import { warnQueryToken } from "./app-settings.ts";
import type { AppViewState } from "./app-view-state.ts";
import { searchDirectoryAccounts } from "./controllers/accounts.ts";
import {
  loadAdminAccounts,
  loadAdminAccountDetail,
  updateAdminAccountRoleAction,
} from "./controllers/admin-accounts.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import { loadAgentSkills } from "./controllers/agent-skills.ts";
import {
  buildToolsEffectiveRequestKey,
  loadAgents,
  loadToolsCatalog,
  loadToolsEffective,
  refreshVisibleToolsEffectiveForCurrentSession,
  saveAgentsConfig,
} from "./controllers/agents.ts";
import { loadChannels } from "./controllers/channels.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import {
  applyConfig,
  ensureAgentConfigEntry,
  findAgentConfigEntryIndex,
  loadConfig,
  openConfigFile,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import {
  deleteCredentialDefinitionAction,
  loadCredentialDefinitions,
  loadCredentials,
  loadCredentialStatus,
  revokeCredentialAction,
  upsertCredentialAction,
  upsertCredentialDefinitionAction,
} from "./controllers/credentials.ts";
import {
  loadCronRuns,
  loadMoreCronJobs,
  loadMoreCronRuns,
  reloadCronJobs,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
  startCronEdit,
  startCronClone,
  cancelCronEdit,
  validateCronForm,
  hasCronFormErrors,
  normalizeCronFormState,
  getVisibleCronJobs,
  updateCronJobsFilter,
  updateCronRunsFilter,
} from "./controllers/cron.ts";
import { loadDashboard } from "./controllers/dashboard.ts";
import { loadDebug, callDebugMethod } from "./controllers/debug.ts";
import {
  approveDevicePairing,
  loadDevices,
  rejectDevicePairing,
  revokeDeviceToken,
  rotateDeviceToken,
} from "./controllers/devices.ts";
import {
  backfillDreamDiary,
  loadDreamDiary,
  loadDreamingStatus,
  resetGroundedShortTerm,
  resetDreamDiary,
  resolveConfiguredDreaming,
  updateDreamingEnabled,
} from "./controllers/dreaming.ts";
import {
  loadExecApprovals,
  removeExecApprovalsFormValue,
  saveExecApprovals,
  updateExecApprovalsFormValue,
} from "./controllers/exec-approvals.ts";
import {
  addGroupMemberAction,
  archiveGroupScopeAction,
  createGroupAction,
  createPartAction,
  loadGroups,
  loadGroupDetail,
  loadGroupScopeOptions,
  removeGroupMemberAction,
  updateGroupAction,
  updatePartAction,
} from "./controllers/groups.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";
import { loadPresence } from "./controllers/presence.ts";
import {
  branchSessionFromCheckpoint,
  deleteSessionsAndRefresh,
  loadSessions,
  patchSession,
  restoreSessionFromCheckpoint,
  toggleSessionCompactionCheckpoints,
} from "./controllers/sessions.ts";
import {
  closeSkillHubDetail,
  deleteSkillHubEntry,
  deleteSkillHubSkill,
  installSkillHubSkill,
  loadSkillHub,
  loadSkillHubDetail,
  loadSkillHubWorkspacePublish,
  publishWorkspaceSkillWithPrompts,
  resolveExistingSkillHubPromptsForSkillName,
  toEditorPrompts,
  transferSkillHubOwnershipAction,
  toggleLikeSkillHubSkill,
  updateSkillHubSkill,
  updateSkillHubPresentationAction,
  uploadSkillHubPackageWithPrompts,
} from "./controllers/skill-hub.ts";
import {
  deleteWorkspaceSkill,
  closeClawHubDetail,
  installFromClawHub,
  installSkill,
  loadClawHubDetail,
  loadSkills,
  saveSkillApiKey,
  searchClawHub,
  setClawHubSearchQuery,
  updateSkillEdit,
  updateSkillEnabled,
} from "./controllers/skills.ts";
import {
  dismissEmployeeAnnouncement,
  isEmployeeAnnouncementDismissed,
  resolveEmployeeAnnouncement,
} from "./employee-announcement.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "./external-link.ts";
import { icons } from "./icons.ts";
import "./components/dashboard-header.ts";
import { toSanitizedMarkdownHtml } from "./markdown.ts";
import {
  employeeSidebarTabGroups,
  employeeUtilityTabGroups,
  normalizeBasePath,
  pathForTab,
  subtitleForTab,
  tabGroupsForMode,
  titleForTab,
  type Tab,
} from "./navigation.ts";
import {
  buildAgentMainSessionKey,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
} from "./session-key.ts";
import type { GatewaySessionRow } from "./types.ts";
import {
  employeeLogoUrl,
  resolveAgentConfig,
  resolveConfiguredCronModelSuggestions,
  resolveEffectiveModelFallbacks,
  resolveModelPrimary,
  sortLocaleStrings,
} from "./views/agents-utils.ts";
import { renderChat } from "./views/chat.ts";
import { renderCommandPalette } from "./views/command-palette.ts";
import { renderConfig } from "./views/config.ts";
import {
  createDefaultDraft,
  draftToCronFormPatch,
  renderCronQuickCreate,
} from "./views/cron-quick-create.ts";
import { renderDreaming } from "./views/dreaming.ts";
import { renderExecApprovalPrompt } from "./views/exec-approval.ts";
import { renderGatewayUrlConfirmation } from "./views/gateway-url-confirmation.ts";
import { renderLoginGate } from "./views/login-gate.ts";
import { renderOverview } from "./views/overview.ts";
import { renderWorkspaceFiles } from "./views/workspace-files.ts";

// Lazy-loaded view modules ??deferred so the initial bundle stays small.
// Each loader resolves once; subsequent calls return the cached module.
type LazyState<T> = { mod: T | null; promise: Promise<T> | null };

let _pendingUpdate: (() => void) | undefined;

function createLazy<T>(loader: () => Promise<T>): () => T | null {
  const s: LazyState<T> = { mod: null, promise: null };
  return () => {
    if (s.mod) {
      return s.mod;
    }
    if (!s.promise) {
      s.promise = loader().then((m) => {
        s.mod = m;
        _pendingUpdate?.();
        return m;
      });
    }
    return null;
  };
}

const lazyAgents = createLazy(() => import("./views/agents.ts"));
const lazyChannels = createLazy(() => import("./views/channels.ts"));
const lazyCron = createLazy(() => import("./views/cron.ts"));
const lazyDashboard = createLazy(() => import("./views/dashboard.ts"));
const lazyDebug = createLazy(() => import("./views/debug.ts"));
const lazyInstances = createLazy(() => import("./views/instances.ts"));
const lazyLogs = createLazy(() => import("./views/logs.ts"));
const lazyNodes = createLazy(() => import("./views/nodes.ts"));
const lazySessions = createLazy(() => import("./views/sessions.ts"));
const lazySkills = createLazy(() => import("./views/skills.ts"));
const lazySkillHub = createLazy(() => import("./views/skill-hub.ts"));
const lazyCredentials = createLazy(() => import("./views/credentials.ts"));
const lazyGroups = createLazy(() => import("./views/groups.ts"));
const lazyAdmin = createLazy(() => import("./views/admin.ts"));

function formatDreamNextCycle(nextRunAtMs: number | undefined): string | null {
  if (typeof nextRunAtMs !== "number" || !Number.isFinite(nextRunAtMs)) {
    return null;
  }
  return new Date(nextRunAtMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function resolveDreamingNextCycle(
  status: { phases: Record<string, { enabled: boolean; nextRunAtMs?: number }> } | null,
): string | null {
  if (!status) {
    return null;
  }
  const nextRunAtMs = Object.values(status.phases)
    .filter((phase) => phase.enabled && typeof phase.nextRunAtMs === "number")
    .map((phase) => phase.nextRunAtMs as number)
    .toSorted((a, b) => a - b)[0];
  return formatDreamNextCycle(nextRunAtMs);
}

let clawhubSearchTimer: ReturnType<typeof setTimeout> | null = null;

function lazyRender<M>(getter: () => M | null, render: (mod: M) => unknown) {
  const mod = getter();
  return mod ? render(mod) : nothing;
}

const UPDATE_BANNER_DISMISS_KEY = "openclaw:control-ui:update-banner-dismissed:v1";
const CRON_THINKING_SUGGESTIONS = ["off", "minimal", "low", "medium", "high"];
const CRON_TIMEZONE_SUGGESTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeSuggestionValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

function renderEmployeeLocaleToggle(state: AppViewState, navCollapsed: boolean) {
  const currentLocale: Locale = state.settings.locale === "en" ? "en" : "ko";
  const options: Array<{ locale: Locale; shortLabel: string; labelKey: string }> = [
    { locale: "ko", shortLabel: "KO", labelKey: "languages.ko" },
    { locale: "en", shortLabel: "EN", labelKey: "languages.en" },
  ];
  return html`
    <div class="sidebar-language-toggle">
      ${!navCollapsed
        ? html`<div class="sidebar-language-toggle__label">${t("common.language")}</div>`
        : nothing}
      <div class="sidebar-language-toggle__actions">
        ${options.map(
          (option) => html`
            <button
              type="button"
              class="btn btn--sm ${currentLocale === option.locale ? "active" : ""}"
              title=${t(option.labelKey)}
              aria-pressed=${currentLocale === option.locale}
              @click=${() => {
                if (currentLocale === option.locale) {
                  return;
                }
                void i18n.setLocale(option.locale);
                state.applySettings({ ...state.settings, locale: option.locale });
              }}
            >
              ${navCollapsed ? option.shortLabel : t(option.labelKey)}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

type DismissedUpdateBanner = {
  latestVersion: string;
  channel: string | null;
  dismissedAtMs: number;
};

function loadDismissedUpdateBanner(): DismissedUpdateBanner | null {
  try {
    const raw = getSafeLocalStorage()?.getItem(UPDATE_BANNER_DISMISS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DismissedUpdateBanner>;
    if (!parsed || typeof parsed.latestVersion !== "string") {
      return null;
    }
    return {
      latestVersion: parsed.latestVersion,
      channel: typeof parsed.channel === "string" ? parsed.channel : null,
      dismissedAtMs: typeof parsed.dismissedAtMs === "number" ? parsed.dismissedAtMs : Date.now(),
    };
  } catch {
    return null;
  }
}

function isUpdateBannerDismissed(updateAvailable: unknown): boolean {
  const dismissed = loadDismissedUpdateBanner();
  if (!dismissed) {
    return false;
  }
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  return Boolean(
    latestVersion && dismissed.latestVersion === latestVersion && dismissed.channel === channel,
  );
}

function dismissUpdateBanner(updateAvailable: unknown) {
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  if (!latestVersion) {
    return;
  }
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  const payload: DismissedUpdateBanner = {
    latestVersion,
    channel,
    dismissedAtMs: Date.now(),
  };
  try {
    getSafeLocalStorage()?.setItem(UPDATE_BANNER_DISMISS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;
const COMMUNICATION_SECTION_KEYS = ["channels", "messages", "broadcast", "talk", "audio"] as const;
const APPEARANCE_SECTION_KEYS = ["__appearance__", "ui", "wizard"] as const;
const AUTOMATION_SECTION_KEYS = [
  "commands",
  "hooks",
  "bindings",
  "cron",
  "approvals",
  "plugins",
] as const;
const INFRASTRUCTURE_SECTION_KEYS = [
  "gateway",
  "web",
  "browser",
  "nodeHost",
  "canvasHost",
  "discovery",
  "media",
  "acp",
  "mcp",
] as const;
const AI_AGENTS_SECTION_KEYS = [
  "agents",
  "models",
  "skills",
  "tools",
  "memory",
  "session",
] as const;
type CommunicationSectionKey = (typeof COMMUNICATION_SECTION_KEYS)[number];
type AppearanceSectionKey = (typeof APPEARANCE_SECTION_KEYS)[number];
type AutomationSectionKey = (typeof AUTOMATION_SECTION_KEYS)[number];
type InfrastructureSectionKey = (typeof INFRASTRUCTURE_SECTION_KEYS)[number];
type AiAgentsSectionKey = (typeof AI_AGENTS_SECTION_KEYS)[number];

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

function trimStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveWorkspaceDocsUrl(state: AppViewState): string | null {
  const configDocsUrl = trimStringOrNull(
    (state.configSnapshot?.config as { gateway?: { controlUi?: { docsUrl?: unknown } } } | null)
      ?.gateway?.controlUi?.docsUrl,
  );
  return configDocsUrl ?? state.employeeUi.docsUrl;
}

function renderEmployeeLoginNotice(state: AppViewState) {
  if (!state.employeeMode || !state.employeeLoginNotice) {
    return nothing;
  }
  return html`
    <div class="callout info" role="status">
      <strong>${state.employeeLoginNotice.title}</strong>
      <div>${state.employeeLoginNotice.body}</div>
      <div style="margin-top:8px;">
        <button
          class="btn btn--sm"
          type="button"
          @click=${() => {
            state.employeeLoginNotice = null;
          }}
        >
          확인
        </button>
      </div>
    </div>
  `;
}

function renderEmployeeIdentitySummary(state: AppViewState, navCollapsed: boolean) {
  if (!state.employeeMode || navCollapsed) {
    return nothing;
  }
  const employeeId = trimStringOrNull(state.employeeProfile.employeeId);
  const employeeName = trimStringOrNull(state.employeeProfile.name);
  const department = trimStringOrNull(state.employeeProfile.department);
  const agentId = trimStringOrNull(state.employeeProfile.agentId);
  const accountSummary = state.employeeAccountSummary;
  if (!employeeId && !employeeName && !department && !agentId) {
    return nothing;
  }
  const roleLabel =
    accountSummary?.globalRole === "admin"
      ? "Admin"
      : accountSummary?.hasLeaderScope
        ? "Leader"
        : accountSummary?.globalRole === "member"
          ? "Member"
          : null;
  const groupSummary = accountSummary
    ? [
        accountSummary.groupCount > 0 ? `${accountSummary.groupCount} group` : null,
        accountSummary.partCount > 0 ? `${accountSummary.partCount} part` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  return html`
    <section class="sidebar-identity" aria-label="Employee identity">
      <div class="sidebar-identity__header">
        <span class="sidebar-identity__title">Signed in</span>
        ${employeeId ? html`<span class="sidebar-identity__badge">${employeeId}</span>` : nothing}
      </div>
      ${employeeName ? html`<div class="sidebar-identity__primary">${employeeName}</div>` : nothing}
      ${roleLabel || groupSummary
        ? html`
            <div class="sidebar-identity__chips">
              ${roleLabel
                ? html`<span class="sidebar-identity__chip sidebar-identity__chip--role"
                    >${roleLabel}</span
                  >`
                : nothing}
              ${groupSummary
                ? html`<span class="sidebar-identity__chip">${groupSummary}</span>`
                : nothing}
            </div>
          `
        : nothing}
      <div class="sidebar-identity__meta">
        ${department
          ? html`
              <div class="sidebar-identity__row">
                <span class="sidebar-identity__label">Department</span>
                <strong>${department}</strong>
              </div>
            `
          : nothing}
        ${accountSummary?.topLevelGroupNames?.length
          ? html`
              <div class="sidebar-identity__row">
                <span class="sidebar-identity__label">Groups</span>
                <strong>${accountSummary.topLevelGroupNames.join(", ")}</strong>
              </div>
            `
          : nothing}
        ${agentId
          ? html`
              <div class="sidebar-identity__row">
                <span class="sidebar-identity__label">Agent</span>
                <strong>${agentId}</strong>
              </div>
            `
          : nothing}
      </div>
    </section>
  `;
}

function formatEmployeeDateTime(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return t("employeeHeartbeat.noRecord");
  }
  return new Intl.DateTimeFormat(i18n.getLocale() === "en" ? "en-US" : "ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatEmployeeRelative(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return t("employeeHeartbeat.noHistoryYet");
  }
  const diffMs = Date.now() - value;
  const english = i18n.getLocale() === "en";
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60_000));
  if (absMinutes < 60) {
    return english
      ? `${absMinutes} minute${absMinutes === 1 ? "" : "s"} ${diffMs >= 0 ? "ago" : "from now"}`
      : `${absMinutes}분 ${diffMs >= 0 ? "전" : "후"}`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return english
      ? `${absHours} hour${absHours === 1 ? "" : "s"} ${diffMs >= 0 ? "ago" : "from now"}`
      : `${absHours}시간 ${diffMs >= 0 ? "전" : "후"}`;
  }
  const absDays = Math.round(absHours / 24);
  return english
    ? `${absDays} day${absDays === 1 ? "" : "s"} ${diffMs >= 0 ? "ago" : "from now"}`
    : `${absDays}일 ${diffMs >= 0 ? "전" : "후"}`;
}

function isEmployeeChatSessionRowVisible(state: AppViewState, row: GatewaySessionRow): boolean {
  if (!state.employeeMode) {
    return true;
  }
  const agentId = state.employeeProfile?.agentId?.trim();
  const key = row.key?.trim();
  if (!agentId || !key) {
    return false;
  }
  return parseAgentSessionKey(key)?.agentId === agentId;
}

function isEmployeeMainChatSessionRow(state: AppViewState, row: GatewaySessionRow): boolean {
  const agentId = state.employeeProfile?.agentId?.trim();
  const parsed = parseAgentSessionKey(row.key?.trim() ?? "");
  return Boolean(agentId && parsed?.agentId === agentId && parsed.rest === "main");
}

function formatEmployeeSessionMeta(
  row: GatewaySessionRow,
  defaults: NonNullable<AppViewState["sessionsResult"]>["defaults"] | undefined,
): string {
  const model =
    typeof row.model === "string" && row.model.trim()
      ? row.model.trim()
      : typeof defaults?.model === "string"
        ? defaults.model.trim()
        : "";
  const provider =
    typeof row.modelProvider === "string" && row.modelProvider.trim()
      ? row.modelProvider.trim()
      : typeof defaults?.modelProvider === "string"
        ? defaults.modelProvider.trim()
        : "";
  const modelLabel = provider && model && !model.includes("/") ? `${provider}/${model}` : model;
  return [modelLabel, formatEmployeeRelative(row.updatedAt)].filter(Boolean).join(" · ");
}

function formatEmployeeSessionTitle(row: GatewaySessionRow): string {
  const displayName = resolveSessionDisplayName(row.key, row);
  if (displayName && displayName !== row.key) {
    return displayName;
  }
  const parsed = parseAgentSessionKey(row.key);
  if (parsed?.agentId && parsed.rest) {
    return parsed.rest;
  }
  return displayName || row.key;
}

function canRenameEmployeeChatSession(row: GatewaySessionRow): boolean {
  const key = row.key.trim().toLowerCase();
  if (key === "main") {
    return false;
  }
  return parseAgentSessionKey(row.key)?.rest !== "main";
}

function canMutateEmployeeChatSession(row: GatewaySessionRow): boolean {
  return canRenameEmployeeChatSession(row);
}

async function createEmployeeChatSession(state: AppViewState) {
  if (!state.client || !state.connected) {
    return;
  }
  const agentId = state.employeeProfile?.agentId?.trim();
  try {
    const created = await state.client.request<{ key?: string }>(
      "sessions.create",
      agentId ? { agentId } : {},
    );
    await loadSessions(state, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: false,
      includeUnknown: false,
    });
    const key = typeof created?.key === "string" ? created.key.trim() : "";
    if (key) {
      await switchChatSession(state, key);
      state.setTab("chat");
    }
  } catch (err) {
    state.sessionsError = String(err);
  }
}

function patchEmployeeSessionLabel(
  state: AppViewState,
  sessionKey: string,
  label: string | undefined,
) {
  const current = state.sessionsResult;
  if (!current) {
    return;
  }
  state.sessionsResult = {
    ...current,
    sessions: current.sessions.map((row) =>
      row.key === sessionKey
        ? {
            ...row,
            label,
          }
        : row,
    ),
  };
}

function startEmployeeChatSessionRename(state: AppViewState, row: GatewaySessionRow) {
  if (!canRenameEmployeeChatSession(row)) {
    cancelEmployeeChatSessionRename(state);
    return;
  }
  state.employeeChatSessionActionMenuKey = null;
  state.employeeChatSessionDeleteError = null;
  state.employeeChatSessionRenameKey = row.key;
  state.employeeChatSessionRenameValue =
    typeof row.label === "string" && row.label.trim()
      ? row.label.trim()
      : formatEmployeeSessionTitle(row);
  state.employeeChatSessionRenameError = null;
}

function cancelEmployeeChatSessionRename(state: AppViewState) {
  state.employeeChatSessionRenameKey = null;
  state.employeeChatSessionRenameValue = "";
  state.employeeChatSessionRenameBusy = false;
  state.employeeChatSessionRenameError = null;
}

function closeEmployeeChatSessionActionMenu(state: AppViewState) {
  state.employeeChatSessionActionMenuKey = null;
}

function toggleEmployeeChatSessionActionMenu(state: AppViewState, row: GatewaySessionRow) {
  if (!canMutateEmployeeChatSession(row)) {
    closeEmployeeChatSessionActionMenu(state);
    return;
  }
  state.employeeChatSessionRenameError = null;
  state.employeeChatSessionDeleteError = null;
  state.employeeChatSessionActionMenuKey =
    state.employeeChatSessionActionMenuKey === row.key ? null : row.key;
}

async function deleteEmployeeChatSession(state: AppViewState, row: GatewaySessionRow) {
  if (
    !state.client ||
    !state.connected ||
    state.employeeChatSessionDeleteBusyKey ||
    !canMutateEmployeeChatSession(row)
  ) {
    return;
  }
  const english = state.settings.locale === "en";
  const title = formatEmployeeSessionTitle(row);
  const confirmed = window.confirm(
    english
      ? `Delete "${title}"?\n\nThis archives the transcript and removes the session from this employee agent.`
      : `"${title}" 세션을 삭제할까요?\n\n대화 기록은 보관되고 이 직원 에이전트의 세션 목록에서 제거됩니다.`,
  );
  if (!confirmed) {
    closeEmployeeChatSessionActionMenu(state);
    return;
  }

  const deletingActiveSession = row.key === state.sessionKey;
  const nextMainSessionKey =
    buildAgentMainSessionKey({
      agentId:
        resolveAgentIdFromSessionKey(row.key) ||
        state.employeeProfile?.agentId?.trim() ||
        resolveAgentIdFromSessionKey(state.sessionKey) ||
        "main",
    }) || "main";

  state.employeeChatSessionDeleteBusyKey = row.key;
  state.employeeChatSessionDeleteError = null;
  closeEmployeeChatSessionActionMenu(state);
  try {
    await state.client.request("sessions.delete", { key: row.key, deleteTranscript: true });
    await loadSessions(state, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: false,
      includeUnknown: false,
    });
    if (deletingActiveSession) {
      if (await switchChatSession(state, nextMainSessionKey)) {
        state.setTab("chat");
        void refreshChatAvatar(state);
      }
    }
  } catch (err) {
    state.employeeChatSessionDeleteError = String(err);
  } finally {
    if (state.employeeChatSessionDeleteBusyKey === row.key) {
      state.employeeChatSessionDeleteBusyKey = null;
    }
  }
}

async function saveEmployeeChatSessionRename(state: AppViewState, row: GatewaySessionRow) {
  if (
    !state.client ||
    !state.connected ||
    state.employeeChatSessionRenameBusy ||
    !canRenameEmployeeChatSession(row)
  ) {
    return;
  }
  const nextLabel = state.employeeChatSessionRenameValue.trim();
  const previousLabel =
    typeof row.label === "string" && row.label.trim() ? row.label.trim() : undefined;
  if ((previousLabel ?? "") === nextLabel) {
    cancelEmployeeChatSessionRename(state);
    return;
  }

  state.employeeChatSessionRenameBusy = true;
  state.employeeChatSessionRenameError = null;
  patchEmployeeSessionLabel(state, row.key, nextLabel || undefined);
  try {
    await state.client.request("sessions.patch", {
      key: row.key,
      label: nextLabel || null,
    });
    await loadSessions(state, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: false,
      includeUnknown: false,
    });
    cancelEmployeeChatSessionRename(state);
  } catch (err) {
    patchEmployeeSessionLabel(state, row.key, previousLabel);
    state.employeeChatSessionRenameBusy = false;
    state.employeeChatSessionRenameError = String(err);
  }
}

function renderEmployeeChatSessionList(state: AppViewState, tab: Tab, navCollapsed: boolean) {
  if (!state.employeeMode || tab !== "chat" || navCollapsed) {
    return nothing;
  }
  const query = state.employeeChatSessionSearch.trim().toLowerCase();
  const rows = (state.sessionsResult?.sessions ?? [])
    .filter((row) => isEmployeeChatSessionRowVisible(state, row))
    .filter((row) => {
      if (!query) {
        return true;
      }
      const name = formatEmployeeSessionTitle(row).toLowerCase();
      const meta = formatEmployeeSessionMeta(row, state.sessionsResult?.defaults).toLowerCase();
      return name.includes(query) || meta.includes(query);
    })
    .toSorted((left, right) => {
      const leftMain = isEmployeeMainChatSessionRow(state, left);
      const rightMain = isEmployeeMainChatSessionRow(state, right);
      if (leftMain === rightMain) {
        return 0;
      }
      return leftMain ? -1 : 1;
    });
  const count = rows.length;
  const english = state.settings.locale === "en";
  const recentSessionsLabel = t("overview.cards.recentSessions");
  const newSessionLabel = t("overview.quickActions.newSession");
  const noRecentSessionsLabel = t("usage.sessions.noRecent");
  const searchLabel = t("common.search");
  const renameLabel = english ? "Rename" : "이름 변경";
  const deleteLabel = english ? "Delete" : "삭제";
  const deletingLabel = english ? "Deleting" : "삭제 중";
  const menuLabel = english ? "Session actions" : "세션 작업";
  const saveLabel = english ? "Save" : "저장";
  const cancelLabel = english ? "Cancel" : "취소";
  const liveLabel = english ? "In progress" : "진행 중";
  const renameInputLabel = english ? "Session name" : "세션 이름";
  const loadingLabel = english ? "Loading..." : "불러오는 중";
  return html`
    <div class="employee-chat-sessions" aria-label=${recentSessionsLabel}>
      <div class="employee-chat-sessions__header">
        <span class="employee-chat-sessions__heading">
          <span>${recentSessionsLabel}</span>
          <span class="employee-chat-sessions__count">${count}</span>
        </span>
        <button
          type="button"
          class="employee-chat-sessions__new"
          ?disabled=${!state.connected || !state.client || state.sessionsLoading}
          @click=${() => void createEmployeeChatSession(state)}
        >
          <span aria-hidden="true">${icons.plus}</span>
          <span>${newSessionLabel}</span>
        </button>
      </div>
      <div class="employee-chat-sessions__tools">
        <label class="employee-chat-sessions__search">
          <input
            type="search"
            placeholder=${searchLabel}
            .value=${state.employeeChatSessionSearch}
            @input=${(event: Event) => {
              state.employeeChatSessionSearch = (event.target as HTMLInputElement).value;
            }}
          />
        </label>
      </div>
      <div class="employee-chat-sessions__list" role="list">
        ${rows.length
          ? rows.map((row) => {
              const selected = row.key === state.sessionKey;
              const label = formatEmployeeSessionTitle(row);
              const meta = formatEmployeeSessionMeta(row, state.sessionsResult?.defaults);
              const renaming = state.employeeChatSessionRenameKey === row.key;
              const mutable = canMutateEmployeeChatSession(row);
              const menuOpen = state.employeeChatSessionActionMenuKey === row.key;
              const deleting = state.employeeChatSessionDeleteBusyKey === row.key;
              return html`
                <div
                  role="listitem"
                  class="employee-chat-session ${selected
                    ? "employee-chat-session--active"
                    : ""} ${menuOpen ? "employee-chat-session--menu-open" : ""}"
                  title=${row.key}
                  @contextmenu=${(event: MouseEvent) => {
                    if (!mutable) {
                      return;
                    }
                    event.preventDefault();
                    toggleEmployeeChatSessionActionMenu(state, row);
                  }}
                >
                  <span class="employee-chat-session__dot" aria-hidden="true"></span>
                  ${renaming
                    ? html`
                        <span class="employee-chat-session__rename-form">
                          <input
                            class="employee-chat-session__rename-input"
                            aria-label=${renameInputLabel}
                            .value=${state.employeeChatSessionRenameValue}
                            ?disabled=${state.employeeChatSessionRenameBusy}
                            ${ref((el) => {
                              if (el instanceof HTMLInputElement) {
                                queueMicrotask(() => {
                                  if (document.activeElement !== el) {
                                    el.focus();
                                    el.select();
                                  }
                                });
                              }
                            })}
                            @input=${(event: Event) => {
                              state.employeeChatSessionRenameValue = (
                                event.target as HTMLInputElement
                              ).value;
                            }}
                            @keydown=${(event: KeyboardEvent) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void saveEmployeeChatSessionRename(state, row);
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelEmployeeChatSessionRename(state);
                              }
                            }}
                          />
                          <span class="employee-chat-session__rename-actions">
                            <button
                              type="button"
                              class="employee-chat-session__text-action employee-chat-session__text-action--primary"
                              title=${saveLabel}
                              aria-label=${saveLabel}
                              ?disabled=${state.employeeChatSessionRenameBusy}
                              @click=${(event: MouseEvent) => {
                                event.stopPropagation();
                                void saveEmployeeChatSessionRename(state, row);
                              }}
                            >
                              ${saveLabel}
                            </button>
                            <button
                              type="button"
                              class="employee-chat-session__text-action"
                              title=${cancelLabel}
                              aria-label=${cancelLabel}
                              ?disabled=${state.employeeChatSessionRenameBusy}
                              @click=${(event: MouseEvent) => {
                                event.stopPropagation();
                                cancelEmployeeChatSessionRename(state);
                              }}
                            >
                              ${cancelLabel}
                            </button>
                          </span>
                        </span>
                      `
                    : html`
                        <button
                          type="button"
                          class="employee-chat-session__select"
                          ?disabled=${selected && state.tab === "chat"}
                          @click=${async () => {
                            closeEmployeeChatSessionActionMenu(state);
                            if (await switchChatSession(state, row.key)) {
                              state.setTab("chat");
                              void refreshChatAvatar(state);
                            }
                          }}
                        >
                          <span class="employee-chat-session__body">
                            <span class="employee-chat-session__title">${label}</span>
                            <span class="employee-chat-session__meta">${meta}</span>
                          </span>
                        </button>
                        ${mutable
                          ? html`
                              <span class="employee-chat-session__actions">
                                <button
                                  type="button"
                                  class="employee-chat-session__text-action employee-chat-session__menu-trigger"
                                  title=${menuLabel}
                                  aria-label=${menuLabel}
                                  aria-haspopup="menu"
                                  aria-expanded=${menuOpen ? "true" : "false"}
                                  ?disabled=${deleting}
                                  @click=${(event: MouseEvent) => {
                                    event.stopPropagation();
                                    toggleEmployeeChatSessionActionMenu(state, row);
                                  }}
                                >
                                  ...
                                </button>
                              </span>
                            `
                          : html`<span aria-hidden="true"></span>`}
                        ${row.hasActiveRun
                          ? html`
                              <span
                                class="employee-chat-session__live"
                                title=${liveLabel}
                                aria-label=${liveLabel}
                              ></span>
                            `
                          : nothing}
                        ${menuOpen
                          ? html`
                              <span
                                class="employee-chat-session__menu"
                                role="menu"
                                @click=${(event: MouseEvent) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  @click=${(event: MouseEvent) => {
                                    event.stopPropagation();
                                    startEmployeeChatSessionRename(state, row);
                                  }}
                                >
                                  ${renameLabel}
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  class="employee-chat-session__menu-danger"
                                  ?disabled=${deleting}
                                  @click=${(event: MouseEvent) => {
                                    event.stopPropagation();
                                    void deleteEmployeeChatSession(state, row);
                                  }}
                                >
                                  ${deleting ? deletingLabel : deleteLabel}
                                </button>
                              </span>
                            `
                          : nothing}
                      `}
                </div>
              `;
            })
          : html`<div class="employee-chat-sessions__empty">${noRecentSessionsLabel}</div>`}
      </div>
      ${state.sessionsLoading || state.sessionsError
        ? html`
            <div class="employee-chat-sessions__footer">
              ${state.sessionsLoading ? loadingLabel : nothing}
              ${state.sessionsError ? html`<span>${state.sessionsError}</span>` : nothing}
            </div>
          `
        : nothing}
      ${state.employeeChatSessionRenameError
        ? html`<div class="employee-chat-sessions__footer employee-chat-sessions__footer--error">
            ${state.employeeChatSessionRenameError}
          </div>`
        : nothing}
      ${state.employeeChatSessionDeleteError
        ? html`<div class="employee-chat-sessions__footer employee-chat-sessions__footer--error">
            ${state.employeeChatSessionDeleteError}
          </div>`
        : nothing}
    </div>
  `;
}

function renderEmployeeHeartbeat(state: AppViewState) {
  const heartbeat = state.debugHeartbeat as
    | {
        ts?: number;
        status?: string;
        channel?: string;
        to?: string;
        durationMs?: number;
        reason?: string;
        preview?: string;
        config?: {
          enabled?: boolean;
          every?: string;
          target?: string;
        };
      }
    | null
    | undefined;
  const heartbeatConfig =
    heartbeat &&
    typeof heartbeat === "object" &&
    heartbeat.config &&
    typeof heartbeat.config === "object"
      ? heartbeat.config
      : null;
  const status = heartbeat?.status?.trim() || "unknown";
  const statusTone =
    status === "ok-empty" || status === "ok-token" ? "ok" : status === "failed" ? "error" : "warn";
  const preview = heartbeat?.preview?.trim() || t("employeeHeartbeat.previewFallback");
  const statusHeadline =
    status === "ok-empty" || status === "ok-token"
      ? t("employeeHeartbeat.statusStable")
      : t("employeeHeartbeat.statusMonitor");
  const statusSummary = heartbeat?.reason?.trim() || t("employeeHeartbeat.statusSummaryFallback");
  const mascotUrl = employeeLogoUrl(state.basePath);
  return html`
    <section class="employee-workspace__panel employee-workspace__panel--heartbeat">
      <div class="employee-panel__header">
        <div>
          <div class="employee-panel__eyebrow">Heartbeat</div>
          <h2 class="employee-panel__title">${t("employeeHeartbeat.title")}</h2>
          <p class="employee-panel__sub">${t("employeeHeartbeat.subtitle")}</p>
        </div>
      </div>
      <div class="employee-heartbeat-grid">
        <article class="employee-heartbeat-card">
          <div class="employee-heartbeat-card__label">${t("employeeHeartbeat.recentStatus")}</div>
          <div class="employee-heartbeat-card__value employee-heartbeat-card__value--${statusTone}">
            ${status}
          </div>
          <div class="employee-heartbeat-card__meta">${formatEmployeeRelative(heartbeat?.ts)}</div>
        </article>
        <article class="employee-heartbeat-card">
          <div class="employee-heartbeat-card__label">${t("employeeHeartbeat.configStatus")}</div>
          <div class="employee-heartbeat-card__value">
            ${heartbeatConfig?.enabled ? t("common.enabled") : t("common.disabled")}
          </div>
          <div class="employee-heartbeat-card__meta">
            ${heartbeatConfig?.every?.trim() || t("employeeHeartbeat.noCadence")}
          </div>
        </article>
        <article class="employee-heartbeat-card">
          <div class="employee-heartbeat-card__label">${t("employeeHeartbeat.deliveryTarget")}</div>
          <div class="employee-heartbeat-card__value">
            ${heartbeatConfig?.target?.trim() || t("employeeHeartbeat.none")}
          </div>
          <div class="employee-heartbeat-card__meta">
            ${heartbeat?.channel?.trim() || t("employeeHeartbeat.noChannelHistory")}
          </div>
        </article>
      </div>
      <div class="employee-heartbeat-details">
        <div class="employee-heartbeat-details__section employee-heartbeat-details__section--hero">
          <div class="employee-heartbeat-details__label employee-heartbeat-details__label--icon">
            <span
              class="employee-heartbeat-details__icon employee-heartbeat-details__icon--${statusTone}"
              >${icons.radio}</span
            >
            <span>${statusHeadline}</span>
          </div>
          <div class="employee-heartbeat-details__mascot">
            <span class="employee-heartbeat-details__mascot-badge">
              <img src=${mascotUrl} alt="PlatformClaw" loading="lazy" />
            </span>
          </div>
          <div class="employee-heartbeat-details__summary-chips">
            <span class="employee-heartbeat-details__chip">
              ${heartbeatConfig?.enabled
                ? t("employeeHeartbeat.heartbeatOn")
                : t("employeeHeartbeat.heartbeatOff")}
            </span>
            <span class="employee-heartbeat-details__chip">
              ${heartbeatConfig?.every?.trim() || t("employeeHeartbeat.noCadence")}
            </span>
            <span class="employee-heartbeat-details__chip">
              ${heartbeatConfig?.target?.trim() || t("employeeHeartbeat.none")}
            </span>
          </div>
          <div class="employee-heartbeat-details__value">${statusSummary}</div>
        </div>
        <div class="employee-heartbeat-details__section">
          <div class="employee-heartbeat-details__label">
            ${t("employeeHeartbeat.lastReceivedAt")}
          </div>
          <div class="employee-heartbeat-details__value">
            ${formatEmployeeDateTime(heartbeat?.ts)}
          </div>
        </div>
        <div class="employee-heartbeat-details__section">
          <div class="employee-heartbeat-details__label">
            ${t("employeeHeartbeat.lastDeliveryInfo")}
          </div>
          <div class="employee-heartbeat-details__preview">
            ${typeof heartbeat?.durationMs === "number" ? `${heartbeat.durationMs}ms` : "-"} ·
            ${heartbeat?.to?.trim() || t("employeeHeartbeat.noTarget")}<br />${preview}
          </div>
        </div>
      </div>
    </section>
  `;
}

type VisibleTabGroup = {
  label: string;
  tabs: Tab[];
};

function filterVisibleTabGroups(
  groups: readonly { label: string; tabs: readonly Tab[] }[],
  state: AppViewState,
): VisibleTabGroup[] {
  return groups
    .map((group) => ({
      ...group,
      tabs: group.tabs.filter((tab) =>
        tab === "admin" ? Boolean(state.employeeAccountSummary?.hasAdminAccess) : true,
      ),
    }))
    .filter((group) => group.tabs.length > 0);
}

function renderEmployeeUtilityPanel(state: AppViewState, groups: VisibleTabGroup[]) {
  if (!state.employeeMode || groups.length === 0) {
    return nothing;
  }
  return html`
    <section class="employee-tools-panel" aria-label="Workspace tools">
      <div class="employee-tools-panel__header">
        <div>
          <div class="employee-tools-panel__eyebrow">${t("nav.workspace")}</div>
          <h2 class="employee-tools-panel__title">Workspace tools</h2>
        </div>
        <div class="employee-tools-panel__meta">
          ${groups.reduce((count, group) => count + group.tabs.length, 0)} items
        </div>
      </div>
      <div class="employee-tools-panel__groups">
        ${groups.map(
          (group) => html`
            <section class="nav-section employee-tools-panel__section">
              <div class="nav-section__label employee-tools-panel__label">
                <span class="nav-section__label-text">${t(`nav.${group.label}`)}</span>
              </div>
              <div class="nav-section__items employee-tools-panel__items">
                ${group.tabs.map((tab) => renderTab(state, tab, { collapsed: false }))}
              </div>
            </section>
          `,
        )}
      </div>
    </section>
  `;
}

function resolveProductVersion(state: AppViewState): { name: string; version: string } | null {
  const product = state.hello?.server?.product;
  const version = product?.version ?? state.hello?.server?.version ?? "";
  if (!version) {
    return null;
  }
  return {
    name: product?.name ?? "PlatformClaw",
    version,
  };
}

export function renderReleaseNotesDialog(state: AppViewState) {
  if (!state.releaseNotesOpen) {
    return nothing;
  }
  const index = state.releaseNotesIndex;
  const selectedVersion = state.releaseNotesSelectedVersion;
  const selectedRelease = index?.releases.find((release) => release.version === selectedVersion);
  const selectedMarkdown = selectedVersion
    ? state.releaseNotesMarkdownByVersion[selectedVersion]
    : null;
  const selectedIsLatest = Boolean(index && selectedVersion === index.latest);
  const latestIsUnread = Boolean(index && state.releaseNotesReadVersion !== index.latest);
  const hasEmployeeSession = Boolean(state.employeeProfile?.employeeId?.trim());
  const ensureOpen = (el?: Element) => {
    if (!(el instanceof HTMLDialogElement) || el.matches(":modal")) {
      return;
    }
    try {
      if (el.open) {
        el.removeAttribute("open");
      }
      el.showModal();
    } catch {
      el.setAttribute("open", "");
    }
  };
  return html`
    <dialog
      class="md-preview-dialog release-notes-dialog"
      ${ref(ensureOpen)}
      @click=${(event: Event) => {
        const dialog = event.currentTarget as HTMLDialogElement;
        if (event.target === dialog) {
          dialog.close();
        }
      }}
      @close=${() => state.handleCloseReleaseNotes()}
    >
      <div class="md-preview-dialog__panel">
        <div class="md-preview-dialog__header">
          <div>
            <div class="md-preview-dialog__title">업데이트 내역</div>
            <div class="release-notes-dialog__subtitle">PlatformClaw 릴리즈 기록</div>
          </div>
          <button
            class="btn btn--icon release-notes-dialog__close"
            type="button"
            aria-label="닫기"
            title="닫기"
            @click=${() => state.handleCloseReleaseNotes()}
          >
            ${icons.x}
          </button>
        </div>
        <div
          class="release-notes-layout ${state.releaseNotesMobileDetail
            ? "release-notes-layout--detail"
            : ""}"
        >
          <aside class="release-notes-list" aria-label="릴리즈 목록">
            <div class="release-notes-list__heading">릴리즈 목록</div>
            <div class="release-notes-list__items">
              ${index
                ? index.releases.map((release) => {
                    const isLatest = release.version === index.latest;
                    const isSelected = release.version === selectedVersion;
                    return html`
                      <button
                        class="release-notes-list__item ${isSelected ? "is-selected" : ""}"
                        type="button"
                        aria-current=${isSelected ? "true" : "false"}
                        @click=${() => state.handleSelectReleaseNotesVersion(release.version)}
                      >
                        <span class="release-notes-list__version-row">
                          ${isLatest && latestIsUnread
                            ? html`<span
                                class="release-notes-list__unread"
                                aria-label="읽지 않은 최신 릴리즈"
                              ></span>`
                            : nothing}
                          <strong>v${release.version}</strong>
                          ${isLatest
                            ? html`<span class="release-notes-list__latest">최신</span>`
                            : nothing}
                        </span>
                        <span class="release-notes-list__title">${release.title}</span>
                        <span class="release-notes-list__date"
                          >${release.date.replaceAll("-", ".")}</span
                        >
                      </button>
                    `;
                  })
                : state.releaseNotesLoading
                  ? html`<div class="release-notes-list__empty">목록을 불러오는 중입니다.</div>`
                  : nothing}
            </div>
          </aside>
          <section class="release-notes-detail" aria-live="polite">
            <button
              class="release-notes-detail__back"
              type="button"
              @click=${() => state.handleReleaseNotesBackToList()}
            >
              <span aria-hidden="true">${icons.arrowLeft}</span>
              릴리즈 목록
            </button>
            ${selectedRelease
              ? html`
                  <div class="release-notes-detail__meta">
                    <span>${selectedRelease.date}</span>
                    ${selectedIsLatest
                      ? html`<span class="release-notes-list__latest">최신</span>`
                      : nothing}
                  </div>
                `
              : nothing}
            <div class="md-preview-dialog__body release-notes-detail__content sidebar-markdown">
              ${state.releaseNotesLoading
                ? html`<p>릴리즈 노트를 불러오는 중입니다.</p>`
                : state.releaseNotesError
                  ? html`<p class="release-notes-detail__error">${state.releaseNotesError}</p>`
                  : selectedMarkdown
                    ? unsafeHTML(toSanitizedMarkdownHtml(selectedMarkdown))
                    : html`<p>표시할 릴리즈 노트가 없습니다.</p>`}
            </div>
          </section>
        </div>
        <div class="release-notes-dialog__footer">
          ${state.employeeMode && hasEmployeeSession && selectedIsLatest && latestIsUnread
            ? html`
                <button class="btn" type="button" @click=${() => state.handleCloseReleaseNotes()}>
                  ${state.releaseNotesAutoMode ? "나중에" : "닫기"}
                </button>
                <button
                  class="btn primary"
                  type="button"
                  ?disabled=${state.releaseNotesReadSubmitting || !selectedMarkdown}
                  @click=${() => state.handleConfirmReleaseNotes()}
                >
                  ${state.releaseNotesReadSubmitting ? "저장 중..." : "확인"}
                </button>
              `
            : html`
                <button
                  class="btn primary"
                  type="button"
                  @click=${() => state.handleCloseReleaseNotes()}
                >
                  닫기
                </button>
              `}
        </div>
      </div>
    </dialog>
  `;
}

function renderEmployeeVocDialog(state: AppViewState) {
  if (!state.employeeVocModalOpen) {
    return nothing;
  }
  const english = state.settings.locale === "en";
  const title = english ? "VOC Registration" : "VOC 등록";
  const description = english
    ? "This is the PlatformClaw VOC registration page."
    : "PlatformClaw VOC 등록 페이지입니다.";
  const titleLabel = english ? "Title" : "제목";
  const bodyLabel = english ? "Details" : "내용";
  const titlePlaceholder = english ? "Please enter a title" : "제목을 입력해주세요";
  const bodyPlaceholder = english
    ? "- Pain points\n- Things that would be nice to improve\n- Features that would be nice to add"
    : "- 불편한 점\n- 개선되면 좋을 만한 점\n- 기능 추가되면 좋을 것 같은 점";
  const submitLabel = state.employeeVocSubmitting
    ? english
      ? "Submitting..."
      : "등록 중..."
    : english
      ? "Register"
      : "등록";
  const cancelLabel = english ? "Cancel" : "취소";
  const successPrefix = english ? "VOC has been registered:" : "VOC가 등록되었습니다:";
  const ensureOpen = (el?: Element) => {
    if (!(el instanceof HTMLDialogElement)) {
      return;
    }
    queueMicrotask(() => {
      if (!el.isConnected || el.matches(":modal")) {
        return;
      }
      try {
        if (el.open) {
          el.removeAttribute("open");
        }
        el.showModal();
      } catch {
        el.setAttribute("open", "");
      }
    });
  };

  return html`
    <dialog
      open
      class="md-preview-dialog employee-voc-dialog"
      ${ref(ensureOpen)}
      @click=${(event: Event) => {
        const dialog = event.currentTarget as HTMLDialogElement;
        if (event.target === dialog) {
          dialog.close();
        }
      }}
      @close=${() => {
        state.employeeVocModalOpen = false;
      }}
    >
      <div class="md-preview-dialog__panel employee-voc-dialog__panel">
        <div class="md-preview-dialog__header employee-voc-dialog__header">
          <div>
            <div class="md-preview-dialog__title employee-voc-dialog__title">${title}</div>
            <div class="employee-voc-dialog__subtitle">${description}</div>
          </div>
        </div>
        <div class="md-preview-dialog__body employee-voc-dialog__body">
          <label class="employee-voc-dialog__field">
            <span>${titleLabel}</span>
            <input
              type="text"
              maxlength="200"
              .value=${state.employeeVocTitle}
              placeholder=${titlePlaceholder}
              ?disabled=${state.employeeVocSubmitting}
              @input=${(event: Event) => {
                state.employeeVocTitle = (event.target as HTMLInputElement).value;
                state.employeeVocError = null;
              }}
            />
          </label>
          <label class="employee-voc-dialog__field">
            <span>${bodyLabel}</span>
            <textarea
              rows="8"
              maxlength="8000"
              .value=${state.employeeVocBody}
              placeholder=${bodyPlaceholder}
              ?disabled=${state.employeeVocSubmitting}
              @input=${(event: Event) => {
                state.employeeVocBody = (event.target as HTMLTextAreaElement).value;
                state.employeeVocError = null;
              }}
            ></textarea>
          </label>
          ${state.employeeVocError
            ? html`<div class="callout danger employee-voc-dialog__message">
                ${state.employeeVocError}
              </div>`
            : nothing}
          ${state.employeeVocResult
            ? html`<div class="callout success employee-voc-dialog__message">
                ${successPrefix}
                <a
                  href=${state.employeeVocResult.issueUrl}
                  target=${EXTERNAL_LINK_TARGET}
                  rel=${buildExternalLinkRel()}
                  >${state.employeeVocResult.issueKey}</a
                >
              </div>`
            : nothing}
          <div class="md-preview-dialog__actions employee-voc-dialog__actions">
            <button
              type="button"
              class="btn"
              ?disabled=${state.employeeVocSubmitting}
              @click=${() => {
                state.employeeVocModalOpen = false;
              }}
            >
              ${cancelLabel}
            </button>
            <button
              type="button"
              class="btn primary"
              ?disabled=${state.employeeVocSubmitting}
              @click=${() => void state.handleEmployeeVocSubmit()}
            >
              ${submitLabel}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  `;
}

export function renderApp(state: AppViewState) {
  const updatableState = state as AppViewState & { requestUpdate?: () => void };
  const requestHostUpdate =
    typeof updatableState.requestUpdate === "function"
      ? () => updatableState.requestUpdate?.()
      : undefined;
  _pendingUpdate = requestHostUpdate;

  // Gate: require successful gateway connection before showing the dashboard.
  // The gateway URL confirmation overlay is always rendered so URL-param flows still work.
  if (!state.connected) {
    return html` ${renderLoginGate(state)} ${renderGatewayUrlConfirmation(state)} `;
  }
  const visibleTabGroups = filterVisibleTabGroups(tabGroupsForMode(state.employeeMode), state);
  const employeeSidebarGroups = state.employeeMode
    ? filterVisibleTabGroups(employeeSidebarTabGroups(), state)
    : visibleTabGroups;
  const employeeUtilityGroups = state.employeeMode
    ? filterVisibleTabGroups(employeeUtilityTabGroups(), state)
    : [];
  const allowedTabs = new Set<Tab>(visibleTabGroups.flatMap((group) => [...group.tabs]));
  // Dashboard and Skill Hub are intentionally entered from the topbar instead of
  // the employee sidebar, so they must stay routable even when omitted from the
  // visible tab groups.
  allowedTabs.add("dashboard");
  allowedTabs.add("skillHub");
  if (!allowedTabs.has(state.tab)) {
    queueMicrotask(() => state.setTab("chat"));
  }

  const presenceCount = state.presenceEntries.length;
  const sessionsCount = state.sessionsResult?.count ?? null;
  const cronNext = state.cronStatus?.nextWakeAtMs ?? null;
  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const isChat = state.tab === "chat";
  const docsUrl = resolveWorkspaceDocsUrl(state);
  const employeeAnnouncement = resolveEmployeeAnnouncement(state.employeeMode, state.employeeUi);
  const showEmployeeAnnouncement =
    employeeAnnouncement && !isEmployeeAnnouncementDismissed(employeeAnnouncement);
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const navDrawerOpen = Boolean(state.navDrawerOpen && !chatFocus && !state.onboarding);
  const navCollapsed = Boolean(state.settings.navCollapsed && !navDrawerOpen);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const showToolCalls = state.onboarding ? true : state.settings.chatShowToolCalls;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const configuredDreaming = resolveConfiguredDreaming(configValue);
  const dreamingOn = state.dreamingStatus?.enabled ?? configuredDreaming.enabled;
  const dreamingNextCycle = resolveDreamingNextCycle(state.dreamingStatus);
  const dreamingLoading = state.dreamingStatusLoading || state.dreamingModeSaving;
  const dreamingRefreshLoading = state.dreamingStatusLoading || state.dreamDiaryLoading;
  const refreshDreaming = () => {
    void Promise.all([loadDreamingStatus(state), loadDreamDiary(state)]);
  };
  const applyDreamingEnabled = (enabled: boolean) => {
    if (state.dreamingModeSaving || dreamingOn === enabled) {
      return;
    }
    void (async () => {
      const updated = await updateDreamingEnabled(state, enabled);
      if (!updated) {
        return;
      }
      await loadConfig(state);
      await loadDreamingStatus(state);
    })();
  };
  const basePath = normalizeBasePath(state.basePath ?? "");
  const dashboardHref = pathForTab("dashboard", basePath);
  const skillHubHref = pathForTab("skillHub", basePath);
  const resolvedAgentId =
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;
  const activeSessionAgentId = resolveAgentIdFromSessionKey(state.sessionKey);
  const toolsPanelUsesActiveSession = Boolean(
    resolvedAgentId && activeSessionAgentId && resolvedAgentId === activeSessionAgentId,
  );
  const getCurrentConfigValue = () =>
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const findAgentIndex = (agentId: string) =>
    findAgentConfigEntryIndex(getCurrentConfigValue(), agentId);
  const ensureAgentIndex = (agentId: string) => ensureAgentConfigEntry(state, agentId);
  const cronAgentSuggestions = sortLocaleStrings(
    new Set(
      [
        ...(state.agentsList?.agents?.map((entry) => entry.id.trim()) ?? []),
        ...state.cronJobs
          .map((job) => (typeof job.agentId === "string" ? job.agentId.trim() : ""))
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const cronModelSuggestions = sortLocaleStrings(
    new Set(
      [
        ...state.cronModelSuggestions,
        ...resolveConfiguredCronModelSuggestions(configValue),
        ...state.cronJobs
          .map((job) => {
            if (job.payload.kind !== "agentTurn" || typeof job.payload.model !== "string") {
              return "";
            }
            return job.payload.model.trim();
          })
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const visibleCronJobs = getVisibleCronJobs(state);
  const selectedDeliveryChannel =
    state.cronForm.deliveryChannel && state.cronForm.deliveryChannel.trim()
      ? state.cronForm.deliveryChannel.trim()
      : "last";
  const jobToSuggestions = state.cronJobs
    .map((job) => normalizeSuggestionValue(job.delivery?.to))
    .filter(Boolean);
  const accountToSuggestions = (
    selectedDeliveryChannel === "last"
      ? Object.values(state.channelsSnapshot?.channelAccounts ?? {}).flat()
      : (state.channelsSnapshot?.channelAccounts?.[selectedDeliveryChannel] ?? [])
  )
    .flatMap((account) => [
      normalizeSuggestionValue(account.accountId),
      normalizeSuggestionValue(account.name),
    ])
    .filter(Boolean);
  const rawDeliveryToSuggestions = uniquePreserveOrder([
    ...jobToSuggestions,
    ...accountToSuggestions,
  ]);
  const accountSuggestions = uniquePreserveOrder(accountToSuggestions);
  const deliveryToSuggestions =
    state.cronForm.deliveryMode === "webhook"
      ? rawDeliveryToSuggestions.filter((value) => isHttpUrl(value))
      : rawDeliveryToSuggestions;
  const employeeAgentId = state.employeeProfile.agentId?.trim() || resolvedAgentId || "main";
  const employeeCronForm = normalizeCronFormState({
    ...state.cronForm,
    agentId: employeeAgentId,
    clearAgent: false,
  });
  const cronQuickCreateSessions =
    state.employeeMode && state.sessionsResult
      ? (() => {
          const sessions = state.sessionsResult.sessions.filter((row) =>
            isEmployeeChatSessionRowVisible(state, row),
          );
          return {
            ...state.sessionsResult,
            count: sessions.length,
            sessions,
          };
        })()
      : state.sessionsResult;

  const chatView =
    state.tab === "chat"
      ? renderChat({
          employeeMode: state.employeeMode,
          sessionKey: state.sessionKey,
          onSessionKeyChange: async (next) => {
            if (await switchChatSession(state, next)) {
              state.artifactFocus = null;
              state.chatAttachments = [];
              void refreshChatAvatar(state);
            }
          },
          thinkingLevel: state.chatThinkingLevel,
          showThinking,
          showToolCalls,
          loading: state.chatLoading,
          sending: state.chatSending,
          compactionStatus: state.compactionStatus,
          runPhaseStatus:
            state.employeeMode &&
            state.runPhaseStatus?.phase === "running" &&
            !state.runPhaseStatus.runId
              ? null
              : state.runPhaseStatus,
          fallbackStatus: state.fallbackStatus,
          assistantAvatarUrl: chatAvatarUrl,
          messages: state.chatMessages,
          toolMessages: state.chatToolMessages,
          streamSegments: state.chatStreamSegments,
          stream: state.chatStream,
          streamStartedAt: state.chatStreamStartedAt,
          draft: state.chatMessage,
          queue: state.chatQueue,
          sendFailures: state.chatSendFailures,
          connected: state.connected,
          canSend:
            state.connected &&
            !state.chatAttachments.some((attachment) => attachment.status === "uploading"),
          disabledReason: chatDisabledReason,
          error: state.lastError,
          sessions: state.sessionsResult,
          focusMode: chatFocus,
          onRefresh: () => {
            state.artifactFocus = null;
            state.resetToolStream();
            return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
          },
          onToggleFocusMode: () => {
            if (state.onboarding) {
              return;
            }
            state.applySettings({
              ...state.settings,
              chatFocusMode: !state.settings.chatFocusMode,
            });
          },
          onChatScroll: (event) => state.handleChatScroll(event),
          getDraft: () => state.chatMessage,
          onDraftChange: (next) => (state.chatMessage = next),
          onRequestUpdate: requestHostUpdate,
          attachments: state.chatAttachments,
          getAttachments: () => state.chatAttachments,
          onAttachmentsChange: (next) => (state.chatAttachments = next),
          onSend: () => state.handleSendChat(),
          canAbort: hasAbortableSessionRun(state),
          onAbort: () => void state.handleAbortChat(),
          onQueueRemove: (id) => state.removeQueuedMessage(id),
          onRetrySend: (runId) => void state.retryFailedChatMessage(runId),
          onNewSession: () => state.handleSendChat("/new", { restoreDraft: true }),
          onClearHistory: async () => {
            if (!state.client || !state.connected) {
              return;
            }
            try {
              state.artifactFocus = null;
              await state.client.request("sessions.reset", { key: state.sessionKey });
              state.chatMessages = [];
              state.chatStream = null;
              state.chatRunId = null;
              state.chatSendDrafts = {};
              state.chatSendFailures = {};
              await loadChatHistory(state);
            } catch (err) {
              state.lastError = String(err);
            }
          },
          agentsList: state.agentsList,
          currentAgentId: resolvedAgentId ?? "main",
          onAgentChange: (agentId: string) => {
            state.artifactFocus = null;
            state.sessionKey = buildAgentMainSessionKey({ agentId });
            state.chatMessages = [];
            state.chatStream = null;
            state.chatRunId = null;
            state.chatSendDrafts = {};
            state.chatSendFailures = {};
            state.applySettings({
              ...state.settings,
              sessionKey: state.sessionKey,
              lastActiveSessionKey: state.sessionKey,
            });
            void loadChatHistory(state);
            void state.loadAssistantIdentity();
          },
          onNavigateToAgent: state.employeeMode
            ? undefined
            : () => {
                state.agentsSelectedId = resolvedAgentId;
                state.setTab("agents" as import("./navigation.ts").Tab);
              },
          onSessionSelect: state.employeeMode
            ? undefined
            : async (key: string) => {
                state.artifactFocus = null;
                await switchChatSession(state, key);
              },
          showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
          onScrollToBottom: () => state.scrollToBottom(),
          sidebarOpen: state.sidebarOpen,
          sidebarContent: state.sidebarContent,
          sidebarError: state.sidebarError,
          splitRatio: state.splitRatio,
          onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
          artifactFocus: state.artifactFocus,
          onOpenArtifact: (artifact) => {
            state.artifactFocus = artifact;
          },
          onCloseArtifact: () => {
            state.artifactFocus = null;
          },
          onCloseSidebar: () => state.handleCloseSidebar(),
          onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
          assistantName: state.assistantName,
          assistantAvatar: state.assistantAvatar,
          basePath: state.basePath ?? "",
        })
      : nothing;

  const cronView =
    state.tab === "cron"
      ? lazyRender(lazyCron, (m) =>
          m.renderCron({
            basePath: state.basePath,
            employeeMode: state.employeeMode,
            lockedAgentId: state.employeeMode ? employeeAgentId : null,
            loading: state.cronLoading,
            status: state.cronStatus,
            jobs: visibleCronJobs,
            jobsLoadingMore: state.cronJobsLoadingMore,
            jobsTotal: state.cronJobsTotal,
            jobsHasMore: state.cronJobsHasMore,
            jobsQuery: state.cronJobsQuery,
            jobsEnabledFilter: state.cronJobsEnabledFilter,
            jobsScheduleKindFilter: state.cronJobsScheduleKindFilter,
            jobsLastStatusFilter: state.cronJobsLastStatusFilter,
            jobsSortBy: state.cronJobsSortBy,
            jobsSortDir: state.cronJobsSortDir,
            editingJobId: state.cronEditingJobId,
            error: state.cronError,
            busy: state.cronBusy,
            form: state.employeeMode ? employeeCronForm : state.cronForm,
            cronFormCollapsed: state.cronFormCollapsed,
            channels: state.channelsSnapshot?.channelMeta?.length
              ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
              : (state.channelsSnapshot?.channelOrder ?? []),
            channelLabels: state.channelsSnapshot?.channelLabels ?? {},
            channelMeta: state.channelsSnapshot?.channelMeta ?? [],
            runsJobId: state.cronRunsJobId,
            runs: state.cronRuns,
            runsTotal: state.cronRunsTotal,
            runsHasMore: state.cronRunsHasMore,
            runsLoadingMore: state.cronRunsLoadingMore,
            runsScope: state.cronRunsScope,
            runsStatuses: state.cronRunsStatuses,
            runsDeliveryStatuses: state.cronRunsDeliveryStatuses,
            runsStatusFilter: state.cronRunsStatusFilter,
            runsQuery: state.cronRunsQuery,
            runsSortDir: state.cronRunsSortDir,
            fieldErrors: state.cronFieldErrors,
            canSubmit: !hasCronFormErrors(state.cronFieldErrors),
            agentSuggestions: state.employeeMode ? [employeeAgentId] : cronAgentSuggestions,
            modelSuggestions: cronModelSuggestions,
            thinkingSuggestions: CRON_THINKING_SUGGESTIONS,
            timezoneSuggestions: CRON_TIMEZONE_SUGGESTIONS,
            deliveryToSuggestions,
            accountSuggestions,
            onFormChange: (patch) => {
              const base = state.employeeMode ? employeeCronForm : state.cronForm;
              const next = normalizeCronFormState({
                ...base,
                ...patch,
                ...(state.employeeMode ? { agentId: employeeAgentId, clearAgent: false } : {}),
              });
              state.cronForm = next;
              state.cronFieldErrors = validateCronForm(next);
            },
            onRefresh: () => state.loadCron(),
            onAdd: () => {
              if (state.employeeMode) {
                state.cronForm = employeeCronForm;
                state.cronFieldErrors = validateCronForm(employeeCronForm);
              }
              void (async () => {
                await addCronJob(state);
                if (!hasCronFormErrors(state.cronFieldErrors) && !state.cronError) {
                  state.cronFormCollapsed = true;
                }
                requestHostUpdate?.();
              })();
            },
            onEdit: (job) => {
              state.cronFormCollapsed = false;
              startCronEdit(state, job);
              if (state.employeeMode) {
                state.cronForm = normalizeCronFormState({
                  ...state.cronForm,
                  agentId: employeeAgentId,
                  clearAgent: false,
                });
              }
            },
            onClone: (job) => {
              state.cronFormCollapsed = false;
              startCronClone(state, job);
              if (state.employeeMode) {
                state.cronForm = normalizeCronFormState({
                  ...state.cronForm,
                  agentId: employeeAgentId,
                  clearAgent: false,
                });
              }
            },
            onCancelEdit: () => {
              cancelCronEdit(state);
              state.cronFormCollapsed = true;
              requestHostUpdate?.();
            },
            onToggleFormCollapsed: (collapsed) => {
              state.cronFormCollapsed = collapsed;
              requestHostUpdate?.();
            },
            onQuickCreate: () => {
              cancelCronEdit(state);
              state.cronQuickCreateOpen = true;
              state.cronQuickCreateStep = "what";
              state.cronQuickCreateDraft = createDefaultDraft();
              requestHostUpdate?.();
            },
            onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
            onRun: (job, mode) => runCronJob(state, job, mode ?? "force"),
            onRemove: (job) => removeCronJob(state, job),
            onLoadRuns: async (jobId) => {
              updateCronRunsFilter(state, { cronRunsScope: "job" });
              await loadCronRuns(state, jobId);
            },
            onLoadMoreJobs: () => loadMoreCronJobs(state),
            onJobsFiltersChange: async (patch) => {
              updateCronJobsFilter(state, patch);
              const shouldReload =
                typeof patch.cronJobsQuery === "string" ||
                Boolean(patch.cronJobsEnabledFilter) ||
                Boolean(patch.cronJobsSortBy) ||
                Boolean(patch.cronJobsSortDir);
              if (shouldReload) {
                await reloadCronJobs(state);
              }
            },
            onJobsFiltersReset: async () => {
              updateCronJobsFilter(state, {
                cronJobsQuery: "",
                cronJobsEnabledFilter: "all",
                cronJobsScheduleKindFilter: "all",
                cronJobsLastStatusFilter: "all",
                cronJobsSortBy: "nextRunAtMs",
                cronJobsSortDir: "asc",
              });
              await reloadCronJobs(state);
            },
            onLoadMoreRuns: () => loadMoreCronRuns(state),
            onRunsFiltersChange: async (patch) => {
              updateCronRunsFilter(state, patch);
              if (state.cronRunsScope === "all") {
                await loadCronRuns(state, null);
                return;
              }
              await loadCronRuns(state, state.cronRunsJobId);
            },
            onNavigateToChat: async (sessionKey) => {
              if (await switchChatSession(state, sessionKey)) {
                state.setTab("chat" as import("./navigation.ts").Tab);
              }
            },
          }),
        )
      : nothing;

  const cronQuickCreateModal =
    state.tab === "cron"
      ? renderCronQuickCreate({
          open: state.cronQuickCreateOpen,
          step: state.cronQuickCreateStep,
          draft: state.cronQuickCreateDraft ?? createDefaultDraft(),
          employeeMode: state.employeeMode,
          currentSessionKey: state.sessionKey,
          sessions: cronQuickCreateSessions ?? null,
          onDraftChange: (patch) => {
            state.cronQuickCreateDraft = {
              ...(state.cronQuickCreateDraft ?? createDefaultDraft()),
              ...patch,
            };
            requestHostUpdate?.();
          },
          onStepChange: (step) => {
            state.cronQuickCreateStep = step;
            requestHostUpdate?.();
          },
          onCreate: () => {
            const draft = state.cronQuickCreateDraft ?? createDefaultDraft();
            const formPatch = draftToCronFormPatch(draft, { currentSessionKey: state.sessionKey });
            const nextForm = normalizeCronFormState({
              ...DEFAULT_CRON_FORM,
              ...formPatch,
              ...(state.employeeMode ? { agentId: employeeAgentId, clearAgent: false } : {}),
            });
            state.cronEditingJobId = null;
            state.cronForm = nextForm;
            state.cronFieldErrors = validateCronForm(nextForm);
            requestHostUpdate?.();
            void (async () => {
              await addCronJob(state);
              if (!hasCronFormErrors(state.cronFieldErrors) && !state.cronError) {
                state.cronQuickCreateOpen = false;
                state.cronQuickCreateStep = "what";
                state.cronQuickCreateDraft = null;
                state.cronFormCollapsed = true;
              }
              requestHostUpdate?.();
            })();
          },
          onAdvancedCreate: () => {
            const draft = state.cronQuickCreateDraft ?? createDefaultDraft();
            const formPatch = draftToCronFormPatch(draft, { currentSessionKey: state.sessionKey });
            const nextForm = normalizeCronFormState({
              ...DEFAULT_CRON_FORM,
              ...formPatch,
              ...(state.employeeMode ? { agentId: employeeAgentId, clearAgent: false } : {}),
            });
            state.cronEditingJobId = null;
            state.cronForm = nextForm;
            state.cronFieldErrors = validateCronForm(nextForm);
            state.cronQuickCreateOpen = false;
            state.cronQuickCreateStep = "what";
            state.cronQuickCreateDraft = null;
            state.cronFormCollapsed = false;
            requestHostUpdate?.();
          },
          onCancel: () => {
            state.cronQuickCreateOpen = false;
            state.cronQuickCreateStep = "what";
            state.cronQuickCreateDraft = null;
            requestHostUpdate?.();
          },
        })
      : nothing;

  return html`
    ${cronQuickCreateModal}
    ${renderCommandPalette({
      open: state.paletteOpen,
      query: state.paletteQuery,
      activeIndex: state.paletteActiveIndex,
      onToggle: () => {
        state.paletteOpen = !state.paletteOpen;
      },
      onQueryChange: (q) => {
        state.paletteQuery = q;
      },
      onActiveIndexChange: (i) => {
        state.paletteActiveIndex = i;
      },
      onNavigate: (tab) => {
        state.setTab(tab as import("./navigation.ts").Tab);
      },
      onSlashCommand: (cmd) => {
        state.setTab("chat" as import("./navigation.ts").Tab);
        state.chatMessage = cmd.endsWith(" ") ? cmd : `${cmd} `;
      },
    })}
    <div
      class="shell ${isChat ? "shell--chat" : ""} ${chatFocus
        ? "shell--chat-focus"
        : ""} ${navCollapsed ? "shell--nav-collapsed" : ""} ${navDrawerOpen
        ? "shell--nav-drawer-open"
        : ""} ${state.onboarding ? "shell--onboarding" : ""}"
    >
      <button
        type="button"
        class="shell-nav-backdrop"
        aria-label="${t("nav.collapse")}"
        @click=${() => {
          state.navDrawerOpen = false;
        }}
      ></button>
      <header class="topbar">
        <div class="topnav-shell">
          <button
            type="button"
            class="topbar-nav-toggle"
            @click=${() => {
              state.navDrawerOpen = !navDrawerOpen;
            }}
            title="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-label="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-expanded=${navDrawerOpen}
          >
            <span class="nav-collapse-toggle__icon" aria-hidden="true">${icons.menu}</span>
          </button>
          <div class="topnav-shell__content">
            <dashboard-header .tab=${state.tab}></dashboard-header>
          </div>
          <div class="topnav-shell__actions">
            <button
              class="topbar-search"
              @click=${() => {
                state.paletteOpen = !state.paletteOpen;
              }}
              title="Search or jump to... (⌘K)"
              aria-label="Open command palette"
            >
              <span class="topbar-search__label">${t("common.search")}</span>
              <kbd class="topbar-search__kbd">⌘K</kbd>
            </button>
            ${state.employeeMode
              ? html`
                  <button
                    type="button"
                    class="topbar-voc-link topbar-voc-link--report"
                    title="VOC"
                    aria-label="VOC"
                    @click=${() => {
                      state.employeeVocModalOpen = true;
                      state.employeeVocError = null;
                      state.employeeVocResult = null;
                    }}
                  >
                    <span class="topbar-voc-link__icon" aria-hidden="true">${icons.headset}</span>
                  </button>
                `
              : nothing}
            <a
              href=${dashboardHref}
              class="topbar-dashboard-link ${state.tab === "dashboard"
                ? "topbar-dashboard-link--active"
                : ""}"
              @click=${(event: MouseEvent) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                state.setTab("dashboard");
              }}
              title="Open dashboard"
              aria-current=${state.tab === "dashboard" ? "page" : "false"}
            >
              <span class="topbar-dashboard-link__icon" aria-hidden="true">${icons.barChart}</span>
              <span class="topbar-dashboard-link__label">Dashboard</span>
            </a>
            <a
              href=${skillHubHref}
              class="topbar-dashboard-link topbar-skillhub-link ${state.tab === "skillHub"
                ? "topbar-dashboard-link--active topbar-skillhub-link--active"
                : ""}"
              @click=${(event: MouseEvent) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                state.setTab("skillHub");
              }}
              title="Open Skill Hub"
              aria-current=${state.tab === "skillHub" ? "page" : "false"}
            >
              <span class="topbar-dashboard-link__icon" aria-hidden="true">${icons.package}</span>
              <span class="topbar-dashboard-link__label">Skill Hub</span>
            </a>
            <div class="topbar-status">
              ${isChat ? renderChatMobileToggle(state) : nothing}
              ${renderTopbarThemeModeToggle(state)}
            </div>
          </div>
        </div>
      </header>
      <div class="shell-nav">
        <aside class="sidebar ${navCollapsed ? "sidebar--collapsed" : ""}">
          <div class="sidebar-shell">
            <div class="sidebar-shell__header">
              <div class="sidebar-brand">
                ${navCollapsed
                  ? nothing
                  : html`
                      <img
                        class="sidebar-brand__logo"
                        src="${employeeLogoUrl(basePath)}"
                        alt="Soc PlatformClaw"
                      />
                      <span class="sidebar-brand__copy">
                        <span class="sidebar-brand__eyebrow"
                          >${state.employeeMode ? "Workspace" : t("nav.control")}</span
                        >
                        <span class="sidebar-brand__title">PlatformClaw</span>
                      </span>
                    `}
              </div>
              <button
                type="button"
                class="nav-collapse-toggle"
                @click=${() =>
                  state.applySettings({
                    ...state.settings,
                    navCollapsed: !state.settings.navCollapsed,
                  })}
                title="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
                aria-label="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
              >
                <span class="nav-collapse-toggle__icon" aria-hidden="true"
                  >${navCollapsed ? icons.panelLeftOpen : icons.panelLeftClose}</span
                >
              </button>
            </div>
            <div class="sidebar-shell__body">
              <div class="sidebar-body-stack">
                ${renderEmployeeIdentitySummary(state, navCollapsed)}
                <nav class="sidebar-nav">
                  ${employeeSidebarGroups.map((group) => {
                    const isChatGroup = state.employeeMode && group.label === "chat";
                    const isGroupCollapsed =
                      state.settings.navGroupsCollapsed[group.label] ?? false;
                    const hasActiveTab = group.tabs.some((tab) => tab === state.tab);
                    const showItems =
                      isChatGroup || navCollapsed || hasActiveTab || !isGroupCollapsed;

                    return html`
                      <section
                        class="nav-section ${isChatGroup ? "nav-section--chat" : ""} ${!showItems
                          ? "nav-section--collapsed"
                          : ""}"
                      >
                        ${!navCollapsed
                          ? isChatGroup
                            ? html`
                                <div class="nav-section__label nav-section__label--static">
                                  <span class="nav-section__label-text"
                                    >${t(`nav.${group.label}`)}</span
                                  >
                                </div>
                              `
                            : html`
                                <button
                                  class="nav-section__label"
                                  @click=${() => {
                                    const next = { ...state.settings.navGroupsCollapsed };
                                    next[group.label] = !isGroupCollapsed;
                                    state.applySettings({
                                      ...state.settings,
                                      navGroupsCollapsed: next,
                                    });
                                  }}
                                  aria-expanded=${showItems}
                                >
                                  <span class="nav-section__label-text"
                                    >${t(`nav.${group.label}`)}</span
                                  >
                                  <span class="nav-section__chevron"> ${icons.chevronDown} </span>
                                </button>
                              `
                          : nothing}
                        <div class="nav-section__items">
                          ${isChatGroup
                            ? renderEmployeeChatSessionList(state, "chat", navCollapsed)
                            : group.tabs.map(
                                (tab) => html`
                                  ${renderTab(state, tab, { collapsed: navCollapsed })}
                                  ${renderEmployeeChatSessionList(state, tab, navCollapsed)}
                                `,
                              )}
                        </div>
                      </section>
                    `;
                  })}
                </nav>
              </div>
            </div>
            <div class="sidebar-shell__footer">
              <div class="sidebar-utility-group">
                ${state.employeeMode
                  ? html`
                      ${renderEmployeeLocaleToggle(state, navCollapsed)}
                      <button
                        class="nav-item sidebar-utility-link"
                        type="button"
                        @click=${() => state.handleEmployeeLogout()}
                        title=${t("common.logout")}
                      >
                        <span class="nav-item__icon" aria-hidden="true">${icons.logOut}</span>
                        ${!navCollapsed
                          ? html`<span class="nav-item__text">${t("common.logout")}</span>`
                          : nothing}
                      </button>
                    `
                  : nothing}
                ${docsUrl
                  ? html`
                      <a
                        class="nav-item nav-item--external sidebar-utility-link"
                        href=${docsUrl}
                        target=${EXTERNAL_LINK_TARGET}
                        rel=${buildExternalLinkRel()}
                        title="${t("common.docs")} (opens in new tab)"
                      >
                        <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
                        ${!navCollapsed
                          ? html`
                              <span class="nav-item__text">${t("common.docs")}</span>
                              <span class="nav-item__external-icon">${icons.externalLink}</span>
                            `
                          : nothing}
                      </a>
                    `
                  : nothing}
                <div class="sidebar-mode-switch">${renderTopbarThemeModeToggle(state)}</div>
                ${(() => {
                  const productVersion = resolveProductVersion(state);
                  return productVersion
                    ? html`
                        <button
                          class="sidebar-version sidebar-version--button"
                          type="button"
                          @click=${() => state.handleOpenReleaseNotes()}
                        >
                          ${!navCollapsed
                            ? html`
                                <span class="sidebar-version__label">${t("common.version")}</span>
                                <span class="sidebar-version__text"
                                  >${productVersion.name} v${productVersion.version}</span
                                >
                                ${renderSidebarConnectionStatus(state)}
                              `
                            : html` ${renderSidebarConnectionStatus(state)} `}
                        </button>
                      `
                    : nothing;
                })()}
              </div>
            </div>
          </div>
        </aside>
      </div>
      <main
        class="content ${isChat ? "content--chat" : ""} ${state.employeeMode &&
        employeeUtilityGroups.length > 0
          ? "content--employee-layout"
          : ""}"
        @scroll=${() => state.handleContentScroll()}
      >
        ${renderEmployeeLoginNotice(state)}
        ${showEmployeeAnnouncement
          ? html`
              <div class="callout warning employee-announcement" role="status">
                <button
                  class="update-banner__close employee-announcement__close"
                  type="button"
                  title="Dismiss notice"
                  aria-label="Dismiss notice"
                  @click=${() => {
                    dismissEmployeeAnnouncement(employeeAnnouncement);
                    (state as AppViewState & { requestUpdate?: () => void }).requestUpdate?.();
                  }}
                >
                  ${icons.x}
                </button>
                ${employeeAnnouncement.title
                  ? html`<strong>${employeeAnnouncement.title}</strong>`
                  : nothing}
                ${employeeAnnouncement.body
                  ? html`<div>${employeeAnnouncement.body}</div>`
                  : nothing}
                ${employeeAnnouncement.linkUrl
                  ? html`
                      <div>
                        <a
                          href=${employeeAnnouncement.linkUrl}
                          target=${EXTERNAL_LINK_TARGET}
                          rel=${buildExternalLinkRel()}
                        >
                          ${employeeAnnouncement.linkLabel || "Open notice"}
                        </a>
                      </div>
                    `
                  : nothing}
              </div>
            `
          : nothing}
        ${state.updateAvailable &&
        state.updateAvailable.latestVersion !== state.updateAvailable.currentVersion &&
        !isUpdateBannerDismissed(state.updateAvailable)
          ? html`<div class="update-banner callout danger" role="alert">
              <strong>Update available:</strong> v${state.updateAvailable.latestVersion} (running
              v${state.updateAvailable.currentVersion}).
              <button
                class="btn btn--sm update-banner__btn"
                ?disabled=${state.updateRunning || !state.connected}
                @click=${() => runUpdate(state)}
              >
                ${state.updateRunning ? "Updating..." : "Update now"}
              </button>
              <button
                class="update-banner__close"
                type="button"
                title="Dismiss"
                aria-label="Dismiss update banner"
                @click=${() => {
                  dismissUpdateBanner(state.updateAvailable);
                  state.updateAvailable = null;
                }}
              >
                ${icons.x}
              </button>
            </div>`
          : nothing}
        ${renderEmployeeUtilityPanel(state, employeeUtilityGroups)}
        ${state.tab === "config"
          ? nothing
          : html`<section class="content-header">
              <div>
                ${isChat
                  ? renderChatSessionSelect(state)
                  : html`<div class="page-title">${titleForTab(state.tab)}</div>`}
                ${isChat ? nothing : html`<div class="page-sub">${subtitleForTab(state.tab)}</div>`}
              </div>
              <div class="page-meta">
                ${state.tab === "dreams"
                  ? html`
                      <div class="dreaming-header-controls">
                        <button
                          class="btn btn--subtle btn--sm"
                          ?disabled=${dreamingLoading || state.dreamDiaryLoading}
                          @click=${refreshDreaming}
                        >
                          ${dreamingRefreshLoading
                            ? t("dreaming.header.refreshing")
                            : t("dreaming.header.refresh")}
                        </button>
                        <button
                          class="dreams__phase-toggle ${dreamingOn
                            ? "dreams__phase-toggle--on"
                            : ""}"
                          ?disabled=${dreamingLoading}
                          @click=${() => applyDreamingEnabled(!dreamingOn)}
                        >
                          <span class="dreams__phase-toggle-dot"></span>
                          <span class="dreams__phase-toggle-label">
                            ${dreamingOn ? t("dreaming.header.on") : t("dreaming.header.off")}
                          </span>
                        </button>
                      </div>
                    `
                  : nothing}
                ${state.lastError
                  ? html`<div class="pill danger">${state.lastError}</div>`
                  : nothing}
                ${isChat ? renderChatControls(state) : nothing}
              </div>
            </section>`}
        ${state.tab === "overview"
          ? renderOverview({
              connected: state.connected,
              hello: state.hello,
              settings: state.settings,
              password: state.password,
              lastError: state.lastError,
              lastErrorCode: state.lastErrorCode,
              presenceCount,
              sessionsCount,
              cronEnabled: state.cronStatus?.enabled ?? null,
              cronNext,
              lastChannelsRefresh: state.channelsLastSuccess,
              warnQueryToken,
              usageResult: state.usageResult,
              sessionsResult: state.sessionsResult,
              skillsReport: state.skillsReport,
              cronJobs: state.cronJobs,
              cronStatus: state.cronStatus,
              attentionItems: state.attentionItems,
              eventLog: state.eventLog,
              overviewLogLines: state.overviewLogLines,
              showGatewayToken: state.overviewShowGatewayToken,
              showGatewayPassword: state.overviewShowGatewayPassword,
              onSettingsChange: (next) => state.applySettings(next),
              onPasswordChange: (next) => (state.password = next),
              onSessionKeyChange: (next) => {
                state.sessionKey = next;
                state.chatMessage = "";
                state.resetToolStream();
                state.applySettings({
                  ...state.settings,
                  sessionKey: next,
                  lastActiveSessionKey: next,
                });
                void state.loadAssistantIdentity();
              },
              onToggleGatewayTokenVisibility: () => {
                state.overviewShowGatewayToken = !state.overviewShowGatewayToken;
              },
              onToggleGatewayPasswordVisibility: () => {
                state.overviewShowGatewayPassword = !state.overviewShowGatewayPassword;
              },
              onConnect: () => state.connect(),
              onRefresh: () => state.loadOverview(),
              onNavigate: (tab) => state.setTab(tab as import("./navigation.ts").Tab),
              onRefreshLogs: () => state.loadOverview(),
            })
          : nothing}
        ${state.tab === "dashboard"
          ? lazyRender(lazyDashboard, (m) =>
              m.renderDashboard({
                loading: state.dashboardLoading,
                error: state.dashboardError,
                range: state.dashboardRange,
                result: state.dashboardResult,
                dashboardSortBy: state.dashboardSortBy,
                dashboardSortDir: state.dashboardSortDir,
                onRangeChange: (range) => {
                  state.dashboardRange = range;
                  void loadDashboard(state);
                },
                onRefresh: () => {
                  void loadDashboard(state);
                },
                onSortChange: (sortBy, sortDir) => {
                  state.dashboardSortBy = sortBy;
                  state.dashboardSortDir = sortDir;
                  void loadDashboard(state);
                },
              }),
            )
          : nothing}
        ${state.tab === "channels"
          ? lazyRender(lazyChannels, (m) =>
              m.renderChannels({
                connected: state.connected,
                loading: state.channelsLoading,
                snapshot: state.channelsSnapshot,
                lastError: state.channelsError,
                lastSuccessAt: state.channelsLastSuccess,
                whatsappMessage: state.whatsappLoginMessage,
                whatsappQrDataUrl: state.whatsappLoginQrDataUrl,
                whatsappConnected: state.whatsappLoginConnected,
                whatsappBusy: state.whatsappBusy,
                configSchema: state.configSchema,
                configSchemaLoading: state.configSchemaLoading,
                configForm: state.configForm,
                configUiHints: state.configUiHints,
                configSaving: state.configSaving,
                configFormDirty: state.configFormDirty,
                nostrProfileFormState: state.nostrProfileFormState,
                nostrProfileAccountId: state.nostrProfileAccountId,
                onRefresh: (probe) => loadChannels(state, probe),
                onWhatsAppStart: (force) => state.handleWhatsAppStart(force),
                onWhatsAppWait: () => state.handleWhatsAppWait(),
                onWhatsAppLogout: () => state.handleWhatsAppLogout(),
                onConfigPatch: (path, value) => updateConfigFormValue(state, path, value),
                onConfigSave: () => state.handleChannelConfigSave(),
                onConfigReload: () => state.handleChannelConfigReload(),
                onNostrProfileEdit: (accountId, profile) =>
                  state.handleNostrProfileEdit(accountId, profile),
                onNostrProfileCancel: () => state.handleNostrProfileCancel(),
                onNostrProfileFieldChange: (field, value) =>
                  state.handleNostrProfileFieldChange(field, value),
                onNostrProfileSave: () => state.handleNostrProfileSave(),
                onNostrProfileImport: () => state.handleNostrProfileImport(),
                onNostrProfileToggleAdvanced: () => state.handleNostrProfileToggleAdvanced(),
              }),
            )
          : nothing}
        ${state.tab === "instances"
          ? lazyRender(lazyInstances, (m) =>
              m.renderInstances({
                loading: state.presenceLoading,
                entries: state.presenceEntries,
                lastError: state.presenceError,
                statusMessage: state.presenceStatus,
                onRefresh: () => loadPresence(state),
              }),
            )
          : nothing}
        ${state.tab === "sessions"
          ? lazyRender(lazySessions, (m) =>
              m.renderSessions({
                loading: state.sessionsLoading,
                result: state.sessionsResult,
                error: state.sessionsError,
                activeMinutes: state.sessionsFilterActive,
                limit: state.sessionsFilterLimit,
                includeGlobal: state.sessionsIncludeGlobal,
                includeUnknown: state.sessionsIncludeUnknown,
                basePath: state.basePath,
                searchQuery: state.sessionsSearchQuery,
                sortColumn: state.sessionsSortColumn,
                sortDir: state.sessionsSortDir,
                page: state.sessionsPage,
                pageSize: state.sessionsPageSize,
                selectedKeys: state.sessionsSelectedKeys,
                expandedCheckpointKey: state.sessionsExpandedCheckpointKey,
                checkpointItemsByKey: state.sessionsCheckpointItemsByKey,
                checkpointLoadingKey: state.sessionsCheckpointLoadingKey,
                checkpointBusyKey: state.sessionsCheckpointBusyKey,
                checkpointErrorByKey: state.sessionsCheckpointErrorByKey,
                onFiltersChange: (next) => {
                  state.sessionsFilterActive = next.activeMinutes;
                  state.sessionsFilterLimit = next.limit;
                  state.sessionsIncludeGlobal = next.includeGlobal;
                  state.sessionsIncludeUnknown = next.includeUnknown;
                },
                onSearchChange: (q) => {
                  state.sessionsSearchQuery = q;
                  state.sessionsPage = 0;
                },
                onSortChange: (col, dir) => {
                  state.sessionsSortColumn = col;
                  state.sessionsSortDir = dir;
                  state.sessionsPage = 0;
                },
                onPageChange: (p) => {
                  state.sessionsPage = p;
                },
                onPageSizeChange: (s) => {
                  state.sessionsPageSize = s;
                  state.sessionsPage = 0;
                },
                onRefresh: () => loadSessions(state),
                onPatch: (key, patch) => patchSession(state, key, patch),
                onToggleSelect: (key) => {
                  const next = new Set(state.sessionsSelectedKeys);
                  if (next.has(key)) {
                    next.delete(key);
                  } else {
                    next.add(key);
                  }
                  state.sessionsSelectedKeys = next;
                },
                onSelectPage: (keys) => {
                  const next = new Set(state.sessionsSelectedKeys);
                  for (const k of keys) {
                    next.add(k);
                  }
                  state.sessionsSelectedKeys = next;
                },
                onDeselectPage: (keys) => {
                  const next = new Set(state.sessionsSelectedKeys);
                  for (const k of keys) {
                    next.delete(k);
                  }
                  state.sessionsSelectedKeys = next;
                },
                onDeselectAll: () => {
                  state.sessionsSelectedKeys = new Set();
                },
                onDeleteSelected: async () => {
                  const keys = [...state.sessionsSelectedKeys];
                  const deleted = await deleteSessionsAndRefresh(state, keys);
                  if (deleted.length > 0) {
                    const next = new Set(state.sessionsSelectedKeys);
                    for (const k of deleted) {
                      next.delete(k);
                    }
                    state.sessionsSelectedKeys = next;
                  }
                },
                onNavigateToChat: async (sessionKey) => {
                  if (await switchChatSession(state, sessionKey)) {
                    state.setTab("chat" as import("./navigation.ts").Tab);
                  }
                },
                onToggleCheckpointDetails: (sessionKey) =>
                  toggleSessionCompactionCheckpoints(state, sessionKey),
                onBranchFromCheckpoint: async (sessionKey, checkpointId) => {
                  const nextKey = await branchSessionFromCheckpoint(
                    state,
                    sessionKey,
                    checkpointId,
                  );
                  if (nextKey) {
                    if (await switchChatSession(state, nextKey)) {
                      state.setTab("chat" as import("./navigation.ts").Tab);
                    }
                  }
                },
                onRestoreCheckpoint: (sessionKey, checkpointId) =>
                  restoreSessionFromCheckpoint(state, sessionKey, checkpointId),
              }),
            )
          : nothing}
        ${renderUsageTab(state)} ${cronView}
        ${state.tab === "heartbeat" ? renderEmployeeHeartbeat(state) : nothing}
        ${state.tab === "agents"
          ? lazyRender(lazyAgents, (m) =>
              m.renderAgents({
                basePath: state.basePath ?? "",
                loading: state.agentsLoading,
                error: state.agentsError,
                agentsList: state.agentsList,
                selectedAgentId: resolvedAgentId,
                activePanel: state.agentsPanel,
                config: {
                  form: configValue,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  dirty: state.configFormDirty,
                },
                channels: {
                  snapshot: state.channelsSnapshot,
                  loading: state.channelsLoading,
                  error: state.channelsError,
                  lastSuccess: state.channelsLastSuccess,
                },
                cron: {
                  status: state.cronStatus,
                  jobs: state.cronJobs,
                  loading: state.cronLoading,
                  error: state.cronError,
                },
                agentFiles: {
                  list: state.agentFilesList,
                  loading: state.agentFilesLoading,
                  error: state.agentFilesError,
                  active: state.agentFileActive,
                  contents: state.agentFileContents,
                  drafts: state.agentFileDrafts,
                  saving: state.agentFileSaving,
                },
                agentIdentityLoading: state.agentIdentityLoading,
                agentIdentityError: state.agentIdentityError,
                agentIdentityById: state.agentIdentityById,
                agentSkills: {
                  report: state.agentSkillsReport,
                  loading: state.agentSkillsLoading,
                  error: state.agentSkillsError,
                  agentId: state.agentSkillsAgentId,
                  filter: state.skillsFilter,
                },
                toolsCatalog: {
                  loading: state.toolsCatalogLoading,
                  error: state.toolsCatalogError,
                  result: state.toolsCatalogResult,
                },
                toolsEffective: {
                  loading: state.toolsEffectiveLoading,
                  error: state.toolsEffectiveError,
                  result: state.toolsEffectiveResult,
                },
                runtimeSessionKey: state.sessionKey,
                runtimeSessionMatchesSelectedAgent: toolsPanelUsesActiveSession,
                modelCatalog: state.chatModelCatalog ?? [],
                onRefresh: async () => {
                  await loadAgents(state);
                  const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                  if (agentIds.length > 0) {
                    void loadAgentIdentities(state, agentIds);
                  }
                  const refreshedAgentId =
                    state.agentsSelectedId ??
                    state.agentsList?.defaultId ??
                    state.agentsList?.agents?.[0]?.id ??
                    null;
                  if (state.agentsPanel === "files" && refreshedAgentId) {
                    void loadAgentFiles(state, refreshedAgentId);
                  }
                  if (state.agentsPanel === "skills" && refreshedAgentId) {
                    void loadAgentSkills(state, refreshedAgentId);
                  }
                  if (state.agentsPanel === "tools" && refreshedAgentId) {
                    void loadToolsCatalog(state, refreshedAgentId);
                    if (refreshedAgentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                      void loadToolsEffective(state, {
                        agentId: refreshedAgentId,
                        sessionKey: state.sessionKey,
                      });
                    }
                  }
                  if (state.agentsPanel === "channels") {
                    void loadChannels(state, false);
                  }
                  if (state.agentsPanel === "cron") {
                    void state.loadCron();
                  }
                },
                onSelectAgent: (agentId) => {
                  if (state.agentsSelectedId === agentId) {
                    return;
                  }
                  state.agentsSelectedId = agentId;
                  state.agentFilesList = null;
                  state.agentFilesError = null;
                  state.agentFilesLoading = false;
                  state.agentFileActive = null;
                  state.agentFileContents = {};
                  state.agentFileDrafts = {};
                  state.agentSkillsReport = null;
                  state.agentSkillsError = null;
                  state.agentSkillsAgentId = null;
                  state.toolsCatalogResult = null;
                  state.toolsCatalogError = null;
                  state.toolsCatalogLoading = false;
                  state.toolsEffectiveResult = null;
                  state.toolsEffectiveResultKey = null;
                  state.toolsEffectiveError = null;
                  state.toolsEffectiveLoading = false;
                  state.toolsEffectiveLoadingKey = null;
                  void loadAgentIdentity(state, agentId);
                  if (state.agentsPanel === "files") {
                    void loadAgentFiles(state, agentId);
                  }
                  if (state.agentsPanel === "tools") {
                    void loadToolsCatalog(state, agentId);
                    if (agentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                      void loadToolsEffective(state, {
                        agentId,
                        sessionKey: state.sessionKey,
                      });
                    }
                  }
                  if (state.agentsPanel === "skills") {
                    void loadAgentSkills(state, agentId);
                  }
                },
                onSelectPanel: (panel) => {
                  state.agentsPanel = panel;
                  if (panel === "files" && resolvedAgentId) {
                    if (state.agentFilesList?.agentId !== resolvedAgentId) {
                      state.agentFilesList = null;
                      state.agentFilesError = null;
                      state.agentFileActive = null;
                      state.agentFileContents = {};
                      state.agentFileDrafts = {};
                      void loadAgentFiles(state, resolvedAgentId);
                    }
                  }
                  if (panel === "skills") {
                    if (resolvedAgentId) {
                      void loadAgentSkills(state, resolvedAgentId);
                    }
                  }
                  if (panel === "tools" && resolvedAgentId) {
                    if (
                      state.toolsCatalogResult?.agentId !== resolvedAgentId ||
                      state.toolsCatalogError
                    ) {
                      void loadToolsCatalog(state, resolvedAgentId);
                    }
                    if (resolvedAgentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                      const toolsRequestKey = buildToolsEffectiveRequestKey(state, {
                        agentId: resolvedAgentId,
                        sessionKey: state.sessionKey,
                      });
                      if (
                        state.toolsEffectiveResultKey !== toolsRequestKey ||
                        state.toolsEffectiveError
                      ) {
                        void loadToolsEffective(state, {
                          agentId: resolvedAgentId,
                          sessionKey: state.sessionKey,
                        });
                      }
                    } else {
                      state.toolsEffectiveResult = null;
                      state.toolsEffectiveResultKey = null;
                      state.toolsEffectiveError = null;
                      state.toolsEffectiveLoading = false;
                      state.toolsEffectiveLoadingKey = null;
                    }
                  }
                  if (panel === "channels") {
                    void loadChannels(state, false);
                  }
                  if (panel === "cron") {
                    void state.loadCron();
                  }
                },
                onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
                onSelectFile: (name) => {
                  state.agentFileActive = name;
                  if (!resolvedAgentId) {
                    return;
                  }
                  void loadAgentFileContent(state, resolvedAgentId, name);
                },
                onFileDraftChange: (name, content) => {
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                },
                onFileReset: (name) => {
                  const base = state.agentFileContents[name] ?? "";
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                },
                onFileSave: (name) => {
                  if (!resolvedAgentId) {
                    return;
                  }
                  const content =
                    state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                  void saveAgentFile(state, resolvedAgentId, name, content);
                },
                onToolsProfileChange: (agentId, profile, clearAllow) => {
                  const index =
                    profile || clearAllow ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (profile) {
                    updateConfigFormValue(state, [...basePath, "profile"], profile);
                  } else {
                    removeConfigFormValue(state, [...basePath, "profile"]);
                  }
                  if (clearAllow) {
                    removeConfigFormValue(state, [...basePath, "allow"]);
                  }
                },
                onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                  const index =
                    alsoAllow.length > 0 || deny.length > 0
                      ? ensureAgentIndex(agentId)
                      : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (alsoAllow.length > 0) {
                    updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
                  } else {
                    removeConfigFormValue(state, [...basePath, "alsoAllow"]);
                  }
                  if (deny.length > 0) {
                    updateConfigFormValue(state, [...basePath, "deny"], deny);
                  } else {
                    removeConfigFormValue(state, [...basePath, "deny"]);
                  }
                },
                onConfigReload: () => loadConfig(state),
                onConfigSave: () => saveAgentsConfig(state),
                onChannelsRefresh: () => loadChannels(state, false),
                onCronRefresh: () => state.loadCron(),
                onCronRunNow: (jobId) => {
                  const job = state.cronJobs.find((entry) => entry.id === jobId);
                  if (!job) {
                    return;
                  }
                  void runCronJob(state, job, "force");
                },
                onSkillsFilterChange: (next) => (state.skillsFilter = next),
                onSkillsRefresh: () => {
                  if (resolvedAgentId) {
                    void loadAgentSkills(state, resolvedAgentId);
                  }
                },
                onAgentSkillToggle: (agentId, skillName, enabled) => {
                  const index = ensureAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const entry = Array.isArray(list)
                    ? (list[index] as { skills?: unknown })
                    : undefined;
                  const normalizedSkill = skillName.trim();
                  if (!normalizedSkill) {
                    return;
                  }
                  const allSkills =
                    state.agentSkillsReport?.skills?.map((skill) => skill.name).filter(Boolean) ??
                    [];
                  const existing = Array.isArray(entry?.skills)
                    ? entry.skills.map((name) => String(name).trim()).filter(Boolean)
                    : undefined;
                  const base = existing ?? allSkills;
                  const next = new Set(base);
                  if (enabled) {
                    next.add(normalizedSkill);
                  } else {
                    next.delete(normalizedSkill);
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], [...next]);
                },
                onAgentSkillsClear: (agentId) => {
                  const index = findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  removeConfigFormValue(state, ["agents", "list", index, "skills"]);
                },
                onAgentSkillsDisableAll: (agentId) => {
                  const index = ensureAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "list", index, "skills"], []);
                },
                onModelChange: (agentId, modelId) => {
                  const index = modelId ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const basePath = ["agents", "list", index, "model"];
                  if (!modelId) {
                    removeConfigFormValue(state, basePath);
                  } else {
                    const entry = Array.isArray(list)
                      ? (list[index] as { model?: unknown })
                      : undefined;
                    const existing = entry?.model;
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                      const next = {
                        primary: modelId,
                        ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                      };
                      updateConfigFormValue(state, basePath, next);
                    } else {
                      updateConfigFormValue(state, basePath, modelId);
                    }
                  }
                  void refreshVisibleToolsEffectiveForCurrentSession(state);
                },
                onModelFallbacksChange: (agentId, fallbacks) => {
                  const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
                  const currentConfig = getCurrentConfigValue();
                  const resolvedConfig = resolveAgentConfig(currentConfig, agentId);
                  const effectivePrimary =
                    resolveModelPrimary(resolvedConfig.entry?.model) ??
                    resolveModelPrimary(resolvedConfig.defaults?.model);
                  const effectiveFallbacks = resolveEffectiveModelFallbacks(
                    resolvedConfig.entry?.model,
                    resolvedConfig.defaults?.model,
                  );
                  const index =
                    normalized.length > 0
                      ? effectivePrimary
                        ? ensureAgentIndex(agentId)
                        : -1
                      : (effectiveFallbacks?.length ?? 0) > 0 || findAgentIndex(agentId) >= 0
                        ? ensureAgentIndex(agentId)
                        : -1;
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const basePath = ["agents", "list", index, "model"];
                  const entry = Array.isArray(list)
                    ? (list[index] as { model?: unknown })
                    : undefined;
                  const existing = entry?.model;
                  const resolvePrimary = () => {
                    if (typeof existing === "string") {
                      return existing.trim() || null;
                    }
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const primary = (existing as { primary?: unknown }).primary;
                      if (typeof primary === "string") {
                        const trimmed = primary.trim();
                        return trimmed || null;
                      }
                    }
                    return null;
                  };
                  const primary = resolvePrimary() ?? effectivePrimary;
                  if (normalized.length === 0) {
                    if (primary) {
                      updateConfigFormValue(state, basePath, primary);
                    } else {
                      removeConfigFormValue(state, basePath);
                    }
                    return;
                  }
                  if (!primary) {
                    return;
                  }
                  updateConfigFormValue(state, basePath, { primary, fallbacks: normalized });
                },
                onSetDefault: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "defaultId"], agentId);
                },
              }),
            )
          : nothing}
        ${state.tab === "skills"
          ? lazyRender(lazySkills, (m) =>
              m.renderSkills({
                readOnly: state.employeeMode,
                allowWorkspaceActions: true,
                connected: state.connected,
                loading: state.employeeMode ? state.agentSkillsLoading : state.skillsLoading,
                report: state.employeeMode ? state.agentSkillsReport : state.skillsReport,
                error: state.employeeMode ? state.agentSkillsError : state.skillsError,
                filter: state.skillsFilter,
                statusFilter: state.skillsStatusFilter,
                edits: state.skillEdits,
                messages: state.skillMessages,
                busyKey: state.skillsBusyKey,
                detailKey: state.skillsDetailKey,
                clawhubQuery: state.clawhubSearchQuery,
                clawhubResults: state.clawhubSearchResults,
                clawhubSearchLoading: state.clawhubSearchLoading,
                clawhubSearchError: state.clawhubSearchError,
                clawhubDetail: state.clawhubDetail,
                clawhubDetailSlug: state.clawhubDetailSlug,
                clawhubDetailLoading: state.clawhubDetailLoading,
                clawhubDetailError: state.clawhubDetailError,
                clawhubInstallSlug: state.clawhubInstallSlug,
                clawhubInstallMessage: state.clawhubInstallMessage,
                onFilterChange: (next) => (state.skillsFilter = next),
                onStatusFilterChange: (next) => (state.skillsStatusFilter = next),
                onRefresh: () =>
                  state.employeeMode
                    ? loadAgentSkills(
                        state,
                        state.employeeProfile.agentId?.trim() ||
                          resolveAgentIdFromSessionKey(state.sessionKey) ||
                          "main",
                      )
                    : loadSkills(state, { clearMessages: true }),
                onToggle: (key, enabled) =>
                  state.employeeMode ? Promise.resolve() : updateSkillEnabled(state, key, enabled),
                onEdit: (key, value) => updateSkillEdit(state, key, value),
                onSaveKey: (key) =>
                  state.employeeMode ? Promise.resolve() : saveSkillApiKey(state, key),
                onInstall: (skillKey, name, installId) =>
                  state.employeeMode
                    ? Promise.resolve()
                    : installSkill(state, skillKey, name, installId),
                onDelete: (skillKey, slug) =>
                  (() => {
                    const confirmed =
                      typeof window === "undefined"
                        ? true
                        : window.confirm(
                            slug
                              ? "이 스킬을 workspace에서 제거합니다. 다시 사용하려면 Skill Hub에서 다시 설치해야 합니다."
                              : "이 스킬을 workspace에서 완전히 삭제합니다. 되돌릴 수 없습니다.",
                          );
                    if (!confirmed) {
                      return Promise.resolve();
                    }
                    return deleteWorkspaceSkill(state, skillKey, slug).then(async () => {
                      if (state.employeeMode) {
                        const agentId =
                          state.employeeProfile.agentId?.trim() ||
                          resolveAgentIdFromSessionKey(state.sessionKey) ||
                          "main";
                        await loadAgentSkills(state, agentId);
                      }
                    });
                  })(),
                onUpdateHubSkill: (slug) =>
                  updateSkillHubSkill(state, slug).then(async () => {
                    if (state.employeeMode) {
                      const agentId =
                        state.employeeProfile.agentId?.trim() ||
                        resolveAgentIdFromSessionKey(state.sessionKey) ||
                        "main";
                      await loadAgentSkills(state, agentId);
                    }
                  }),
                onDetailOpen: (key) => (state.skillsDetailKey = key),
                onDetailClose: () => (state.skillsDetailKey = null),
                onClawHubQueryChange: (query) => {
                  setClawHubSearchQuery(state, query);
                  if (clawhubSearchTimer) {
                    clearTimeout(clawhubSearchTimer);
                  }
                  clawhubSearchTimer = setTimeout(() => searchClawHub(state, query), 300);
                },
                onClawHubDetailOpen: (slug) => loadClawHubDetail(state, slug),
                onClawHubDetailClose: () => closeClawHubDetail(state),
                onClawHubInstall: (slug) => installFromClawHub(state, slug),
              }),
            )
          : nothing}
        ${state.tab === "skillHub"
          ? lazyRender(lazySkillHub, (m) =>
              m.renderSkillHub({
                loading: state.skillHubLoading,
                entries: state.skillHubEntries,
                error: state.skillHubError,
                scope: state.skillHubScope,
                sort: state.skillHubSort,
                category: state.skillHubCategory,
                query: state.skillHubQuery,
                detail: state.skillHubDetail,
                detailSlug: state.skillHubDetailSlug,
                detailLoading: state.skillHubDetailLoading,
                detailError: state.skillHubDetailError,
                busySlug: state.skillHubBusySlug,
                message: state.skillHubMessage,
                workspacePublishing: state.skillHubWorkspacePublishing,
                workspacePendingKeys: state.skillHubWorkspacePendingKeys,
                workspacePublishEntries: state.skillHubWorkspacePublishEntries,
                overview: state.skillHubOverview,
                uploading: state.skillHubUploading,
                workspacePanelOpen: state.skillHubWorkspacePanelOpen,
                editorOpen: state.skillHubEditorOpen,
                editorMode: state.skillHubEditorMode,
                editorTitle: state.skillHubEditorTitle,
                editorSkillName: state.skillHubEditorSkillName,
                editorFile: state.skillHubEditorFile,
                editorIconFile: state.skillHubEditorIconFile,
                editorIconReset: state.skillHubEditorIconReset,
                editorHasUploadedIcon:
                  state.skillHubEditorMode === "edit-metadata" &&
                  state.skillHubDetail?.slug === state.skillHubEditorSlug &&
                  state.skillHubDetail.presentation.icon.source === "uploaded",
                editorDisplayName: state.skillHubEditorDisplayName,
                editorDescription: state.skillHubEditorDescription,
                editorCategory: state.skillHubEditorCategory,
                editorPrompts: state.skillHubEditorPrompts,
                editorError: state.skillHubEditorError,
                editorLoading: state.skillHubEditorLoading,
                transferOpen: state.skillHubTransferOpen,
                transferTitle: state.skillHubTransferTitle,
                transferQuery: state.skillHubTransferQuery,
                transferResults: state.skillHubTransferResults,
                transferTargetAccountId: state.skillHubTransferTargetAccountId,
                transferReason: state.skillHubTransferReason,
                transferError: state.skillHubTransferError,
                transferLoading: state.skillHubTransferLoading,
                onScopeChange: (scope) => {
                  state.skillHubScope = scope;
                  void loadSkillHub(state);
                },
                onSortChange: (sort) => {
                  state.skillHubSort = sort;
                  void loadSkillHub(state);
                },
                onCategoryChange: (category) => {
                  state.skillHubCategory = category;
                  void loadSkillHub(state);
                },
                onQueryChange: (query) => {
                  state.skillHubQuery = query;
                  void loadSkillHub(state);
                },
                onRefresh: () => {
                  void loadSkillHub(state);
                  void loadSkillHubWorkspacePublish(state);
                },
                onOpenDetail: (slug) => void loadSkillHubDetail(state, slug),
                onCloseDetail: () => closeSkillHubDetail(state),
                onLike: (slug) => void toggleLikeSkillHubSkill(state, slug),
                onCopy: async (text, successText) => {
                  try {
                    await navigator.clipboard.writeText(text);
                    state.skillHubMessage = { kind: "success", text: successText };
                  } catch (err) {
                    state.skillHubMessage = {
                      kind: "error",
                      text: err instanceof Error ? err.message : String(err),
                    };
                  }
                },
                onInstall: async (slug) => {
                  await installSkillHubSkill(state, slug);
                  if (state.employeeMode) {
                    const agentId =
                      state.employeeProfile?.agentId?.trim() ||
                      resolveAgentIdFromSessionKey(state.sessionKey) ||
                      "main";
                    await loadAgentSkills(state, agentId);
                  } else {
                    await loadSkills(state);
                  }
                },
                onUpdate: async (slug) => {
                  await updateSkillHubSkill(state, slug);
                  if (state.employeeMode) {
                    const agentId =
                      state.employeeProfile?.agentId?.trim() ||
                      resolveAgentIdFromSessionKey(state.sessionKey) ||
                      "main";
                    await loadAgentSkills(state, agentId);
                  } else {
                    await loadSkills(state);
                  }
                },
                onDelete: (slug) => {
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm(
                      "이 스킬을 workspace에서 제거합니다. 다시 사용하려면 Skill Hub에서 다시 설치해야 합니다.",
                    )
                  ) {
                    return;
                  }
                  void (async () => {
                    await deleteSkillHubSkill(state, slug);
                    if (state.employeeMode) {
                      const agentId =
                        state.employeeProfile?.agentId?.trim() ||
                        resolveAgentIdFromSessionKey(state.sessionKey) ||
                        "main";
                      await loadAgentSkills(state, agentId);
                    } else {
                      await loadSkills(state);
                    }
                  })();
                },
                onDeleteFromHub: (slug) => {
                  if (
                    typeof window !== "undefined" &&
                    !window.confirm(
                      "이 스킬을 Skill Hub에서 완전히 삭제합니다. 워크스페이스 복사본은 유지되며 다시 발행할 수 있습니다.",
                    )
                  ) {
                    return;
                  }
                  void deleteSkillHubEntry(state, slug);
                },
                onOpenWorkspaceSkillDetail: (skillKey) => {
                  state.skillsDetailKey = skillKey;
                  state.tab = "skills";
                },
                onOpenPublishEditor: (skillName, title) => {
                  state.skillHubEditorOpen = true;
                  state.skillHubEditorMode = "publish";
                  state.skillHubEditorTitle = title;
                  state.skillHubEditorSkillName = skillName;
                  state.skillHubEditorSlug = null;
                  state.skillHubEditorFile = null;
                  state.skillHubEditorIconFile = null;
                  state.skillHubEditorIconReset = false;
                  state.skillHubEditorDisplayName = "";
                  state.skillHubEditorDescription = "";
                  state.skillHubEditorCategory = "";
                  state.skillHubEditorRevision = 0;
                  state.skillHubEditorPrompts = ["", "", ""];
                  state.skillHubEditorError = null;
                  state.skillHubEditorLoading = true;
                  void (async () => {
                    try {
                      const existing = await resolveExistingSkillHubPromptsForSkillName(
                        state,
                        skillName,
                      );
                      if (
                        !state.skillHubEditorOpen ||
                        state.skillHubEditorMode !== "publish" ||
                        state.skillHubEditorSkillName !== skillName
                      ) {
                        return;
                      }
                      state.skillHubEditorSlug = existing?.slug ?? null;
                      state.skillHubEditorDisplayName =
                        existing?.presentationEdit.displayName ?? "";
                      state.skillHubEditorDescription =
                        existing?.presentationEdit.displayDescription ?? "";
                      state.skillHubEditorCategory = existing?.presentationEdit.category ?? "";
                      state.skillHubEditorPrompts = toEditorPrompts(existing?.examplePrompts ?? []);
                    } catch (err) {
                      if (
                        state.skillHubEditorOpen &&
                        state.skillHubEditorMode === "publish" &&
                        state.skillHubEditorSkillName === skillName
                      ) {
                        state.skillHubEditorError =
                          err instanceof Error ? err.message : String(err);
                      }
                    } finally {
                      if (
                        state.skillHubEditorOpen &&
                        state.skillHubEditorMode === "publish" &&
                        state.skillHubEditorSkillName === skillName
                      ) {
                        state.skillHubEditorLoading = false;
                      }
                    }
                  })();
                },
                onOpenUploadEditor: () => {
                  state.skillHubEditorOpen = true;
                  state.skillHubEditorMode = "upload";
                  state.skillHubEditorTitle = null;
                  state.skillHubEditorSkillName = null;
                  state.skillHubEditorSlug = null;
                  state.skillHubEditorFile = null;
                  state.skillHubEditorIconFile = null;
                  state.skillHubEditorIconReset = false;
                  state.skillHubEditorDisplayName = "";
                  state.skillHubEditorDescription = "";
                  state.skillHubEditorCategory = "";
                  state.skillHubEditorRevision = 0;
                  state.skillHubEditorPrompts = ["", "", ""];
                  state.skillHubEditorError = null;
                  state.skillHubEditorLoading = false;
                },
                onToggleWorkspacePanel: () => {
                  state.skillHubWorkspacePanelOpen = !state.skillHubWorkspacePanelOpen;
                },
                onOpenEditMetadataEditor: (detail) => {
                  state.skillHubEditorOpen = true;
                  state.skillHubEditorMode = "edit-metadata";
                  state.skillHubEditorTitle = detail.presentation.displayName;
                  state.skillHubEditorSkillName = null;
                  state.skillHubEditorSlug = detail.slug;
                  state.skillHubEditorFile = null;
                  state.skillHubEditorIconFile = null;
                  state.skillHubEditorIconReset = false;
                  state.skillHubEditorDisplayName = detail.presentationEdit.displayName ?? "";
                  state.skillHubEditorDescription =
                    detail.presentationEdit.displayDescription ?? "";
                  state.skillHubEditorCategory = detail.presentationEdit.category ?? "";
                  state.skillHubEditorRevision = detail.presentationEdit.revision;
                  state.skillHubEditorPrompts = [
                    detail.examplePrompts[0] ?? "",
                    detail.examplePrompts[1] ?? "",
                    detail.examplePrompts[2] ?? "",
                  ];
                  state.skillHubEditorError = null;
                  state.skillHubEditorLoading = false;
                },
                onEditorClose: () => {
                  state.skillHubEditorOpen = false;
                  state.skillHubEditorMode = null;
                  state.skillHubEditorTitle = null;
                  state.skillHubEditorSkillName = null;
                  state.skillHubEditorSlug = null;
                  state.skillHubEditorFile = null;
                  state.skillHubEditorIconFile = null;
                  state.skillHubEditorIconReset = false;
                  state.skillHubEditorDisplayName = "";
                  state.skillHubEditorDescription = "";
                  state.skillHubEditorCategory = "";
                  state.skillHubEditorRevision = 0;
                  state.skillHubEditorPrompts = ["", "", ""];
                  state.skillHubEditorError = null;
                  state.skillHubEditorLoading = false;
                },
                onEditorDisplayNameChange: (value) => {
                  state.skillHubEditorDisplayName = value.slice(0, 80);
                },
                onEditorDescriptionChange: (value) => {
                  state.skillHubEditorDescription = value.slice(0, 100);
                },
                onEditorCategoryChange: (value) => {
                  state.skillHubEditorCategory = value;
                },
                onEditorPromptChange: (index, value) => {
                  const next = state.skillHubEditorPrompts.slice(0, 3);
                  while (next.length < 3) {
                    next.push("");
                  }
                  next[index] = value.slice(0, 200);
                  state.skillHubEditorPrompts = next;
                },
                onEditorFileChange: (file) => {
                  state.skillHubEditorFile = file;
                  state.skillHubEditorError = null;
                },
                onEditorIconFileChange: (file) => {
                  state.skillHubEditorIconFile = file;
                  state.skillHubEditorIconReset = false;
                  state.skillHubEditorError = null;
                },
                onEditorIconReset: () => {
                  state.skillHubEditorIconFile = null;
                  state.skillHubEditorIconReset = true;
                  state.skillHubEditorError = null;
                },
                onEditorSubmit: () => {
                  const prompts = state.skillHubEditorPrompts
                    .map((value) => value.replace(/\s+/g, " ").trim())
                    .filter(Boolean)
                    .slice(0, 3);
                  void (async () => {
                    state.skillHubEditorError = null;
                    try {
                      if (state.skillHubEditorMode === "publish") {
                        if (!state.skillHubEditorSkillName) {
                          state.skillHubEditorError = "Missing workspace skill.";
                          return;
                        }
                        const publishEntry = state.skillHubWorkspacePublishEntries.find(
                          (entry) => entry.skillName === state.skillHubEditorSkillName,
                        );
                        if (!publishEntry || publishEntry.disabled) {
                          state.skillHubEditorError =
                            "발행 상태가 변경되었습니다. Skill Hub를 새로고침해주세요.";
                          return;
                        }
                        await publishWorkspaceSkillWithPrompts(state, publishEntry, prompts, {
                          displayName: state.skillHubEditorDisplayName,
                          displayDescription: state.skillHubEditorDescription,
                          category: state.skillHubEditorCategory,
                          iconFile: state.skillHubEditorIconFile,
                        });
                      } else if (state.skillHubEditorMode === "upload") {
                        if (!state.skillHubEditorFile) {
                          state.skillHubEditorError = "Choose a .skill file first.";
                          return;
                        }
                        await uploadSkillHubPackageWithPrompts(
                          state,
                          state.skillHubEditorFile,
                          prompts,
                          {
                            displayName: state.skillHubEditorDisplayName,
                            displayDescription: state.skillHubEditorDescription,
                            category: state.skillHubEditorCategory,
                            iconFile: state.skillHubEditorIconFile,
                          },
                        );
                      } else if (state.skillHubEditorMode === "edit-metadata") {
                        if (!state.skillHubEditorSlug) {
                          state.skillHubEditorError = "Missing skill id.";
                          return;
                        }
                        await updateSkillHubPresentationAction(state, {
                          slug: state.skillHubEditorSlug,
                          expectedRevision: state.skillHubEditorRevision,
                          displayName: state.skillHubEditorDisplayName,
                          displayDescription: state.skillHubEditorDescription,
                          category: state.skillHubEditorCategory,
                          examplePrompts: prompts,
                          iconFile: state.skillHubEditorIconFile,
                          resetIcon: state.skillHubEditorIconReset,
                        });
                      }
                      state.skillHubEditorOpen = false;
                      state.skillHubEditorMode = null;
                      state.skillHubEditorTitle = null;
                      state.skillHubEditorSkillName = null;
                      state.skillHubEditorSlug = null;
                      state.skillHubEditorFile = null;
                      state.skillHubEditorIconFile = null;
                      state.skillHubEditorIconReset = false;
                      state.skillHubEditorDisplayName = "";
                      state.skillHubEditorDescription = "";
                      state.skillHubEditorCategory = "";
                      state.skillHubEditorRevision = 0;
                      state.skillHubEditorPrompts = ["", "", ""];
                      state.skillHubEditorError = null;
                      state.skillHubEditorLoading = false;
                      if (state.employeeMode) {
                        const agentId =
                          state.employeeProfile?.agentId?.trim() ||
                          resolveAgentIdFromSessionKey(state.sessionKey) ||
                          "main";
                        await loadAgentSkills(state, agentId);
                      } else {
                        await loadSkills(state);
                      }
                    } catch (err) {
                      state.skillHubEditorError = err instanceof Error ? err.message : String(err);
                    }
                  })();
                },
                onOpenTransfer: async (slug, title) => {
                  state.skillHubTransferOpen = true;
                  state.skillHubTransferSlug = slug;
                  state.skillHubTransferTitle = title;
                  state.skillHubTransferQuery = "";
                  state.skillHubTransferResults = [];
                  state.skillHubTransferTargetAccountId = null;
                  state.skillHubTransferReason = "";
                  state.skillHubTransferError = null;
                  state.skillHubTransferLoading = true;
                  try {
                    const result = await searchDirectoryAccounts({
                      client: state.client,
                      connected: state.connected,
                      query: "",
                      limit: 12,
                    });
                    if (
                      !state.skillHubTransferOpen ||
                      state.skillHubTransferSlug !== slug ||
                      state.skillHubTransferQuery !== ""
                    ) {
                      return;
                    }
                    state.skillHubTransferResults = result.entries;
                    state.skillHubTransferError = result.error;
                  } finally {
                    if (
                      state.skillHubTransferOpen &&
                      state.skillHubTransferSlug === slug &&
                      state.skillHubTransferQuery === ""
                    ) {
                      state.skillHubTransferLoading = false;
                    }
                  }
                },
                onCloseTransfer: () => {
                  state.skillHubTransferOpen = false;
                  state.skillHubTransferSlug = null;
                  state.skillHubTransferTitle = null;
                  state.skillHubTransferQuery = "";
                  state.skillHubTransferResults = [];
                  state.skillHubTransferTargetAccountId = null;
                  state.skillHubTransferReason = "";
                  state.skillHubTransferError = null;
                  state.skillHubTransferLoading = false;
                },
                onTransferQueryChange: async (value) => {
                  state.skillHubTransferQuery = value;
                  state.skillHubTransferTargetAccountId = null;
                  state.skillHubTransferLoading = true;
                  const transferSlug = state.skillHubTransferSlug;
                  try {
                    const result = await searchDirectoryAccounts({
                      client: state.client,
                      connected: state.connected,
                      query: value,
                      limit: 12,
                    });
                    if (
                      !state.skillHubTransferOpen ||
                      state.skillHubTransferSlug !== transferSlug ||
                      state.skillHubTransferQuery !== value
                    ) {
                      return;
                    }
                    state.skillHubTransferResults = result.entries;
                    state.skillHubTransferError = result.error;
                  } finally {
                    if (
                      state.skillHubTransferOpen &&
                      state.skillHubTransferSlug === transferSlug &&
                      state.skillHubTransferQuery === value
                    ) {
                      state.skillHubTransferLoading = false;
                    }
                  }
                },
                onTransferTargetSelect: (accountId) => {
                  state.skillHubTransferTargetAccountId = accountId;
                },
                onTransferReasonChange: (value) => {
                  state.skillHubTransferReason = value;
                },
                onTransferSubmit: () => {
                  const slug = state.skillHubTransferSlug;
                  const targetAccountId = state.skillHubTransferTargetAccountId;
                  if (!slug || !targetAccountId) {
                    return;
                  }
                  void (async () => {
                    state.skillHubTransferLoading = true;
                    state.skillHubTransferError = null;
                    try {
                      await transferSkillHubOwnershipAction(state, {
                        slug,
                        targetAccountId,
                        reason: state.skillHubTransferReason,
                      });
                      state.skillHubTransferOpen = false;
                      state.skillHubTransferSlug = null;
                      state.skillHubTransferTitle = null;
                      state.skillHubTransferQuery = "";
                      state.skillHubTransferResults = [];
                      state.skillHubTransferTargetAccountId = null;
                      state.skillHubTransferReason = "";
                    } catch (err) {
                      state.skillHubTransferError =
                        err instanceof Error ? err.message : String(err);
                    } finally {
                      state.skillHubTransferLoading = false;
                    }
                  })();
                },
              }),
            )
          : nothing}
        ${state.tab === "credentials"
          ? lazyRender(lazyCredentials, (m) =>
              m.renderCredentials({
                statusLoading: state.credentialStatusLoading,
                encryptionReady: state.credentialStatus?.encryptionReady === true,
                encryptionKeyName: state.credentialStatus?.keyName ?? "PLATFORMCLAW_MASTER_KEY",
                statusError: state.credentialStatusError,
                loading: state.credentialDefinitionsLoading,
                definitions: state.credentialDefinitions,
                definitionsError: state.credentialDefinitionsError,
                credentialsLoading: state.credentialsLoading,
                credentials: state.credentials,
                credentialsError: state.credentialsError,
                message: state.credentialsMessage,
                valueDrafts: state.credentialValueDrafts,
                expiresAtDrafts: state.credentialExpiresAtDrafts,
                savingKey: state.credentialSavingKey,
                revokingKey: state.credentialRevokingKey,
                canManageDefinitions: Boolean(state.employeeAccountSummary?.hasAdminAccess),
                definitionDraft: state.credentialDefinitionDraft,
                definitionSaving: state.credentialDefinitionSaving,
                definitionDeletingKey: state.credentialDefinitionDeletingKey,
                definitionModalOpen: state.credentialDefinitionModalOpen,
                onRefresh: () => {
                  void Promise.all([
                    loadCredentialStatus(state),
                    loadCredentialDefinitions(state),
                    loadCredentials(state),
                  ]);
                },
                onValueDraftChange: (definitionKey, value) => {
                  state.credentialValueDrafts = {
                    ...state.credentialValueDrafts,
                    [definitionKey]: value,
                  };
                },
                onExpiresAtDraftChange: (definitionKey, value) => {
                  state.credentialExpiresAtDrafts = {
                    ...state.credentialExpiresAtDrafts,
                    [definitionKey]: value,
                  };
                },
                onSaveCredential: (definitionKey) => {
                  const value = state.credentialValueDrafts[definitionKey]?.trim() ?? "";
                  const expiresAt = state.credentialExpiresAtDrafts[definitionKey]?.trim() || null;
                  if (!value) {
                    return;
                  }
                  void (async () => {
                    state.credentialSavingKey = definitionKey;
                    try {
                      await upsertCredentialAction(state, { definitionKey, value, expiresAt });
                      const remainingValues = { ...state.credentialValueDrafts };
                      delete remainingValues[definitionKey];
                      state.credentialValueDrafts = remainingValues;
                    } finally {
                      state.credentialSavingKey = null;
                    }
                  })();
                },
                onRevokeCredential: (definitionKey) => {
                  if (!window.confirm(`Revoke credential "${definitionKey}"?`)) {
                    return;
                  }
                  void (async () => {
                    state.credentialRevokingKey = definitionKey;
                    try {
                      await revokeCredentialAction(state, { definitionKey });
                    } finally {
                      state.credentialRevokingKey = null;
                    }
                  })();
                },
                onDefinitionDraftChange: (patch) => {
                  state.credentialDefinitionDraft = {
                    ...state.credentialDefinitionDraft,
                    ...patch,
                  };
                },
                onOpenDefinitionCreate: () => {
                  state.credentialDefinitionDraft = {
                    key: "",
                    label: "",
                    type: "api_token",
                    description: "",
                    descriptionEn: "",
                    usageHint: "",
                    ownerPolicy: "account",
                    rotationDays: "",
                    required: false,
                  };
                  state.credentialDefinitionModalOpen = true;
                },
                onCloseDefinitionModal: () => {
                  state.credentialDefinitionModalOpen = false;
                },
                onSaveDefinition: () => {
                  const draft = state.credentialDefinitionDraft;
                  const parsedRotationDays = draft.rotationDays.trim()
                    ? Number.parseInt(draft.rotationDays.trim(), 10)
                    : null;
                  const rotationDays =
                    typeof parsedRotationDays === "number" &&
                    Number.isInteger(parsedRotationDays) &&
                    parsedRotationDays > 0
                      ? parsedRotationDays
                      : null;
                  void (async () => {
                    state.credentialDefinitionSaving = true;
                    try {
                      await upsertCredentialDefinitionAction(state, {
                        key: draft.key,
                        label: draft.label,
                        type: draft.type,
                        description: draft.description || null,
                        descriptionEn: draft.descriptionEn || null,
                        usageHint: draft.usageHint || null,
                        ownerPolicy: draft.ownerPolicy,
                        rotationDays,
                        required: draft.required,
                      });
                      state.credentialDefinitionDraft = {
                        key: "",
                        label: "",
                        type: "api_token",
                        description: "",
                        descriptionEn: "",
                        usageHint: "",
                        ownerPolicy: "account",
                        rotationDays: "",
                        required: false,
                      };
                      state.credentialDefinitionModalOpen = false;
                    } finally {
                      state.credentialDefinitionSaving = false;
                    }
                  })();
                },
                onDeleteDefinition: (definitionKey) => {
                  const ok = window.confirm(
                    i18n.getLocale() === "ko"
                      ? `Credential 유형 "${definitionKey}"을 삭제할까요?`
                      : `Delete credential type "${definitionKey}"?`,
                  );
                  if (!ok) {
                    return;
                  }
                  void (async () => {
                    state.credentialDefinitionDeletingKey = definitionKey;
                    try {
                      await deleteCredentialDefinitionAction(state, { key: definitionKey });
                    } finally {
                      state.credentialDefinitionDeletingKey = null;
                    }
                  })();
                },
                onUseDefinitionTemplate: (definition) => {
                  state.credentialDefinitionDraft = {
                    key: definition.key,
                    label: definition.label,
                    type: definition.type,
                    description: definition.description ?? "",
                    descriptionEn: definition.descriptionEn ?? "",
                    usageHint: definition.usageHint ?? "",
                    ownerPolicy: definition.ownerPolicy,
                    rotationDays: definition.rotationDays ? String(definition.rotationDays) : "",
                    required: definition.required,
                  };
                  state.credentialDefinitionModalOpen = true;
                  requestHostUpdate?.();
                },
              }),
            )
          : nothing}
        ${state.tab === "groups"
          ? lazyRender(lazyGroups, (m) =>
              m.renderGroups({
                loading: state.groupsLoading,
                entries: state.groupsEntries,
                error: state.groupsError,
                includeArchived: state.groupsIncludeArchived,
                detailGroupId: state.groupsDetailGroupId,
                detailLoading: state.groupsDetailLoading,
                detail: state.groupsDetail,
                detailError: state.groupsDetailError,
                message: state.groupsMessage,
                createOpen: state.groupsCreateOpen,
                createName: state.groupsCreateName,
                createDescription: state.groupsCreateDescription,
                createSubmitting: state.groupsCreateSubmitting,
                partCreateOpen: state.groupsPartCreateOpen,
                partCreateParentId: state.groupsPartCreateParentId,
                partCreateName: state.groupsPartCreateName,
                partCreateDescription: state.groupsPartCreateDescription,
                partCreateSubmitting: state.groupsPartCreateSubmitting,
                editOpen: state.groupsEditOpen,
                editScopeType: state.groupsEditScopeType,
                editTitle: state.groupsEditTitle,
                editName: state.groupsEditName,
                editDescription: state.groupsEditDescription,
                editSubmitting: state.groupsEditSubmitting,
                memberModalOpen: state.groupsMemberModalOpen,
                memberModalScopeType: state.groupsMemberModalScopeType,
                memberModalScopeLabel: state.groupsMemberModalScopeLabel,
                memberModalQuery: state.groupsMemberModalQuery,
                memberModalResults: state.groupsMemberModalResults,
                memberModalSelectedAccountId: state.groupsMemberModalSelectedAccountId,
                memberModalRole: state.groupsMemberModalRole,
                memberModalError: state.groupsMemberModalError,
                memberModalLoading: state.groupsMemberModalLoading,
                canAssignLeader: Boolean(state.employeeAccountSummary?.hasAdminAccess),
                onToggleArchived: async (next) => {
                  state.groupsIncludeArchived = next;
                  await loadGroups(state);
                  if (state.groupsDetailGroupId) {
                    await loadGroupDetail(state, state.groupsDetailGroupId);
                  }
                },
                onRefresh: () =>
                  void (async () => {
                    await Promise.all([loadGroups(state), loadGroupScopeOptions(state)]);
                    const currentGroupId =
                      state.groupsDetailGroupId ?? state.groupsEntries[0]?.id ?? null;
                    if (currentGroupId) {
                      await loadGroupDetail(state, currentGroupId);
                    }
                  })(),
                onSelectGroup: (groupId) => void loadGroupDetail(state, groupId),
                onOpenCreate: () => {
                  state.groupsCreateOpen = true;
                },
                onCloseCreate: () => {
                  state.groupsCreateOpen = false;
                  state.groupsCreateName = "";
                  state.groupsCreateDescription = "";
                },
                onCreateNameChange: (value) => (state.groupsCreateName = value),
                onCreateDescriptionChange: (value) => (state.groupsCreateDescription = value),
                onSubmitCreate: () => {
                  void (async () => {
                    state.groupsCreateSubmitting = true;
                    try {
                      await createGroupAction(state, {
                        name: state.groupsCreateName,
                        description: state.groupsCreateDescription,
                      });
                      state.groupsCreateOpen = false;
                      state.groupsCreateName = "";
                      state.groupsCreateDescription = "";
                    } finally {
                      state.groupsCreateSubmitting = false;
                    }
                  })();
                },
                onOpenCreatePart: (groupId) => {
                  state.groupsPartCreateOpen = true;
                  state.groupsPartCreateParentId = groupId;
                },
                onCloseCreatePart: () => {
                  state.groupsPartCreateOpen = false;
                  state.groupsPartCreateParentId = null;
                  state.groupsPartCreateName = "";
                  state.groupsPartCreateDescription = "";
                },
                onPartNameChange: (value) => (state.groupsPartCreateName = value),
                onPartDescriptionChange: (value) => (state.groupsPartCreateDescription = value),
                onSubmitCreatePart: () => {
                  const groupId = state.groupsPartCreateParentId;
                  if (!groupId) {
                    return;
                  }
                  void (async () => {
                    state.groupsPartCreateSubmitting = true;
                    try {
                      await createPartAction(state, {
                        groupId,
                        name: state.groupsPartCreateName,
                        description: state.groupsPartCreateDescription,
                      });
                      state.groupsPartCreateOpen = false;
                      state.groupsPartCreateParentId = null;
                      state.groupsPartCreateName = "";
                      state.groupsPartCreateDescription = "";
                    } finally {
                      state.groupsPartCreateSubmitting = false;
                    }
                  })();
                },
                onOpenEdit: (scopeType, entry) => {
                  state.groupsEditOpen = true;
                  state.groupsEditScopeType = scopeType;
                  state.groupsEditScopeId = entry.id;
                  state.groupsEditParentGroupId =
                    scopeType === "part" ? entry.parentGroupId : entry.id;
                  state.groupsEditTitle = entry.name;
                  state.groupsEditName = entry.name;
                  state.groupsEditDescription = entry.description ?? "";
                },
                onCloseEdit: () => {
                  state.groupsEditOpen = false;
                  state.groupsEditScopeId = null;
                  state.groupsEditParentGroupId = null;
                  state.groupsEditTitle = null;
                  state.groupsEditName = "";
                  state.groupsEditDescription = "";
                  state.groupsEditSubmitting = false;
                },
                onEditNameChange: (value) => (state.groupsEditName = value),
                onEditDescriptionChange: (value) => (state.groupsEditDescription = value),
                onSubmitEdit: () => {
                  const scopeId = state.groupsEditScopeId;
                  const parentGroupId = state.groupsEditParentGroupId;
                  if (!scopeId || !parentGroupId) {
                    return;
                  }
                  void (async () => {
                    state.groupsEditSubmitting = true;
                    try {
                      if (state.groupsEditScopeType === "group") {
                        await updateGroupAction(state, {
                          groupId: scopeId,
                          name: state.groupsEditName,
                          description: state.groupsEditDescription,
                        });
                      } else {
                        await updatePartAction(state, {
                          groupId: parentGroupId,
                          partId: scopeId,
                          name: state.groupsEditName,
                          description: state.groupsEditDescription,
                        });
                      }
                      state.groupsEditOpen = false;
                      state.groupsEditScopeId = null;
                      state.groupsEditParentGroupId = null;
                      state.groupsEditTitle = null;
                      state.groupsEditName = "";
                      state.groupsEditDescription = "";
                    } finally {
                      state.groupsEditSubmitting = false;
                    }
                  })();
                },
                onOpenAddMember: async (scopeType, scopeId, label) => {
                  state.groupsMemberModalOpen = true;
                  state.groupsMemberModalScopeType = scopeType;
                  state.groupsMemberModalScopeId = scopeId;
                  state.groupsMemberModalScopeLabel = label;
                  state.groupsMemberModalQuery = "";
                  state.groupsMemberModalResults = [];
                  state.groupsMemberModalSelectedAccountId = null;
                  state.groupsMemberModalRole = "member";
                  state.groupsMemberModalError = null;
                  const result = await searchDirectoryAccounts({
                    client: state.client,
                    connected: state.connected,
                    query: "",
                    limit: 12,
                  });
                  state.groupsMemberModalResults = result.entries;
                  state.groupsMemberModalError = result.error;
                },
                onCloseAddMember: () => {
                  state.groupsMemberModalOpen = false;
                  state.groupsMemberModalScopeId = null;
                  state.groupsMemberModalScopeLabel = null;
                  state.groupsMemberModalQuery = "";
                  state.groupsMemberModalResults = [];
                  state.groupsMemberModalSelectedAccountId = null;
                  state.groupsMemberModalRole = "member";
                  state.groupsMemberModalError = null;
                  state.groupsMemberModalLoading = false;
                },
                onMemberQueryChange: async (value) => {
                  state.groupsMemberModalQuery = value;
                  const result = await searchDirectoryAccounts({
                    client: state.client,
                    connected: state.connected,
                    query: value,
                    limit: 12,
                  });
                  state.groupsMemberModalResults = result.entries;
                  state.groupsMemberModalError = result.error;
                },
                onSelectMemberAccount: (accountId) => {
                  state.groupsMemberModalSelectedAccountId = accountId;
                },
                onMemberRoleChange: (value) => {
                  state.groupsMemberModalRole = value;
                },
                onSubmitAddMember: () => {
                  const scopeId = state.groupsMemberModalScopeId;
                  const accountId = state.groupsMemberModalSelectedAccountId;
                  if (!scopeId || !accountId) {
                    return;
                  }
                  void (async () => {
                    state.groupsMemberModalLoading = true;
                    try {
                      await addGroupMemberAction(state, {
                        scopeType: state.groupsMemberModalScopeType,
                        scopeId,
                        accountId,
                        groupRole: state.groupsMemberModalRole,
                      });
                      state.groupsMemberModalOpen = false;
                      state.groupsMemberModalScopeId = null;
                      state.groupsMemberModalScopeLabel = null;
                      state.groupsMemberModalRole = "member";
                    } finally {
                      state.groupsMemberModalLoading = false;
                    }
                  })();
                },
                onRemoveMember: (scopeType, scopeId, accountId, label) => {
                  if (!window.confirm(`Remove ${label} from this ${scopeType}?`)) {
                    return;
                  }
                  void removeGroupMemberAction(state, { scopeType, scopeId, accountId });
                },
                onPromoteMember: (scopeType, scopeId, accountId) => {
                  void addGroupMemberAction(state, {
                    scopeType,
                    scopeId,
                    accountId,
                    groupRole: "leader",
                  });
                },
                onDemoteMember: (scopeType, scopeId, accountId) => {
                  void addGroupMemberAction(state, {
                    scopeType,
                    scopeId,
                    accountId,
                    groupRole: "member",
                  });
                },
                onArchiveScope: (scopeId, label) => {
                  if (!window.confirm(`Archive ${label}?`)) {
                    return;
                  }
                  void archiveGroupScopeAction(state, scopeId);
                },
              }),
            )
          : nothing}
        ${state.tab === "files"
          ? renderWorkspaceFiles({
              loading: state.workspaceFilesLoading,
              uploading: state.workspaceFilesUploading,
              error: state.workspaceFilesError,
              message: state.workspaceFilesMessage,
              currentPath: state.workspaceFilesCurrentPath,
              parentPath: state.workspaceFilesParentPath,
              breadcrumbs: state.workspaceFilesBreadcrumbs,
              entries: state.workspaceFilesEntries,
              selectedPaths: state.workspaceFilesSelectedPaths,
              uploads: state.workspaceFilesUploads,
              previewLoading: state.workspaceFilesPreviewLoading,
              previewError: state.workspaceFilesPreviewError,
              preview: state.workspaceFilesPreview,
              onNavigate: (relativePath) => void state.loadWorkspaceFiles(relativePath),
              onRefresh: () => void state.loadWorkspaceFiles(state.workspaceFilesCurrentPath),
              onToggleSelection: (relativePath, selected) =>
                state.toggleWorkspaceFileSelection(relativePath, selected),
              onToggleAllSelections: (relativePaths, selected) =>
                state.setAllWorkspaceFileSelections(relativePaths, selected),
              onDownload: (relativePaths) => state.downloadWorkspaceFiles(relativePaths),
              onOpenFilePreview: (relativePath) => state.openWorkspaceFilePreview(relativePath),
              onCloseFilePreview: () => state.closeWorkspaceFilePreview(),
              onCreateFolder: (name) => state.createWorkspaceFolder(name),
              onRename: (relativePath, nextName) =>
                state.renameWorkspaceEntry(relativePath, nextName),
              onDelete: (relativePaths) => state.deleteWorkspaceEntries(relativePaths),
              onUpload: (files) => state.uploadWorkspaceFiles(files),
              requestUpdate: requestHostUpdate,
            })
          : nothing}
        ${state.tab === "admin"
          ? lazyRender(lazyAdmin, (m) =>
              m.renderAdmin({
                loading: state.adminAccountsLoading,
                entries: state.adminAccountsEntries,
                error: state.adminAccountsError,
                query: state.adminAccountsQuery,
                detailLoading: state.adminAccountDetailLoading,
                detail: state.adminAccountDetail,
                detailError: state.adminAccountDetailError,
                message: state.adminAccountMessage,
                roleModalOpen: state.adminRoleModalOpen,
                roleModalAccountName: state.adminRoleModalAccountName,
                roleModalNextRole: state.adminRoleModalNextRole,
                groupScopeOptions: state.groupsScopeOptions,
                onQueryChange: (value) => {
                  state.adminAccountsQuery = value;
                  void loadAdminAccounts(state);
                },
                onRefresh: () =>
                  void (async () => {
                    await Promise.all([loadAdminAccounts(state), loadGroupScopeOptions(state)]);
                    if (state.adminAccountDetailAccountId) {
                      await loadAdminAccountDetail(state, state.adminAccountDetailAccountId);
                    }
                  })(),
                onOpenDetail: (accountId) => void loadAdminAccountDetail(state, accountId),
                onCloseDetail: () => {
                  state.adminAccountDetail = null;
                  state.adminAccountDetailAccountId = null;
                  state.adminAccountDetailError = null;
                },
                onOpenRoleModal: (accountId, accountName, currentRole) => {
                  state.adminRoleModalOpen = true;
                  state.adminRoleModalAccountId = accountId;
                  state.adminRoleModalAccountName = accountName;
                  state.adminRoleModalNextRole = currentRole;
                },
                onCloseRoleModal: () => {
                  state.adminRoleModalOpen = false;
                  state.adminRoleModalAccountId = null;
                  state.adminRoleModalAccountName = null;
                },
                onRoleChangeSelect: (value) => (state.adminRoleModalNextRole = value),
                onConfirmRoleChange: () => {
                  if (!state.adminRoleModalAccountId) {
                    return;
                  }
                  void (async () => {
                    await updateAdminAccountRoleAction(state, {
                      accountId: state.adminRoleModalAccountId!,
                      globalRole: state.adminRoleModalNextRole,
                    });
                    state.adminRoleModalOpen = false;
                    state.adminRoleModalAccountId = null;
                    state.adminRoleModalAccountName = null;
                  })();
                },
                onAddMembership: (scopeType, scopeId, groupRole) => {
                  if (!state.adminAccountDetail?.accountId) {
                    return;
                  }
                  void (async () => {
                    await addGroupMemberAction(state, {
                      scopeType,
                      scopeId,
                      accountId: state.adminAccountDetail!.accountId,
                      groupRole,
                    });
                    await loadAdminAccountDetail(state, state.adminAccountDetail!.accountId);
                  })();
                },
                onRemoveMembership: (scopeType, scopeId) => {
                  if (!state.adminAccountDetail?.accountId) {
                    return;
                  }
                  void (async () => {
                    await removeGroupMemberAction(state, {
                      scopeType,
                      scopeId,
                      accountId: state.adminAccountDetail!.accountId,
                    });
                    await loadAdminAccountDetail(state, state.adminAccountDetail!.accountId);
                  })();
                },
              }),
            )
          : nothing}
        ${state.tab === "nodes"
          ? lazyRender(lazyNodes, (m) =>
              m.renderNodes({
                loading: state.nodesLoading,
                nodes: state.nodes,
                devicesLoading: state.devicesLoading,
                devicesError: state.devicesError,
                devicesList: state.devicesList,
                configForm:
                  state.configForm ??
                  (state.configSnapshot?.config as Record<string, unknown> | null),
                configLoading: state.configLoading,
                configSaving: state.configSaving,
                configDirty: state.configFormDirty,
                configFormMode: state.configFormMode,
                execApprovalsLoading: state.execApprovalsLoading,
                execApprovalsSaving: state.execApprovalsSaving,
                execApprovalsDirty: state.execApprovalsDirty,
                execApprovalsSnapshot: state.execApprovalsSnapshot,
                execApprovalsForm: state.execApprovalsForm,
                execApprovalsSelectedAgent: state.execApprovalsSelectedAgent,
                execApprovalsTarget: state.execApprovalsTarget,
                execApprovalsTargetNodeId: state.execApprovalsTargetNodeId,
                onRefresh: () => loadNodes(state),
                onDevicesRefresh: () => loadDevices(state),
                onDeviceApprove: (requestId) => approveDevicePairing(state, requestId),
                onDeviceReject: (requestId) => rejectDevicePairing(state, requestId),
                onDeviceRotate: (deviceId, role, scopes) =>
                  rotateDeviceToken(state, { deviceId, role, scopes }),
                onDeviceRevoke: (deviceId, role) => revokeDeviceToken(state, { deviceId, role }),
                onLoadConfig: () => loadConfig(state),
                onLoadExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return loadExecApprovals(state, target);
                },
                onBindDefault: (nodeId) => {
                  if (nodeId) {
                    updateConfigFormValue(state, ["tools", "exec", "node"], nodeId);
                  } else {
                    removeConfigFormValue(state, ["tools", "exec", "node"]);
                  }
                },
                onBindAgent: (agentIndex, nodeId) => {
                  const basePath = ["agents", "list", agentIndex, "tools", "exec", "node"];
                  if (nodeId) {
                    updateConfigFormValue(state, basePath, nodeId);
                  } else {
                    removeConfigFormValue(state, basePath);
                  }
                },
                onSaveBindings: () => saveConfig(state),
                onExecApprovalsTargetChange: (kind, nodeId) => {
                  state.execApprovalsTarget = kind;
                  state.execApprovalsTargetNodeId = nodeId;
                  state.execApprovalsSnapshot = null;
                  state.execApprovalsForm = null;
                  state.execApprovalsDirty = false;
                  state.execApprovalsSelectedAgent = null;
                },
                onExecApprovalsSelectAgent: (agentId) => {
                  state.execApprovalsSelectedAgent = agentId;
                },
                onExecApprovalsPatch: (path, value) =>
                  updateExecApprovalsFormValue(state, path, value),
                onExecApprovalsRemove: (path) => removeExecApprovalsFormValue(state, path),
                onSaveExecApprovals: () => {
                  const target =
                    state.execApprovalsTarget === "node" && state.execApprovalsTargetNodeId
                      ? { kind: "node" as const, nodeId: state.execApprovalsTargetNodeId }
                      : { kind: "gateway" as const };
                  return saveExecApprovals(state, target);
                },
              }),
            )
          : nothing}
        ${chatView}
        ${state.tab === "config"
          ? renderConfig({
              raw: state.configRaw,
              originalRaw: state.configRawOriginal,
              valid: state.configValid,
              issues: state.configIssues,
              loading: state.configLoading,
              saving: state.configSaving,
              applying: state.configApplying,
              updating: state.updateRunning,
              connected: state.connected,
              schema: state.configSchema,
              schemaLoading: state.configSchemaLoading,
              uiHints: state.configUiHints,
              formMode: state.configFormMode,
              showModeToggle: true,
              formValue: state.configForm,
              originalValue: state.configFormOriginal,
              searchQuery: state.configSearchQuery,
              activeSection:
                state.configActiveSection &&
                (COMMUNICATION_SECTION_KEYS.includes(
                  state.configActiveSection as CommunicationSectionKey,
                ) ||
                  APPEARANCE_SECTION_KEYS.includes(
                    state.configActiveSection as AppearanceSectionKey,
                  ) ||
                  AUTOMATION_SECTION_KEYS.includes(
                    state.configActiveSection as AutomationSectionKey,
                  ) ||
                  INFRASTRUCTURE_SECTION_KEYS.includes(
                    state.configActiveSection as InfrastructureSectionKey,
                  ) ||
                  AI_AGENTS_SECTION_KEYS.includes(state.configActiveSection as AiAgentsSectionKey))
                  ? null
                  : state.configActiveSection,
              activeSubsection:
                state.configActiveSection &&
                (COMMUNICATION_SECTION_KEYS.includes(
                  state.configActiveSection as CommunicationSectionKey,
                ) ||
                  APPEARANCE_SECTION_KEYS.includes(
                    state.configActiveSection as AppearanceSectionKey,
                  ) ||
                  AUTOMATION_SECTION_KEYS.includes(
                    state.configActiveSection as AutomationSectionKey,
                  ) ||
                  INFRASTRUCTURE_SECTION_KEYS.includes(
                    state.configActiveSection as InfrastructureSectionKey,
                  ) ||
                  AI_AGENTS_SECTION_KEYS.includes(state.configActiveSection as AiAgentsSectionKey))
                  ? null
                  : state.configActiveSubsection,
              onRawChange: (next) => {
                state.configRaw = next;
              },
              onRequestUpdate: requestHostUpdate,
              onFormModeChange: (mode) => (state.configFormMode = mode),
              onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
              onSearchChange: (query) => (state.configSearchQuery = query),
              onSectionChange: (section) => {
                state.configActiveSection = section;
                state.configActiveSubsection = null;
              },
              onSubsectionChange: (section) => (state.configActiveSubsection = section),
              onReload: () => loadConfig(state),
              onSave: () => saveConfig(state),
              onApply: () => applyConfig(state),
              onUpdate: () => runUpdate(state),
              onOpenFile: () => openConfigFile(state),
              version: state.hello?.server?.version ?? "",
              theme: state.theme,
              themeMode: state.themeMode,
              setTheme: (t, ctx) => state.setTheme(t, ctx),
              setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
              borderRadius: state.settings.borderRadius,
              setBorderRadius: (v) => state.setBorderRadius(v),
              gatewayUrl: state.settings.gatewayUrl,
              assistantName: state.assistantName,
              configPath: state.configSnapshot?.path ?? null,
              rawAvailable: typeof state.configSnapshot?.raw === "string",
              excludeSections: [
                ...COMMUNICATION_SECTION_KEYS,
                ...AUTOMATION_SECTION_KEYS,
                ...INFRASTRUCTURE_SECTION_KEYS,
                ...AI_AGENTS_SECTION_KEYS,
                "ui",
                "wizard",
              ],
              includeVirtualSections: false,
            })
          : nothing}
        ${state.tab === "communications"
          ? renderConfig({
              raw: state.configRaw,
              originalRaw: state.configRawOriginal,
              valid: state.configValid,
              issues: state.configIssues,
              loading: state.configLoading,
              saving: state.configSaving,
              applying: state.configApplying,
              updating: state.updateRunning,
              connected: state.connected,
              schema: state.configSchema,
              schemaLoading: state.configSchemaLoading,
              uiHints: state.configUiHints,
              formMode: state.communicationsFormMode,
              formValue: state.configForm,
              originalValue: state.configFormOriginal,
              searchQuery: state.communicationsSearchQuery,
              activeSection:
                state.communicationsActiveSection &&
                !COMMUNICATION_SECTION_KEYS.includes(
                  state.communicationsActiveSection as CommunicationSectionKey,
                )
                  ? null
                  : state.communicationsActiveSection,
              activeSubsection:
                state.communicationsActiveSection &&
                !COMMUNICATION_SECTION_KEYS.includes(
                  state.communicationsActiveSection as CommunicationSectionKey,
                )
                  ? null
                  : state.communicationsActiveSubsection,
              onRawChange: (next) => {
                state.configRaw = next;
              },
              onRequestUpdate: requestHostUpdate,
              onFormModeChange: (mode) => (state.communicationsFormMode = mode),
              onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
              onSearchChange: (query) => (state.communicationsSearchQuery = query),
              onSectionChange: (section) => {
                state.communicationsActiveSection = section;
                state.communicationsActiveSubsection = null;
              },
              onSubsectionChange: (section) => (state.communicationsActiveSubsection = section),
              onReload: () => loadConfig(state),
              onSave: () => saveConfig(state),
              onApply: () => applyConfig(state),
              onUpdate: () => runUpdate(state),
              onOpenFile: () => openConfigFile(state),
              version: state.hello?.server?.version ?? "",
              theme: state.theme,
              themeMode: state.themeMode,
              setTheme: (t, ctx) => state.setTheme(t, ctx),
              setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
              borderRadius: state.settings.borderRadius,
              setBorderRadius: (v) => state.setBorderRadius(v),
              gatewayUrl: state.settings.gatewayUrl,
              assistantName: state.assistantName,
              configPath: state.configSnapshot?.path ?? null,
              rawAvailable: typeof state.configSnapshot?.raw === "string",
              navRootLabel: "Communication",
              includeSections: [...COMMUNICATION_SECTION_KEYS],
              includeVirtualSections: false,
            })
          : nothing}
        ${state.tab === "appearance"
          ? renderConfig({
              raw: state.configRaw,
              originalRaw: state.configRawOriginal,
              valid: state.configValid,
              issues: state.configIssues,
              loading: state.configLoading,
              saving: state.configSaving,
              applying: state.configApplying,
              updating: state.updateRunning,
              connected: state.connected,
              schema: state.configSchema,
              schemaLoading: state.configSchemaLoading,
              uiHints: state.configUiHints,
              formMode: state.appearanceFormMode,
              formValue: state.configForm,
              originalValue: state.configFormOriginal,
              searchQuery: state.appearanceSearchQuery,
              activeSection:
                state.appearanceActiveSection &&
                !APPEARANCE_SECTION_KEYS.includes(
                  state.appearanceActiveSection as AppearanceSectionKey,
                )
                  ? null
                  : state.appearanceActiveSection,
              activeSubsection:
                state.appearanceActiveSection &&
                !APPEARANCE_SECTION_KEYS.includes(
                  state.appearanceActiveSection as AppearanceSectionKey,
                )
                  ? null
                  : state.appearanceActiveSubsection,
              onRawChange: (next) => {
                state.configRaw = next;
              },
              onRequestUpdate: requestHostUpdate,
              onFormModeChange: (mode) => (state.appearanceFormMode = mode),
              onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
              onSearchChange: (query) => (state.appearanceSearchQuery = query),
              onSectionChange: (section) => {
                state.appearanceActiveSection = section;
                state.appearanceActiveSubsection = null;
              },
              onSubsectionChange: (section) => (state.appearanceActiveSubsection = section),
              onReload: () => loadConfig(state),
              onSave: () => saveConfig(state),
              onApply: () => applyConfig(state),
              onUpdate: () => runUpdate(state),
              onOpenFile: () => openConfigFile(state),
              version: state.hello?.server?.version ?? "",
              theme: state.theme,
              themeMode: state.themeMode,
              setTheme: (t, ctx) => state.setTheme(t, ctx),
              setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
              borderRadius: state.settings.borderRadius,
              setBorderRadius: (v) => state.setBorderRadius(v),
              gatewayUrl: state.settings.gatewayUrl,
              assistantName: state.assistantName,
              configPath: state.configSnapshot?.path ?? null,
              rawAvailable: typeof state.configSnapshot?.raw === "string",
              navRootLabel: t("tabs.appearance"),
              includeSections: [...APPEARANCE_SECTION_KEYS],
              includeVirtualSections: true,
            })
          : nothing}
        ${state.tab === "automation"
          ? renderConfig({
              raw: state.configRaw,
              originalRaw: state.configRawOriginal,
              valid: state.configValid,
              issues: state.configIssues,
              loading: state.configLoading,
              saving: state.configSaving,
              applying: state.configApplying,
              updating: state.updateRunning,
              connected: state.connected,
              schema: state.configSchema,
              schemaLoading: state.configSchemaLoading,
              uiHints: state.configUiHints,
              formMode: state.automationFormMode,
              formValue: state.configForm,
              originalValue: state.configFormOriginal,
              searchQuery: state.automationSearchQuery,
              activeSection:
                state.automationActiveSection &&
                !AUTOMATION_SECTION_KEYS.includes(
                  state.automationActiveSection as AutomationSectionKey,
                )
                  ? null
                  : state.automationActiveSection,
              activeSubsection:
                state.automationActiveSection &&
                !AUTOMATION_SECTION_KEYS.includes(
                  state.automationActiveSection as AutomationSectionKey,
                )
                  ? null
                  : state.automationActiveSubsection,
              onRawChange: (next) => {
                state.configRaw = next;
              },
              onRequestUpdate: requestHostUpdate,
              onFormModeChange: (mode) => (state.automationFormMode = mode),
              onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
              onSearchChange: (query) => (state.automationSearchQuery = query),
              onSectionChange: (section) => {
                state.automationActiveSection = section;
                state.automationActiveSubsection = null;
              },
              onSubsectionChange: (section) => (state.automationActiveSubsection = section),
              onReload: () => loadConfig(state),
              onSave: () => saveConfig(state),
              onApply: () => applyConfig(state),
              onUpdate: () => runUpdate(state),
              onOpenFile: () => openConfigFile(state),
              version: state.hello?.server?.version ?? "",
              theme: state.theme,
              themeMode: state.themeMode,
              setTheme: (t, ctx) => state.setTheme(t, ctx),
              setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
              borderRadius: state.settings.borderRadius,
              setBorderRadius: (v) => state.setBorderRadius(v),
              gatewayUrl: state.settings.gatewayUrl,
              assistantName: state.assistantName,
              configPath: state.configSnapshot?.path ?? null,
              rawAvailable: typeof state.configSnapshot?.raw === "string",
              navRootLabel: "Automation",
              includeSections: [...AUTOMATION_SECTION_KEYS],
              includeVirtualSections: false,
            })
          : nothing}
        ${state.tab === "infrastructure"
          ? renderConfig({
              raw: state.configRaw,
              originalRaw: state.configRawOriginal,
              valid: state.configValid,
              issues: state.configIssues,
              loading: state.configLoading,
              saving: state.configSaving,
              applying: state.configApplying,
              updating: state.updateRunning,
              connected: state.connected,
              schema: state.configSchema,
              schemaLoading: state.configSchemaLoading,
              uiHints: state.configUiHints,
              formMode: state.infrastructureFormMode,
              formValue: state.configForm,
              originalValue: state.configFormOriginal,
              searchQuery: state.infrastructureSearchQuery,
              activeSection:
                state.infrastructureActiveSection &&
                !INFRASTRUCTURE_SECTION_KEYS.includes(
                  state.infrastructureActiveSection as InfrastructureSectionKey,
                )
                  ? null
                  : state.infrastructureActiveSection,
              activeSubsection:
                state.infrastructureActiveSection &&
                !INFRASTRUCTURE_SECTION_KEYS.includes(
                  state.infrastructureActiveSection as InfrastructureSectionKey,
                )
                  ? null
                  : state.infrastructureActiveSubsection,
              onRawChange: (next) => {
                state.configRaw = next;
              },
              onRequestUpdate: requestHostUpdate,
              onFormModeChange: (mode) => (state.infrastructureFormMode = mode),
              onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
              onSearchChange: (query) => (state.infrastructureSearchQuery = query),
              onSectionChange: (section) => {
                state.infrastructureActiveSection = section;
                state.infrastructureActiveSubsection = null;
              },
              onSubsectionChange: (section) => (state.infrastructureActiveSubsection = section),
              onReload: () => loadConfig(state),
              onSave: () => saveConfig(state),
              onApply: () => applyConfig(state),
              onUpdate: () => runUpdate(state),
              onOpenFile: () => openConfigFile(state),
              version: state.hello?.server?.version ?? "",
              theme: state.theme,
              themeMode: state.themeMode,
              setTheme: (t, ctx) => state.setTheme(t, ctx),
              setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
              borderRadius: state.settings.borderRadius,
              setBorderRadius: (v) => state.setBorderRadius(v),
              gatewayUrl: state.settings.gatewayUrl,
              assistantName: state.assistantName,
              configPath: state.configSnapshot?.path ?? null,
              rawAvailable: typeof state.configSnapshot?.raw === "string",
              navRootLabel: "Infrastructure",
              includeSections: [...INFRASTRUCTURE_SECTION_KEYS],
              includeVirtualSections: false,
            })
          : nothing}
        ${state.tab === "aiAgents"
          ? renderConfig({
              raw: state.configRaw,
              originalRaw: state.configRawOriginal,
              valid: state.configValid,
              issues: state.configIssues,
              loading: state.configLoading,
              saving: state.configSaving,
              applying: state.configApplying,
              updating: state.updateRunning,
              connected: state.connected,
              schema: state.configSchema,
              schemaLoading: state.configSchemaLoading,
              uiHints: state.configUiHints,
              formMode: state.aiAgentsFormMode,
              formValue: state.configForm,
              originalValue: state.configFormOriginal,
              searchQuery: state.aiAgentsSearchQuery,
              activeSection:
                state.aiAgentsActiveSection &&
                !AI_AGENTS_SECTION_KEYS.includes(state.aiAgentsActiveSection as AiAgentsSectionKey)
                  ? null
                  : state.aiAgentsActiveSection,
              activeSubsection:
                state.aiAgentsActiveSection &&
                !AI_AGENTS_SECTION_KEYS.includes(state.aiAgentsActiveSection as AiAgentsSectionKey)
                  ? null
                  : state.aiAgentsActiveSubsection,
              onRawChange: (next) => {
                state.configRaw = next;
              },
              onRequestUpdate: requestHostUpdate,
              onFormModeChange: (mode) => (state.aiAgentsFormMode = mode),
              onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
              onSearchChange: (query) => (state.aiAgentsSearchQuery = query),
              onSectionChange: (section) => {
                state.aiAgentsActiveSection = section;
                state.aiAgentsActiveSubsection = null;
              },
              onSubsectionChange: (section) => (state.aiAgentsActiveSubsection = section),
              onReload: () => loadConfig(state),
              onSave: () => saveConfig(state),
              onApply: () => applyConfig(state),
              onUpdate: () => runUpdate(state),
              onOpenFile: () => openConfigFile(state),
              version: state.hello?.server?.version ?? "",
              theme: state.theme,
              themeMode: state.themeMode,
              setTheme: (t, ctx) => state.setTheme(t, ctx),
              setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
              borderRadius: state.settings.borderRadius,
              setBorderRadius: (v) => state.setBorderRadius(v),
              gatewayUrl: state.settings.gatewayUrl,
              assistantName: state.assistantName,
              configPath: state.configSnapshot?.path ?? null,
              rawAvailable: typeof state.configSnapshot?.raw === "string",
              navRootLabel: "AI & Agents",
              includeSections: [...AI_AGENTS_SECTION_KEYS],
              includeVirtualSections: false,
            })
          : nothing}
        ${state.tab === "debug"
          ? lazyRender(lazyDebug, (m) =>
              m.renderDebug({
                loading: state.debugLoading,
                status: state.debugStatus,
                health: state.debugHealth,
                models: state.debugModels,
                heartbeat: state.debugHeartbeat,
                eventLog: state.eventLog,
                methods: (state.hello?.features?.methods ?? []).toSorted(),
                callMethod: state.debugCallMethod,
                callParams: state.debugCallParams,
                callResult: state.debugCallResult,
                callError: state.debugCallError,
                onCallMethodChange: (next) => (state.debugCallMethod = next),
                onCallParamsChange: (next) => (state.debugCallParams = next),
                onRefresh: () => loadDebug(state),
                onCall: () => callDebugMethod(state),
              }),
            )
          : nothing}
        ${state.tab === "logs"
          ? lazyRender(lazyLogs, (m) =>
              m.renderLogs({
                loading: state.logsLoading,
                error: state.logsError,
                file: state.logsFile,
                entries: state.logsEntries,
                filterText: state.logsFilterText,
                levelFilters: state.logsLevelFilters,
                autoFollow: state.logsAutoFollow,
                truncated: state.logsTruncated,
                onFilterTextChange: (next) => (state.logsFilterText = next),
                onLevelToggle: (level, enabled) => {
                  state.logsLevelFilters = { ...state.logsLevelFilters, [level]: enabled };
                },
                onToggleAutoFollow: (next) => (state.logsAutoFollow = next),
                onRefresh: () => loadLogs(state, { reset: true }),
                onExport: (lines, label) => state.exportLogs(lines, label),
                onScroll: (event) => state.handleLogsScroll(event),
              }),
            )
          : nothing}
        ${state.tab === "dreams"
          ? renderDreaming({
              active: dreamingOn,
              shortTermCount: state.dreamingStatus?.shortTermCount ?? 0,
              groundedSignalCount: state.dreamingStatus?.groundedSignalCount ?? 0,
              totalSignalCount: state.dreamingStatus?.totalSignalCount ?? 0,
              promotedCount: state.dreamingStatus?.promotedToday ?? 0,
              phaseSignalCount: state.dreamingStatus?.phaseSignalCount ?? 0,
              shortTermEntries: state.dreamingStatus?.shortTermEntries ?? [],
              signalEntries: state.dreamingStatus?.signalEntries ?? [],
              promotedEntries: state.dreamingStatus?.promotedEntries ?? [],
              dreamingOf: null,
              nextCycle: dreamingNextCycle,
              timezone: state.dreamingStatus?.timezone ?? null,
              statusLoading: state.dreamingStatusLoading,
              statusError: state.dreamingStatusError,
              modeSaving: state.dreamingModeSaving,
              dreamDiaryLoading: state.dreamDiaryLoading,
              dreamDiaryActionLoading: state.dreamDiaryActionLoading,
              dreamDiaryError: state.dreamDiaryError,
              dreamDiaryPath: state.dreamDiaryPath,
              dreamDiaryContent: state.dreamDiaryContent,
              onRefresh: refreshDreaming,
              onRefreshDiary: () => loadDreamDiary(state),
              onBackfillDiary: () => backfillDreamDiary(state),
              onResetDiary: () => resetDreamDiary(state),
              onResetGroundedShortTerm: () => resetGroundedShortTerm(state),
              onToggleEnabled: applyDreamingEnabled,
              onRequestUpdate: requestHostUpdate,
            })
          : nothing}
      </main>
      ${renderExecApprovalPrompt(state)} ${renderGatewayUrlConfirmation(state)}
      ${renderEmployeeVocDialog(state)} ${renderReleaseNotesDialog(state)}
    </div>
  `;
}
