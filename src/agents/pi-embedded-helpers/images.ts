import type { AgentMessage, AgentToolResult } from "@mariozechner/pi-agent-core";
import path from "node:path";
import { logImagePayloadDebug, summarizeImagePayload } from "../../infra/image-payload-debug.js";
import { loadWebMedia } from "../../media/web-media.js";
import type { ImageSanitizationLimits } from "../image-sanitization.js";
import { assertSandboxPath } from "../sandbox-paths.js";
import type { ToolCallIdMode } from "../tool-call-id.js";
import { sanitizeToolCallIdsForCloudCodeAssist } from "../tool-call-id.js";
import { sanitizeContentBlocksImages } from "../tool-images.js";
import { stripThoughtSignatures } from "./bootstrap.js";

type ContentBlock = AgentToolResult<unknown>["content"][number];

type SessionMediaBlockDebugEntry = {
  messageIndex: number;
  contentIndex: number;
  role?: string;
  type?: string;
  mimeType?: string;
  fileName?: string;
  summary: ReturnType<typeof summarizeImagePayload>;
};

function readBlockMimeType(block: Record<string, unknown>): string | undefined {
  return typeof block.mimeType === "string"
    ? block.mimeType
    : typeof block.media_type === "string"
      ? block.media_type
      : undefined;
}

function readBlockPayload(block: Record<string, unknown>): unknown {
  if (typeof block.data === "string") {
    return block.data;
  }
  if (typeof block.content === "string") {
    return block.content;
  }
  if (block.source && typeof block.source === "object") {
    const source = block.source as Record<string, unknown>;
    if (typeof source.data === "string") {
      return source.data;
    }
    if (typeof source.url === "string") {
      return source.url;
    }
  }
  if (typeof block.workspacePath === "string") {
    return block.workspacePath;
  }
  return undefined;
}

function collectSessionMediaBlockDebugEntries(
  messages: AgentMessage[],
): SessionMediaBlockDebugEntry[] {
  const entries: SessionMediaBlockDebugEntry[] = [];
  messages.forEach((message, messageIndex) => {
    if (!message || typeof message !== "object") {
      return;
    }
    const role = typeof (message as { role?: unknown }).role === "string"
      ? String((message as { role?: unknown }).role)
      : undefined;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      return;
    }
    content.forEach((block, contentIndex) => {
      if (!block || typeof block !== "object") {
        return;
      }
      const record = block as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : undefined;
      if (type !== "image" && type !== "attachment") {
        return;
      }
      entries.push({
        messageIndex,
        contentIndex,
        role,
        type,
        mimeType: readBlockMimeType(record),
        fileName: typeof record.fileName === "string" ? record.fileName : undefined,
        summary: summarizeImagePayload(readBlockPayload(record)),
      });
    });
  });
  return entries;
}

function formatCompactMediaBlockEntries(entries: SessionMediaBlockDebugEntry[]): string {
  if (entries.length === 0) {
    return "none";
  }
  return entries
    .slice(0, 12)
    .map(
      (entry) =>
        `m${entry.messageIndex}c${entry.contentIndex}:${entry.role ?? "?"}/${entry.type ?? "?"}` +
        `:${entry.mimeType ?? entry.summary.mimeType ?? "no-mime"}` +
        (entry.fileName ? `:${entry.fileName}` : "") +
        `:${entry.summary.kind}`,
    )
    .join("|");
}

