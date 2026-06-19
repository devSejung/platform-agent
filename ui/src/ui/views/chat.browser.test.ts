import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import "../../test-helpers/load-styles.ts";
import { renderChat, type ChatProps } from "./chat.ts";

const contextNoticeSessions: ChatProps["sessions"] = {
  ts: 0,
  path: "",
  count: 1,
  defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
  sessions: [
    {
      key: "main",
      kind: "direct",
      updatedAt: null,
      totalTokens: 3_800,
      inputTokens: 3_800,
      contextTokens: 4_000,
    },
  ],
};

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    showToolCalls: true,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: {
      ts: 0,
      path: "",
      count: 1,
      defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: null },
      sessions: [
        {
          key: "main",
          kind: "direct",
          updatedAt: null,
          inputTokens: 3_800,
          contextTokens: 4_000,
        },
      ],
    },
    focusMode: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    agentsList: null,
    currentAgentId: "",
    onAgentChange: () => undefined,
    ...overrides,
  };
}

async function renderContextNoticeChat() {
  const container = document.createElement("div");
  document.body.append(container);
  render(
    renderChat(
      createProps({
        sessions: contextNoticeSessions,
      }),
    ),
    container,
  );
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return container;
}

describe("chat context notice", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("falls back to default notice colors when theme vars are not hex", async () => {
    document.documentElement.style.setProperty("--warn", "rgb(1, 2, 3)");
    document.documentElement.style.setProperty("--danger", "tomato");
    const container = await renderContextNoticeChat();

    const notice = container.querySelector<HTMLElement>(".context-notice");
    expect(notice).not.toBeNull();
    expect(notice?.style.getPropertyValue("--ctx-color")).toContain("rgb(");
    expect(notice?.style.getPropertyValue("--ctx-color")).not.toContain("NaN");
    expect(notice?.style.getPropertyValue("--ctx-bg")).not.toContain("NaN");

    document.documentElement.style.removeProperty("--warn");
    document.documentElement.style.removeProperty("--danger");
  });

  it("keeps the warning icon badge-sized", async () => {
    const container = await renderContextNoticeChat();

    const icon = container.querySelector<SVGElement>(".context-notice__icon");
    expect(icon).not.toBeNull();
    if (!icon) {
      return;
    }

    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.classList.contains("context-notice__icon")).toBe(true);
    expect(icon.getAttribute("width")).toBe("16");
    expect(icon.getAttribute("height")).toBe("16");
    expect(icon.querySelector("path")).not.toBeNull();
  });

  it("renders persisted attachment cards from transcript-style user messages", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              timestamp: Date.now(),
              content: [
                { type: "text", text: "see attached" },
                {
                  type: "attachment",
                  attachmentType: "file",
                  fileName: "notes.txt",
                  workspacePath: "inbox/chat-attachments/2026-06-06/notes.txt",
                  mimeType: "text/plain",
                  sizeBytes: 42,
                  promptMode: "workspace",
                },
              ],
            },
          ],
        }),
      ),
      container,
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const attachmentLink = container.querySelector<HTMLAnchorElement>(
      ".chat-message-attachments__item",
    );
    expect(attachmentLink).not.toBeNull();
    expect(attachmentLink?.textContent).toContain("notes.txt");
    expect(attachmentLink?.getAttribute("href")).toContain(
      "path=inbox%2Fchat-attachments%2F2026-06-06%2Fnotes.txt",
    );
  });

  it("renders assistant artifact attachments as inline images", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              timestamp: Date.now(),
              content: [
                { type: "text", text: "붙였습니다." },
                {
                  type: "attachment",
                  attachmentType: "image",
                  fileName: "plot.png",
                  workspacePath: "outbox/generated-artifacts/2026-06-16/plot-abcd1234.png",
                  mimeType: "image/png",
                  sizeBytes: 1234,
                  promptMode: "workspace",
                },
              ],
            },
          ],
        }),
      ),
      container,
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const image = container.querySelector<HTMLImageElement>(".chat-message-images img");
    expect(image).not.toBeNull();
    expect(container.querySelector(".chat-group--artifact-preview")).not.toBeNull();
    expect(container.querySelector(".chat-group--image-artifact")).not.toBeNull();
    expect(container.querySelector(".chat-bubble--artifact-preview")).not.toBeNull();
    expect(container.querySelector(".chat-bubble--image-artifact")).not.toBeNull();
    expect(image?.getAttribute("alt")).toBe("plot.png");
    expect(image?.getAttribute("src")).toContain(
      "path=outbox%2Fgenerated-artifacts%2F2026-06-16%2Fplot-abcd1234.png",
    );
    expect(image?.getAttribute("src")).toContain("inline=1");
  });

  it("renders html assistant artifact attachments in sandboxed iframes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              timestamp: Date.now(),
              content: [
                { type: "text", text: "차트입니다." },
                {
                  type: "attachment",
                  attachmentType: "file",
                  fileName: "chart.html",
                  workspacePath: "outbox/generated-artifacts/2026-06-19/chart-abcd1234.html",
                  mimeType: "text/html",
                  sizeBytes: 4096,
                  promptMode: "workspace",
                },
              ],
            },
          ],
        }),
      ),
      container,
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const frame = container.querySelector<HTMLIFrameElement>(
      ".chat-message-attachments__html-frame",
    );
    expect(frame).not.toBeNull();
    expect(container.querySelector(".chat-group--artifact-preview")).not.toBeNull();
    expect(container.querySelector(".chat-group--html-artifact")).not.toBeNull();
    expect(container.querySelector(".chat-bubble--artifact-preview")).not.toBeNull();
    expect(container.querySelector(".chat-bubble--html-artifact")).not.toBeNull();
    expect(frame?.getAttribute("title")).toBe("chart.html");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toContain(
      "path=outbox%2Fgenerated-artifacts%2F2026-06-19%2Fchart-abcd1234.html",
    );
    expect(frame?.getAttribute("src")).toContain("inline=1");

    const downloadLink = container.querySelector<HTMLAnchorElement>(
      ".chat-message-attachments__download",
    );
    expect(downloadLink).not.toBeNull();
    expect(downloadLink?.getAttribute("href")).toContain(
      "path=outbox%2Fgenerated-artifacts%2F2026-06-19%2Fchart-abcd1234.html",
    );
    expect(downloadLink?.getAttribute("href")).not.toContain("inline=1");
  });
});
