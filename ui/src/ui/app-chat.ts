import { scheduleChatScroll, resetChatScroll } from "./app-scroll.ts";
import { setLastActiveSessionKey } from "./app-settings.ts";
import { resetToolStream } from "./app-tool-stream.ts";
import type { OpenClawApp } from "./app.ts";
import { executeSlashCommand } from "./chat/slash-command-executor.ts";
import { parseSlashCommand } from "./chat/slash-commands.ts";
import { abortChatRun, loadChatHistory, sendChatMessage } from "./controllers/chat.ts";
import { loadModels } from "./controllers/models.ts";
import { loadSessions } from "./controllers/sessions.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import { normalizeBasePath } from "./navigation.ts";
import { parseAgentSessionKey } from "./session-key.ts";
import { normalizeLowercaseStringOrEmpty } from "./string-coerce.ts";
import type { ChatModelOverride, ModelCatalogEntry } from "./types.ts";
import type { SessionsListResult } from "./types.ts";
import type { ChatAttachment, ChatQueueItem, ChatSendDraft, ChatSendFailure } from "./ui-types.ts";
import { generateUUID } from "./uuid.ts";

export type ChatHost = {
  client: GatewayBrowserClient | null;
  employeeMode?: boolean;
  chatMessages: unknown[];
  chatStream: string | null;
  connected: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatQueue: ChatQueueItem[];
  chatSendDrafts: Record<string, ChatSendDraft>;
  chatSendFailures: Record<string, ChatSendFailure>;
  chatRunId: string | null;
  chatSending: boolean;
  lastError?: string | null;
  sessionKey: string;
  basePath: string;
  hello: GatewayHelloOk | null;
  chatAvatarUrl: string | null;
  chatModelOverrides: Record<string, ChatModelOverride | null>;
  chatModelsLoading: boolean;
  chatModelCatalog: ModelCatalogEntry[];
  sessionsResult?: SessionsListResult | null;
  updateComplete?: Promise<unknown>;
  refreshSessionsAfterChat: Set<string>;
  pendingAbort?: { runId?: string | null; sessionKey: string } | null;
  /** Callback for slash-command side effects that need app-level access. */
  onSlashAction?: (action: string) => void;
};

export const CHAT_SESSIONS_ACTIVE_MINUTES = 120;
const CHAT_RUN_TERMINAL_FALLBACK_TIMEOUT_MS = 10 * 60_000;

export function isChatBusy(host: ChatHost) {
  return host.chatSending || Boolean(host.chatRunId);
}

export function hasAbortableSessionRun(host: {
  chatRunId?: string | null;
  sessionKey: string;
  sessionsResult?: SessionsListResult | null;
}): boolean {
  if (host.chatRunId) {
    return true;
  }
  return Boolean(
    host.sessionsResult?.sessions.some(
      (session) => session.key === host.sessionKey && session.hasActiveRun === true,
    ),
  );
}

export function isChatStopCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = normalizeLowercaseStringOrEmpty(trimmed);
  if (normalized === "/stop") {
    return true;
  }
  return (
    normalized === "stop" ||
    normalized === "esc" ||
    normalized === "abort" ||
    normalized === "wait" ||
    normalized === "exit"
  );
}

function isChatResetCommand(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  const normalized = normalizeLowercaseStringOrEmpty(trimmed);
  if (normalized === "/new" || normalized === "/reset") {
    return true;
  }
  return normalized.startsWith("/new ") || normalized.startsWith("/reset ");
}

export async function handleAbortChat(host: ChatHost) {
  const activeRunId = host.chatRunId;
  if (!host.connected && hasAbortableSessionRun(host)) {
    host.chatMessage = "";
    host.pendingAbort = { runId: activeRunId, sessionKey: host.sessionKey };
    return;
  }
  if (!host.connected) {
    return;
  }
  host.chatMessage = "";
  await abortChatRun(host as unknown as OpenClawApp);
}

