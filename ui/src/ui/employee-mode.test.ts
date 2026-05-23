import { describe, expect, it } from "vitest";
import "../styles.css";
import { mountApp as mountTestApp, registerAppMountHooks } from "./test-helpers/app-mount.ts";
import "./app.ts";
import type { OpenClawApp } from "./app.ts";

registerAppMountHooks();

function mountConnectedEmployeeApp(pathname = "/employee/chat") {
  window.__OPENCLAW_UI_MODE__ = "employee";
  const app = mountTestApp(pathname);
  app.employeeMode = true;
  return app;
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

  it("shows employee tabs and the chat model selector in the connected workspace", async () => {
    const app = mountConnectedEmployeeApp();
    app.employeeProfile = {
      employeeId: "eon",
      name: "Eon",
      department: "Ops",
      agentId: "eon",
    };
    app.chatModelCatalog = [{ id: "gpt-5", name: "GPT-5", provider: "openai" }];
    app.connected = true;
    app.requestUpdate();
    await app.updateComplete;

    expect(app.textContent).toContain("Chat");
    expect(app.textContent).toContain("Cron Jobs");
    expect(app.textContent).toContain("Heartbeat");
    expect(app.textContent).toContain("Skill Hub");
    expect(app.querySelector("[data-chat-model-select='true']")).not.toBeNull();
  });
});