function logSessionMediaBlocksDebug(params: {
  stage: "before" | "after";
  label: string;
  messages: AgentMessage[];
  beforeCount?: number;
}) {
  const entries = collectSessionMediaBlockDebugEntries(params.messages);
  logImagePayloadDebug({
    stage: `agent.session-history.media-blocks.${params.stage}`,
    note:
      `label=${params.label} messages=${params.messages.length} mediaBlocks=${entries.length}` +
      (typeof params.beforeCount === "number" ? ` beforeMediaBlocks=${params.beforeCount}` : "") +
      ` blocks=${formatCompactMediaBlockEntries(entries)}`,
    entries: entries.map((entry, index) => ({
      index,
      mimeType: entry.mimeType,
      summary: {
        ...entry.summary,
        prefix:
          `message[${entry.messageIndex}].content[${entry.contentIndex}] ` +
          `role=${entry.role ?? "unknown"} type=${entry.type ?? "unknown"} ` +
          (entry.fileName ? `file=${entry.fileName} ` : "") +
          (entry.summary.prefix ?? ""),
      },
    })),
    allowEmpty: true,
  });
}

function isAttachmentBlock(block: unknown): block is Record<string, unknown> & {
  type: "attachment";
} {
  return (
    Boolean(block) &&
    typeof block === "object" &&
    (block as { type?: unknown }).type === "attachment"
  );
}

function isImageAttachmentBlock(block: Record<string, unknown>): boolean {
  const attachmentType =
    typeof block.attachmentType === "string" ? block.attachmentType.toLowerCase() : "";
  const mimeType = typeof block.mimeType === "string" ? block.mimeType.toLowerCase() : "";
  return attachmentType === "image" && mimeType.startsWith("image/");
}

async function imageAttachmentBlockToImage(
  block: Record<string, unknown>,
  options?: { workspaceDir?: string; maxBytes?: number },
): Promise<ContentBlock | null> {
  if (!isImageAttachmentBlock(block) || typeof block.workspacePath !== "string") {
    return null;
  }
  const workspaceDir = options?.workspaceDir;
  if (!workspaceDir) {
    return null;
  }
  const workspacePath = block.workspacePath.trim();
  if (!workspacePath || path.isAbsolute(workspacePath)) {
    return null;
  }
  const root = path.resolve(workspaceDir);
  const absolutePath = path.resolve(root, workspacePath);
  await assertSandboxPath({ filePath: absolutePath, cwd: root, root });
  const media = await loadWebMedia(absolutePath, {
    maxBytes: options?.maxBytes,
    localRoots: [root],
  });
  if (media.kind !== "image") {
    return null;
  }
  return {
    type: "image",
    data: media.buffer.toString("base64"),
    mimeType:
      media.contentType ?? (typeof block.mimeType === "string" ? block.mimeType : "image/jpeg"),
  } as ContentBlock;
}

function attachmentBlockToText(block: Record<string, unknown>, label: string): ContentBlock {
  const fileName = typeof block.fileName === "string" ? block.fileName : "attachment";
  const attachmentType = typeof block.attachmentType === "string" ? block.attachmentType : "file";
  const mimeType = typeof block.mimeType === "string" ? block.mimeType : "application/octet-stream";
  const promptMode = typeof block.promptMode === "string" ? block.promptMode : "workspace";
  const workspacePath = typeof block.workspacePath === "string" ? block.workspacePath : undefined;
  const storedFileName = typeof block.storedFileName === "string" ? block.storedFileName : undefined;
  const sizeBytes = typeof block.sizeBytes === "number" && Number.isFinite(block.sizeBytes)
    ? block.sizeBytes
    : undefined;
  const lines = [
    `[${label}] attached file metadata`,
    `name: ${fileName}`,
    `type: ${attachmentType}`,
    `mime: ${mimeType}`,
    `handling: ${promptMode}`,
  ];
  if (workspacePath) {
    lines.push(`workspace_path: ${workspacePath}`);
  }
  if (storedFileName) {
    lines.push(`stored_name: ${storedFileName}`);
  }
  if (sizeBytes !== undefined) {
    lines.push(`size_bytes: ${sizeBytes}`);
  }
  if (block.inlineTruncated === true) {
    lines.push("inline_truncated: true");
  }
  return {
    type: "text",
    text: lines.join("\n"),
  } as ContentBlock;
}