function enqueueChatMessage(
  host: ChatHost,
  text: string,
  attachments?: ChatAttachment[],
  refreshSessions?: boolean,
  localCommand?: { args: string; name: string },
) {
  const trimmed = text.trim();
  const hasAttachments = Boolean(attachments && attachments.length > 0);
  if (!trimmed && !hasAttachments) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      attachments: hasAttachments ? attachments?.map((att) => ({ ...att })) : undefined,
      refreshSessions,
      localCommandArgs: localCommand?.args,
      localCommandName: localCommand?.name,
    },
  ];
}

function enqueuePendingRunMessage(host: ChatHost, text: string, pendingRunId: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  host.chatQueue = [
    ...host.chatQueue,
    {
      id: generateUUID(),
      text: trimmed,
      createdAt: Date.now(),
      pendingRunId,
    },
  ];
}

async function sendChatMessageNow(
  host: ChatHost,
  message: string,
  opts?: {
    previousDraft?: string;
    restoreDraft?: boolean;
    attachments?: ChatAttachment[];
    previousAttachments?: ChatAttachment[];
    restoreAttachments?: boolean;
    refreshSessions?: boolean;
  },
) {
  resetToolStream(host as unknown as Parameters<typeof resetToolStream>[0]);
  // Reset scroll state before sending to ensure auto-scroll works for the response
  resetChatScroll(host as unknown as Parameters<typeof resetChatScroll>[0]);
  const requestedRunId = generateUUID();
  const runId = await sendChatMessage(host as unknown as OpenClawApp, message, opts?.attachments, {
    runId: requestedRunId,
  });
  const ok = Boolean(runId);
  const hasVisibleFailure = requestedRunId in (host.chatSendFailures ?? {});
  if (!ok && !hasVisibleFailure && opts?.previousDraft != null) {
    host.chatMessage = opts.previousDraft;
  }
  if (!ok && !hasVisibleFailure && opts?.previousAttachments) {
    host.chatAttachments = opts.previousAttachments;
  }
  if (ok) {
    setLastActiveSessionKey(
      host as unknown as Parameters<typeof setLastActiveSessionKey>[0],
      host.sessionKey,
    );
  }
  if (ok && opts?.restoreDraft && opts.previousDraft?.trim()) {
    host.chatMessage = opts.previousDraft;
  }
  if (ok && opts?.restoreAttachments && opts.previousAttachments?.length) {
    host.chatAttachments = opts.previousAttachments;
  }
  // Force scroll after sending to ensure viewport is at bottom for incoming stream
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0], true);
  if (ok && !host.chatRunId) {
    void flushChatQueue(host);
  }
  if (ok && opts?.refreshSessions && runId) {
    host.refreshSessionsAfterChat.add(runId);
  }
  if (ok && runId) {
    void refreshChatHistoryWhenRunTerminal(host, runId, host.sessionKey);
  }
  return ok;
}

async function refreshChatHistoryWhenRunTerminal(
  host: ChatHost,
  runId: string,
  sessionKey: string,
) {
  const client = host.client;
  if (!client) {
    return;
  }
  try {
    const result = await client.request<{ status?: string }>("agent.wait", {
      runId,
      timeoutMs: CHAT_RUN_TERMINAL_FALLBACK_TIMEOUT_MS,
    });
    if (!result?.status || result.status === "timeout") {
      return;
    }
    // Normal live chat events clear chatRunId. If it is still the same run after
    // agent.wait reaches a terminal state, the browser missed the final event.
    if (host.sessionKey !== sessionKey || host.chatRunId !== runId || !host.connected) {
      return;
    }
    await loadChatHistory(host as unknown as OpenClawApp);
    await loadSessions(host as unknown as OpenClawApp, {
      activeMinutes: CHAT_SESSIONS_ACTIVE_MINUTES,
      rerunIfLoading: true,
    });
    if (host.sessionKey === sessionKey && host.chatRunId === runId) {
      host.chatRunId = null;
      host.chatStream = null;
    }
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0], true);
    void flushChatQueue(host);
  } catch {
    // This is only a missed-event recovery path. Normal chat event handling still
    // owns user-visible errors.
  }
}

