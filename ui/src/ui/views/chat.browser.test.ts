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
                {
                  type: "attachment",
                  attachmentType: "image",
                  fileName: "plot.png",
                  workspacePath: "outbox/generated-artifacts/2026-06-16/plot-abcd1234.png",
                  mimeType: "image/png",
                  sizeBytes: 1234,
                  promptMode: "workspace",
                  caption: "latency graph",
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
    expect(image?.getAttribute("alt")).toBe("latency graph");
    expect(container.querySelector(".chat-text")).toBeNull();
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
                {
                  type: "attachment",
                  attachmentType: "file",
                  fileName: "chart.html",
                  workspacePath: "outbox/generated-artifacts/2026-06-19/chart-abcd1234.html",
                  mimeType: "text/html",
                  sizeBytes: 4096,
                  promptMode: "workspace",
                  caption: "dashboard preview",
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
    expect(frame?.getAttribute("title")).toBe("dashboard preview");
    expect(container.querySelector(".chat-text")).toBeNull();
    expect(container.textContent).toContain("dashboard preview");
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

    frame?.dispatchEvent(new Event("load"));
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "platformclaw:artifact-resize", height: 320.4 },
        source: frame?.contentWindow ?? null,
      }),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(frame?.style.height).toBe("321px");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "platformclaw:artifact-resize", height: 500 },
        source: window,
      }),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(frame?.style.height).toBe("321px");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "platformclaw:artifact-resize", height: 100 },
        source: frame?.contentWindow ?? null,
      }),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(frame?.style.height).toBe("240px");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "platformclaw:artifact-resize", height: 2_000 },
        source: frame?.contentWindow ?? null,
      }),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(frame?.style.height).toBe("900px");
  });

  it("opens and closes an image artifact focus viewer", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const message = {
      role: "assistant",
      timestamp: Date.now(),
      content: [
        {
          type: "attachment",
          attachmentType: "image",
          fileName: "result.png",
          workspacePath: "outbox/generated-artifacts/2026-06-20/result-abcd1234.png",
          mimeType: "image/png",
          promptMode: "workspace",
        },
      ],
    };
    let artifactFocus: Parameters<NonNullable<ChatProps["onOpenArtifact"]>>[0] | null = null;
    const renderView = () => {
      render(
        renderChat(
          createProps({
            messages: [message],
            artifactFocus,
            onOpenArtifact: (artifact) => {
              artifactFocus = artifact;
              renderView();
            },
            onCloseArtifact: () => {
              artifactFocus = null;
              renderView();
            },
          }),
        ),
        container,
      );
    };
    renderView();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const openButton = container.querySelector<HTMLButtonElement>(
      ".chat-artifact-focus-btn--image",
    );
    expect(openButton).not.toBeNull();
    expect(openButton?.classList.contains("artifact-action-btn")).toBe(true);
    expect(openButton?.classList.contains("btn")).toBe(true);
    expect(openButton?.classList.contains("btn--sm")).toBe(true);
    const compactDownload = container.querySelector<HTMLAnchorElement>(
      ".chat-artifact-download-btn--image",
    );
    expect(compactDownload?.classList.contains("artifact-action-btn")).toBe(true);
    expect(compactDownload?.classList.contains("btn")).toBe(true);
    expect(compactDownload?.getAttribute("href")).toContain(
      "path=outbox%2Fgenerated-artifacts%2F2026-06-20%2Fresult-abcd1234.png",
    );
    expect(compactDownload?.getAttribute("href")).not.toContain("inline=1");
    openButton?.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const viewerImage = container.querySelector<HTMLImageElement>(".artifact-focus-viewer__image");
    expect(viewerImage?.getAttribute("src")).toContain(
      "path=outbox%2Fgenerated-artifacts%2F2026-06-20%2Fresult-abcd1234.png",
    );
    expect(viewerImage?.getAttribute("src")).toContain("inline=1");
    const download = container.querySelector<HTMLAnchorElement>(
      ".artifact-focus-viewer__action[href]",
    );
    expect(download?.getAttribute("href")).toContain(
      "path=outbox%2Fgenerated-artifacts%2F2026-06-20%2Fresult-abcd1234.png",
    );
    expect(download?.getAttribute("href")).not.toContain("inline=1");

    container.querySelector<HTMLButtonElement>(".artifact-focus-viewer__close")?.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector(".artifact-focus-viewer")).toBeNull();
    expect(container.querySelector(".chat-message-image")).not.toBeNull();
  });

  it("does not add artifact focus controls to user image attachments", async () => {
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
                {
                  type: "attachment",
                  attachmentType: "image",
                  fileName: "input.png",
                  workspacePath: "inbox/chat-attachments/2026-06-20/input.png",
                  mimeType: "image/png",
                  promptMode: "workspace",
                },
              ],
            },
          ],
          onOpenArtifact: () => undefined,
        }),
      ),
      container,
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(container.querySelector(".chat-message-image")).not.toBeNull();
    expect(container.querySelector(".chat-artifact-focus-btn")).toBeNull();
    expect(container.querySelector(".chat-artifact-download-btn--image")).toBeNull();
  });

  it("keeps assistant image downloads available without a focus viewer callback", async () => {
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
                {
                  type: "attachment",
                  attachmentType: "image",
                  fileName: "standalone.png",
                  workspacePath: "outbox/generated-artifacts/2026-06-20/standalone.png",
                  mimeType: "image/png",
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

    expect(container.querySelector(".chat-artifact-download-btn--image")).not.toBeNull();
    expect(container.querySelector(".chat-artifact-focus-btn")).toBeNull();
  });

  it("keeps multiple image artifact actions bound to their own files", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const opened: string[] = [];
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "assistant",
              timestamp: Date.now(),
              content: [
                {
                  type: "attachment",
                  attachmentType: "image",
                  fileName: "first image.png",
                  workspacePath: "outbox/generated-artifacts/2026-06-20/first image.png",
                  mimeType: "image/png",
                },
                {
                  type: "attachment",
                  attachmentType: "image",
                  fileName: "second#image.png",
                  workspacePath: "outbox/generated-artifacts/2026-06-20/second#image.png",
                  mimeType: "image/png",
                },
              ],
            },
          ],
          onOpenArtifact: (artifact) => opened.push(artifact.workspacePath),
        }),
      ),
      container,
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const downloads = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(".chat-artifact-download-btn--image"),
    );
    const focusButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".chat-artifact-focus-btn--image"),
    );
    expect(downloads).toHaveLength(2);
    expect(focusButtons).toHaveLength(2);
    expect(downloads[0]?.getAttribute("href")).toContain("first%20image.png");
    expect(downloads[1]?.getAttribute("href")).toContain("second%23image.png");

    focusButtons[1]?.click();
    expect(opened).toEqual(["outbox/generated-artifacts/2026-06-20/second#image.png"]);
  });

  it("opens an html artifact focus viewer and closes it with Escape", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const message = {
      role: "assistant",
      timestamp: Date.now(),
      content: [
        {
          type: "attachment",
          attachmentType: "file",
          fileName: "dashboard.html",
          workspacePath: "outbox/generated-artifacts/2026-06-20/dashboard-abcd1234.html",
          mimeType: "text/html",
          promptMode: "workspace",
        },
      ],
    };
    let artifactFocus: Parameters<NonNullable<ChatProps["onOpenArtifact"]>>[0] | null = null;
    const renderView = () => {
      render(
        renderChat(
          createProps({
            messages: [message],
            artifactFocus,
            onOpenArtifact: (artifact) => {
              artifactFocus = artifact;
              renderView();
            },
            onCloseArtifact: () => {
              artifactFocus = null;
              renderView();
            },
          }),
        ),
        container,
      );
    };
    renderView();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const openButton = container.querySelector<HTMLButtonElement>(
      ".chat-message-attachments__html .chat-artifact-focus-btn",
    );
    expect(openButton).not.toBeNull();
    expect(openButton?.classList.contains("artifact-action-btn")).toBe(true);
    expect(openButton?.classList.contains("btn")).toBe(true);
    expect(
      container
        .querySelector(".chat-message-attachments__download")
        ?.classList.contains("artifact-action-btn"),
    ).toBe(true);
    openButton?.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const viewer = container.querySelector<HTMLElement>(".artifact-focus-viewer");
    const frame = container.querySelector<HTMLIFrameElement>(".artifact-focus-viewer__html");
    expect(viewer).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.getAttribute("src")).toContain(
      "path=outbox%2Fgenerated-artifacts%2F2026-06-20%2Fdashboard-abcd1234.html",
    );
    expect(frame?.getAttribute("src")).toContain("inline=1");
    expect(container.querySelector(".artifact-focus-viewer__action[href]")).not.toBeNull();

    viewer?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(container.querySelector(".artifact-focus-viewer")).toBeNull();
    expect(container.querySelector(".chat-message-attachments__html-frame")).not.toBeNull();
  });
});