async function normalizeAttachmentBlocksForModelInput(
  content: readonly unknown[],
  label: string,
  options?: { workspaceDir?: string; maxBytes?: number },
): Promise<ContentBlock[]> {
  const out: ContentBlock[] = [];
  for (const block of content) {
    if (!isAttachmentBlock(block)) {
      out.push(block as ContentBlock);
      continue;
    }
    const imageBlock = await imageAttachmentBlockToImage(block, options).catch(() => null);
    out.push(imageBlock ?? attachmentBlockToText(block, label));
  }
  return out;
}

const INTERNAL_ATTACHMENT_PROMPT_PREFIXES = [
  "[Attached files metadata]",
  "[Recent image attachment context]",
];

function readUserMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const rec = block as { type?: unknown; text?: unknown };
      if (
        (rec.type === "text" ||
          rec.type === "input_text" ||
          rec.type === undefined) &&
        typeof rec.text === "string"
      ) {
        return rec.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function isInternalAttachmentPromptUserMessage(msg: Extract<AgentMessage, { role: "user" }>) {
  const text = readUserMessageText(msg.content).trimStart();
  return INTERNAL_ATTACHMENT_PROMPT_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function isThinkingOrRedactedBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") {
    return false;
  }
  const rec = block as { type?: unknown };
  return rec.type === "thinking" || rec.type === "redacted_thinking";
}

