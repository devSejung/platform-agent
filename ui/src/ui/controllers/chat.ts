import { EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH } from "../../../../src/gateway/employee-workspace-files-contract.ts";
import { resetToolStream } from "../app-tool-stream.ts";
import { extractText } from "../chat/message-extract.ts";
import { describeChatFailure } from "../chat/send-failure.ts";
import {
  appendChatMessageToCache,
  cacheChatMessages,
  type ChatMessageCache,
} from "../chat/session-message-cache.ts";
import { formatConnectError } from "../connect-error.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import type { ChatAttachment, ChatSendDraft, ChatSendFailure } from "../ui-types.ts";
import { generateUUID } from "../uuid.ts";
import {
  formatMissingOperatorReadScopeMessage,
  isMissingOperatorReadScopeError,
} from "./scope-errors.ts";

const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/;
const chatHistoryRequestVersions = new WeakMap<object, number>();

function beginChatHistoryRequest(state: ChatState): number {
  const key = state as object;
  const nextVersion = (chatHistoryRequestVersions.get(key) ?? 0) + 1;
  chatHistoryRequestVersions.set(key, nextVersion);
  return nextVersion;
}

function isLatestChatHistoryRequest(state: ChatState, version: number): boolean {
  return chatHistoryRequestVersions.get(state as object) === version;
}

function shouldApplyChatHistoryResult(
  state: ChatState,
  version: number,
  sessionKey: string,
): boolean {
  return isLatestChatHistoryRequest(state, version) && state.sessionKey === sessionKey;
}

function isImageMimeType(value: string | undefined): boolean {
  return typeof value === "string" && value.toLowerCase().startsWith("image/");
}

function resolveOutboundAttachmentKind(att: ChatAttachment): "image" | "file" {
  return isImageMimeType(att.mimeType) ? "image" : "file";
}

function shouldSendAttachmentAsImagePayload(
  att: ChatAttachment,
): att is ChatAttachment & { file: File } {
  return att.status === "image" && isImageMimeType(att.mimeType) && att.file instanceof File;
}

function isSilentReplyStream(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}
/** Client-side defense-in-depth: detect assistant messages whose text is purely NO_REPLY. */
function isAssistantSilentReply(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const entry = message as Record<string, unknown>;
  const role = normalizeLowercaseStringOrEmpty(entry.role);
  if (role !== "assistant") {
    return false;
  }
  // entry.text takes precedence — matches gateway extractAssistantTextForSilentCheck
  if (typeof entry.text === "string") {
    return isSilentReplyStream(entry.text);
  }
  const text = extractText(message);
  return typeof text === "string" && isSilentReplyStream(text);
}

function replaceCachedChatMessages(state: ChatState, sessionKey: string, messages: unknown[]) {
  if (!state.chatMessagesBySession) {
    return;
  }
  cacheChatMessages(state.chatMessagesBySession, sessionKey, messages);
}

function appendCachedChatMessage(state: ChatState, sessionKey: string, message: unknown) {
  if (!state.chatMessagesBySession) {
    return;
  }
  appendChatMessageToCache(state.chatMessagesBySession, sessionKey, message);
}

export type ChatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  employeeMode?: boolean;
  sessionKey: string;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatMessagesBySession?: ChatMessageCache;
  chatThinkingLevel: string | null;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatRunId: string | null;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatSendDrafts: Record<string, ChatSendDraft>;
  chatSendFailures: Record<string, ChatSendFailure>;
  lastError: string | null;
};

export type ChatEventPayload = {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
  errorCode?: string;
};

type SendChatMessageOptions = {
  runId?: string;
  replaceRunId?: string;
};

function buildLocalOutboundMarker(runId: string) {
  return { kind: "outbound", runId };
}

function messageHasOutboundRunId(message: unknown, runId: string): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const marker = (message as Record<string, unknown>).__openclaw;
  return (
    Boolean(marker) &&
    typeof marker === "object" &&
    (marker as Record<string, unknown>).kind === "outbound" &&
    (marker as Record<string, unknown>).runId === runId
  );
}

