import { describe, expect, it, vi } from "vitest";
import "../styles.css";
import type { OpenClawApp } from "./app.ts";
import "./app.ts";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";
import type { GatewaySessionRow, SessionsListResult } from "./types.ts";
import { createDefaultDraft } from "./views/cron-quick-create.ts";

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

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
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

  it("keeps chat in the left sidebar and moves employee tools into the right workspace rail", async () => {
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

    const sidebarNav = app.querySelector(".sidebar-nav");
    expect(sidebarNav?.textContent).toContain("최근 세션");
    expect(sidebarNav?.textContent).not.toContain("Files");
    expect(sidebarNav?.textContent).not.toContain("Skills");
    expect(sidebarNav?.textContent).not.toContain("Cron Jobs");
    expect(sidebarNav?.textContent).not.toContain("Heartbeat");
    expect(sidebarNav?.textContent).not.toContain("Groups");
    expect(sidebarNav?.textContent).not.toContain("Skill Hub");
    expect(app.querySelector(".content--employee-layout")).not.toBeNull();
    const toolsPanel = app.querySelector(".employee-tools-panel");
    expect(toolsPanel).not.toBeNull();
    expect(toolsPanel?.textContent).toContain("Workspace tools");
    expect(toolsPanel?.textContent).toContain("Files");
    expect(toolsPanel?.textContent).toContain("Skills");
    expect(toolsPanel?.textContent).toContain("MCP");
    expect(toolsPanel?.textContent).toContain("Cron Jobs");
    expect(toolsPanel?.textContent).toContain("Heartbeat");
    expect(toolsPanel?.textContent).toContain("Groups");
    expect(app.querySelector(".topbar-skillhub-link")?.textContent).toContain("Skill Hub");
    expect(app.querySelector("[data-chat-model-select='true']")).not.toBeNull();
    expect(app.querySelector(".content-header optgroup")).toBeNull();
    expect(app.querySelector(".employee-chat-sessions")).not.toBeNull();
    const sidebarSessions = app.querySelector(".employee-chat-sessions");
    expect(sidebarSessions?.textContent).toContain("Main");
    expect(sidebarSessions?.textContent).not.toContain("Other employee");
  });

  it("keeps the session list inside the sidebar body while header and footer stay separate", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.sessionKey = "agent:eon:main";
    app.sessionsResult = createSessionsResult(
      Array.from({ length: 24 }, (_, index) => ({
        key: index === 0 ? "agent:eon:main" : `agent:eon:dashboard:${index}`,
        kind: "direct" as const,
        label: index === 0 ? "Main" : `Session ${index}`,
        updatedAt: Date.now() - index * 1_000,
      })),
    );
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const header = app.querySelector<HTMLElement>(".sidebar-shell__header");
    const body = app.querySelector<HTMLElement>(".sidebar-shell__body");
    const footer = app.querySelector<HTMLElement>(".sidebar-shell__footer");
    const sidebarNav = app.querySelector<HTMLElement>(".sidebar-nav");
    const sessions = app.querySelector<HTMLElement>(".employee-chat-sessions");
    const list = app.querySelector<HTMLElement>(".employee-chat-sessions__list");

    expect(header).not.toBeNull();
    expect(body).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(sidebarNav).not.toBeNull();
    expect(sessions).not.toBeNull();
    expect(list).not.toBeNull();

    expect(header?.parentElement?.classList.contains("sidebar-shell")).toBe(true);
    expect(footer?.parentElement?.classList.contains("sidebar-shell")).toBe(true);
    expect(body?.contains(sidebarNav!)).toBe(true);
    expect(sidebarNav?.contains(sessions!)).toBe(true);
    expect(sessions?.contains(list!)).toBe(true);
    expect(header?.contains(list!)).toBe(false);
    expect(footer?.contains(list!)).toBe(false);
  });

  it("opens Skill Hub from the employee topbar shortcut", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const shortcut = app.querySelector<HTMLAnchorElement>(".topbar-skillhub-link");
    expect(shortcut).not.toBeNull();
    shortcut?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
    await Promise.resolve();
    await app.updateComplete;

    expect(app.tab).toBe("skillHub");
    expect(window.location.pathname).toBe("/employee/skill-hub");
    expect(app.querySelector(".topbar-skillhub-link--active")).not.toBeNull();
  });

  it("opens the employee VOC modal from the topbar shortcut", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const button = app.querySelector<HTMLButtonElement>(".topbar-voc-link");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("VOC");
    expect(button?.textContent).toContain("VOC");
    button?.click();
    await app.updateComplete;

    expect(app.employeeVocModalOpen).toBe(true);
    expect(app.querySelector(".employee-voc-dialog")).not.toBeNull();
    expect(app.textContent).toContain("VOC 등록");
  });

  it("still opens the employee VOC modal even when a VOC URL is configured", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.employeeUi = {
      ...app.employeeUi,
      vocUrl: "https://voc.company.example/intake",
    };
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const button = app.querySelector<HTMLButtonElement>(".topbar-voc-link");
    expect(button).not.toBeNull();
    expect(button?.tagName).toBe("BUTTON");
    button?.click();
    await app.updateComplete;

    expect(app.employeeVocModalOpen).toBe(true);
    expect(app.querySelector(".employee-voc-dialog")).not.toBeNull();
  });

  it("renders non-chat employee destinations inside the right workspace rail", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const toolsPanel = app.querySelector<HTMLElement>(".employee-tools-panel");
    expect(toolsPanel).not.toBeNull();
    expect(app.querySelector(".content--employee-layout")).not.toBeNull();
    expect(toolsPanel?.textContent).toContain("Files");
    expect(toolsPanel?.textContent).toContain("Skills");
    expect(toolsPanel?.textContent).toContain("Cron Jobs");
    expect(toolsPanel?.textContent).toContain("Heartbeat");
    expect(toolsPanel?.textContent).toContain("Groups");
  });

  it("returns to chat when clicking the active session from an employee workspace tab", async () => {
    const app = mountConnectedEmployeeApp("/employee/files");
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.sessionKey = "agent:eon:main";
    app.tab = "files";
    app.sessionsResult = createSessionsResult([
      { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
    ]);
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const content = app.querySelector<HTMLElement>(".content");
    expect(content).not.toBeNull();
    if (content) {
      content.scrollTop = 240;
    }

    const selectedButton = app.querySelector<HTMLButtonElement>(".employee-chat-session__select");
    expect(selectedButton).not.toBeNull();
    expect(selectedButton?.disabled).toBe(false);

    selectedButton?.click();
    await app.updateComplete;
    await nextFrame();

    expect(app.tab).toBe("chat");
    expect(content?.scrollTop).toBe(0);
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
    expect(app.querySelector(".employee-chat-sessions__header")?.textContent).toContain("4");
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

  it("pins the employee main chat session at the top of the recent session list", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.sessionKey = "agent:eon:dashboard:active";
    app.sessionsResult = createSessionsResult([
      {
        key: "agent:eon:dashboard:newer",
        kind: "direct",
        label: "Newer dashboard",
        updatedAt: Date.now(),
      },
      { key: "agent:minji:main", kind: "direct", label: "Other main", updatedAt: Date.now() },
      {
        key: "agent:eon:dashboard:active",
        kind: "direct",
        label: "Active dashboard",
        updatedAt: Date.now() - 1_000,
      },
      { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() - 60_000 },
    ]);
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const rows = Array.from(app.querySelectorAll(".employee-chat-session"));
    expect(rows.map((row) => row.textContent ?? "")).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("Main");
    expect(rows[1]?.textContent).toContain("Newer dashboard");
    expect(rows[2]?.textContent).toContain("Active dashboard");
    expect(app.querySelector(".employee-chat-sessions")?.textContent).not.toContain("Other main");
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

  it("keeps the employee recent chat session list visible across employee tabs", async () => {
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

    const sidebarSessions = app.querySelector(".employee-chat-sessions");
    expect(sidebarSessions?.textContent).toContain("최근 세션");
    expect(sidebarSessions?.textContent).toContain("Main");

    app
      .querySelector<HTMLAnchorElement>(".nav-item")
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
      app.querySelectorAll<HTMLButtonElement>(".employee-chat-session__select"),
    ).find((button) => button.textContent?.includes("Alpha Plan"));
    alpha?.click();
    await flushEmployeeApp(app);

    expect(app.sessionKey).toBe("agent:eon:dashboard:alpha");
    expect(request).toHaveBeenCalledWith(
      "chat.history",
      expect.objectContaining({ sessionKey: "agent:eon:dashboard:alpha" }),
    );
  });

  it("renames the exact employee chat session row through sessions.patch", async () => {
    const app = mountConnectedEmployeeApp("/employee/chat");
    const request = vi.fn(async (method: string, payload?: unknown) => {
      if (method === "sessions.patch") {
        return { ok: true, key: "agent:eon:dashboard:alpha", entry: { label: "Alpha Renamed" } };
      }
      if (method === "sessions.list") {
        return createSessionsResult([
          { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
          {
            key: "agent:eon:dashboard:alpha",
            kind: "direct",
            label: "Alpha Renamed",
            updatedAt: Date.now(),
          },
        ]);
      }
      throw new Error(`unexpected method: ${method} ${JSON.stringify(payload)}`);
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

    const alphaRow = Array.from(app.querySelectorAll<HTMLElement>(".employee-chat-session")).find(
      (row) => row.textContent?.includes("Alpha Plan"),
    );
    expect(alphaRow).not.toBeNull();
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");
    alphaRow
      ?.querySelector<HTMLButtonElement>(".employee-chat-session__menu-trigger")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushEmployeeApp(app);
    alphaRow
      ?.querySelector<HTMLButtonElement>("[role='menuitem']")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await flushEmployeeApp(app);

    const input = app.querySelector<HTMLInputElement>(".employee-chat-session__rename-input");
    expect(input).not.toBeNull();
    await Promise.resolve();
    expect(selectSpy).toHaveBeenCalledTimes(1);
    input!.value = "A";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushEmployeeApp(app);
    expect(selectSpy).toHaveBeenCalledTimes(1);
    input!.value = "Alpha Renamed";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushEmployeeApp(app);
    await flushEmployeeApp(app);

    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:eon:dashboard:alpha",
      label: "Alpha Renamed",
    });
    expect(request).toHaveBeenCalledWith(
      "sessions.list",
      expect.objectContaining({ includeGlobal: false, includeUnknown: false }),
    );
    expect(app.querySelector(".employee-chat-sessions")?.textContent).toContain("Alpha Renamed");
  });

  it("does not offer session actions for the employee main session", async () => {
    const app = mountConnectedEmployeeApp("/employee/chat");
    const request = vi.fn();
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

    const rows = Array.from(app.querySelectorAll<HTMLElement>(".employee-chat-session"));
    const mainRow = rows.find((row) => row.textContent?.includes("Main"));
    const alphaRow = rows.find((row) => row.textContent?.includes("Alpha Plan"));
    expect(mainRow?.querySelector(".employee-chat-session__menu-trigger")).toBeNull();
    expect(alphaRow?.querySelector(".employee-chat-session__menu-trigger")).not.toBeNull();

    mainRow?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 }),
    );
    await flushEmployeeApp(app);

    expect(app.querySelector(".employee-chat-session__rename-input")).toBeNull();
    expect(app.querySelector(".employee-chat-session__menu")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("deletes the exact employee chat session row through sessions.delete", async () => {
    const app = mountConnectedEmployeeApp("/employee/chat");
    const request = vi.fn(async (method: string, payload?: unknown) => {
      if (method === "sessions.delete") {
        return { ok: true, deleted: true };
      }
      if (method === "sessions.list") {
        return createSessionsResult([
          { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
        ]);
      }
      throw new Error(`unexpected method: ${method} ${JSON.stringify(payload)}`);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
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

    const alphaRow = Array.from(app.querySelectorAll<HTMLElement>(".employee-chat-session")).find(
      (row) => row.textContent?.includes("Alpha Plan"),
    );
    alphaRow?.querySelector<HTMLButtonElement>(".employee-chat-session__menu-trigger")?.click();
    await flushEmployeeApp(app);
    Array.from(alphaRow!.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((button) => button.textContent?.includes("삭제"))
      ?.click();
    await flushEmployeeApp(app);
    await flushEmployeeApp(app);

    expect(request).toHaveBeenCalledWith("sessions.delete", {
      key: "agent:eon:dashboard:alpha",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenCalledWith(
      "sessions.list",
      expect.objectContaining({ includeGlobal: false, includeUnknown: false }),
    );
  });

  it("switches to the employee main session after deleting the active sidebar session", async () => {
    const app = mountConnectedEmployeeApp("/employee/chat");
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        return { ok: true, deleted: true };
      }
      if (method === "sessions.list") {
        return createSessionsResult([
          { key: "agent:eon:main", kind: "direct", label: "Main", updatedAt: Date.now() },
        ]);
      }
      if (method === "chat.history") {
        return { messages: [] };
      }
      return {};
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    app.client = { request, stop: vi.fn() } as never;
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.tab = "chat";
    app.sessionKey = "agent:eon:dashboard:alpha";
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

    const alphaRow = Array.from(app.querySelectorAll<HTMLElement>(".employee-chat-session")).find(
      (row) => row.textContent?.includes("Alpha Plan"),
    );
    alphaRow?.querySelector<HTMLButtonElement>(".employee-chat-session__menu-trigger")?.click();
    await flushEmployeeApp(app);
    Array.from(alphaRow!.querySelectorAll<HTMLButtonElement>("[role='menuitem']"))
      .find((button) => button.textContent?.includes("삭제"))
      ?.click();
    await flushEmployeeApp(app);
    await flushEmployeeApp(app);

    expect(app.sessionKey).toBe("agent:eon:main");
    expect(request).toHaveBeenCalledWith(
      "chat.history",
      expect.objectContaining({ sessionKey: "agent:eon:main" }),
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

  it("scopes cron quick-create session choices to the employee agent", async () => {
    const app = mountConnectedEmployeeApp("/employee/cron");
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.tab = "cron";
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
        key: "agent:minji:dashboard:beta",
        kind: "direct",
        label: "Other employee",
        updatedAt: Date.now(),
      },
    ]);
    app.cronQuickCreateOpen = true;
    app.cronQuickCreateStep = "how";
    app.cronQuickCreateDraft = {
      ...createDefaultDraft(),
      prompt: "Run scoped job",
    };
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    const options = Array.from(
      app.querySelectorAll<HTMLOptionElement>(".cqc-container option"),
    ).map((option) => option.textContent?.trim());
    expect(options).toContain("Main");
    expect(options).toContain("Alpha Plan");
    expect(options).not.toContain("Other employee");
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
