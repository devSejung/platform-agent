import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

type Transport = "stdio" | "streamable-http" | "sse";
type ToolPolicy = { mode: "all" | "allowlist" | "denylist"; tools: string[] };
type Server = {
  id: string;
  name: string;
  description?: string;
  transport: Transport;
  config: { url?: string; templateId?: string; args?: string[]; cwd?: string };
  enabled: boolean;
  forcedDisabled: boolean;
  timeoutMs: number;
  toolPolicy: ToolPolicy;
  status: string;
  lastErrorMessage?: string;
  toolCount: number;
};
type Policy = {
  enabled: boolean;
  allowedTransports: Transport[];
  maxServersPerUser: number;
  maxTimeoutMs: number;
  allowPrivateNetwork: boolean;
  allowedHostnames: string[];
  stdioTemplates: Array<{ id: string; label: string; command: string }>;
};
type AdminServer = Pick<
  Server,
  "id" | "name" | "transport" | "enabled" | "forcedDisabled" | "status"
> & { ownerUserId: string; targetSummary: string; policyViolation: boolean };
type AuditEvent = {
  id: string;
  actorUserId: string;
  eventType: string;
  targetId: string;
  createdAt: string;
};

const USER_API = "/api/user/mcp-servers";
const ADMIN_API = "/api/admin/mcp-policy";
const ADMIN_SERVERS_API = "/api/admin/mcp-servers";
const ADMIN_AUDIT_API = "/api/admin/mcp-audit";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    headers,
  });
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed (${response.status})`);
  }
  return payload as T;
}

@customElement("user-mcp-panel")
export class UserMcpPanel extends LitElement {
  @state() private servers: Server[] = [];
  @state() private policy: Policy | null = null;
  @state() private adminPolicy: Policy | null = null;
  @state() private adminServers: AdminServer[] = [];
  @state() private auditEvents: AuditEvent[] = [];
  @state() private loading = true;
  @state() private busy = false;
  @state() private error = "";
  @state() private editingId = "";
  @state() private name = "";
  @state() private description = "";
  @state() private transport: Transport = "streamable-http";
  @state() private url = "";
  @state() private templateId = "";
  @state() private timeoutMs = 30_000;
  @state() private enabled = true;
  @state() private toolMode: ToolPolicy["mode"] = "all";
  @state() private tools = "";
  @state() private catalog: Array<{ name: string; description?: string }> = [];
  @state() private templateIdDraft = "";
  @state() private templateLabelDraft = "";
  @state() private templateCommandDraft = "";

  static styles = css`
    :host {
      display: block;
      margin-bottom: 16px;
    }
    .panel {
      border: 1px solid var(--border, #d7dce3);
      border-radius: 12px;
      padding: 16px;
      background: var(--card, #fff);
    }
    h2,
    h3 {
      margin: 0;
      font-size: 16px;
    }
    .sub,
    .meta {
      color: var(--muted, #667085);
      font-size: 12px;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .between {
      justify-content: space-between;
    }
    .list {
      display: grid;
      gap: 8px;
      margin: 14px 0;
    }
    .server {
      border: 1px solid var(--border, #e4e7ec);
      border-radius: 8px;
      padding: 10px;
    }
    .form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    label {
      display: grid;
      gap: 4px;
      font-size: 12px;
      color: var(--muted, #475467);
    }
    label.wide {
      grid-column: 1 / -1;
    }
    input,
    select {
      box-sizing: border-box;
      width: 100%;
      padding: 8px;
      border: 1px solid var(--border, #d0d5dd);
      border-radius: 7px;
      background: var(--input, #fff);
      color: inherit;
    }
    button {
      padding: 7px 10px;
      border: 1px solid var(--border, #d0d5dd);
      border-radius: 7px;
      background: var(--button, #fff);
      color: inherit;
      cursor: pointer;
    }
    button.primary {
      background: var(--accent, #2563eb);
      color: white;
      border-color: transparent;
    }
    button.light-surface {
      color: #101828;
    }
    button.danger {
      color: #b42318;
    }
    button:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .error {
      color: #b42318;
      margin-top: 8px;
      font-size: 12px;
    }
    .catalog {
      margin: 8px 0 0;
      padding-left: 18px;
      font-size: 12px;
    }
    details {
      margin-top: 14px;
    }
    @media (max-width: 700px) {
      .form {
        grid-template-columns: 1fr;
      }
      label.wide {
        grid-column: auto;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  private async load() {
    this.loading = true;
    this.error = "";
    try {
      const data = await request<{ servers: Server[]; policy: Policy }>(USER_API);
      this.servers = data.servers;
      this.policy = data.policy;
      if (!data.policy.allowedTransports.includes(this.transport)) {
        this.transport = data.policy.allowedTransports[0] ?? "streamable-http";
      }
      try {
        this.adminPolicy = (await request<{ policy: Policy }>(ADMIN_API)).policy;
        this.adminServers = (await request<{ servers: AdminServer[] }>(ADMIN_SERVERS_API)).servers;
        this.auditEvents = (await request<{ events: AuditEvent[] }>(ADMIN_AUDIT_API)).events;
      } catch {
        this.adminPolicy = null;
        this.adminServers = [];
        this.auditEvents = [];
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  private resetForm() {
    this.editingId = "";
    this.name = "";
    this.description = "";
    this.url = "";
    this.templateId = "";
    this.timeoutMs = Math.min(30_000, this.policy?.maxTimeoutMs ?? 30_000);
    this.enabled = true;
    this.toolMode = "all";
    this.tools = "";
  }

  private edit(server: Server) {
    this.editingId = server.id;
    this.name = server.name;
    this.description = server.description ?? "";
    this.transport = server.transport;
    this.url = server.config.url ?? "";
    this.templateId = server.config.templateId ?? "";
    this.timeoutMs = server.timeoutMs;
    this.enabled = server.enabled;
    this.toolMode = server.toolPolicy.mode;
    this.tools = server.toolPolicy.tools.join(", ");
  }

  private async save() {
    if (!this.name.trim()) {
      this.error = "이름을 입력하세요.";
      return;
    }
    const config =
      this.transport === "stdio" ? { templateId: this.templateId } : { url: this.url.trim() };
    const body = {
      name: this.name.trim(),
      description: this.description.trim() || undefined,
      transport: this.transport,
      config,
      enabled: this.enabled,
      timeoutMs: this.timeoutMs,
      toolPolicy: {
        mode: this.toolMode,
        tools:
          this.toolMode === "all"
            ? []
            : this.tools
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
      },
    };
    this.busy = true;
    this.error = "";
    try {
      await request(this.editingId ? `${USER_API}/${this.editingId}` : USER_API, {
        method: this.editingId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      this.resetForm();
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  private async mutate(server: Server, action: "toggle" | "delete" | "test") {
    if (action === "delete" && !window.confirm(`'${server.name}' MCP를 삭제할까요?`)) {
      return;
    }
    this.busy = true;
    this.error = "";
    this.catalog = [];
    try {
      if (action === "delete") {
        await request(`${USER_API}/${server.id}`, { method: "DELETE" });
      } else if (action === "toggle") {
        await request(`${USER_API}/${server.id}`, {
          method: "PATCH",
          body: JSON.stringify({ enabled: !server.enabled }),
        });
      } else {
        this.catalog = (
          await request<{ tools: Array<{ name: string; description?: string }> }>(
            `${USER_API}/${server.id}/test`,
            { method: "POST" },
          )
        ).tools;
      }
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  private async saveAdminPolicy() {
    if (!this.adminPolicy) {
      return;
    }
    this.busy = true;
    this.error = "";
    try {
      this.adminPolicy = (
        await request<{ policy: Policy }>(ADMIN_API, {
          method: "PUT",
          body: JSON.stringify(this.adminPolicy),
        })
      ).policy;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  private toggleAdminTransport(transport: Transport, allowed: boolean) {
    if (!this.adminPolicy) {
      return;
    }
    const next = new Set(this.adminPolicy.allowedTransports);
    if (allowed) {
      next.add(transport);
    } else {
      next.delete(transport);
    }
    this.adminPolicy = { ...this.adminPolicy, allowedTransports: [...next] };
  }

  private addAdminTemplate() {
    if (!this.adminPolicy || !this.templateIdDraft.trim() || !this.templateCommandDraft.trim()) {
      return;
    }
    const template = {
      id: this.templateIdDraft.trim(),
      label: this.templateLabelDraft.trim() || this.templateIdDraft.trim(),
      command: this.templateCommandDraft.trim(),
    };
    this.adminPolicy = {
      ...this.adminPolicy,
      stdioTemplates: [
        ...this.adminPolicy.stdioTemplates.filter((entry) => entry.id !== template.id),
        template,
      ],
    };
    this.templateIdDraft = "";
    this.templateLabelDraft = "";
    this.templateCommandDraft = "";
  }

  private async forceDisable(server: AdminServer) {
    this.busy = true;
    this.error = "";
    try {
      await request(`${ADMIN_SERVERS_API}/${server.id}`, {
        method: "PATCH",
        body: JSON.stringify({ forcedDisabled: !server.forcedDisabled }),
      });
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }

  render() {
    const policy = this.policy;
    return html`<section class="panel">
      <div class="row between">
        <div>
          <h2>MCP Servers</h2>
          <div class="sub">내 개인 Agent와 개인 세션에서만 사용하는 MCP 서버입니다.</div>
        </div>
        <button
          class="light-surface"
          @click=${() => this.load()}
          ?disabled=${this.loading || this.busy}
        >
          새로고침
        </button>
      </div>
      ${this.loading ? html`<p class="sub">불러오는 중…</p>` : nothing}
      <div class="list">
        ${this.servers.map(
          (server) => html`<div class="server">
            <div class="row between">
              <strong>${server.name}</strong
              ><span class="meta"
                >${server.transport} · ${server.status} · tools ${server.toolCount}</span
              >
            </div>
            <div class="meta">
              ${server.description ??
              server.config.url ??
              server.config.templateId ??
              ""}${server.lastErrorMessage ? ` · ${server.lastErrorMessage}` : ""}
            </div>
            <div class="row" style="margin-top:8px">
              <button @click=${() => this.edit(server)}>편집</button
              ><button
                @click=${() => this.mutate(server, "toggle")}
                ?disabled=${this.busy || server.forcedDisabled}
              >
                ${server.enabled ? "비활성화" : "활성화"}</button
              ><button
                @click=${() => this.mutate(server, "test")}
                ?disabled=${this.busy || !server.enabled}
              >
                연결 테스트</button
              ><button
                class="danger"
                @click=${() => this.mutate(server, "delete")}
                ?disabled=${this.busy}
              >
                삭제
              </button>
            </div>
          </div>`,
        )}
      </div>
      ${this.catalog.length
        ? html`<ul class="catalog">
            ${this.catalog.map(
              (tool) =>
                html`<li>
                  <strong>${tool.name}</strong>${tool.description ? ` — ${tool.description}` : ""}
                </li>`,
            )}
          </ul>`
        : nothing}
      ${policy
        ? html`<div class="form">
            <label
              >이름<input
                .value=${this.name}
                @input=${(e: InputEvent) => (this.name = (e.target as HTMLInputElement).value)}
            /></label>
            <label
              >Transport<select
                .value=${this.transport}
                @change=${(e: Event) =>
                  (this.transport = (e.target as HTMLSelectElement).value as Transport)}
              >
                ${policy.allowedTransports.map(
                  (value) => html`<option value=${value}>${value}</option>`,
                )}
              </select></label
            >
            <label class="wide"
              >설명<input
                .value=${this.description}
                @input=${(e: InputEvent) =>
                  (this.description = (e.target as HTMLInputElement).value)}
            /></label>
            ${this.transport === "stdio"
              ? html`<label class="wide"
                  >승인 템플릿<select
                    .value=${this.templateId}
                    @change=${(e: Event) =>
                      (this.templateId = (e.target as HTMLSelectElement).value)}
                  >
                    <option value="">선택</option>
                    ${policy.stdioTemplates.map(
                      (t) => html`<option value=${t.id}>${t.label}</option>`,
                    )}</select
                  ><span class="sub">승인 템플릿이 없으면 stdio 실행은 차단됩니다.</span></label
                >`
              : html`<label class="wide"
                  >URL<input
                    type="url"
                    placeholder="https://mcp.example.com/mcp"
                    .value=${this.url}
                    @input=${(e: InputEvent) => (this.url = (e.target as HTMLInputElement).value)}
                /></label>`}
            <label
              >Timeout (ms)<input
                type="number"
                min="1000"
                max=${policy.maxTimeoutMs}
                .value=${String(this.timeoutMs)}
                @input=${(e: InputEvent) =>
                  (this.timeoutMs = Number((e.target as HTMLInputElement).value))}
            /></label>
            <label
              >Tool 정책<select
                .value=${this.toolMode}
                @change=${(e: Event) =>
                  (this.toolMode = (e.target as HTMLSelectElement).value as ToolPolicy["mode"])}
              >
                <option value="all">전체 허용</option>
                <option value="allowlist">Allowlist</option>
                <option value="denylist">Denylist</option>
              </select></label
            >
            ${this.toolMode !== "all"
              ? html`<label class="wide"
                  >Tool 이름 (쉼표 구분)<input
                    .value=${this.tools}
                    @input=${(e: InputEvent) =>
                      (this.tools = (e.target as HTMLInputElement).value)}
                /></label>`
              : nothing}
            <label
              ><span
                ><input
                  style="width:auto"
                  type="checkbox"
                  .checked=${this.enabled}
                  @change=${(e: Event) => (this.enabled = (e.target as HTMLInputElement).checked)}
                />
                활성화</span
              ></label
            >
            <div class="row">
              <button
                class="primary"
                @click=${() => this.save()}
                ?disabled=${this.busy ||
                !policy.enabled ||
                (this.transport === "stdio" && !this.templateId)}
              >
                ${this.editingId ? "수정" : "추가"}</button
              >${this.editingId
                ? html`<button @click=${() => this.resetForm()}>취소</button>`
                : nothing}
            </div>
          </div>`
        : nothing}
      ${this.adminPolicy
        ? html`<details>
            <summary>관리자 MCP 정책</summary>
            <div class="form">
              <label
                ><span
                  ><input
                    style="width:auto"
                    type="checkbox"
                    .checked=${this.adminPolicy.enabled}
                    @change=${(e: Event) =>
                      (this.adminPolicy = {
                        ...this.adminPolicy!,
                        enabled: (e.target as HTMLInputElement).checked,
                      })}
                  />
                  전체 기능 활성화</span
                ></label
              >
              <label
                >사용자별 최대 서버<input
                  type="number"
                  .value=${String(this.adminPolicy.maxServersPerUser)}
                  @input=${(e: InputEvent) =>
                    (this.adminPolicy = {
                      ...this.adminPolicy!,
                      maxServersPerUser: Number((e.target as HTMLInputElement).value),
                    })}
              /></label>
              <label
                >최대 timeout<input
                  type="number"
                  .value=${String(this.adminPolicy.maxTimeoutMs)}
                  @input=${(e: InputEvent) =>
                    (this.adminPolicy = {
                      ...this.adminPolicy!,
                      maxTimeoutMs: Number((e.target as HTMLInputElement).value),
                    })}
              /></label>
              <label
                ><span
                  ><input
                    style="width:auto"
                    type="checkbox"
                    .checked=${this.adminPolicy.allowPrivateNetwork}
                    @change=${(e: Event) =>
                      (this.adminPolicy = {
                        ...this.adminPolicy!,
                        allowPrivateNetwork: (e.target as HTMLInputElement).checked,
                      })}
                  />
                  Private network 허용</span
                ></label
              >
              <label class="wide"
                >허용 transport
                <div class="row">
                  ${(["streamable-http", "sse", "stdio"] as Transport[]).map(
                    (transport) =>
                      html`<span
                        ><input
                          style="width:auto"
                          type="checkbox"
                          .checked=${this.adminPolicy!.allowedTransports.includes(transport)}
                          @change=${(e: Event) =>
                            this.toggleAdminTransport(
                              transport,
                              (e.target as HTMLInputElement).checked,
                            )}
                        />
                        ${transport}</span
                      >`,
                  )}
                </div></label
              >
              <label class="wide"
                >Private network 예외 hostname<input
                  .value=${this.adminPolicy.allowedHostnames.join(", ")}
                  @input=${(e: InputEvent) =>
                    (this.adminPolicy = {
                      ...this.adminPolicy!,
                      allowedHostnames: (e.target as HTMLInputElement).value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean),
                    })}
              /></label>
              <label
                >Template ID<input
                  .value=${this.templateIdDraft}
                  @input=${(e: InputEvent) =>
                    (this.templateIdDraft = (e.target as HTMLInputElement).value)}
              /></label>
              <label
                >표시 이름<input
                  .value=${this.templateLabelDraft}
                  @input=${(e: InputEvent) =>
                    (this.templateLabelDraft = (e.target as HTMLInputElement).value)}
              /></label>
              <label class="wide"
                >직접 실행 executable<input
                  .value=${this.templateCommandDraft}
                  @input=${(e: InputEvent) =>
                    (this.templateCommandDraft = (e.target as HTMLInputElement).value)}
              /></label>
              <div class="row">
                <button class="light-surface" @click=${() => this.addAdminTemplate()}>
                  승인 template 추가</button
                >${this.adminPolicy.stdioTemplates.map(
                  (template) =>
                    html`<span class="meta"
                      >${template.label}: ${template.command}
                      <button
                        class="danger"
                        @click=${() =>
                          (this.adminPolicy = {
                            ...this.adminPolicy!,
                            stdioTemplates: this.adminPolicy!.stdioTemplates.filter(
                              (entry) => entry.id !== template.id,
                            ),
                          })}
                      >
                        제거
                      </button></span
                    >`,
                )}
              </div>
              <div>
                <button
                  class="primary"
                  @click=${() => this.saveAdminPolicy()}
                  ?disabled=${this.busy}
                >
                  정책 저장
                </button>
              </div>
            </div>
            <h3 style="margin-top:16px">운영 상태</h3>
            <div class="list">
              ${this.adminServers.map(
                (server) =>
                  html`<div class="server">
                    <div class="row between">
                      <strong>${server.ownerUserId} · ${server.name}</strong
                      ><span class="meta"
                        >${server.transport} · ${server.targetSummary} · ${server.status}</span
                      >
                    </div>
                    <div class="row" style="margin-top:8px">
                      <button
                        class=${server.forcedDisabled ? "" : "danger"}
                        @click=${() => this.forceDisable(server)}
                        ?disabled=${this.busy}
                      >
                        ${server.forcedDisabled ? "강제 차단 해제" : "강제 비활성화"}</button
                      >${server.policyViolation
                        ? html`<span class="error">정책 위반</span>`
                        : nothing}
                    </div>
                  </div>`,
              )}
            </div>
            <h3 style="margin-top:16px">감사 로그</h3>
            <div class="list">
              ${this.auditEvents.map(
                (event) => html`<div class="server meta">
                  ${event.createdAt} · ${event.actorUserId} · ${event.eventType} · ${event.targetId}
                </div>`,
              )}
            </div>
          </details>`
        : nothing}
      ${this.error ? html`<div class="error">${this.error}</div>` : nothing}
    </section>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "user-mcp-panel": UserMcpPanel;
  }
}
