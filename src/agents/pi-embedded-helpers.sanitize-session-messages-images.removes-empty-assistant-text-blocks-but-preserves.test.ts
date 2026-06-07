import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  sanitizeGoogleTurnOrdering,
  sanitizeSessionMessagesImages,
} from "./pi-embedded-helpers.js";
import {
  castAgentMessages,
  makeAgentAssistantMessage,
} from "./test-helpers/agent-message-fixtures.js";

let testTimestamp = 1;
const nextTimestamp = () => testTimestamp++;

function makeToolCallResultPairInput(): Array<AssistantMessage | ToolResultMessage> {
  return [
    makeAgentAssistantMessage({
      content: [
        {
          type: "toolCall",
          id: "call_123|fc_456",
          name: "read",
          arguments: { path: "package.json" },
        },
      ],
      model: "gpt-5.4",
      stopReason: "toolUse",
      timestamp: nextTimestamp(),
    }),
    {
      role: "toolResult",
      toolCallId: "call_123|fc_456",
      toolName: "read",
      content: [{ type: "text", text: "ok" }],
      isError: false,
      timestamp: nextTimestamp(),
    },
  ];
}

function makeEmptyAssistantErrorMessage(): AssistantMessage {
  return makeAgentAssistantMessage({
    stopReason: "error",
    content: [],
    model: "gpt-5.4",
    timestamp: nextTimestamp(),
  }) satisfies AssistantMessage;
}

function makeOpenAiResponsesAssistantMessage(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "toolUse",
): AssistantMessage {
  return makeAgentAssistantMessage({
    content,
    model: "gpt-5.4",
    stopReason,
    timestamp: nextTimestamp(),
  });
}

function expectToolCallAndResultIds(out: AgentMessage[], expectedId: string) {
  const assistant = out[0];
  expect(assistant.role).toBe("assistant");
  const assistantContent = assistant.role === "assistant" ? assistant.content : [];
  const toolCall = assistantContent.find((block) => block.type === "toolCall");
  expect(toolCall?.id).toBe(expectedId);

  const toolResult = out[1];
  expect(toolResult.role).toBe("toolResult");
  if (toolResult.role === "toolResult") {
    expect(toolResult.toolCallId).toBe(expectedId);
  }
}

function expectSingleAssistantContentEntry(
  out: AgentMessage[],
  expectEntry: (entry: { type?: string; text?: string }) => void,
) {
  expect(out).toHaveLength(1);
  expect(out[0]?.role).toBe("assistant");
  const content = out[0]?.role === "assistant" ? out[0].content : [];
  expect(content).toHaveLength(1);
  expectEntry((content as Array<{ type?: string; text?: string }>)[0] ?? {});
}

