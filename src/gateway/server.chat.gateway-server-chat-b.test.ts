import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { GetReplyOptions } from "../auto-reply/types.js";
import { clearConfigCache } from "../config/config.js";
import { __setMaxChatHistoryMessagesBytesForTest } from "./server-constants.js";
import {
  connectOk,
  dispatchInboundMessageMock,
  getReplyFromConfig,
  installGatewayTestHooks,
  mockGetReplyFromConfigOnce,
  onceMessage,
  rpcReq,
  startServerWithClient,
  testState,
  writeSessionStore,
} from "./test-helpers.js";

installGatewayTestHooks({ scope: "suite" });
const FAST_WAIT_OPTS = { timeout: 250, interval: 2 } as const;

const sendReq = (
  ws: { send: (payload: string) => void },
  id: string,
  method: string,
  params: unknown,
) => {
  ws.send(
    JSON.stringify({
      type: "req",
      id,
      method,
      params,
    }),
  );
};

async function withGatewayChatHarness(
  run: (ctx: {
    ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
    createSessionDir: () => Promise<string>;
  }) => Promise<void>,
) {
  const tempDirs: string[] = [];
  const { server, ws } = await startServerWithClient();
  const createSessionDir = async () => {
    const sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-gw-"));
    tempDirs.push(sessionDir);
    testState.sessionStorePath = path.join(sessionDir, "sessions.json");
    return sessionDir;
  };

  try {
    await run({ ws, createSessionDir });
  } finally {
    __setMaxChatHistoryMessagesBytesForTest();
    clearConfigCache();
    testState.sessionStorePath = undefined;
    ws.close();
    await server.close();
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
}

async function writeMainSessionStore() {
  await writeSessionStore({
    entries: {
      main: { sessionId: "sess-main", updatedAt: Date.now() },
    },
  });
}

async function writeGatewayConfig(config: Record<string, unknown>) {
  const configPath = process.env.OPENCLAW_CONFIG_PATH;
  if (!configPath) {
    throw new Error("OPENCLAW_CONFIG_PATH missing in gateway test environment");
  }
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  clearConfigCache();
}

async function writeMainSessionTranscript(sessionDir: string, lines: string[]) {
  await fs.writeFile(path.join(sessionDir, "sess-main.jsonl"), `${lines.join("\n")}\n`, "utf-8");
}

async function fetchHistoryMessages(
  ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"],
  params?: {
    limit?: number;
    maxChars?: number;
  },
): Promise<unknown[]> {
  const historyRes = await rpcReq<{ messages?: unknown[] }>(ws, "chat.history", {
    sessionKey: "main",
    limit: params?.limit ?? 1000,
    ...(typeof params?.maxChars === "number" ? { maxChars: params.maxChars } : {}),
  });
  expect(historyRes.ok).toBe(true);
  return historyRes.payload?.messages ?? [];
}

async function prepareMainHistoryHarness(params: {
  ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
  createSessionDir: () => Promise<string>;
  historyMaxBytes?: number;
}) {
  if (params.historyMaxBytes !== undefined) {
    __setMaxChatHistoryMessagesBytesForTest(params.historyMaxBytes);
  }
  await connectOk(params.ws);
  const sessionDir = await params.createSessionDir();
  await writeMainSessionStore();
  return sessionDir;
}

describe("gateway server chat", () => {
  test("chat.history backfills claude-cli sessions from Claude project files", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);
      const sessionDir = await createSessionDir();
      const originalHome = process.env.HOME;
      const homeDir = path.join(sessionDir, "home");
      const cliSessionId = "5b8b202c-f6bb-4046-9475-d2f15fd07530";
      const claudeProjectsDir = path.join(homeDir, ".claude", "projects", "workspace");
      await fs.mkdir(claudeProjectsDir, { recursive: true });
      await fs.writeFile(
        path.join(claudeProjectsDir, `${cliSessionId}.jsonl`),
        [
          JSON.stringify({
            type: "queue-operation",
            operation: "enqueue",
            timestamp: "2026-03-26T16:29:54.722Z",
            sessionId: cliSessionId,
            content: "[Thu 2026-03-26 16:29 GMT] hi",
          }),
          JSON.stringify({
            type: "user",
            uuid: "user-1",
            timestamp: "2026-03-26T16:29:54.800Z",
            message: {
              role: "user",
              content:
                'Sender (untrusted metadata):\n```json\n{"label":"openclaw-control-ui"}\n```\n\n[Thu 2026-03-26 16:29 GMT] hi',
            },
          }),
          JSON.stringify({
            type: "assistant",
            uuid: "assistant-1",
            timestamp: "2026-03-26T16:29:55.500Z",
            message: {
              role: "assistant",
              model: "claude-sonnet-4-6",
              content: [{ type: "text", text: "hello from Claude" }],
            },
          }),
        ].join("\n"),
        "utf-8",
      );
      process.env.HOME = homeDir;
      try {
        await writeSessionStore({
          entries: {
            main: {
              sessionId: "sess-main",
              updatedAt: Date.now(),
              modelProvider: "claude-cli",
              model: "claude-sonnet-4-6",
              cliSessionBindings: {
                "claude-cli": {
                  sessionId: cliSessionId,
                },
              },
            },
          },
        });

        const messages = await fetchHistoryMessages(ws);
        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({
          role: "user",
          content: "hi",
        });
        expect(messages[1]).toMatchObject({
          role: "assistant",
          provider: "claude-cli",
        });
      } finally {
        if (originalHome === undefined) {
          delete process.env.HOME;
        } else {
          process.env.HOME = originalHome;
        }
      }
    });
  });

  test("smoke: caps history payload and preserves routing metadata", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const historyMaxBytes = 64 * 1024;
      const sessionDir = await prepareMainHistoryHarness({
        ws,
        createSessionDir,
        historyMaxBytes,
      });

      const bigText = "x".repeat(2_000);
      const historyLines: string[] = [];
      for (let i = 0; i < 45; i += 1) {
        historyLines.push(
          JSON.stringify({
            message: {
              role: "user",
              content: [{ type: "text", text: `${i}:${bigText}` }],
              timestamp: Date.now() + i,
            },
          }),
        );
      }
      await writeMainSessionTranscript(sessionDir, historyLines);
      const messages = await fetchHistoryMessages(ws);
      const bytes = Buffer.byteLength(JSON.stringify(messages), "utf8");
      expect(bytes).toBeLessThanOrEqual(historyMaxBytes);
      expect(messages.length).toBeLessThan(45);

      await writeSessionStore({
        entries: {
          main: {
            sessionId: "sess-main",
            updatedAt: Date.now(),
            lastChannel: "whatsapp",
            lastTo: "+1555",
          },
        },
      });

      const sendRes = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-route",
      });
      expect(sendRes.ok).toBe(true);

      const sessionStorePath = testState.sessionStorePath;
      if (!sessionStorePath) {
        throw new Error("expected session store path");
      }
      const stored = JSON.parse(await fs.readFile(sessionStorePath, "utf-8")) as Record<
        string,
        { lastChannel?: string; lastTo?: string } | undefined
      >;
      expect(stored["agent:main:main"]?.lastChannel).toBe("whatsapp");
      expect(stored["agent:main:main"]?.lastTo).toBe("+1555");
    });
  });

  test("chat.send does not force-disable block streaming", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const spy = getReplyFromConfig;
      await connectOk(ws);

      await createSessionDir();
      await writeMainSessionStore();
      testState.agentConfig = { blockStreamingDefault: "on" };
      try {
        let capturedOpts: GetReplyOptions | undefined;
        mockGetReplyFromConfigOnce(async (_ctx, opts) => {
          capturedOpts = opts;
          return undefined;
        });

        const sendRes = await rpcReq(ws, "chat.send", {
          sessionKey: "main",
          message: "hello",
          idempotencyKey: "idem-block-streaming",
        });
        expect(sendRes.ok).toBe(true);

        await vi.waitFor(() => {
          expect(spy.mock.calls.length).toBeGreaterThan(0);
        }, FAST_WAIT_OPTS);

        expect(capturedOpts?.disableBlockStreaming).toBeUndefined();
      } finally {
        testState.agentConfig = undefined;
      }
    });
  });

  test("chat.send materializes assistant artifact delivery blocks as workspace attachments", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);
      const sessionDir = await createSessionDir();
      const workspaceDir = path.join(sessionDir, "workspace");
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.writeFile(path.join(workspaceDir, "plot.png"), "plot image");
      await writeGatewayConfig({
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
      });
      await writeMainSessionStore();

      const artifactPayload = {
        text: "그래프 생성했습니다.",
        mediaUrls: ["./plot.png"],
        assistantArtifactDelivery: true,
      };
      dispatchInboundMessageMock.mockImplementationOnce(async (...args: unknown[]) => {
        const [params] = args as [
          {
            dispatcher: {
              sendBlockReply: (payload: {
                text?: string;
                mediaUrls: string[];
                assistantArtifactDelivery: boolean;
                assistantArtifact?: { caption?: string; deliveryId?: string };
              }) => boolean;
              sendFinalReply: (payload: { text: string }) => boolean;
              markComplete: () => void;
              waitForIdle: () => Promise<void>;
              getQueuedCounts: () => { final: number; block: number; tool: number };
            };
          },
        ];
        params.dispatcher.sendBlockReply(artifactPayload);
        params.dispatcher.sendFinalReply({ text: "완료했습니다." });
        params.dispatcher.markComplete();
        await params.dispatcher.waitForIdle();
        return {
          queuedFinal: true,
          counts: params.dispatcher.getQueuedCounts(),
        };
      });

      const finalPromise = onceMessage<{
        type?: string;
        event?: string;
        payload?: {
          state?: string;
          runId?: string;
          message?: { role?: string; content?: unknown[] };
        };
      }>(
        ws,
        (o) =>
          o.type === "event" &&
          o.event === "chat" &&
          o.payload?.state === "final" &&
          o.payload?.runId === "idem-artifact-1",
        8000,
      );

      const sendRes = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "make plot",
        idempotencyKey: "idem-artifact-1",
      });
      expect(sendRes.ok).toBe(true);

      const finalEvent = await finalPromise;
      expect(finalEvent.payload?.message?.content).toEqual([
        expect.objectContaining({ type: "text", text: "완료했습니다." }),
      ]);
      expect(artifactPayload.mediaUrls).toEqual(["./plot.png"]);
      await expect(fs.readFile(path.join(workspaceDir, "plot.png"), "utf-8")).resolves.toBe(
        "plot image",
      );
      const messages = await fetchHistoryMessages(ws);
      const artifactMessage = messages.find((message) => {
        const content = (message as { content?: unknown }).content;
        return (
          Array.isArray(content) &&
          content.some(
            (block) =>
              block &&
              typeof block === "object" &&
              (block as { type?: unknown }).type === "attachment",
          )
        );
      }) as { content?: unknown[] } | undefined;
      const attachment = artifactMessage?.content?.find(
        (block) =>
          block && typeof block === "object" && (block as { type?: unknown }).type === "attachment",
      ) as Record<string, unknown> | undefined;
      expect(attachment).toMatchObject({
        attachmentType: "image",
        fileName: "plot.png",
        mimeType: "image/png",
        promptMode: "workspace",
      });
      expect(attachment?.workspacePath).toMatch(
        /^outbox\/generated-artifacts\/\d{4}-\d{2}-\d{2}\/plot-[a-f0-9]{8}\.png$/,
      );
      await expect(
        fs.readFile(path.join(workspaceDir, String(attachment?.workspacePath)), "utf-8"),
      ).resolves.toBe("plot image");
      expect(artifactMessage).toMatchObject({
        role: "assistant",
        content: [expect.objectContaining({ workspacePath: attachment?.workspacePath })],
      });
    });
  });

  test("chat.send skips only a failed artifact and keeps later artifacts and final text", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);
      const sessionDir = await createSessionDir();
      const workspaceDir = path.join(sessionDir, "workspace");
      await fs.mkdir(workspaceDir, { recursive: true });
      const sourcePath = path.join(workspaceDir, "plot.png");
      const hardlinkPath = path.join(workspaceDir, "plot-hardlink.png");
      await fs.writeFile(sourcePath, "plot image");
      await fs.link(sourcePath, hardlinkPath);
      await fs.writeFile(path.join(workspaceDir, "result.txt"), "result");
      await writeGatewayConfig({
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
      });
      await writeMainSessionStore();

      dispatchInboundMessageMock.mockImplementationOnce(async (...args: unknown[]) => {
        const [params] = args as [
          {
            dispatcher: {
              sendBlockReply: (payload: {
                text: string;
                mediaUrls: string[];
                assistantArtifactDelivery: boolean;
              }) => boolean;
              sendFinalReply: (payload: { text: string }) => boolean;
              markComplete: () => void;
              waitForIdle: () => Promise<void>;
              getQueuedCounts: () => { final: number; block: number; tool: number };
            };
          },
        ];
        params.dispatcher.sendBlockReply({
          text: "텍스트는 유지됩니다.",
          mediaUrls: ["./plot-hardlink.png"],
          assistantArtifactDelivery: true,
        });
        params.dispatcher.sendBlockReply({
          text: "caption must not become body text",
          mediaUrls: ["./result.txt"],
          assistantArtifactDelivery: true,
        });
        params.dispatcher.sendFinalReply({ text: "완료했습니다." });
        params.dispatcher.markComplete();
        await params.dispatcher.waitForIdle();
        return {
          queuedFinal: true,
          counts: params.dispatcher.getQueuedCounts(),
        };
      });

      const finalPromise = onceMessage<{
        type?: string;
        event?: string;
        payload?: {
          state?: string;
          runId?: string;
          message?: { role?: string; content?: unknown[] };
        };
      }>(
        ws,
        (o) =>
          o.type === "event" &&
          o.event === "chat" &&
          o.payload?.state === "final" &&
          o.payload?.runId === "idem-artifact-fail-1",
        8000,
      );

      const sendRes = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "make plot",
        idempotencyKey: "idem-artifact-fail-1",
      });
      expect(sendRes.ok).toBe(true);

      const finalEvent = await finalPromise;
      expect(finalEvent.payload?.message?.content).toEqual([
        expect.objectContaining({ type: "text", text: "완료했습니다." }),
      ]);

      const messages = await fetchHistoryMessages(ws);
      const artifactMessages = messages.filter((message) => {
        const content = (message as { content?: unknown }).content;
        return (
          Array.isArray(content) &&
          content.some(
            (block) =>
              block &&
              typeof block === "object" &&
              (block as { type?: unknown }).type === "attachment",
          )
        );
      }) as Array<{ content?: unknown[] }>;
      expect(artifactMessages).toHaveLength(1);
      expect(artifactMessages[0]?.content).toEqual([
        expect.objectContaining({
          type: "attachment",
          fileName: "result.txt",
          mimeType: "text/plain",
        }),
      ]);
    });
  });

  test("chat.send preserves mixed assistant artifact messages and final text in history order", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);
      const sessionDir = await createSessionDir();
      const workspaceDir = path.join(sessionDir, "workspace");
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.writeFile(path.join(workspaceDir, "result.txt"), "result");
      await fs.writeFile(path.join(workspaceDir, "report.pdf"), "%PDF-1.4\n%%EOF\n");
      await fs.writeFile(path.join(workspaceDir, "graph.png"), "graph image");
      await fs.writeFile(path.join(workspaceDir, "dashboard.html"), "<h1>Dashboard</h1>");
      await writeGatewayConfig({
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
      });
      await writeMainSessionStore();

      dispatchInboundMessageMock.mockImplementationOnce(async (...args: unknown[]) => {
        const [params] = args as [
          {
            dispatcher: {
              sendBlockReply: (payload: {
                text?: string;
                mediaUrls: string[];
                assistantArtifactDelivery: boolean;
                assistantArtifact?: { caption?: string; deliveryId?: string };
              }) => boolean;
              sendFinalReply: (payload: { text: string }) => boolean;
              markComplete: () => void;
              waitForIdle: () => Promise<void>;
              getQueuedCounts: () => { final: number; block: number; tool: number };
            };
          },
        ];
        params.dispatcher.sendBlockReply({
          mediaUrls: ["./result.txt"],
          assistantArtifactDelivery: true,
          assistantArtifact: { caption: "raw result", deliveryId: "artifact-1" },
        });
        params.dispatcher.sendBlockReply({
          mediaUrls: ["./report.pdf"],
          assistantArtifactDelivery: true,
          assistantArtifact: { deliveryId: "artifact-2" },
        });
        params.dispatcher.sendBlockReply({
          mediaUrls: ["./graph.png"],
          assistantArtifactDelivery: true,
          assistantArtifact: { caption: "latency graph", deliveryId: "artifact-3" },
        });
        params.dispatcher.sendBlockReply({
          mediaUrls: ["./dashboard.html"],
          assistantArtifactDelivery: true,
          assistantArtifact: { deliveryId: "artifact-4" },
        });
        params.dispatcher.sendFinalReply({ text: "위 파일들을 생성해서 첨부했어." });
        params.dispatcher.markComplete();
        await params.dispatcher.waitForIdle();
        return {
          queuedFinal: true,
          counts: params.dispatcher.getQueuedCounts(),
        };
      });

      const finalPromise = onceMessage<{
        type?: string;
        event?: string;
        payload?: {
          state?: string;
          runId?: string;
          message?: { role?: string; content?: unknown[] };
        };
      }>(
        ws,
        (o) =>
          o.type === "event" &&
          o.event === "chat" &&
          o.payload?.state === "final" &&
          o.payload?.runId === "idem-artifact-order-1",
        8000,
      );

      const sendRes = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "run two tests",
        idempotencyKey: "idem-artifact-order-1",
      });
      expect(sendRes.ok).toBe(true);
      await finalPromise;

      const messages = await fetchHistoryMessages(ws);
      const assistantMessages = messages.filter(
        (message): message is { role?: string; content?: unknown[] } =>
          Boolean(
            message &&
            typeof message === "object" &&
            (message as { role?: unknown }).role === "assistant" &&
            Array.isArray((message as { content?: unknown }).content),
          ),
      );
      const delivered = assistantMessages.filter((message) =>
        message.content?.some(
          (block) =>
            block &&
            typeof block === "object" &&
            (block as { type?: unknown }).type === "attachment",
        ),
      );

      expect(delivered).toHaveLength(4);
      expect(delivered.map((message) => message.content?.[0])).toEqual([
        expect.objectContaining({
          type: "attachment",
          attachmentType: "file",
          fileName: "result.txt",
          mimeType: "text/plain",
          caption: "raw result",
        }),
        expect.objectContaining({
          type: "attachment",
          attachmentType: "file",
          fileName: "report.pdf",
          mimeType: "application/pdf",
        }),
        expect.objectContaining({
          type: "attachment",
          attachmentType: "image",
          fileName: "graph.png",
          mimeType: "image/png",
          caption: "latency graph",
        }),
        expect.objectContaining({
          type: "attachment",
          attachmentType: "file",
          fileName: "dashboard.html",
          mimeType: "text/html",
        }),
      ]);
      expect(delivered.every((message) => message.content?.length === 1)).toBe(true);
      expect(
        delivered.some((message) =>
          message.content?.some(
            (block) =>
              block && typeof block === "object" && (block as { type?: unknown }).type === "text",
          ),
        ),
      ).toBe(false);
      expect(assistantMessages.at(-1)?.content).toEqual([
        expect.objectContaining({ type: "text", text: "위 파일들을 생성해서 첨부했어." }),
      ]);
    });
  });

  test("chat.send does not materialize existing ReplyPayload mediaUrls without artifact marker", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);
      const sessionDir = await createSessionDir();
      const workspaceDir = path.join(sessionDir, "workspace");
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.writeFile(path.join(workspaceDir, "plot.png"), "plot image");
      await writeGatewayConfig({
        agents: {
          defaults: {
            workspace: workspaceDir,
          },
        },
      });
      await writeMainSessionStore();

      dispatchInboundMessageMock.mockImplementationOnce(async (...args: unknown[]) => {
        const [params] = args as [
          {
            dispatcher: {
              sendFinalReply: (payload: { text: string; mediaUrls?: string[] }) => boolean;
              markComplete: () => void;
              waitForIdle: () => Promise<void>;
              getQueuedCounts: () => { final: number; block: number; tool: number };
            };
          },
        ];
        params.dispatcher.sendFinalReply({
          text: "붙였습니다.",
          mediaUrls: ["./plot.png"],
        });
        params.dispatcher.markComplete();
        await params.dispatcher.waitForIdle();
        return {
          queuedFinal: true,
          counts: params.dispatcher.getQueuedCounts(),
        };
      });

      const finalPromise = onceMessage<{
        type?: string;
        event?: string;
        payload?: {
          state?: string;
          runId?: string;
          message?: { role?: string; content?: unknown[] };
        };
      }>(
        ws,
        (o) =>
          o.type === "event" &&
          o.event === "chat" &&
          o.payload?.state === "final" &&
          o.payload?.runId === "idem-tool-artifact-1",
        8000,
      );

      const sendRes = await rpcReq(ws, "chat.send", {
        sessionKey: "main",
        message: "make plot",
        idempotencyKey: "idem-tool-artifact-1",
      });
      expect(sendRes.ok).toBe(true);

      const finalEvent = await finalPromise;
      const content = finalEvent.payload?.message?.content ?? [];
      expect(content).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: "text", text: "붙였습니다." })]),
      );
      expect(content.some((block) => (block as { type?: unknown })?.type === "attachment")).toBe(
        false,
      );

      const messages = await fetchHistoryMessages(ws);
      expect(messages.at(-1)).toMatchObject({
        role: "assistant",
        content: [expect.objectContaining({ type: "text", text: "붙였습니다." })],
      });
    });
  });

  test("chat.history hard-caps single oversized nested payloads", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const historyMaxBytes = 64 * 1024;
      const sessionDir = await prepareMainHistoryHarness({
        ws,
        createSessionDir,
        historyMaxBytes,
      });

      const hugeNestedText = "n".repeat(120_000);
      const oversizedLine = JSON.stringify({
        message: {
          role: "assistant",
          timestamp: Date.now(),
          content: [
            {
              type: "tool_result",
              toolUseId: "tool-1",
              output: {
                nested: {
                  payload: hugeNestedText,
                },
              },
            },
          ],
        },
      });
      await writeMainSessionTranscript(sessionDir, [oversizedLine]);
      const messages = await fetchHistoryMessages(ws);
      expect(messages.length).toBe(1);

      const serialized = JSON.stringify(messages);
      const bytes = Buffer.byteLength(serialized, "utf8");
      expect(bytes).toBeLessThanOrEqual(historyMaxBytes);
      expect(serialized).toContain("[chat.history omitted: message too large]");
      expect(serialized.includes(hugeNestedText.slice(0, 256))).toBe(false);
    });
  });

  test("chat.history keeps recent small messages when latest message is oversized", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const historyMaxBytes = 64 * 1024;
      const sessionDir = await prepareMainHistoryHarness({
        ws,
        createSessionDir,
        historyMaxBytes,
      });

      const baseText = "s".repeat(1_200);
      const lines: string[] = [];
      for (let i = 0; i < 30; i += 1) {
        lines.push(
          JSON.stringify({
            message: {
              role: "user",
              timestamp: Date.now() + i,
              content: [{ type: "text", text: `small-${i}:${baseText}` }],
            },
          }),
        );
      }

      const hugeNestedText = "z".repeat(120_000);
      lines.push(
        JSON.stringify({
          message: {
            role: "assistant",
            timestamp: Date.now() + 1_000,
            content: [
              {
                type: "tool_result",
                toolUseId: "tool-1",
                output: {
                  nested: {
                    payload: hugeNestedText,
                  },
                },
              },
            ],
          },
        }),
      );

      await writeMainSessionTranscript(sessionDir, lines);
      const messages = await fetchHistoryMessages(ws);
      const serialized = JSON.stringify(messages);
      const bytes = Buffer.byteLength(serialized, "utf8");

      expect(bytes).toBeLessThanOrEqual(historyMaxBytes);
      expect(messages.length).toBeGreaterThan(1);
      expect(serialized).toContain("small-29:");
      expect(serialized).toContain("[chat.history omitted: message too large]");
      expect(serialized.includes(hugeNestedText.slice(0, 256))).toBe(false);
    });
  });

  test("chat.history preserves usage and cost metadata for assistant messages", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);

      const sessionDir = await createSessionDir();
      await writeMainSessionStore();

      await writeMainSessionTranscript(sessionDir, [
        JSON.stringify({
          message: {
            role: "assistant",
            timestamp: Date.now(),
            content: [{ type: "text", text: "hello" }],
            usage: { input: 12, output: 5, totalTokens: 17 },
            cost: { total: 0.0123 },
            details: { debug: true },
          },
        }),
      ]);

      const messages = await fetchHistoryMessages(ws);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        role: "assistant",
        usage: { input: 12, output: 5, totalTokens: 17 },
        cost: { total: 0.0123 },
      });
      expect(messages[0]).not.toHaveProperty("details");
    });
  });

  test("chat.history strips inline directives from displayed message text", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);

      const sessionDir = await createSessionDir();
      await writeMainSessionStore();

      const lines = [
        JSON.stringify({
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Hello [[reply_to_current]] world [[audio_as_voice]]" },
            ],
            timestamp: Date.now(),
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            content: "A [[reply_to:abc-123]] B",
            timestamp: Date.now() + 1,
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            text: "[[ reply_to : 456 ]] C",
            timestamp: Date.now() + 2,
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "  keep padded  " }],
            timestamp: Date.now() + 3,
          },
        }),
      ];
      await writeMainSessionTranscript(sessionDir, lines);
      const messages = await fetchHistoryMessages(ws);
      expect(messages.length).toBe(4);

      const serialized = JSON.stringify(messages);
      expect(serialized.includes("[[reply_to")).toBe(false);
      expect(serialized.includes("[[audio_as_voice]]")).toBe(false);

      const first = messages[0] as { content?: Array<{ text?: string }> };
      const second = messages[1] as { content?: string };
      const third = messages[2] as { text?: string };
      const fourth = messages[3] as { content?: Array<{ text?: string }> };

      expect(first.content?.[0]?.text?.replace(/\s+/g, " ").trim()).toBe("Hello world");
      expect(second.content?.replace(/\s+/g, " ").trim()).toBe("A B");
      expect(third.text?.replace(/\s+/g, " ").trim()).toBe("C");
      expect(fourth.content?.[0]?.text).toBe("  keep padded  ");
    });
  });

  test("chat.history hides internal attachment metadata prompt duplicates", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);

      const sessionDir = await createSessionDir();
      await writeMainSessionStore();

      const timestamp = Date.now();
      await writeMainSessionTranscript(sessionDir, [
        JSON.stringify({
          message: {
            role: "user",
            content: [
              { type: "text", text: "이거 PDF보여?" },
              {
                type: "attachment",
                attachmentType: "file",
                fileName: "2025세금.pdf",
                storedFileName: "2025_5.pdf",
                workspacePath: "inbox/chat-attachments/2026-06-06/2025_5.pdf",
                mimeType: "application/pdf",
                sizeBytes: 237568,
                promptMode: "workspace",
              },
            ],
            timestamp,
          },
        }),
        JSON.stringify({
          message: {
            role: "user",
            content:
              "[Attached files metadata]\n" +
              "The user uploaded files into the workspace before sending this message.\n" +
              "Use the metadata below. Open workspace files when deeper inspection is needed.\n\n" +
              "```yaml\n" +
              "attachments:\n" +
              "- name: 2025세금.pdf\n" +
              "  type: file\n" +
              "  mime: application/pdf\n" +
              "  size: 232 KB\n" +
              "  workspace_path: inbox/chat-attachments/2026-06-06/2025_5.pdf\n" +
              "  stored_name: 2025_5.pdf\n" +
              "  handling: workspace\n" +
              "```\n\n" +
              "이거 PDF보여?",
            timestamp: timestamp + 1,
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "보입니다." }],
            timestamp: timestamp + 2,
          },
        }),
      ]);

      const messages = await fetchHistoryMessages(ws);
      expect(messages).toHaveLength(2);
      expect(JSON.stringify(messages)).not.toContain("[Attached files metadata]");
      expect(JSON.stringify(messages)).toContain("2025세금.pdf");
      expect(JSON.stringify(messages)).toContain("이거 PDF보여?");
    });
  });

  test("chat.history hides internal recent image attachment prompt duplicates", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await connectOk(ws);

      const sessionDir = await createSessionDir();
      await writeMainSessionStore();

      const timestamp = Date.now();
      await writeMainSessionTranscript(sessionDir, [
        JSON.stringify({
          message: {
            role: "user",
            content: [
              { type: "text", text: "이거 보여?" },
              {
                type: "attachment",
                attachmentType: "image",
                fileName: "capture.png",
                workspacePath: "inbox/chat-attachments/2026-06-06/capture.png",
                mimeType: "image/png",
                sizeBytes: 12000,
                promptMode: "image",
              },
            ],
            timestamp,
          },
        }),
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "보입니다." }],
            timestamp: timestamp + 1,
          },
        }),
        JSON.stringify({
          message: {
            role: "user",
            content: "거기서 내용 수정하려면 어떻게 해야해?",
            timestamp: timestamp + 2,
          },
        }),
        JSON.stringify({
          message: {
            role: "user",
            content:
              "[Recent image attachment context]\n" +
              "The user may refer to recently uploaded image files in follow-up turns.\n" +
              "Re-open these workspace images if the current message refers to them.\n" +
              "[media attached 1/1: inbox/chat-attachments/2026-06-06/capture.png (image/png)]\n\n" +
              "거기서 내용 수정하려면 어떻게 해야해?",
            timestamp: timestamp + 3,
          },
        }),
      ]);

      const messages = await fetchHistoryMessages(ws);
      expect(messages).toHaveLength(3);
      expect(JSON.stringify(messages)).not.toContain("[Recent image attachment context]");
      expect(JSON.stringify(messages)).toContain("capture.png");
      expect(JSON.stringify(messages)).toContain("거기서 내용 수정하려면 어떻게 해야해?");
    });
  });

  test("chat.history applies gateway.webchat.chatHistoryMaxChars from config", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await writeGatewayConfig({
        gateway: {
          webchat: {
            chatHistoryMaxChars: 5,
          },
        },
      });
      const sessionDir = await prepareMainHistoryHarness({ ws, createSessionDir });
      await writeMainSessionTranscript(sessionDir, [
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "abcdefghij" }],
            timestamp: Date.now(),
          },
        }),
      ]);

      const messages = await fetchHistoryMessages(ws);
      expect(JSON.stringify(messages)).toContain("abcde\\n...(truncated)...");
    });
  });

  test("chat.history prefers RPC maxChars over config", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await writeGatewayConfig({
        gateway: {
          webchat: {
            chatHistoryMaxChars: 3,
          },
        },
      });
      const sessionDir = await prepareMainHistoryHarness({ ws, createSessionDir });
      await writeMainSessionTranscript(sessionDir, [
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "abcdefghij" }],
            timestamp: Date.now(),
          },
        }),
      ]);

      const messages = await fetchHistoryMessages(ws, { maxChars: 7 });
      const serialized = JSON.stringify(messages);
      expect(serialized).toContain("abcdefg\\n...(truncated)...");
      expect(serialized).not.toContain("abc\\n...(truncated)...");
    });
  });

  test("chat.history rejects invalid RPC maxChars values", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      await prepareMainHistoryHarness({ ws, createSessionDir });

      const zeroRes = await rpcReq(ws, "chat.history", {
        sessionKey: "main",
        maxChars: 0,
      });
      expect(zeroRes.ok).toBe(false);
      expect((zeroRes.error as { message?: string } | undefined)?.message ?? "").toMatch(
        /invalid chat\.history params/i,
      );

      const tooLargeRes = await rpcReq(ws, "chat.history", {
        sessionKey: "main",
        maxChars: 500_001,
      });
      expect(tooLargeRes.ok).toBe(false);
      expect((tooLargeRes.error as { message?: string } | undefined)?.message ?? "").toMatch(
        /invalid chat\.history params/i,
      );
    });
  });

  test("chat.history still drops assistant NO_REPLY entries before truncation", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const sessionDir = await prepareMainHistoryHarness({ ws, createSessionDir });
      await writeMainSessionTranscript(sessionDir, [
        JSON.stringify({
          message: {
            role: "assistant",
            content: [{ type: "text", text: "NO_REPLY" }],
            timestamp: Date.now(),
          },
        }),
      ]);

      const messages = await fetchHistoryMessages(ws, { maxChars: 3 });
      expect(messages).toEqual([]);
    });
  });

  test("dedupes in-flight, completed, and terminal-failure chat retries by idempotency key", async () => {
    await withGatewayChatHarness(async ({ ws, createSessionDir }) => {
      const spy = getReplyFromConfig;
      let aborted = false;
      await connectOk(ws);

      await createSessionDir();
      await writeMainSessionStore();

      mockGetReplyFromConfigOnce(async (_ctx, opts) => {
        opts?.onAgentRunStart?.(opts.runId ?? "idem-abort-1");
        const signal = opts?.abortSignal;
        await new Promise<void>((resolve) => {
          if (!signal || signal.aborted) {
            aborted = Boolean(signal?.aborted);
            resolve();
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
        return undefined;
      });

      const sendResP = onceMessage(ws, (o) => o.type === "res" && o.id === "send-abort-1", 2_000);
      sendReq(ws, "send-abort-1", "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-abort-1",
        timeoutMs: 30_000,
      });

      const sendRes = await sendResP;
      expect(sendRes.ok).toBe(true);
      await vi.waitFor(() => {
        expect(spy.mock.calls.length).toBeGreaterThan(0);
      }, FAST_WAIT_OPTS);

      const inFlight = await rpcReq<{ status?: string }>(ws, "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-abort-1",
      });
      expect(inFlight.ok).toBe(true);
      expect(["started", "in_flight", "ok"]).toContain(inFlight.payload?.status ?? "");
      // Reusing a key whose acknowledgement may have been lost must not start another agent run.
      expect(spy).toHaveBeenCalledTimes(1);

      const abortRes = await rpcReq<{ aborted?: boolean }>(ws, "chat.abort", {
        sessionKey: "main",
        runId: "idem-abort-1",
      });
      expect(abortRes.ok).toBe(true);
      expect(abortRes.payload?.aborted).toBe(true);
      await vi.waitFor(() => {
        expect(aborted).toBe(true);
      }, FAST_WAIT_OPTS);

      spy.mockClear();
      spy.mockResolvedValueOnce(undefined);

      const completeRes = await rpcReq<{ status?: string }>(ws, "chat.send", {
        sessionKey: "main",
        message: "hello",
        idempotencyKey: "idem-complete-1",
      });
      expect(completeRes.ok).toBe(true);

      await vi.waitFor(async () => {
        const again = await rpcReq<{ status?: string }>(ws, "chat.send", {
          sessionKey: "main",
          message: "hello",
          idempotencyKey: "idem-complete-1",
        });
        expect(again.ok).toBe(true);
        expect(again.payload?.status).toBe("ok");
      }, FAST_WAIT_OPTS);

      spy.mockClear();
      const timeoutError = Object.assign(new Error("upstream request timed out"), {
        name: "TimeoutError",
      });
      spy.mockRejectedValueOnce(timeoutError);
      const errorEventP = onceMessage(
        ws,
        (o) =>
          o.type === "event" &&
          o.event === "chat" &&
          (o.payload as { runId?: string; state?: string } | undefined)?.runId ===
            "idem-timeout-1" &&
          (o.payload as { state?: string } | undefined)?.state === "error",
        2_000,
      );
      const timeoutAck = await rpcReq<{ status?: string }>(ws, "chat.send", {
        sessionKey: "main",
        message: "timeout",
        idempotencyKey: "idem-timeout-1",
      });
      expect(timeoutAck.ok).toBe(true);
      await errorEventP;
      expect(spy).toHaveBeenCalledTimes(1);

      const cachedTimeout = await rpcReq<{ status?: string }>(ws, "chat.send", {
        sessionKey: "main",
        message: "timeout",
        idempotencyKey: "idem-timeout-1",
      });
      expect(cachedTimeout.ok).toBe(false);
      // A terminal runtime failure is cached under the original key and is never re-executed.
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockResolvedValueOnce(undefined);
      // An explicit retry after terminal failure needs a new key to start a new agent run.
      const retryAck = await rpcReq<{ status?: string }>(ws, "chat.send", {
        sessionKey: "main",
        message: "timeout",
        idempotencyKey: "idem-timeout-2",
      });
      expect(retryAck.ok).toBe(true);
      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(2);
      }, FAST_WAIT_OPTS);
    });
  });
});