export async function retryFailedChatMessage(host: ChatHost, failedRunId: string) {
  const failure = host.chatSendFailures?.[failedRunId];
  if (!failure || failure.retrying || !failure.retryable || isChatBusy(host)) {
    return;
  }

  host.chatSendFailures = {
    ...host.chatSendFailures,
    [failedRunId]: { ...failure, retrying: true },
  };
  const nextRunId = resolveChatRetryRunId(failure);
  const result = await sendChatMessage(
    host as unknown as OpenClawApp,
    failure.message,
    failure.attachments,
    {
      runId: nextRunId,
      replaceRunId: failedRunId,
    },
  );

  if (nextRunId !== failedRunId) {
    const { [failedRunId]: _oldFailure, ...remainingFailures } = host.chatSendFailures ?? {};
    host.chatSendFailures = remainingFailures;
    const { [failedRunId]: _oldDraft, ...remainingDrafts } = host.chatSendDrafts ?? {};
    host.chatSendDrafts = remainingDrafts;
  } else if (result) {
    const { [failedRunId]: _oldFailure, ...remainingFailures } = host.chatSendFailures ?? {};
    host.chatSendFailures = remainingFailures;
  }
}

export function resolveChatRetryRunId(failure: ChatSendFailure): string {
  // Submit-stage network/timeout failures have uncertain delivery: the server may have accepted
  // the request before the acknowledgement was lost. Reuse the idempotency key so the gateway
  // returns "in_flight" or its cached result without starting a second agent run.
  const deliveryIsUncertain =
    failure.phase === "submit" && (failure.code === "network" || failure.code === "timeout");
  if (deliveryIsUncertain) {
    return failure.runId;
  }

  // Runtime timeout/overloaded/rate-limit errors are emitted only after terminal lifecycle
  // failure. That key now returns a cached error, so an intentional retry requires a new key.
  // sendChatMessage replaces the existing optimistic message by run id in both cases.
  return generateUUID();
}

async function flushChatQueue(host: ChatHost) {
  if (!host.connected || isChatBusy(host)) {
    return;
  }
  const nextIndex = host.chatQueue.findIndex((item) => !item.pendingRunId);
  if (nextIndex < 0) {
    return;
  }
  const next = host.chatQueue[nextIndex];
  host.chatQueue = host.chatQueue.filter((_, index) => index !== nextIndex);
  let ok = false;
  try {
    if (next.localCommandName) {
      await dispatchSlashCommand(host, next.localCommandName, next.localCommandArgs ?? "");
      ok = true;
    } else {
      ok = await sendChatMessageNow(host, next.text, {
        attachments: next.attachments,
        refreshSessions: next.refreshSessions,
      });
    }
  } catch (err) {
    host.lastError = String(err);
  }
  if (!ok) {
    host.chatQueue = [next, ...host.chatQueue];
  } else if (host.chatQueue.length > 0) {
    // Continue draining — local commands don't block on server response
    void flushChatQueue(host);
  }
}

export function removeQueuedMessage(host: ChatHost, id: string) {
  host.chatQueue = host.chatQueue.filter((item) => item.id !== id);
}

export function clearPendingQueueItemsForRun(host: ChatHost, runId: string | undefined) {
  if (!runId) {
    return;
  }
  host.chatQueue = host.chatQueue.filter((item) => item.pendingRunId !== runId);
}

