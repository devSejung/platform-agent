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
    expect(app.querySelector(".login-gate__title")?.textContent).toContain(
      "Soc PlatformClaw 업무 워크스페이스",
    );
  });

  it("falls back to employee mode from the root route even without the inline mode flag", async () => {
    delete window.__OPENCLAW_UI_MODE__;
    window.history.replaceState({}, "", "/");

    const app = document.createElement("openclaw-app") as OpenClawApp;
    document.body.appendChild(app);
    await app.updateComplete;

    expect(app.employeeMode).toBe(true);
    expect(app.querySelector(".login-gate__title")?.textContent).toContain(
      "Soc PlatformClaw 업무 워크스페이스",
    );
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
    expect(app.querySelector(".login-gate__title")?.textContent).toContain(
      "Soc PlatformClaw 업무 워크스페이스",
    );
    expect(app.textContent).toContain("회사 계정으로 로그인해 주세요");
    expect(app.textContent).toContain("로그인 안내");
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
    await app.updateComplete;

    expect(app.querySelector(".shell--employee")).not.toBeNull();
    expect(app.querySelector(".sidebar-shell")).toBeNull();
    expect(app.querySelector(".sidebar")).toBeNull();
    expect(app.querySelector(".page-title")?.textContent).toContain("Soc PlatformClaw Workspace");
    expect(app.querySelector(".page-sub")?.textContent).toContain("Eon");
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
    app.requestUpdate();
    await app.updateComplete;

    expect(app.textContent).toContain("대화");
    expect(app.textContent).toContain("자동화");
    expect(app.textContent).toContain("하트비트");
    expect(app.querySelector("[data-chat-model-select='true']")).not.toBeNull();
  });
});