function setChatSendFailure(params: {
  state: ChatState;
  runId: string;
  message: string;
  attachments?: ChatAttachment[];
  phase: "submit" | "run";
  errorCode?: string;
  errorMessage?: string;
}) {
  const presentation = describeChatFailure(
    params.errorCode,
    params.errorMessage,
    params.state.employeeMode === true,
  );
  const failures = params.state.chatSendFailures ?? {};
  const drafts = params.state.chatSendDrafts ?? {};
  const existing = failures[params.runId];
  const draft = drafts[params.runId];
  params.state.chatSendFailures = {
    ...failures,
    [params.runId]: {
      runId: params.runId,
      message: params.message || existing?.message || draft?.message || "",
      attachments: (params.attachments ?? existing?.attachments ?? draft?.attachments ?? []).map(
        (attachment) => ({
          ...attachment,
        }),
      ),
      phase: params.phase,
      retrying: false,
      ...presentation,
    },
  };
}

function maybeResetToolStream(state: ChatState) {
  const toolHost = state as ChatState & Partial<Parameters<typeof resetToolStream>[0]>;
  if (
    toolHost.toolStreamById instanceof Map &&
    Array.isArray(toolHost.toolStreamOrder) &&
    Array.isArray(toolHost.chatToolMessages) &&
    Array.isArray(toolHost.chatStreamSegments)
  ) {
    resetToolStream(toolHost as Parameters<typeof resetToolStream>[0]);
  }
}

export async function loadChatHistory(state: ChatState) {
  if (!state.client || !state.connected) {
    return;
  }
  const sessionKey = state.sessionKey;
  const requestVersion = beginChatHistoryRequest(state);
  state.chatLoading = true;
  state.lastError = null;
  try {
    const res = await state.client.request<{ messages?: Array<unknown>; thinkingLevel?: string }>(
      "chat.history",
      {
        sessionKey,
        limit: 200,
      },
    );
    if (!shouldApplyChatHistoryResult(state, requestVersion, sessionKey)) {
      return;
    }
    const messages = Array.isArray(res.messages) ? res.messages : [];
    state.chatMessages = messages.filter((message) => !isAssistantSilentReply(message));
    replaceCachedChatMessages(state, sessionKey, state.chatMessages);
    state.chatThinkingLevel = res.thinkingLevel ?? null;
    // Clear all streaming state — history includes tool results and text
    // inline, so keeping streaming artifacts would cause duplicates.
    maybeResetToolStream(state);
    state.chatStream = null;
    state.chatStreamStartedAt = null;
  } catch (err) {
    if (!shouldApplyChatHistoryResult(state, requestVersion, sessionKey)) {
      return;
    }
    if (isMissingOperatorReadScopeError(err)) {
      state.chatMessages = [];
      state.chatThinkingLevel = null;
      state.lastError = formatMissingOperatorReadScopeMessage("existing chat history");
    } else {
      state.lastError = String(err);
    }
  } finally {
    if (isLatestChatHistoryRequest(state, requestVersion)) {
      state.chatLoading = false;
    }
  }
}

function buildTranscriptAttachment(att: ChatAttachment) {
  const kind = resolveOutboundAttachmentKind(att);
  return {
    type: kind,
    fileName: att.fileName,
    storedFileName: att.storedFileName,
    workspacePath: att.workspacePath,
    mimeType: att.mimeType,
    sizeBytes: att.sizeBytes,
    promptMode:
      att.status === "image" || att.status === "inline" || att.status === "workspace"
        ? att.status
        : undefined,
    inlineTruncated: att.inlineTruncated === true,
    downloadUrl: att.workspacePath
      ? `${EMPLOYEE_WORKSPACE_FILES_DOWNLOAD_PATH}?path=${encodeURIComponent(att.workspacePath)}`
      : undefined,
  };
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

type AssistantMessageNormalizationOptions = {
  roleRequirement: "required" | "optional";
  roleCaseSensitive?: boolean;
  requireContentArray?: boolean;
  allowTextField?: boolean;
};

function normalizeAssistantMessage(
  message: unknown,
  options: AssistantMessageNormalizationOptions,
): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const candidate = message as Record<string, unknown>;
  const roleValue = candidate.role;
  if (typeof roleValue === "string") {
    const role = options.roleCaseSensitive ? roleValue : normalizeLowercaseStringOrEmpty(roleValue);
    if (role !== "assistant") {
      return null;
    }
  } else if (options.roleRequirement === "required") {
    return null;
  }

  if (options.requireContentArray) {
    return Array.isArray(candidate.content) ? candidate : null;
  }
  if (!("content" in candidate) && !(options.allowTextField && "text" in candidate)) {
    return null;
  }
  return candidate;
}

function normalizeAbortedAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "required",
    roleCaseSensitive: true,
    requireContentArray: true,
  });
}

function normalizeFinalAssistantMessage(message: unknown): Record<string, unknown> | null {
  return normalizeAssistantMessage(message, {
    roleRequirement: "optional",
    allowTextField: true,
  });
}

export async function sendChatMessage(
  state: ChatState,
  message: string,
  attachments?: ChatAttachment[],
  options: SendChatMessageOptions = {},
): Promise<string | null> {
  if (!state.client || !state.connected) {
    return null;
  }
  const msg = message.trim();
  const hasAttachments = attachments && attachments.length > 0;
  if (!msg && !hasAttachments) {
    return null;
  }

  const now = Date.now();
  const runId = options.runId ?? generateUUID();
  state.chatSendDrafts = {
    ...state.chatSendDrafts,
    [runId]: {
      message: msg,
      attachments: (attachments ?? []).map((attachment) => ({ ...attachment })),
    },
  };

  // Build user message content blocks
  const contentBlocks: Array<{ type: string; text?: string; source?: unknown; url?: string }> = [];
  if (msg) {
    contentBlocks.push({ type: "text", text: msg });
  }
  // Add image previews to the message for display
  if (hasAttachments) {
    for (const att of attachments) {
      if (att.kind === "image" && att.previewUrl) {
        contentBlocks.push({
          type: "image",
          source: { type: "url", media_type: att.mimeType, data: att.previewUrl },
          url: att.previewUrl,
        });
      }
    }
  }

  const optimisticMessage = {
    role: "user",
    content: contentBlocks,
    ...(hasAttachments ? { Attachments: attachments.map(buildTranscriptAttachment) } : {}),
    timestamp: now,
    __openclaw: buildLocalOutboundMarker(runId),
  };
  state.chatMessages = options.replaceRunId
    ? state.chatMessages.map((entry) =>
        messageHasOutboundRunId(entry, options.replaceRunId!) ? optimisticMessage : entry,
      )
    : [...state.chatMessages, optimisticMessage];

  state.chatSending = true;
  state.lastError = null;
  state.chatRunId = runId;
  state.chatStream = "";
  state.chatStreamStartedAt = now;

  try {
    // Convert attachments to API format only after the optimistic message has a failure target.
    const apiAttachments = hasAttachments
      ? (
          await Promise.all(
            attachments.map(async (att) => {
              if (att.status === "uploading") {
                return null;
              }
              if (shouldSendAttachmentAsImagePayload(att)) {
                return {
                  type: "image",
                  fileName: att.fileName,
                  originalFileName: att.fileName,
                  storedFileName: att.storedFileName,
                  workspacePath: att.workspacePath,
                  mimeType: att.mimeType,
                  sizeBytes: att.sizeBytes,
                  promptMode: "image",
                  content: await fileToBase64(att.file),
                };
              }
              const attachmentType = resolveOutboundAttachmentKind(att);
              return {
                type: attachmentType,
                fileName: att.fileName,
                originalFileName: att.fileName,
                storedFileName: att.storedFileName,
                workspacePath: att.workspacePath,
                mimeType: att.mimeType,
                sizeBytes: att.sizeBytes,
                promptMode:
                  att.status === "inline" || att.status === "workspace" ? att.status : "workspace",
                inlineContent: att.inlineContent ?? undefined,
                inlineTruncated: att.inlineTruncated === true,
              };
            }),
          )
        ).filter((a): a is NonNullable<typeof a> => a !== null)
      : undefined;

    await state.client.request("chat.send", {
      sessionKey: state.sessionKey,
      message: msg,
      deliver: false,
      idempotencyKey: runId,
      attachments: apiAttachments,
    });
    return runId;
  } catch (err) {
    const error = formatConnectError(err);
    state.chatRunId = null;
    state.chatStream = null;
    state.chatStreamStartedAt = null;
    state.lastError = null;
    setChatSendFailure({
      state,
      runId,
      message: msg,
      attachments,
      phase: "submit",
      errorMessage: error,
    });
    return null;
  } finally {
    state.chatSending = false;
  }
}

