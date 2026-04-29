import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { AppViewState } from "../app-view-state.ts";
import {
  dismissEmployeeAnnouncement,
  isEmployeeAnnouncementDismissed,
  resolveEmployeeAnnouncement,
} from "../employee-announcement.ts";
import { icons } from "../icons.ts";
import { normalizeBasePath } from "../navigation.ts";
import { agentLogoUrl, employeeLogoUrl } from "./agents-utils.ts";
import { renderConnectCommand } from "./connect-command.ts";

export function renderLoginGate(state: AppViewState) {
  const basePath = normalizeBasePath(state.basePath ?? "");
  const faviconSrc = state.employeeMode ? employeeLogoUrl(basePath) : agentLogoUrl(basePath);
  const employeeAnnouncement = resolveEmployeeAnnouncement(state.employeeMode, state.employeeUi);
  const showEmployeeAnnouncement =
    employeeAnnouncement && !isEmployeeAnnouncementDismissed(employeeAnnouncement);
  if (state.employeeMode) {
    const employeeLabel = state.employeeProfile.name ?? state.employeeProfile.employeeId ?? "";
    const employeeMeta = [
      state.employeeProfile.department,
      state.employeeProfile.agentId ? `Agent ${state.employeeProfile.agentId}` : "",
    ].filter(Boolean);
    return html`
      <div class="login-gate login-gate--employee">
        <div class="login-gate__layout">
          <section class="login-gate__hero">
            <div class="login-gate__eyebrow">PlatformClaw</div>
            <div class="login-gate__hero-title">Start Soc PlatformClaw.</div>
            <div class="login-gate__hero-copy">Workspace access for your assigned agent.</div>
          </section>

          <div class="login-gate__card login-gate__card--employee">
            <div class="login-gate__header login-gate__header--employee">
              <img class="login-gate__logo" src=${faviconSrc} alt="Soc PlatformClaw" />
              <div class="login-gate__title">Soc PlatformClaw</div>
              <div class="login-gate__sub">
                ${state.employeeBootstrapReady ? `${employeeLabel}`.trim() : "Workspace access"}
              </div>
              ${employeeMeta.length > 0
                ? html`<div class="login-gate__meta">
                    ${employeeMeta.map(
                      (entry) => html`<span class="login-gate__meta-chip">${entry}</span>`,
                    )}
                  </div>`
                : ""}
            </div>

            <div class="login-gate__form login-gate__form--employee">
              ${state.employeeBootstrapReady
                ? html`
                    <button
                      class="btn primary login-gate__connect"
                      type="button"
                      @click=${() => state.connect()}
                    >
                      워크스페이스 입장
                    </button>
                    <button class="btn" type="button" @click=${() => state.handleEmployeeLogout()}>
                      로그아웃
                    </button>
                  `
                : html`
                    <label class="field">
                      <span>Account</span>
                      <input
                        .value=${state.employeeLoginIdentifier}
                        @input=${(e: Event) => {
                          state.employeeLoginIdentifier = (e.target as HTMLInputElement).value;
                        }}
                        placeholder="Email or employee ID"
                        autocomplete="username"
                        inputmode="email"
                        ?disabled=${state.employeeLoginSubmitting}
                        @keydown=${(e: KeyboardEvent) => {
                          if (e.key === "Enter") {
                            void state.handleEmployeeLogin();
                          }
                        }}
                      />
                    </label>
                    <label class="field">
                      <span>Password</span>
                      <div class="login-gate__secret-row">
                        <input
                          type=${state.loginShowGatewayPassword ? "text" : "password"}
                          .value=${state.employeeLoginPassword}
                          @input=${(e: Event) => {
                            state.employeeLoginPassword = (e.target as HTMLInputElement).value;
                          }}
                          placeholder="Password"
                          autocomplete="current-password"
                          ?disabled=${state.employeeLoginSubmitting}
                          @keydown=${(e: KeyboardEvent) => {
                            if (e.key === "Enter") {
                              void state.handleEmployeeLogin();
                            }
                          }}
                        />
                        <button
                          type="button"
                          class="btn btn--icon ${state.loginShowGatewayPassword ? "active" : ""}"
                          title=${state.loginShowGatewayPassword ? "Hide password" : "Show password"}
                          aria-label="Toggle password visibility"
                          aria-pressed=${state.loginShowGatewayPassword}
                          ?disabled=${state.employeeLoginSubmitting}
                          @click=${() => {
                            state.loginShowGatewayPassword = !state.loginShowGatewayPassword;
                          }}
                        >
                          ${state.loginShowGatewayPassword ? icons.eye : icons.eyeOff}
                        </button>
                      </div>
                    </label>
                    <button
                      class="btn primary login-gate__connect"
                      type="button"
                      ?disabled=${state.employeeLoginSubmitting}
                      @click=${() => state.handleEmployeeLogin()}
                    >
                      ${state.employeeLoginSubmitting ? "워크스페이스 준비 중..." : "Sign in"}
                    </button>
                    <button
                      class="btn btn--sso login-gate__connect"
                      type="button"
                      ?disabled=${state.employeeLoginSubmitting}
                      @click=${() => state.handleEmployeeAdSso()}
                    >
                      Sign in with AD SSO
                    </button>
                  `}
            </div>

            ${state.employeeBootstrapError
              ? html`<div class="callout danger login-gate__error">
                  <div>${state.employeeBootstrapError}</div>
                </div>`
              : ""}
            ${showEmployeeAnnouncement
              ? html`
                  <div class="callout warning login-gate__error employee-announcement">
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
                    ${employeeAnnouncement.title ? html`<strong>${employeeAnnouncement.title}</strong>` : nothing}
                    ${employeeAnnouncement.body ? html`<div>${employeeAnnouncement.body}</div>` : nothing}
                    ${employeeAnnouncement.linkUrl
                      ? html`
                          <div>
                            <a href=${employeeAnnouncement.linkUrl} target="_blank" rel="noopener noreferrer">
                              ${employeeAnnouncement.linkLabel || "Open notice"}
                            </a>
                          </div>
                        `
                      : nothing}
                  </div>
                `
              : nothing}
          </div>
        </div>
      </div>
    `;
  }

  return html`
    <div class="login-gate">
      <div class="login-gate__card">
        <div class="login-gate__header">
          <img class="login-gate__logo" src=${faviconSrc} alt="Soc PlatformClaw" />
          <div class="login-gate__title">Soc PlatformClaw</div>
          <div class="login-gate__sub">${t("login.subtitle")}</div>
        </div>
        <div class="login-gate__form">
          <label class="field">
            <span>${t("overview.access.wsUrl")}</span>
            <input
              .value=${state.settings.gatewayUrl}
              @input=${(e: Event) => {
                const v = (e.target as HTMLInputElement).value;
                state.applySettings({ ...state.settings, gatewayUrl: v });
              }}
              placeholder="ws://127.0.0.1:18789"
            />
          </label>
          <label class="field">
            <span>${t("overview.access.token")}</span>
            <div class="login-gate__secret-row">
              <input
                type=${state.loginShowGatewayToken ? "text" : "password"}
                autocomplete="off"
                spellcheck="false"
                .value=${state.settings.token}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  state.applySettings({ ...state.settings, token: v });
                }}
                placeholder="OPENCLAW_GATEWAY_TOKEN (${t("login.passwordPlaceholder")})"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    state.connect();
                  }
                }}
              />
              <button
                type="button"
                class="btn btn--icon ${state.loginShowGatewayToken ? "active" : ""}"
                title=${state.loginShowGatewayToken ? "Hide token" : "Show token"}
                aria-label="Toggle token visibility"
                aria-pressed=${state.loginShowGatewayToken}
                @click=${() => {
                  state.loginShowGatewayToken = !state.loginShowGatewayToken;
                }}
              >
                ${state.loginShowGatewayToken ? icons.eye : icons.eyeOff}
              </button>
            </div>
          </label>
          <label class="field">
            <span>${t("overview.access.password")}</span>
            <div class="login-gate__secret-row">
              <input
                type=${state.loginShowGatewayPassword ? "text" : "password"}
                autocomplete="off"
                spellcheck="false"
                .value=${state.password}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  state.password = v;
                }}
                placeholder="${t("login.passwordPlaceholder")}"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter") {
                    state.connect();
                  }
                }}
              />
              <button
                type="button"
                class="btn btn--icon ${state.loginShowGatewayPassword ? "active" : ""}"
                title=${state.loginShowGatewayPassword ? "Hide password" : "Show password"}
                aria-label="Toggle password visibility"
                aria-pressed=${state.loginShowGatewayPassword}
                @click=${() => {
                  state.loginShowGatewayPassword = !state.loginShowGatewayPassword;
                }}
              >
                ${state.loginShowGatewayPassword ? icons.eye : icons.eyeOff}
              </button>
            </div>
          </label>
          <button class="btn primary login-gate__connect" @click=${() => state.connect()}>
            ${t("common.connect")}
          </button>
        </div>
        ${state.lastError
          ? html`<div class="callout danger" style="margin-top: 14px;">
              <div>${state.lastError}</div>
            </div>`
          : ""}
        <div class="login-gate__help">
          <div class="login-gate__help-title">${t("overview.connection.title")}</div>
          <ol class="login-gate__steps">
            <li>
              ${t("overview.connection.step1")}${renderConnectCommand("openclaw gateway run")}
            </li>
            <li>${t("overview.connection.step2")} ${renderConnectCommand("openclaw dashboard")}</li>
            <li>${t("overview.connection.step3")}</li>
          </ol>
          <div class="login-gate__docs">
            <a
              class="session-link"
              href="https://docs.openclaw.ai/web/dashboard"
              target="_blank"
              rel="noreferrer"
              >${t("overview.connection.docsLink")}</a
            >
          </div>
        </div>
      </div>
    </div>
  `;
}
