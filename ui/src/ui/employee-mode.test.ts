import { describe, expect, it, vi } from "vitest";
import "../styles.css";
import type { OpenClawApp } from "./app.ts";
import "./app.ts";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";
import type { GatewaySessionRow, SessionsListResult } from "./types.ts";

registerAppMountHooks();

function mountConnectedEmployeeApp(pathname = "/employee/chat") {
  window.__OPENCLAW_UI_MODE__ = "employee";
  const app = mountTestApp(pathname);
  app.employeeMode = true;
  return app;
}

function createSessionsResult(rows: GatewaySessionRow[]): SessionsListResult {
  return {
    ts: Date.now(),
    path: "",
    count: rows.length,
    defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
    sessions: rows,
  };
}

async function flushEmployeeApp(app: OpenClawApp) {
  await Promise.resolve();
  app.requestUpdate();
  await app.updateComplete;
}

describe("employee mode", () => {
  it("falls back to employee mode from the /employee route even without the inline mode flag", async () => {
    delete window.__OPENCLAW_UI_MODE__;
    window.history.replaceState({}, "", "/employee/chat?session=main");

    const app = document.createElement("openclaw-app") as OpenClawApp;
    document.body.appendChild(app);
    await app.updateComplete;

    expect(app.employeeMode).toBe(true);
    expect(app.querySelector(".login-gate__title")?.textContent).toContain("Soc PlatformClaw");
  });

  it("falls back to employee mode from the root route even without the inline mode flag", async () => {
    delete window.__OPENCLAW_UI_MODE__;
    window.history.replaceState({}, "", "/");

    const app = document.createElement("openclaw-app") as OpenClawApp;
    document.body.appendChild(app);
    await app.updateComplete;

    expect(app.employeeMode).toBe(true);
    expect(app.querySelector(".login-gate__title")?.textContent).toContain("Soc PlatformClaw");
  });

  it("renders an employee login gate before connecting", async () => {
    window.__OPENCLAW_UI_MODE__ = "employee";
    window.history.replaceState({}, "", "/employee/");
    const app = document.createElement("openclaw-app") as OpenClawApp;
    document.body.append(app);
    app.connected = false;
    app.requestUpdate();
    await app.updateComplete;

    expect(app.querySelector(".login-gate")).not.toBeNull();
    expect(app.querySelector(".login-gate__title")?.textContent).toContain("Soc PlatformClaw");
    expect(app.textContent).toContain("Start Soc PlatformClaw.");
    expect(app.textContent).toContain("Workspace access");
    expect(app.querySelector(".sidebar-shell")).toBeNull();
  });

  it("renders a dedicated connected workspace without the control sidebar shell", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "main",
    };
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    expect(app.querySelector(".shell")).not.toBeNull();
    expect(app.querySelector(".sidebar-shell")).not.toBeNull();
    expect(app.textContent).toContain("PlatformClaw");
    expect(app.textContent).toContain("Workspace");
    expect(app.textContent).toContain("Eon");
    expect(app.textContent).toContain("로그아웃");
  });

  it("shows employee tabs, sidebar sessions, and the compact chat model selector", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.sessionKey = "agent:eon:main";
    app.sessionsResult = createSessionsResult([
      { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
      { key: "agent:minji:main", kind: "direct", label: "Other employee", updatedAt: Date.now() },
    ]);
    app.chatModelCatalog = [{ id: "gpt-5", name: "GPT-5", provider: "openai" }];
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    expect(app.textContent).toContain("Chat");
    expect(app.textContent).toContain("Cron Jobs");
    expect(app.textContent).toContain("Heartbeat");
    expect(app.textContent).toContain("Skill Hub");
    expect(app.querySelector("[data-chat-model-select='true']")).not.toBeNull();
    expect(app.querySelector(".content-header optgroup")).toBeNull();
    expect(app.querySelector(".employee-chat-sessions")).not.toBeNull();
    const sidebarSessions = app.querySelector(".employee-chat-sessions");
    expect(sidebarSessions?.textContent).toContain("Main");
    expect(sidebarSessions?.textContent).not.toContain("Other employee");
  });

  it("filters the employee chat session list without exposing raw session keys", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.sessionKey = "agent:eon:main";
    app.sessionsResult = createSessionsResult([
      { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
      {
        key: "agent:eon:dashboard:alpha",
        kind: "direct",
        label: "Alpha Plan",
        updatedAt: Date.now(),
      },
      {
        key: "agent:eon:dashboard:beta",
        kind: "direct",
        label: "Beta Notes",
        updatedAt: Date.now(),
      },
      { key: "agent:eon:dashboard:gamma", kind: "direct", label: "Gamma", updatedAt: Date.now() },
    ]);
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const list = app.querySelector<HTMLElement>(".employee-chat-sessions__list");
    expect(list).not.toBeNull();
    expect(Array.from(list!.querySelectorAll(".employee-chat-session"))).toHaveLength(4);
    expect(app.querySelector(".employee-chat-sessions__header")?.textContent).toContain("4개");
    expect(app.textContent).toContain("Alpha Plan");
    expect(app.textContent).not.toContain("agent:eon:dashboard:alpha");

    const search = app.querySelector<HTMLInputElement>(".employee-chat-sessions__search input");
    expect(search).not.toBeNull();
    search!.value = "beta";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushEmployeeApp(app);

    const sidebarSessions = app.querySelector(".employee-chat-sessions");
    expect(sidebarSessions?.textContent).toContain("Beta Notes");
    expect(sidebarSessions?.textContent).not.toContain("Alpha Plan");
  });

  it("shows active employee sessions with a right-side live indicator", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.sessionKey = "agent:eon:main";
    app.sessionsResult = createSessionsResult([
      {
        key: "agent:eon:dashboard:live",
        kind: "direct",
        label: "Live session",
        updatedAt: Date.now(),
        hasActiveRun: true,
      },
    ]);
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    expect(app.querySelector(".employee-chat-sessions__search svg")).toBeNull();
    expect(app.querySelector(".employee-chat-session__live")).not.toBeNull();
  });

  it("shows the employee recent chat session list only while Chat is active and toggles on Chat click", async () => {
    const app = mountConnectedEmployeeApp("/employee/files");
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.tab = "files";
    app.sessionKey = "agent:eon:main";
    app.sessionsResult = createSessionsResult([
      { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
    ]);
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    expect(app.querySelector(".employee-chat-sessions")).toBeNull();

    app.tab = "chat";
    app.requestUpdate();
    await app.updateComplete;

    const sidebarSessions = app.querySelector(".employee-chat-sessions");
    expect(sidebarSessions?.textContent).toContain("최근");
    expect(sidebarSessions?.textContent).toContain("Main");

    app
      .querySelector<HTMLAnchorElement>(".nav-item--active")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await app.updateComplete;

    expect(app.querySelector(".employee-chat-sessions")).toBeNull();

    app
      .querySelector<HTMLAnchorElement>(".nav-item--active")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await app.updateComplete;

    expect(app.querySelector(".employee-chat-sessions")?.textContent).toContain("Main");
  });

  it("switches to a recent employee session from the Chat sidebar panel", async () => {
    const app = mountConnectedEmployeeApp("/employee/chat");
    const request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        return { messages: [] };
      }
      if (method === "sessions.list") {
        return createSessionsResult([
          { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
          {
            key: "agent:eon:dashboard:alpha",
            kind: "direct",
            label: "Alpha Plan",
            updatedAt: Date.now(),
          },
        ]);
      }
      return {};
    });
    app.client = { request, stop: vi.fn() } as never;
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.tab = "chat";
    app.sessionKey = "agent:eon:main";
    app.sessionsResult = createSessionsResult([
      { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
      {
        key: "agent:eon:dashboard:alpha",
        kind: "direct",
        label: "Alpha Plan",
        updatedAt: Date.now(),
      },
    ]);
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const alpha = Array.from(
      app.querySelectorAll<HTMLButtonElement>(".employee-chat-session"),
    ).find((button) => button.textContent?.includes("Alpha Plan"));
    alpha?.click();
    await flushEmployeeApp(app);

    expect(app.sessionKey).toBe("agent:eon:dashboard:alpha");
    expect(request).toHaveBeenCalledWith(
      "chat.history",
      expect.objectContaining({ sessionKey: "agent:eon:dashboard:alpha" }),
    );
  });

  it("creates and switches employee chat sessions through sessions.create and chat.history", async () => {
    const app = mountConnectedEmployeeApp();
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.create") {
        return { ok: true, key: "agent:eon:dashboard:new-session" };
      }
      if (method === "sessions.list") {
        return createSessionsResult([
          {
            key: "agent:eon:dashboard:new-session",
            kind: "direct",
            label: "New session",
            updatedAt: Date.now(),
          },
        ]);
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      return {};
    });
    app.client = { request, stop: vi.fn() } as never;
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.sessionKey = "agent:eon:main";
    app.sessionsResult = createSessionsResult([
      { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
    ]);
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    app.querySelector<HTMLButtonElement>(".employee-chat-sessions__new")?.click();
    await flushEmployeeApp(app);
    await flushEmployeeApp(app);

    expect(request).toHaveBeenCalledWith("sessions.create", { agentId: "eon" });
    expect(request).toHaveBeenCalledWith(
      "sessions.list",
      expect.objectContaining({ includeGlobal: false, includeUnknown: false }),
    );
    expect(app.sessionKey).toBe("agent:eon:dashboard:new-session");
    expect(request).toHaveBeenCalledWith(
      "chat.history",
      expect.objectContaining({ sessionKey: "agent:eon:dashboard:new-session" }),
    );
  });

  it("shows Groups for all employees and hides Admin without admin access", async () => {
    const app = mountConnectedEmployeeApp("/employee/groups");
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.employeeAccountSummary = {
      accountId: "eon",
      globalRole: "member",
      groupCount: 1,
      partCount: 1,
      topLevelGroupNames: ["Platform"],
      hasAdminAccess: false,
      hasLeaderScope: true,
    };
    app.tab = "groups";
    app.groupsEntries = [
      {
        id: "group-platform",
        name: "Platform",
        description: "Platform group",
        scopeType: "group",
        parentGroupId: null,
        parentGroupName: null,
        groupLevel: 1,
        createdByAccountId: "eon",
        ownerAccountId: "eon",
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
        archivedAt: null,
        partCount: 1,
        memberCount: 2,
        leaderCount: 1,
        canManageMembers: true,
        canEditMetadata: false,
        canCreatePart: false,
        canArchive: false,
      },
    ];
    app.groupsDetailGroupId = "group-platform";
    app.groupsDetail = {
      group: app.groupsEntries[0],
      members: [
        {
          accountId: "eon",
          displayName: "Eon",
          email: "eon@example.com",
          department: "Ops",
          groupRole: "leader",
        },
      ],
      parts: [],
    };
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    expect(app.textContent).toContain("Groups");
    expect(app.textContent).toContain("Platform");
    expect(app.textContent).not.toContain("Admin");
  });

  it("shows Admin only for admin accounts and renders the account list view", async () => {
    const app = mountConnectedEmployeeApp("/employee/admin");
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.employeeAccountSummary = {
      accountId: "eon",
      globalRole: "admin",
      groupCount: 1,
      partCount: 0,
      topLevelGroupNames: ["Platform"],
      hasAdminAccess: true,
      hasLeaderScope: true,
    };
    app.tab = "admin";
    app.adminAccountsEntries = [
      {
        accountId: "leader",
        employeeId: "leader",
        displayName: "Leader",
        email: "leader@example.com",
        department: "Ops",
        globalRole: "member",
        status: "active",
        lastLoginAt: "2026-06-01T10:00:00.000Z",
        groups: ["Platform"],
      },
    ];
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    expect(app.textContent).toContain("Admin");
    expect(app.textContent).toContain("Review accounts, roles, and membership assignments.");
  });
});