export async function abortChatRun(state: ChatState): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  const runId = state.chatRunId;
  try {
    await state.client.request(
      "chat.abort",
      runId ? { sessionKey: state.sessionKey, runId } : { sessionKey: state.sessionKey },
    );
    return true;
  } catch (err) {
    state.lastError = formatConnectError(err);
    return false;
  }
}

export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (!payload) {
    return null;
  }
  if (payload.sessionKey !== state.sessionKey) {
    if (payload.state === "final") {
      const finalMessage = normalizeFinalAssistantMessage(payload.message);
      if (finalMessage && !isAssistantSilentReply(finalMessage)) {
        appendCachedChatMessage(state, payload.sessionKey, finalMessage);
      }
    }
    return null;
  }

  // Final from another run (e.g. sub-agent announce): refresh history to show new message.
  // See https://github.com/openclaw/openclaw/issues/1909
  if (payload.runId && state.chatRunId && payload.runId !== state.chatRunId) {
    if (payload.state === "final") {
      const finalMessage = normalizeFinalAssistantMessage(payload.message);
      if (finalMessage && !isAssistantSilentReply(finalMessage)) {
        state.chatMessages = [...state.chatMessages, finalMessage];
        replaceCachedChatMessages(state, state.sessionKey, state.chatMessages);
        return null;
      }
      return "final";
    }
    return null;
  }

  if (payload.state === "delta") {
    const next = extractText(payload.message);
    if (typeof next === "string" && !isSilentReplyStream(next)) {
      state.chatStream = next;
    }
  } else if (payload.state === "final") {
    const finalMessage = normalizeFinalAssistantMessage(payload.message);
    if (finalMessage && !isAssistantSilentReply(finalMessage)) {
      state.chatMessages = [...state.chatMessages, finalMessage];
    } else if (state.chatStream?.trim() && !isSilentReplyStream(state.chatStream)) {
      state.chatMessages = [
        ...state.chatMessages,
        {
          role: "assistant",
          content: [{ type: "text", text: state.chatStream }],
          timestamp: Date.now(),
        },
      ];
    }
    replaceCachedChatMessages(state, state.sessionKey, state.chatMessages);
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    if (payload.runId in (state.chatSendFailures ?? {})) {
      const { [payload.runId]: _completed, ...remaining } = state.chatSendFailures;
      state.chatSendFailures = remaining;
    }
    if (payload.runId in (state.chatSendDrafts ?? {})) {
      const { [payload.runId]: _completed, ...remaining } = state.chatSendDrafts;
      state.chatSendDrafts = remaining;
    }
  } else if (payload.state === "aborted") {
    const normalizedMessage = normalizeAbortedAssistantMessage(payload.message);
    if (normalizedMessage && !isAssistantSilentReply(normalizedMessage)) {
      state.chatMessages = [...state.chatMessages, normalizedMessage];
    } else {
      const streamedText = state.chatStream ?? "";
      if (streamedText.trim() && !isSilentReplyStream(streamedText)) {
        state.chatMessages = [
          ...state.chatMessages,
          {
            role: "assistant",
            content: [{ type: "text", text: streamedText }],
            timestamp: Date.now(),
          },
        ];
      }
    }
    replaceCachedChatMessages(state, state.sessionKey, state.chatMessages);
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    if (payload.runId in (state.chatSendDrafts ?? {})) {
      const { [payload.runId]: _aborted, ...remaining } = state.chatSendDrafts;
      state.chatSendDrafts = remaining;
    }
  } else if (payload.state === "error") {
    state.chatStream = null;
    state.chatRunId = null;
    state.chatStreamStartedAt = null;
    state.lastError = null;
    setChatSendFailure({
      state,
      runId: payload.runId,
      message: "",
      phase: "run",
      errorCode: payload.errorCode,
      errorMessage: payload.errorMessage,
    });
  }
  return payload.state;
}