export async function handleSendChat(
  host: ChatHost,
  messageOverride?: string,
  opts?: { restoreDraft?: boolean },
) {
  if (!host.connected) {
    return;
  }
  const previousDraft = host.chatMessage;
  const message = (messageOverride ?? host.chatMessage).trim();
  const attachments = host.chatAttachments ?? [];
  const attachmentsToSend = messageOverride == null ? attachments : [];
  const hasAttachments = attachmentsToSend.length > 0;
  const hasUploadingAttachments = attachmentsToSend.some(
    (attachment) => attachment.status === "uploading",
  );

  if (hasUploadingAttachments) {
    host.lastError = "Wait for file uploads to finish before sending.";
    return;
  }

  if (!message && !hasAttachments) {
    return;
  }

  if (isChatStopCommand(message)) {
    await handleAbortChat(host);
    return;
  }

  // Intercept local slash commands (/status, /model, /compact, etc.)
  const parsed = parseSlashCommand(message);
  if (parsed?.command.executeLocal) {
    if (isChatBusy(host) && shouldQueueLocalSlashCommand(parsed.command.key)) {
      if (messageOverride == null) {
        host.chatMessage = "";
        host.chatAttachments = [];
      }
      enqueueChatMessage(host, message, undefined, isChatResetCommand(message), {
        args: parsed.args,
        name: parsed.command.key,
      });
      return;
    }
    const prevDraft = messageOverride == null ? previousDraft : undefined;
    if (messageOverride == null) {
      host.chatMessage = "";
      host.chatAttachments = [];
    }
    await dispatchSlashCommand(host, parsed.command.key, parsed.args, {
      previousDraft: prevDraft,
      restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    });
    return;
  }

  const refreshSessions = isChatResetCommand(message);
  if (messageOverride == null) {
    host.chatMessage = "";
    host.chatAttachments = [];
  }

  if (isChatBusy(host)) {
    enqueueChatMessage(host, message, attachmentsToSend, refreshSessions);
    return;
  }

  await sendChatMessageNow(host, message, {
    previousDraft: messageOverride == null ? previousDraft : undefined,
    restoreDraft: Boolean(messageOverride && opts?.restoreDraft),
    attachments: hasAttachments ? attachmentsToSend : undefined,
    previousAttachments: messageOverride == null ? attachments : undefined,
    restoreAttachments: Boolean(messageOverride && opts?.restoreDraft),
    refreshSessions,
  });
}

function shouldQueueLocalSlashCommand(name: string): boolean {
  return !["stop", "focus", "export-session", "steer", "redirect"].includes(name);
}

// ── Slash Command Dispatch ──

async function dispatchSlashCommand(
  host: ChatHost,
  name: string,
  args: string,
  sendOpts?: { previousDraft?: string; restoreDraft?: boolean },
) {
  switch (name) {
    case "stop":
      await handleAbortChat(host);
      return;
    case "new":
      await sendChatMessageNow(host, "/new", {
        refreshSessions: true,
        previousDraft: sendOpts?.previousDraft,
        restoreDraft: sendOpts?.restoreDraft,
      });
      return;
    case "reset":
      await sendChatMessageNow(host, "/reset", {
        refreshSessions: true,
        previousDraft: sendOpts?.previousDraft,
        restoreDraft: sendOpts?.restoreDraft,
      });
      return;
    case "clear":
      await clearChatHistory(host);
      return;
    case "focus":
      host.onSlashAction?.("toggle-focus");
      return;
    case "export-session":
      host.onSlashAction?.("export");
      return;
  }

  if (!host.client) {
    return;
  }

  const targetSessionKey = host.sessionKey;
  const result = await executeSlashCommand(host.client, targetSessionKey, name, args, {
    chatModelCatalog: host.chatModelCatalog,
    sessionsResult: host.sessionsResult,
  });

  if (result.content) {
    injectCommandResult(host, result.content);
  }

  if (result.trackRunId) {
    host.chatRunId = result.trackRunId;
    host.chatStream = "";
    host.chatSending = false;
  }

  if (result.pendingCurrentRun && host.chatRunId) {
    enqueuePendingRunMessage(host, `/${name} ${args}`.trim(), host.chatRunId);
  }

  if (result.sessionPatch && "modelOverride" in result.sessionPatch) {
    host.chatModelOverrides = {
      ...host.chatModelOverrides,
      [targetSessionKey]: result.sessionPatch.modelOverride ?? null,
    };
    host.onSlashAction?.("refresh-tools-effective");
  }

  if (result.action === "refresh") {
    await refreshChat(host);
  }

  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
}