export function isEmptyAssistantMessageContent(
  message: Extract<AgentMessage, { role: "assistant" }>,
): boolean {
  const content = message.content;
  if (content == null) {
    return true;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return content.every((block) => {
    if (!block || typeof block !== "object") {
      return true;
    }
    const rec = block as { type?: unknown; text?: unknown };
    if (rec.type !== "text") {
      return false;
    }
    return typeof rec.text !== "string" || rec.text.trim().length === 0;
  });
}

export async function sanitizeSessionMessagesImages(
  messages: AgentMessage[],
  label: string,
  options?: {
    sanitizeMode?: "full" | "images-only";
    sanitizeToolCallIds?: boolean;
    preserveNativeAnthropicToolUseIds?: boolean;
    /**
     * Mode for tool call ID sanitization:
     * - "strict" (alphanumeric only)
     * - "strict9" (alphanumeric only, length 9)
     */
    toolCallIdMode?: ToolCallIdMode;
    preserveSignatures?: boolean;
    sanitizeThoughtSignatures?: {
      allowBase64Only?: boolean;
      includeCamelCase?: boolean;
    };
    workspaceDir?: string;
  } & ImageSanitizationLimits,
): Promise<AgentMessage[]> {
  const sanitizeMode = options?.sanitizeMode ?? "full";
  const allowNonImageSanitization = sanitizeMode === "full";
  const imageSanitization = {
    maxDimensionPx: options?.maxDimensionPx,
    maxBytes: options?.maxBytes,
  };
  const shouldSanitizeToolCallIds = options?.sanitizeToolCallIds === true;
  // We sanitize historical session messages because Anthropic can reject a request
  // if the transcript contains oversized base64 images (default max side 1200px).
  const beforeMediaBlockCount = collectSessionMediaBlockDebugEntries(messages).length;
  logSessionMediaBlocksDebug({
    stage: "before",
    label,
    messages,
  });
  const sanitizedIds = shouldSanitizeToolCallIds
    ? sanitizeToolCallIdsForCloudCodeAssist(messages, options.toolCallIdMode, {
        preserveNativeAnthropicToolUseIds: options?.preserveNativeAnthropicToolUseIds,
      })
    : messages;
  const out: AgentMessage[] = [];
  for (const msg of sanitizedIds) {
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }

    const role = (msg as { role?: unknown }).role;
    if (role === "toolResult") {
      const toolMsg = msg as Extract<AgentMessage, { role: "toolResult" }>;
      const content = Array.isArray(toolMsg.content) ? toolMsg.content : [];
      const modelSafeContent = await normalizeAttachmentBlocksForModelInput(content, label, {
        workspaceDir: options?.workspaceDir,
        maxBytes: options?.maxBytes,
      });
      const nextContent = (await sanitizeContentBlocksImages(
        modelSafeContent,
        label,
        imageSanitization,
      )) as unknown as typeof toolMsg.content;
      out.push({ ...toolMsg, content: nextContent });
      continue;
    }

    if (role === "user") {
      const userMsg = msg as Extract<AgentMessage, { role: "user" }>;
      if (isInternalAttachmentPromptUserMessage(userMsg)) {
        continue;
      }
      const content = userMsg.content;
      if (Array.isArray(content)) {
        const modelSafeContent = await normalizeAttachmentBlocksForModelInput(content, label, {
          workspaceDir: options?.workspaceDir,
          maxBytes: options?.maxBytes,
        });
        const nextContent = (await sanitizeContentBlocksImages(
          modelSafeContent,
          label,
          imageSanitization,
        )) as unknown as typeof userMsg.content;
        out.push({ ...userMsg, content: nextContent });
        continue;
      }
    }

    if (role === "assistant") {
      const assistantMsg = msg as Extract<AgentMessage, { role: "assistant" }>;
      if (assistantMsg.stopReason === "error") {
        const content = assistantMsg.content;
        if (Array.isArray(content)) {
          const modelSafeContent = await normalizeAttachmentBlocksForModelInput(content, label, {
            workspaceDir: options?.workspaceDir,
            maxBytes: options?.maxBytes,
          });
          const nextContent = (await sanitizeContentBlocksImages(
            modelSafeContent,
            label,
            imageSanitization,
          )) as unknown as typeof assistantMsg.content;
          out.push({ ...assistantMsg, content: nextContent });
        } else {
          out.push(assistantMsg);
        }
        continue;
      }
      const content = assistantMsg.content;
      if (Array.isArray(content)) {
        const strippedContent = options?.preserveSignatures
          ? content // Keep signatures for Antigravity Claude
          : stripThoughtSignatures(content, options?.sanitizeThoughtSignatures); // Strip for Gemini
        if (!allowNonImageSanitization) {
          const modelSafeContent = await normalizeAttachmentBlocksForModelInput(
            strippedContent,
            label,
            {
              workspaceDir: options?.workspaceDir,
              maxBytes: options?.maxBytes,
            },
          );
          const nextContent = (await sanitizeContentBlocksImages(
            modelSafeContent,
            label,
            imageSanitization,
          )) as unknown as typeof assistantMsg.content;
          out.push({ ...assistantMsg, content: nextContent });
          continue;
        }

        const filteredContent =
          options?.preserveSignatures &&
          strippedContent.some((block) => isThinkingOrRedactedBlock(block))
            ? strippedContent
            : strippedContent.filter((block) => {
                if (!block || typeof block !== "object") {
                  return true;
                }
                const rec = block as { type?: unknown; text?: unknown };
                if (rec.type !== "text" || typeof rec.text !== "string") {
                  return true;
                }
                return rec.text.trim().length > 0;
              });
        const modelSafeContent = await normalizeAttachmentBlocksForModelInput(
          filteredContent,
          label,
          {
            workspaceDir: options?.workspaceDir,
            maxBytes: options?.maxBytes,
          },
        );
        const finalContent = (await sanitizeContentBlocksImages(
          modelSafeContent,
          label,
          imageSanitization,
        )) as unknown as typeof assistantMsg.content;
        if (finalContent.length === 0) {
          continue;
        }
        out.push({ ...assistantMsg, content: finalContent });
        continue;
      }
    }

    out.push(msg);
  }
  logSessionMediaBlocksDebug({
    stage: "after",
    label,
    messages: out,
    beforeCount: beforeMediaBlockCount,
  });
  return out;
}