describe("sanitizeSessionMessagesImages", () => {
  it("keeps tool call + tool result IDs unchanged by default", async () => {
    const input = makeToolCallResultPairInput();

    const out = await sanitizeSessionMessagesImages(input, "test");

    expectToolCallAndResultIds(out, "call_123|fc_456");
  });

  it("sanitizes tool call + tool result IDs in strict mode (alphanumeric only)", async () => {
    const input = makeToolCallResultPairInput();

    const out = await sanitizeSessionMessagesImages(input, "test", {
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
    });

    // Strict mode strips all non-alphanumeric characters
    expectToolCallAndResultIds(out, "call123fc456");
  });

  it("does not synthesize tool call input when missing", async () => {
    const input = castAgentMessages([
      makeOpenAiResponsesAssistantMessage([
        { type: "toolCall", id: "call_1", name: "read", arguments: {} },
      ]),
    ]);

    const out = await sanitizeSessionMessagesImages(input, "test");
    const assistant = out[0] as { content?: Array<Record<string, unknown>> };
    const toolCall = assistant.content?.find((b) => b.type === "toolCall");
    expect(toolCall).toBeTruthy();
    expect("input" in (toolCall ?? {})).toBe(false);
  });

  it("downgrades persisted attachment blocks to text metadata for model replay", async () => {
    const input = castAgentMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "see attached" },
          {
            type: "attachment",
            attachmentType: "image",
            fileName: "old.pdf",
            mimeType: "application/pdf",
            workspacePath: "inbox/chat-attachments/2026-06-06/old.pdf",
            promptMode: "workspace",
            sizeBytes: 1234,
          },
        ],
        timestamp: nextTimestamp(),
      },
    ]);

    const out = await sanitizeSessionMessagesImages(input, "session:history");
    const user = out[0] as { content?: Array<{ type?: string; text?: string }> };

    expect(user.content).toHaveLength(2);
    expect(user.content?.[1]?.type).toBe("text");
    expect(user.content?.[1]?.text).toContain("attached file metadata");
    expect(user.content?.[1]?.text).toContain("mime: application/pdf");
    expect(user.content?.[1]?.text).toContain(
      "workspace_path: inbox/chat-attachments/2026-06-06/old.pdf",
    );
  });

  it("restores persisted image attachment blocks as image blocks for model replay", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-image-attachment-"));
    const relPath = "inbox/chat-attachments/2026-06-06/capture.png";
    const absPath = path.join(workspaceDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYoYAAAAASUVORK5CYII=";
    await fs.writeFile(absPath, Buffer.from(pngBase64, "base64"));

    try {
      const input = castAgentMessages([
        {
          role: "user",
          content: [
            { type: "text", text: "see attached" },
            {
              type: "attachment",
              attachmentType: "image",
              fileName: "capture.png",
              mimeType: "image/png",
              workspacePath: relPath,
              promptMode: "image",
              sizeBytes: 68,
            },
          ],
          timestamp: nextTimestamp(),
        },
      ]);

      const out = await sanitizeSessionMessagesImages(input, "session:history", {
        workspaceDir,
      });
      const user = out[0] as { content?: Array<{ type?: string; text?: string; data?: string; mimeType?: string }> };

      expect(user.content).toHaveLength(2);
      expect(user.content?.[0]).toMatchObject({ type: "text", text: "see attached" });
      expect(user.content?.[1]?.type).toBe("image");
      expect(user.content?.[1]?.mimeType).toMatch(/^image\//);
      expect(typeof user.content?.[1]?.data).toBe("string");
      expect(user.content?.[1]?.data?.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("drops internal attachment prompt-only user messages from model replay", async () => {
    const input = castAgentMessages([
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "[Recent image attachment context]\n" +
              "The user may refer to recently uploaded image files in follow-up turns.\n" +
              "[media attached 1/1: inbox/chat-attachments/2026-06-06/capture.png (image/png)]\n\n" +
              "이거 다시 봐줘",
          },
        ],
        timestamp: nextTimestamp(),
      },
      {
        role: "user",
        content:
          "[Attached files metadata]\n" +
          "The user uploaded files into the workspace before sending this message.\n\n" +
          "```yaml\nattachments:\n- name: a.pdf\n```\n\n" +
          "이거 PDF야",
        timestamp: nextTimestamp(),
      },
      {
        role: "user",
        content: "normal user text",
        timestamp: nextTimestamp(),
      },
    ]);

    const out = await sanitizeSessionMessagesImages(input, "session:history");

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      role: "user",
      content: "normal user text",
    });
  });

  it("removes empty assistant text blocks but preserves tool calls", async () => {
    const input = castAgentMessages([
      makeOpenAiResponsesAssistantMessage([
        { type: "text", text: "" },
        { type: "toolCall", id: "call_1", name: "read", arguments: {} },
      ]),
    ]);

    const out = await sanitizeSessionMessagesImages(input, "test");

    expectSingleAssistantContentEntry(out, (entry) => {
      expect(entry.type).toBe("toolCall");
    });
  });

  it("sanitizes tool ids in strict mode (alphanumeric only)", async () => {
    const input = castAgentMessages([
      {
        role: "assistant",
        content: [
          { type: "toolUse", id: "call_abc|item:123", name: "test", input: {} },
          {
            type: "toolCall",
            id: "call_abc|item:456",
            name: "exec",
            arguments: {},
          },
        ],
      },
      {
        role: "toolResult",
        toolUseId: "call_abc|item:123",
        content: [{ type: "text", text: "ok" }],
      },
    ]);

    const out = await sanitizeSessionMessagesImages(input, "test", {
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
    });

    // Strict mode strips all non-alphanumeric characters
    const assistant = out[0] as { content?: Array<{ id?: string }> };
    expect(assistant.content?.[0]?.id).toBe("callabcitem123");
    expect(assistant.content?.[1]?.id).toBe("callabcitem456");

    const toolResult = out[1] as { toolUseId?: string };
    expect(toolResult.toolUseId).toBe("callabcitem123");
  });

  it("sanitizes tool IDs in images-only mode when explicitly enabled", async () => {
    const input = makeToolCallResultPairInput();

    const out = await sanitizeSessionMessagesImages(input, "test", {
      sanitizeMode: "images-only",
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
    });

    const assistant = out[0];
    const toolCall =
      assistant?.role === "assistant"
        ? assistant.content.find((b) => b.type === "toolCall")
        : undefined;
    expect(toolCall?.id).toBe("call123fc456");

    const toolResult = out[1];
    expect(toolResult?.role).toBe("toolResult");
    if (toolResult?.role === "toolResult") {
      expect(toolResult.toolCallId).toBe("call123fc456");
    }
  });
  it("filters whitespace-only assistant text blocks", async () => {
    const input = castAgentMessages([
      {
        role: "assistant",
        content: [
          { type: "text", text: "   " },
          { type: "text", text: "ok" },
        ],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5.4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: nextTimestamp(),
      },
    ]);

    const out = await sanitizeSessionMessagesImages(input, "test");

    expectSingleAssistantContentEntry(out, (entry) => {
      expect(entry.text).toBe("ok");
    });
  });
  it("drops assistant messages that only contain empty text", async () => {
    const input = castAgentMessages([
      { role: "user", content: "hello", timestamp: nextTimestamp() } satisfies UserMessage,
      {
        role: "assistant",
        content: [{ type: "text", text: "" }],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5.4",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: nextTimestamp(),
      } satisfies AssistantMessage,
    ]);

    const out = await sanitizeSessionMessagesImages(input, "test");

    expect(out).toHaveLength(1);
    expect(out[0]?.role).toBe("user");
  });
  it("keeps empty assistant error messages", async () => {
    const input = castAgentMessages([
      { role: "user", content: "hello", timestamp: nextTimestamp() } satisfies UserMessage,
      {
        ...makeEmptyAssistantErrorMessage(),
      },
      {
        ...makeEmptyAssistantErrorMessage(),
      },
    ]);

    const out = await sanitizeSessionMessagesImages(input, "test");

    expect(out).toHaveLength(3);
    expect(out[0]?.role).toBe("user");
    expect(out[1]?.role).toBe("assistant");
    expect(out[2]?.role).toBe("assistant");
  });
  it("leaves non-assistant messages unchanged", async () => {
    const input = [
      { role: "user", content: "hello", timestamp: nextTimestamp() } satisfies UserMessage,
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "read",
        isError: false,
        content: [{ type: "text", text: "result" }],
        timestamp: nextTimestamp(),
      } satisfies ToolResultMessage,
    ];

    const out = await sanitizeSessionMessagesImages(input, "test");

    expect(out).toHaveLength(2);
    expect(out[0]?.role).toBe("user");
    expect(out[1]?.role).toBe("toolResult");
  });

  describe("thought_signature stripping", () => {
    it("strips msg_-prefixed thought_signature from assistant message content blocks", async () => {
      const input = castAgentMessages([
        {
          role: "assistant",
          content: [
            { type: "text", text: "hello", thought_signature: "msg_abc123" },
            {
              type: "thinking",
              thinking: "reasoning",
              thought_signature: "AQID",
            },
          ],
        },
      ]);

      const out = await sanitizeSessionMessagesImages(input, "test");

      expect(out).toHaveLength(1);
      const content = (out[0] as { content?: unknown[] }).content;
      expect(content).toHaveLength(2);
      expect("thought_signature" in ((content?.[0] ?? {}) as object)).toBe(false);
      expect((content?.[1] as { thought_signature?: unknown })?.thought_signature).toBe("AQID");
    });

    it("still strips signatures in images-only mode when replay policy requests it", async () => {
      const input = castAgentMessages([
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "internal", thought_signature: "msg_abc123" },
            { type: "text", text: "visible" },
          ],
        },
      ]);

      const out = await sanitizeSessionMessagesImages(input, "test", {
        sanitizeMode: "images-only",
        sanitizeThoughtSignatures: {
          allowBase64Only: true,
          includeCamelCase: true,
        },
      });

      const content = (out[0] as { content?: Array<{ thought_signature?: unknown }> }).content;
      expect(content).toHaveLength(2);
      expect(content?.[0]?.thought_signature).toBeUndefined();
    });

    it("preserves interleaved thinking block order when signatures are preserved", async () => {
      const input = castAgentMessages([
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "first",
              thought_signature: "sig-1",
            },
            { type: "text", text: "" },
            { type: "text", text: "visible" },
            {
              type: "redacted_thinking",
              data: "opaque",
              thought_signature: "sig-2",
            },
            { type: "text", text: "tail" },
          ],
        },
      ]);

      const out = await sanitizeSessionMessagesImages(input, "test", {
        preserveSignatures: true,
      });

      expect(out).toHaveLength(1);
      const content = (out[0] as { content?: Array<{ type?: string; text?: string }> }).content;
      expect(content?.map((block) => block.type)).toEqual([
        "thinking",
        "text",
        "text",
        "redacted_thinking",
        "text",
      ]);
      expect(content?.[0]).toMatchObject({
        type: "thinking",
        thinking: "first",
        thought_signature: "sig-1",
      });
      expect(content?.[1]).toMatchObject({ type: "text", text: "" });
      expect(content?.[3]).toMatchObject({
        type: "redacted_thinking",
        thought_signature: "sig-2",
      });
    });
  });
});

describe("sanitizeGoogleTurnOrdering", () => {
  it("prepends a synthetic user turn when history starts with assistant", () => {
    const input = castAgentMessages([
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "exec", arguments: {} }],
      },
    ]);

    const out = sanitizeGoogleTurnOrdering(input);
    expect(out[0]?.role).toBe("user");
    expect(out[1]?.role).toBe("assistant");
  });
  it("is a no-op when history starts with user", () => {
    const input = castAgentMessages([{ role: "user", content: "hi" }]);
    const out = sanitizeGoogleTurnOrdering(input);
    expect(out).toBe(input);
  });
});