async function clearChatHistory(host: ChatHost) {
  if (!host.client || !host.connected) {
    return;
  }
  try {
    await host.client.request("sessions.reset", { key: host.sessionKey });
    host.chatMessages = [];
    host.chatStream = null;
    host.chatRunId = null;
    host.chatSendDrafts = {};
    host.chatSendFailures = {};
    await loadChatHistory(host as unknown as OpenClawApp);
  } catch (err) {
    host.lastError = String(err);
  }
  scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
}

function injectCommandResult(host: ChatHost, content: string) {
  host.chatMessages = [
    ...host.chatMessages,
    {
      role: "system",
      content,
      timestamp: Date.now(),
    },
  ];
}

export async function refreshChat(host: ChatHost, opts?: { scheduleScroll?: boolean }) {
  void Promise.allSettled([
    loadSessions(host as unknown as OpenClawApp, {
      activeMinutes: 0,
      limit: 0,
      includeGlobal: true,
      includeUnknown: true,
    }),
    refreshChatAvatar(host),
    refreshChatModels(host),
  ]);
  await loadChatHistory(host as unknown as OpenClawApp);
  if (opts?.scheduleScroll !== false) {
    scheduleChatScroll(host as unknown as Parameters<typeof scheduleChatScroll>[0]);
  }
}

async function refreshChatModels(host: ChatHost) {
  if (!host.client || !host.connected) {
    host.chatModelsLoading = false;
    host.chatModelCatalog = [];
    return;
  }
  host.chatModelsLoading = true;
  try {
    host.chatModelCatalog = await loadModels(host.client);
  } finally {
    host.chatModelsLoading = false;
  }
}

export const flushChatQueueForEvent = flushChatQueue;
const chatAvatarRequestVersions = new WeakMap<object, number>();

type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
};

function beginChatAvatarRequest(host: ChatHost): number {
  const key = host as object;
  const nextVersion = (chatAvatarRequestVersions.get(key) ?? 0) + 1;
  chatAvatarRequestVersions.set(key, nextVersion);
  return nextVersion;
}

function shouldApplyChatAvatarResult(host: ChatHost, version: number, sessionKey: string): boolean {
  return (
    chatAvatarRequestVersions.get(host as object) === version && host.sessionKey === sessionKey
  );
}

function resolveAgentIdForSession(host: ChatHost): string | null {
  const parsed = parseAgentSessionKey(host.sessionKey);
  if (parsed?.agentId) {
    return parsed.agentId;
  }
  const snapshot = host.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const fallback = snapshot?.sessionDefaults?.defaultAgentId?.trim();
  return fallback || "main";
}

function buildAvatarMetaUrl(basePath: string, agentId: string): string {
  const base = normalizeBasePath(basePath);
  const encoded = encodeURIComponent(agentId);
  return base ? `${base}/avatar/${encoded}?meta=1` : `avatar/${encoded}?meta=1`;
}

export async function refreshChatAvatar(host: ChatHost) {
  if (!host.connected) {
    host.chatAvatarUrl = null;
    return;
  }
  const sessionKey = host.sessionKey;
  const requestVersion = beginChatAvatarRequest(host);
  const agentId = resolveAgentIdForSession(host);
  if (!agentId) {
    if (shouldApplyChatAvatarResult(host, requestVersion, sessionKey)) {
      host.chatAvatarUrl = null;
    }
    return;
  }
  host.chatAvatarUrl = null;
  const url = buildAvatarMetaUrl(host.basePath, agentId);
  try {
    const res = await fetch(url, { method: "GET" });
    if (!shouldApplyChatAvatarResult(host, requestVersion, sessionKey)) {
      return;
    }
    if (!res.ok) {
      host.chatAvatarUrl = null;
      return;
    }
    const data = (await res.json()) as { avatarUrl?: unknown };
    if (!shouldApplyChatAvatarResult(host, requestVersion, sessionKey)) {
      return;
    }
    const avatarUrl = typeof data.avatarUrl === "string" ? data.avatarUrl.trim() : "";
    host.chatAvatarUrl = avatarUrl || null;
  } catch {
    if (shouldApplyChatAvatarResult(host, requestVersion, sessionKey)) {
      host.chatAvatarUrl = null;
    }
  }
}
