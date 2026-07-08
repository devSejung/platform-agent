import { beforeEach, describe, expect, it, vi } from "vitest";

const loadSessionsMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadSkillHubMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadSkillHubWorkspacePublishMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadAgentSkillsMock = vi.hoisted(() => vi.fn(async () => undefined));
const loadWorkspaceFilesMock = vi.hoisted(() => vi.fn(async () => undefined));
const refreshChatMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("./controllers/sessions.ts", () => ({
  loadSessions: loadSessionsMock,
}));

vi.mock("./controllers/skill-hub.ts", () => ({
  loadSkillHub: loadSkillHubMock,
  loadSkillHubWorkspacePublish: loadSkillHubWorkspacePublishMock,
}));

vi.mock("./controllers/agent-skills.ts", () => ({
  loadAgentSkills: loadAgentSkillsMock,
}));

vi.mock("./controllers/workspace-files.ts", () => ({
  loadWorkspaceFiles: loadWorkspaceFilesMock,
}));

vi.mock("./app-chat.ts", () => ({
  refreshChat: refreshChatMock,
}));

import { refreshActiveTab } from "./app-settings.ts";

type EmployeeTab =
  | "chat"
  | "dashboard"
  | "files"
  | "cron"
  | "heartbeat"
  | "skills"
  | "skillHub"
  | "groups"
  | "admin";

function createEmployeeHost(tab: EmployeeTab) {
  return {
    employeeMode: true,
    tab,
    connected: true,
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "agent:eon:main",
      lastActiveSessionKey: "agent:eon:main",
      theme: "claw",
      themeMode: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
      borderRadius: 50,
    },
    employeeProfile: {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    },
    employeeAccountSummary: {
      hasAdminAccess: true,
    },
    sessionKey: "agent:eon:main",
    chatHasAutoScrolled: false,
    logsAtBottom: false,
    eventLog: [],
    eventLogBuffer: [],
    basePath: "/employee",
    groupsEntries: [],
    groupsDetailGroupId: null,
    agentsList: null,
    agentsSelectedId: null,
    agentsPanel: "files",
    pendingGatewayUrl: null,
    systemThemeCleanup: null,
    pendingGatewayToken: null,
    dreamingStatusLoading: false,
    dreamingStatusError: null,
    dreamingStatus: null,
    dreamingModeSaving: false,
    dreamDiaryLoading: false,
    dreamDiaryError: null,
    dreamDiaryPath: null,
    dreamDiaryContent: null,
  };
}

describe("refreshActiveTab employee session loading", () => {
  beforeEach(() => {
    loadSessionsMock.mockClear();
    loadSkillHubMock.mockClear();
    loadSkillHubWorkspacePublishMock.mockClear();
    loadAgentSkillsMock.mockClear();
    loadWorkspaceFilesMock.mockClear();
    refreshChatMock.mockClear();
  });

  it("loads employee sessions even when re-entering on the Skill Hub tab", async () => {
    const host = createEmployeeHost("skillHub");

    await refreshActiveTab(host as never);

    expect(loadSessionsMock).toHaveBeenCalledWith(host, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: false,
      includeUnknown: false,
    });
    expect(loadAgentSkillsMock).toHaveBeenCalledWith(host, "eon");
    expect(loadSkillHubMock).toHaveBeenCalledWith(host);
    expect(loadSkillHubWorkspacePublishMock).toHaveBeenCalledWith(host);
  });

  it("loads employee sessions on non-chat workspace tabs too", async () => {
    const host = createEmployeeHost("files");

    await refreshActiveTab(host as never);

    expect(loadSessionsMock).toHaveBeenCalledWith(host, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: false,
      includeUnknown: false,
    });
    expect(loadWorkspaceFilesMock).toHaveBeenCalledWith(host);
  });
});
