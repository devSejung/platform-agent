import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { repeat } from "lit/directives/repeat.js";
import {
  EMPLOYEE_CHAT_ATTACHMENTS_DELETE_PATH,
  EMPLOYEE_CHAT_ATTACHMENTS_UPLOAD_PATH,
  type EmployeeChatAttachmentUploadResponse,
} from "../../../../src/gateway/employee-chat-attachments-contract.ts";
import type {
  CompactionStatus as CompactionIndicatorStatus,
  FallbackStatus as FallbackIndicatorStatus,
  RunPhaseStatus,
} from "../app-tool-stream.ts";
import {
  renderArtifactFocusViewer,
  type ArtifactFocusItem,
} from "../chat/artifact-focus-viewer.ts";
import {
  CHAT_ATTACHMENT_ACCEPT,
  isSupportedChatAttachmentMimeType,
} from "../chat/attachment-support.ts";
import { DeletedMessages } from "../chat/deleted-messages.ts";
import { exportChatMarkdown } from "../chat/export.ts";
import {
  renderMessageGroup,
  renderReadingIndicatorGroup,
  renderStreamingGroup,
} from "../chat/grouped-render.ts";
import { InputHistory } from "../chat/input-history.ts";
import { normalizeMessage, normalizeRoleForGrouping } from "../chat/message-normalizer.ts";
import { PinnedMessages } from "../chat/pinned-messages.ts";
import { getPinnedMessageSummary } from "../chat/pinned-summary.ts";
import { messageMatchesSearchQuery } from "../chat/search-match.ts";
import { getOrCreateSessionCacheValue } from "../chat/session-cache.ts";
import {
  CATEGORY_LABELS,
  SLASH_COMMANDS,
  getSlashCommandCompletions,
  type SlashCommandCategory,
  type SlashCommandDef,
} from "../chat/slash-commands.ts";
import { isSttSupported, startStt, stopStt } from "../chat/speech.ts";
import { icons } from "../icons.ts";
import { renderEmployeeCrabMascot, type EmployeeCrabMascotPhase } from "../mascot.ts";
import { normalizeLowercaseStringOrEmpty } from "../string-coerce.ts";
import { detectTextDirection } from "../text-direction.ts";
import type { GatewaySessionRow, SessionsListResult } from "../types.ts";
import type { ChatItem, MessageGroup } from "../types/chat-types.ts";
import type { ChatAttachment, ChatQueueItem, ChatSendFailure } from "../ui-types.ts";
import { agentLogoUrl, employeeLogoUrl, resolveAgentAvatarUrl } from "./agents-utils.ts";
import { renderMarkdownSidebar } from "./markdown-sidebar.ts";
import "../components/resizable-divider.ts";

export type ChatProps = {
  sessionKey: string;
  employeeMode?: boolean;
  onSessionKeyChange: (next: string) => void;
  thinkingLevel: string | null;
  showThinking: boolean;
  showToolCalls: boolean;
  loading: boolean;
  sending: boolean;
  canAbort?: boolean;
  compactionStatus?: CompactionIndicatorStatus | null;
  runPhaseStatus?: RunPhaseStatus | null;
  fallbackStatus?: FallbackIndicatorStatus | null;
  messages: unknown[];
  toolMessages: unknown[];
  streamSegments: Array<{ text: string; ts: number }>;
  stream: string | null;
  streamStartedAt: number | null;
  assistantAvatarUrl?: string | null;
  draft: string;
  queue: ChatQueueItem[];
  sendFailures?: Record<string, ChatSendFailure>;
  connected: boolean;
  canSend: boolean;
  disabledReason: string | null;
  error: string | null;
  sessions: SessionsListResult | null;
  focusMode: boolean;
  sidebarOpen?: boolean;
  sidebarContent?: string | null;
  sidebarError?: string | null;
  splitRatio?: number;
  assistantName: string;
  assistantAvatar: string | null;
  attachments?: ChatAttachment[];
  getAttachments?: () => ChatAttachment[];
  onAttachmentsChange?: (attachments: ChatAttachment[]) => void;
  showNewMessages?: boolean;
  onScrollToBottom?: () => void;
  onRefresh: () => void;
  onToggleFocusMode: () => void;
  getDraft?: () => string;
  onDraftChange: (next: string) => void;
  onRequestUpdate?: () => void;
  onSend: () => void;
  onAbort?: () => void;
  onQueueRemove: (id: string) => void;
  onRetrySend?: (runId: string) => void;
  onNewSession: () => void;
  onClearHistory?: () => void;
  agentsList: {
    agents: Array<{ id: string; name?: string; identity?: { name?: string; avatarUrl?: string } }>;
    defaultId?: string;
  } | null;
  currentAgentId: string;
  onAgentChange: (agentId: string) => void;
  onNavigateToAgent?: () => void;
  onSessionSelect?: (sessionKey: string) => void;
  onOpenSidebar?: (content: string) => void;
  artifactFocus?: ArtifactFocusItem | null;
  onOpenArtifact?: (artifact: ArtifactFocusItem) => void;
  onCloseArtifact?: () => void;
  onCloseSidebar?: () => void;
  onSplitRatioChange?: (ratio: number) => void;
  onChatScroll?: (event: Event) => void;
  basePath?: string;
};

const COMPACTION_TOAST_DURATION_MS = 5000;
const FALLBACK_TOAST_DURATION_MS = 8000;

// Persistent instances keyed by session
const inputHistories = new Map<string, InputHistory>();
const pinnedMessagesMap = new Map<string, PinnedMessages>();
const deletedMessagesMap = new Map<string, DeletedMessages>();

function getInputHistory(sessionKey: string): InputHistory {
  return getOrCreateSessionCacheValue(inputHistories, sessionKey, () => new InputHistory());
}

function getPinnedMessages(sessionKey: string): PinnedMessages {
  return getOrCreateSessionCacheValue(
    pinnedMessagesMap,
    sessionKey,
    () => new PinnedMessages(sessionKey),
  );
}

function getDeletedMessages(sessionKey: string): DeletedMessages {
  return getOrCreateSessionCacheValue(
    deletedMessagesMap,
    sessionKey,
    () => new DeletedMessages(sessionKey),
  );
}

interface ChatEphemeralState {
  sttRecording: boolean;
  sttInterimText: string;
  slashMenuOpen: boolean;
  slashMenuItems: SlashCommandDef[];
  slashMenuIndex: number;
  slashMenuMode: "command" | "args";
  slashMenuCommand: SlashCommandDef | null;
  slashMenuArgItems: string[];
  searchOpen: boolean;
  searchQuery: string;
  pinnedExpanded: boolean;
}

function createChatEphemeralState(): ChatEphemeralState {
  return {
    sttRecording: false,
    sttInterimText: "",
    slashMenuOpen: false,
    slashMenuItems: [],
    slashMenuIndex: 0,
    slashMenuMode: "command",
    slashMenuCommand: null,
    slashMenuArgItems: [],
    searchOpen: false,
    searchQuery: "",
    pinnedExpanded: false,
  };
}

const vs = createChatEphemeralState();

/**
 * Reset chat view ephemeral state when navigating away.
 * Stops STT recording and clears search/slash UI that should not survive navigation.
 */
export function resetChatViewState() {
  if (vs.sttRecording) {
    stopStt();
  }
  Object.assign(vs, createChatEphemeralState());
}

export const cleanupChatModuleState = resetChatViewState;

function adjustTextareaHeight(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
}

function formatCompactionElapsed(startedAt: number | null | undefined) {
  if (!startedAt || !Number.isFinite(startedAt)) {
    return null;
  }
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function isKoreanLocale(): boolean {
  const lang =
    document.documentElement.lang?.trim() ||
    (typeof navigator.language === "string" ? navigator.language : "");
  return /^ko\b/i.test(lang);
}

function formatTokenDeltaCompact(before?: number, after?: number): string | null {
  if (
    typeof before !== "number" ||
    !Number.isFinite(before) ||
    before <= 0 ||
    typeof after !== "number" ||
    !Number.isFinite(after) ||
    after < 0
  ) {
    return null;
  }
  const clampedAfter = Math.min(before, after);
  const ratio = Math.max(0, Math.min(1, (before - clampedAfter) / before));
  const reducedPercent = Math.round(ratio * 100);
  if (isKoreanLocale()) {
    return `${formatTokensCompact(before)} -> ${formatTokensCompact(clampedAfter)} · ${reducedPercent}% 감소`;
  }
  return `${formatTokensCompact(before)} -> ${formatTokensCompact(clampedAfter)} · ${reducedPercent}% reduced`;
}

function renderCompactionIndicator(status: CompactionIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }
  const elapsedLabel = formatCompactionElapsed(status.startedAt);
  if (status.phase === "active") {
    return html`
      <div
        class="compaction-indicator compaction-indicator--active"
        role="status"
        aria-live="polite"
      >
        <div class="compaction-indicator__icon">${icons.loader}</div>
        <div class="compaction-indicator__content">
          <div class="compaction-indicator__title">Context compaction in progress</div>
          <div class="compaction-indicator__body">
            Preparing room for the next response. Your conversation is still running.
          </div>
        </div>
        ${elapsedLabel
          ? html`<div class="compaction-indicator__meta">Elapsed ${elapsedLabel}</div>`
          : nothing}
      </div>
    `;
  }
  if (status.phase === "retrying") {
    return html`
      <div
        class="compaction-indicator compaction-indicator--active"
        role="status"
        aria-live="polite"
      >
        <div class="compaction-indicator__icon">${icons.loader}</div>
        <div class="compaction-indicator__content">
          <div class="compaction-indicator__title">Continuing after compaction</div>
          <div class="compaction-indicator__body">
            Context was compacted successfully. Resuming the response now.
          </div>
        </div>
        ${elapsedLabel
          ? html`<div class="compaction-indicator__meta">Elapsed ${elapsedLabel}</div>`
          : nothing}
      </div>
    `;
  }
  if (status.phase === "complete" && status.completedAt) {
    const elapsed = Date.now() - status.completedAt;
    if (elapsed < COMPACTION_TOAST_DURATION_MS) {
      return html`
        <div
          class="compaction-indicator compaction-indicator--complete"
          role="status"
          aria-live="polite"
        >
          <div class="compaction-indicator__icon">${icons.check}</div>
          <div class="compaction-indicator__content">
            <div class="compaction-indicator__title">Context compaction complete</div>
          </div>
        </div>
      `;
    }
  }
  return nothing;
}

function renderFallbackIndicator(status: FallbackIndicatorStatus | null | undefined) {
  if (!status) {
    return nothing;
  }
  const phase = status.phase ?? "active";
  const elapsed = Date.now() - status.occurredAt;
  if (elapsed >= FALLBACK_TOAST_DURATION_MS) {
    return nothing;
  }
  const details = [
    `Selected: ${status.selected}`,
    phase === "cleared" ? `Active: ${status.selected}` : `Active: ${status.active}`,
    phase === "cleared" && status.previous ? `Previous fallback: ${status.previous}` : null,
    status.reason ? `Reason: ${status.reason}` : null,
    status.attempts.length > 0 ? `Attempts: ${status.attempts.slice(0, 3).join(" | ")}` : null,
  ]
    .filter(Boolean)
    .join(" • ");
  const message =
    phase === "cleared"
      ? `Fallback cleared: ${status.selected}`
      : `Fallback active: ${status.active}`;
  const className =
    phase === "cleared"
      ? "compaction-indicator compaction-indicator--fallback-cleared"
      : "compaction-indicator compaction-indicator--fallback";
  const icon = phase === "cleared" ? icons.check : icons.brain;
  return html`
    <div class=${className} role="status" aria-live="polite" title=${details}>
      ${icon} ${message}
    </div>
  `;
}

function normalizeChatErrorMessage(error: string): string {
  const trimmed = error.trim();
  if (!trimmed) {
    return "Request failed.";
  }
  const normalized = trimmed.toLowerCase();
  if (normalized.includes("timeout")) {
    return "Request failed. Timed out.";
  }
  if (normalized.includes("aborted")) {
    return "Request failed. Aborted.";
  }
  return `Request failed. ${trimmed}`;
}

type LiveRunStatus = {
  phase:
    | "sending"
    | "waiting"
    | "streaming"
    | "tool"
    | "compacting"
    | "retrying"
    | "queued"
    | "terminal";
  tone: "normal" | "attention" | "compaction" | "tool";
  title: string;
  body: string;
  meta: string;
  icon: TemplateResult;
  mascotPhase: EmployeeCrabMascotPhase;
  startedAt: number | null;
  elapsedMs: number;
  queueDepth: number;
};

type LiveRunViewKind =
  | "idle"
  | "queued"
  | "sending"
  | "waiting"
  | "compacting"
  | "retrying"
  | "tool"
  | "streaming"
  | "terminal";

type LiveRunViewState = Omit<LiveRunStatus, "phase"> & {
  kind: LiveRunViewKind;
};

function formatElapsedMs(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resolveElapsedMs(startedAt: number | null, endedAt?: number | null, elapsedMs?: number) {
  if (typeof elapsedMs === "number" && Number.isFinite(elapsedMs)) {
    return Math.max(0, elapsedMs);
  }
  if (!startedAt || !Number.isFinite(startedAt)) {
    return 0;
  }
  const end = typeof endedAt === "number" && Number.isFinite(endedAt) ? endedAt : Date.now();
  return Math.max(0, end - startedAt);
}

function waitCopy(elapsedMs: number) {
  if (elapsedMs >= 180_000) {
    return {
      title: "Still working",
      body: "The model API is taking longer than usual. Keep this tab open, or send /stop if you want to cancel.",
      tone: "attention" as const,
    };
  }
  if (elapsedMs >= 60_000) {
    return {
      title: "Waiting for model response",
      body: "Company model latency is higher than usual. The run is still active.",
      tone: "attention" as const,
    };
  }
  if (elapsedMs >= 20_000) {
    return {
      title: "Waiting for model response",
      body: "No output yet. This can happen while the model prepares a long answer.",
      tone: "normal" as const,
    };
  }
  return {
    title: "Preparing response",
    body: "Request accepted. Waiting for the first assistant update.",
    tone: "normal" as const,
  };
}

function compactionCopy(params: {
  elapsedMs: number;
  localizedKo: boolean;
  subtype: "runtime" | "preflight" | "memory_flush";
}) {
  const { elapsedMs, localizedKo, subtype } = params;
  if (subtype === "memory_flush") {
    return {
      title: localizedKo ? "기억 정리 중" : "Organizing memory",
      body: localizedKo
        ? "응답 전 필요한 기억을 정리하고 있습니다."
        : "Organizing the memory needed before the response continues.",
    };
  }
  if (subtype === "preflight") {
    if (elapsedMs >= 60_000) {
      return {
        title: localizedKo ? "대화 정리 중" : "Compacting conversation",
        body: localizedKo
          ? "예상보다 오래 걸리고 있습니다. 잠시만 기다려주세요."
          : "This is taking longer than expected. Please keep this tab open.",
      };
    }
    if (elapsedMs >= 10_000) {
      return {
        title: localizedKo ? "대화 정리 중" : "Compacting conversation",
        body: localizedKo
          ? "대화가 길어 정리에 시간이 조금 걸리고 있습니다."
          : "The conversation is long, so compaction is taking a little longer.",
      };
    }
    return {
      title: localizedKo ? "대화 정리 중" : "Compacting conversation",
      body: localizedKo
        ? "응답을 이어가기 전에 이전 대화를 정리하고 있습니다."
        : "Compressing earlier conversation before the response continues.",
    };
  }
  if (elapsedMs >= 60_000) {
    return {
      title: localizedKo ? "긴 대화 정리 중" : "Compacting context",
      body: localizedKo
        ? "예상보다 오래 걸리고 있습니다. 잠시만 기다려주세요."
        : "This is taking longer than expected. Please keep this tab open.",
    };
  }
  if (elapsedMs >= 10_000) {
    return {
      title: localizedKo ? "긴 대화 정리 중" : "Compacting context",
      body: localizedKo
        ? "대화가 길어 정리에 시간이 조금 걸리고 있습니다."
        : "The conversation is long, so compaction is taking a little longer.",
    };
  }
  if (elapsedMs >= 3_000) {
    return {
      title: localizedKo ? "긴 대화 정리 중" : "Compacting context",
      body: localizedKo
        ? "응답을 이어가기 위해 이전 대화를 정리하고 있습니다."
        : "Organizing earlier conversation so the response can continue.",
    };
  }
  return {
    title: localizedKo ? "긴 대화 정리 중" : "Compacting context",
    body: localizedKo
      ? "긴 대화를 정리 중입니다."
      : "Long conversation context is being organized.",
  };
}

function terminalRunPhaseCopy(runPhase: RunPhaseStatus, localizedKo: boolean) {
  if (runPhase.phase === "aborted") {
    return {
      title: localizedKo ? "응답이 중단되었습니다." : "Response stopped.",
      body: localizedKo
        ? "요청이 중단되어 더 이상 진행 중이 아닙니다."
        : "The request was aborted and is no longer running.",
    };
  }
  const code = runPhase.failedCode?.toLowerCase() ?? "";
  if (code.includes("timeout")) {
    return {
      title: localizedKo
        ? "AI 서버가 제한 시간 내에 응답하지 않았습니다."
        : "The AI server did not respond in time.",
      body: localizedKo
        ? "실행이 종료되어 더 이상 대기 중이 아닙니다."
        : "The run has ended and is no longer waiting for output.",
    };
  }
  return {
    title: localizedKo ? "응답 생성에 실패했습니다." : "Response failed.",
    body: localizedKo
      ? "실행이 실패하여 더 이상 진행 중이 아닙니다."
      : "The run failed and is no longer active.",
  };
}

function deriveLiveRunViewState(props: ChatProps): LiveRunViewState {
  const compaction = props.compactionStatus;
  const compactionActive = compaction?.phase === "active" || compaction?.phase === "retrying";
  const localizedKo = isKoreanLocale();
  const runPhase = props.runPhaseStatus;
  const runPhaseCompacting =
    runPhase?.phase === "preflight_compacting" || runPhase?.phase === "memory_flushing";
  const startedAt =
    runPhase?.startedAt ??
    (compactionActive ? (compaction.startedAt ?? props.streamStartedAt) : props.streamStartedAt);
  const elapsedMs = resolveElapsedMs(startedAt);
  const elapsed = formatElapsedMs(elapsedMs);
  const queueDepth = props.queue.length;

  if (!props.connected && (props.canAbort || props.stream !== null || props.sending)) {
    return {
      kind: "terminal",
      tone: "attention",
      title: localizedKo ? "연결이 끊겼습니다." : "Disconnected.",
      body: localizedKo
        ? "gateway 연결이 끊겨 현재 실행 상태를 확인할 수 없습니다."
        : "The gateway connection was lost, so the current run state cannot be verified.",
      meta: `${elapsed} elapsed`,
      icon: icons.x,
      mascotPhase: "attention",
      startedAt,
      elapsedMs,
      queueDepth,
    };
  }

  if (runPhase?.phase === "failed" || runPhase?.phase === "aborted") {
    const terminalElapsedMs = resolveElapsedMs(
      runPhase.startedAt,
      runPhase.endedAt,
      runPhase.elapsedMs,
    );
    const copy = terminalRunPhaseCopy(runPhase, localizedKo);
    return {
      kind: "terminal",
      tone: "attention",
      title: copy.title,
      body: copy.body,
      meta: `${formatElapsedMs(terminalElapsedMs)} elapsed`,
      icon: icons.x,
      mascotPhase: "attention",
      startedAt: runPhase.startedAt,
      elapsedMs: terminalElapsedMs,
      queueDepth,
    };
  }

  if (compaction?.phase === "retrying") {
    const tokenDelta = formatTokenDeltaCompact(compaction.tokensBefore, compaction.tokensAfter);
    return {
      kind: "retrying",
      tone: "compaction",
      title: localizedKo ? "응답 이어가는 중" : "Resuming response",
      body: localizedKo
        ? "대화 정리가 끝나서 응답을 다시 이어가고 있습니다."
        : "Compaction finished successfully. The assistant is resuming the response.",
      meta: tokenDelta ?? `${elapsed} elapsed`,
      icon: icons.check,
      mascotPhase: "retrying",
      startedAt,
      elapsedMs,
      queueDepth,
    };
  }

  if (props.stream !== null && props.stream.trim().length > 0) {
    return {
      kind: "streaming",
      tone: "normal",
      title: localizedKo ? "응답 작성 중" : "Writing response",
      body: localizedKo
        ? "assistant 답변이 생성되고 있습니다."
        : "Assistant output is arriving. The final message will settle when the run completes.",
      meta: `${elapsed} elapsed`,
      icon: icons.spark,
      mascotPhase: "streaming",
      startedAt,
      elapsedMs,
      queueDepth,
    };
  }

  if (props.toolMessages.length > 0) {
    return {
      kind: "tool",
      tone: "tool",
      title: localizedKo ? "도구 실행 중" : "Running tools",
      body: localizedKo
        ? "도구 결과를 바탕으로 답변을 정리하고 있습니다."
        : "Tool activity is streaming into the conversation. Results will be folded into the final answer.",
      meta: `${elapsed} elapsed`,
      icon: icons.terminal,
      mascotPhase: "tool",
      startedAt,
      elapsedMs,
      queueDepth,
    };
  }

  if (compaction?.phase === "incomplete" && !runPhaseCompacting) {
    const incompleteElapsedMs = resolveElapsedMs(compaction.startedAt, compaction.completedAt);
    return {
      kind: "compacting",
      tone: "compaction",
      title: localizedKo
        ? "대화 정리를 완료하지 못했습니다."
        : "Conversation cleanup was incomplete.",
      body: localizedKo
        ? "응답은 계속 진행될 수 있습니다."
        : "The response may still continue.",
      meta: `${formatElapsedMs(incompleteElapsedMs)} elapsed`,
      icon: icons.brain,
      mascotPhase: "attention",
      startedAt: compaction.startedAt,
      elapsedMs: incompleteElapsedMs,
      queueDepth,
    };
  }

  if (runPhase) {
    const tokenDelta = formatTokenDeltaCompact(compaction?.tokensBefore, compaction?.tokensAfter);
    if (runPhase.phase === "preflight_compacting") {
      const copy = compactionCopy({ elapsedMs, localizedKo, subtype: "preflight" });
      return {
        kind: "compacting",
        tone: "compaction",
        title: copy.title,
        body: copy.body,
        meta: tokenDelta ?? `${elapsed} elapsed`,
        icon: icons.loader,
        mascotPhase: "compacting",
        startedAt,
        elapsedMs,
        queueDepth,
      };
    }
    if (runPhase.phase === "memory_flushing") {
      const copy = compactionCopy({ elapsedMs, localizedKo, subtype: "memory_flush" });
      return {
        kind: "compacting",
        tone: "compaction",
        title: copy.title,
        body: copy.body,
        meta: `${elapsed} elapsed`,
        icon: icons.brain,
        mascotPhase: "compacting",
        startedAt,
        elapsedMs,
        queueDepth,
      };
    }
    if (runPhase.phase === "queued" && queueDepth > 0) {
      return {
        kind: "queued",
        tone: "normal",
        title: localizedKo ? "후속 요청 대기 중" : "Pending follow-up",
        body: localizedKo
          ? "현재 실행이 끝나면 후속 요청을 이어서 처리합니다."
          : "This follow-up request will start after the current run completes.",
        meta: localizedKo ? `${queueDepth}건 대기` : `${queueDepth} queued`,
        icon: icons.loader,
        mascotPhase: "queued",
        startedAt: null,
        elapsedMs: 0,
        queueDepth,
      };
    }
    if (runPhase.phase === "running" && props.stream === null && props.toolMessages.length === 0) {
      return {
        kind: "waiting",
        tone: "normal",
        title: localizedKo ? "응답 준비 중" : "Preparing response",
        body: localizedKo
          ? "assistant가 답변을 준비하고 있습니다."
          : "The assistant is preparing the response.",
        meta: `${elapsed} elapsed`,
        icon: icons.brain,
        mascotPhase: "waiting",
        startedAt,
        elapsedMs,
        queueDepth,
      };
    }
  }

  if (compactionActive) {
    const tokenDelta = formatTokenDeltaCompact(compaction?.tokensBefore, compaction?.tokensAfter);
    const copy = compactionCopy({ elapsedMs, localizedKo, subtype: "runtime" });
    return {
      kind: "compacting",
      tone: "compaction",
      title: copy.title,
      body: copy.body,
      meta: tokenDelta ?? `${elapsed} elapsed`,
      icon: icons.loader,
      mascotPhase: "compacting",
      startedAt,
      elapsedMs,
      queueDepth,
    };
  }

  if (props.sending) {
    return {
      kind: "sending",
      tone: "normal",
      title: localizedKo ? "요청 전송 중" : "Sending request",
      body: localizedKo
        ? "브라우저가 메시지를 gateway로 전달하고 있습니다."
        : "The browser is handing this message to the gateway.",
      meta: `${elapsed} elapsed`,
      icon: icons.loader,
      mascotPhase: "sending",
      startedAt,
      elapsedMs,
      queueDepth,
    };
  }

  if (props.canAbort || props.stream !== null) {
    const copy = waitCopy(elapsedMs);
    return {
      kind: "waiting",
      tone: copy.tone,
      title: copy.title,
      body: copy.body,
      meta: `${elapsed} elapsed`,
      icon: icons.brain,
      mascotPhase: copy.tone === "attention" ? "attention" : "waiting",
      startedAt,
      elapsedMs,
      queueDepth,
    };
  }

  if (queueDepth > 0) {
    return {
      kind: "queued",
      tone: "normal",
      title: localizedKo ? "후속 요청 대기 중" : "Pending follow-up",
      body: localizedKo
        ? "현재 실행이 끝나면 후속 요청을 이어서 처리합니다."
        : "This follow-up request will start after the current run completes.",
      meta: localizedKo ? `${queueDepth}건 대기` : `${queueDepth} queued`,
      icon: icons.loader,
      mascotPhase: "queued",
      startedAt: null,
      elapsedMs: 0,
      queueDepth,
    };
  }

  return {
    kind: "idle",
    tone: "normal",
    title: "",
    body: "",
    meta: "",
    icon: icons.loader,
    mascotPhase: "idle",
    startedAt: null,
    elapsedMs: 0,
    queueDepth,
  };
}

function adaptLiveRunViewStateToLegacyStatus(state: LiveRunViewState): LiveRunStatus | null {
  if (state.kind === "idle") {
    return null;
  }
  return {
    ...state,
    phase: state.kind,
  };
}

function deriveLiveRunStatus(props: ChatProps): LiveRunStatus | null {
  return adaptLiveRunViewStateToLegacyStatus(deriveLiveRunViewState(props));
}

function renderLiveRunMascot(status: LiveRunViewState) {
  return renderEmployeeCrabMascot(status.mascotPhase);
}

function renderLiveRunStatusBanner(status: LiveRunViewState) {
  const phaseLabel = status.kind.replace("-", " ");
  return html`
    <div
      class="live-run-status live-run-status--${status.tone}"
      role="status"
      aria-live="polite"
      data-phase=${status.kind}
    >
      <div class="live-run-status__rail" aria-hidden="true"></div>
      <div class="live-run-status__icon" aria-hidden="true">
        ${renderLiveRunMascot(status)}
      </div>
      <div class="live-run-status__main">
        <div class="live-run-status__topline">
          <span class="live-run-status__title">${status.title}</span>
          <span class="live-run-status__phase">${phaseLabel}</span>
        </div>
        <div class="live-run-status__body">${status.body}</div>
      </div>
      <div class="live-run-status__meta">
        <span>${status.meta}</span>
      </div>
    </div>
  `;
}

function renderRequestStatus(props: ChatProps, viewState: LiveRunViewState) {
  if (props.error) {
    return html`<div class="callout danger">${normalizeChatErrorMessage(props.error)}</div>`;
  }
  if (viewState.kind === "idle") {
    return nothing;
  }
  return renderLiveRunStatusBanner(viewState);
}

function shouldShowStopButton(props: ChatProps, viewState: LiveRunViewState): boolean {
  if (!props.connected || !props.canAbort || !props.onAbort) {
    return false;
  }
  return viewState.kind !== "idle" && viewState.kind !== "queued" && viewState.kind !== "terminal";
}

type ComposerSubmitMode = "send" | "queue";

type ComposerControlState = {
  inputDisabled: boolean;
  submitDisabled: boolean;
  submitMode: ComposerSubmitMode;
  submitTitle: "Send" | "Queue";
  submitAriaLabel: "Send message" | "Queue message";
};

function deriveComposerControlState(
  props: ChatProps,
  _viewState: LiveRunViewState,
): ComposerControlState {
  // Mirrors app-chat's transport-level queue decision: chatSending or an active chatRunId.
  const submitMode: ComposerSubmitMode = props.sending || props.canAbort ? "queue" : "send";
  return {
    inputDisabled: !props.connected,
    submitDisabled: !props.connected || props.sending || !props.canSend,
    submitMode,
    submitTitle: submitMode === "queue" ? "Queue" : "Send",
    submitAriaLabel: submitMode === "queue" ? "Queue message" : "Send message",
  };
}

/**
 * Compact notice when context usage reaches 85%+.
 * Progressively shifts from amber (85%) to red (90%+).
 */
/** Parse a 6-digit CSS hex color string to [r, g, b] integer components. */
function parseHexRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    return null;
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

let cachedThemeNoticeColors: {
  warnHex: string;
  dangerHex: string;
  warnRgb: [number, number, number];
  dangerRgb: [number, number, number];
} | null = null;

function getThemeNoticeColors() {
  if (cachedThemeNoticeColors) {
    return cachedThemeNoticeColors;
  }
  const rootStyle = getComputedStyle(document.documentElement);
  const warnHex = rootStyle.getPropertyValue("--warn").trim() || "#f59e0b";
  const dangerHex = rootStyle.getPropertyValue("--danger").trim() || "#ef4444";
  cachedThemeNoticeColors = {
    warnHex,
    dangerHex,
    warnRgb: parseHexRgb(warnHex) ?? [245, 158, 11],
    dangerRgb: parseHexRgb(dangerHex) ?? [239, 68, 68],
  };
  return cachedThemeNoticeColors;
}

function renderContextNotice(
  session: GatewaySessionRow | undefined,
  defaultContextTokens: number | null,
) {
  if (session?.totalTokensFresh === false) {
    return nothing;
  }
  const used = session?.totalTokens ?? 0;
  const limit = session?.contextTokens ?? defaultContextTokens ?? 0;
  if (!used || !limit) {
    return nothing;
  }
  const ratio = used / limit;
  if (ratio < 0.85) {
    return nothing;
  }
  const pct = Math.min(Math.round(ratio * 100), 100);
  // Read theme semantic tokens so color tracks the active theme (Dash, dark, light …)
  const { warnRgb, dangerRgb } = getThemeNoticeColors();
  const [wr, wg, wb] = warnRgb;
  const [dr, dg, db] = dangerRgb;
  // Blend from --warn at 85% usage to --danger at 95%+ usage
  const t = Math.min(Math.max((ratio - 0.85) / 0.1, 0), 1);
  const r = Math.round(wr + (dr - wr) * t);
  const g = Math.round(wg + (dg - wg) * t);
  const b = Math.round(wb + (db - wb) * t);
  const color = `rgb(${r}, ${g}, ${b})`;
  const bgOpacity = 0.08 + 0.08 * t;
  const bg = `rgba(${r}, ${g}, ${b}, ${bgOpacity})`;
  return html`
    <div class="context-notice" role="status" style="--ctx-color:${color};--ctx-bg:${bg}">
      <svg
        class="context-notice__icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>${pct}% context used</span>
      <span class="context-notice__detail"
        >${formatTokensCompact(used)} / ${formatTokensCompact(limit)}</span
      >
    </div>
  `;
}

/** Format token count compactly (e.g. 128000 → "128k"). */
function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(n);
}

function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function parseJsonOrThrow<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | T | null;
  if (!response.ok) {
    throw new Error(
      typeof (data as { error?: unknown } | null)?.error === "string"
        ? (data as { error: string }).error
        : `${response.status} ${response.statusText}`,
    );
  }
  return data as T;
}

function formatAttachmentSize(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(2).replace(/\.00$/, "")} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  }
  return `${sizeBytes} B`;
}

function attachmentStatusLabel(att: ChatAttachment): string {
  switch (att.status) {
    case "uploading":
      return "Uploading";
    case "image":
      return "Image";
    case "inline":
      return "Inline";
    case "workspace":
      return "Workspace";
    case "failed":
      return "Failed";
  }
}

function updateAttachment(props: ChatProps, attachmentId: string, patch: Partial<ChatAttachment>) {
  const currentAttachments = props.getAttachments?.() ?? props.attachments ?? [];
  props.onAttachmentsChange?.(
    currentAttachments.map((entry) => (entry.id === attachmentId ? { ...entry, ...patch } : entry)),
  );
}

async function deletePendingAttachment(att: ChatAttachment) {
  if (!att.workspacePath) {
    return;
  }
  const response = await fetch(EMPLOYEE_CHAT_ATTACHMENTS_DELETE_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspacePath: att.workspacePath }),
  });
  await parseJsonOrThrow<{ ok: true }>(response);
}

async function uploadChatAttachment(
  props: ChatProps,
  attachmentId: string,
  file: File,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", EMPLOYEE_CHAT_ATTACHMENTS_UPLOAD_PATH);
    xhr.withCredentials = true;
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) {
        return;
      }
      updateAttachment(props, attachmentId, {
        progress: Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))),
      });
    });
    xhr.addEventListener("load", () => {
      let parsed: EmployeeChatAttachmentUploadResponse | { error?: string } | null = null;
      try {
        parsed = xhr.responseText
          ? (JSON.parse(xhr.responseText) as EmployeeChatAttachmentUploadResponse)
          : null;
      } catch {
        parsed = null;
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed && "attachment" in parsed) {
        const uploaded = parsed.attachment;
        updateAttachment(props, attachmentId, {
          kind: uploaded.type,
          fileName: uploaded.originalFileName,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          status: uploaded.promptMode,
          progress: 100,
          workspacePath: uploaded.workspacePath,
          storedFileName: uploaded.storedFileName,
          inlineContent: uploaded.inlineContent,
          inlineTruncated: uploaded.inlineTruncated,
          error: null,
        });
        resolve();
        return;
      }
      reject(
        new Error(
          typeof (parsed as { error?: string } | null)?.error === "string"
            ? (parsed as unknown as { error: string }).error
            : `${xhr.status} ${xhr.statusText}`,
        ),
      );
    });
    xhr.addEventListener("error", () => reject(new Error("Upload failed.")));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

function enqueueAttachments(props: ChatProps, files: File[]) {
  if (!props.onAttachmentsChange || files.length === 0) {
    return;
  }
  const current = props.getAttachments?.() ?? props.attachments ?? [];
  const additions = files.map((file) => ({
    id: generateAttachmentId(),
    kind: file.type.startsWith("image/") ? ("image" as const) : ("file" as const),
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    status: "uploading" as const,
    progress: 0,
    error: null,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    file,
  }));
  props.onAttachmentsChange([...current, ...additions]);
  for (const [index, file] of files.entries()) {
    const placeholder = additions[index];
    void uploadChatAttachment(props, placeholder.id, file).catch((err) => {
      updateAttachment(props, placeholder.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
}

function handlePaste(e: ClipboardEvent, props: ChatProps) {
  const items = e.clipboardData?.items;
  if (!items || !props.onAttachmentsChange) {
    return;
  }
  const imageItems: DataTransferItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type.startsWith("image/")) {
      imageItems.push(item);
    }
  }
  if (imageItems.length === 0) {
    return;
  }
  e.preventDefault();
  const files: File[] = [];
  for (const item of imageItems) {
    const file = item.getAsFile();
    if (!file) {
      continue;
    }
    files.push(file);
  }
  enqueueAttachments(props, files);
}

function handleFileSelect(e: Event, props: ChatProps) {
  const input = e.target as HTMLInputElement;
  if (!input.files || !props.onAttachmentsChange) {
    return;
  }
  const files: File[] = [];
  for (const file of input.files) {
    if (!isSupportedChatAttachmentMimeType(file.type)) {
      continue;
    }
    files.push(file);
  }
  enqueueAttachments(props, files);
  input.value = "";
}

function handleDrop(e: DragEvent, props: ChatProps) {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (!files || !props.onAttachmentsChange) {
    return;
  }
  const additions: File[] = [];
  for (const file of files) {
    if (!isSupportedChatAttachmentMimeType(file.type)) {
      continue;
    }
    additions.push(file);
  }
  enqueueAttachments(props, additions);
}

function renderAttachmentPreview(props: ChatProps): TemplateResult | typeof nothing {
  const attachments = props.attachments ?? [];
  if (attachments.length === 0) {
    return nothing;
  }
  return html`
    <div class="chat-attachments-preview">
      ${attachments.map(
        (att) => html`
          <div class="chat-attachment-card ${att.status === "failed" ? "is-error" : ""}">
            <div class="chat-attachment-card__icon">
              ${att.kind === "image" && att.previewUrl
                ? html`<img src=${att.previewUrl} alt=${att.fileName} />`
                : icons.fileText}
            </div>
            <div class="chat-attachment-card__body">
              <div class="chat-attachment-card__name" title=${att.fileName}>${att.fileName}</div>
              <div class="chat-attachment-card__meta">
                <span>${formatAttachmentSize(att.sizeBytes)}</span>
                <span>${attachmentStatusLabel(att)}</span>
                ${att.error ? html`<span>${att.error}</span>` : nothing}
              </div>
            </div>
            ${att.status === "uploading"
              ? html`
                  <div
                    class="chat-attachment-card__progress"
                    style=${`--chat-attachment-progress:${att.progress}%`}
                    aria-label=${`Uploading ${att.fileName}: ${att.progress}%`}
                  >
                    <span>${att.progress}</span>
                  </div>
                `
              : nothing}
            <button
              class="chat-attachment-remove chat-attachment-remove--card"
              type="button"
              aria-label="Remove attachment"
              @click=${async () => {
                try {
                  if (att.status !== "uploading" && att.workspacePath) {
                    await deletePendingAttachment(att);
                  }
                } catch {
                  // Keep local removal responsive even if cleanup fails.
                } finally {
                  const next = (props.getAttachments?.() ?? props.attachments ?? []).filter(
                    (a) => a.id !== att.id,
                  );
                  props.onAttachmentsChange?.(next);
                }
              }}
            >
              &times;
            </button>
          </div>
        `,
      )}
    </div>
  `;
}

function resetSlashMenuState(): void {
  vs.slashMenuMode = "command";
  vs.slashMenuCommand = null;
  vs.slashMenuArgItems = [];
  vs.slashMenuItems = [];
}

function updateSlashMenu(value: string, requestUpdate: () => void): void {
  // Arg mode: /command <partial-arg>
  const argMatch = value.match(/^\/(\S+)\s(.*)$/);
  if (argMatch) {
    const cmdName = normalizeLowercaseStringOrEmpty(argMatch[1]);
    const argFilter = normalizeLowercaseStringOrEmpty(argMatch[2]);
    const cmd = SLASH_COMMANDS.find((c) => c.name === cmdName);
    if (cmd?.argOptions?.length) {
      const filtered = argFilter
        ? cmd.argOptions.filter((opt) => normalizeLowercaseStringOrEmpty(opt).startsWith(argFilter))
        : cmd.argOptions;
      if (filtered.length > 0) {
        vs.slashMenuMode = "args";
        vs.slashMenuCommand = cmd;
        vs.slashMenuArgItems = filtered;
        vs.slashMenuOpen = true;
        vs.slashMenuIndex = 0;
        vs.slashMenuItems = [];
        requestUpdate();
        return;
      }
    }
    vs.slashMenuOpen = false;
    resetSlashMenuState();
    requestUpdate();
    return;
  }

  // Command mode: /partial-command
  const match = value.match(/^\/(\S*)$/);
  if (match) {
    const items = getSlashCommandCompletions(match[1]);
    vs.slashMenuItems = items;
    vs.slashMenuOpen = items.length > 0;
    vs.slashMenuIndex = 0;
    vs.slashMenuMode = "command";
    vs.slashMenuCommand = null;
    vs.slashMenuArgItems = [];
  } else {
    vs.slashMenuOpen = false;
    resetSlashMenuState();
  }
  requestUpdate();
}

function selectSlashCommand(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
): void {
  // Transition to arg picker when the command has fixed options
  if (cmd.argOptions?.length) {
    props.onDraftChange(`/${cmd.name} `);
    vs.slashMenuMode = "args";
    vs.slashMenuCommand = cmd;
    vs.slashMenuArgItems = cmd.argOptions;
    vs.slashMenuOpen = true;
    vs.slashMenuIndex = 0;
    vs.slashMenuItems = [];
    requestUpdate();
    return;
  }

  vs.slashMenuOpen = false;
  resetSlashMenuState();

  if (cmd.executeLocal && !cmd.args) {
    props.onDraftChange(`/${cmd.name}`);
    requestUpdate();
    props.onSend();
  } else {
    props.onDraftChange(`/${cmd.name} `);
    requestUpdate();
  }
}

function tabCompleteSlashCommand(
  cmd: SlashCommandDef,
  props: ChatProps,
  requestUpdate: () => void,
): void {
  // Tab: fill in the command text without executing
  if (cmd.argOptions?.length) {
    props.onDraftChange(`/${cmd.name} `);
    vs.slashMenuMode = "args";
    vs.slashMenuCommand = cmd;
    vs.slashMenuArgItems = cmd.argOptions;
    vs.slashMenuOpen = true;
    vs.slashMenuIndex = 0;
    vs.slashMenuItems = [];
    requestUpdate();
    return;
  }

  vs.slashMenuOpen = false;
  resetSlashMenuState();
  props.onDraftChange(cmd.args ? `/${cmd.name} ` : `/${cmd.name}`);
  requestUpdate();
}

function selectSlashArg(
  arg: string,
  props: ChatProps,
  requestUpdate: () => void,
  execute: boolean,
): void {
  const cmdName = vs.slashMenuCommand?.name ?? "";
  vs.slashMenuOpen = false;
  resetSlashMenuState();
  props.onDraftChange(`/${cmdName} ${arg}`);
  requestUpdate();
  if (execute) {
    props.onSend();
  }
}

function tokenEstimate(draft: string): string | null {
  if (draft.length < 100) {
    return null;
  }
  return `~${Math.ceil(draft.length / 4)} tokens`;
}

/**
 * Export chat markdown - delegates to shared utility.
 */
function exportMarkdown(props: ChatProps): void {
  exportChatMarkdown(props.messages, props.assistantName);
}

const WELCOME_SUGGESTIONS = [
  "What can you do?",
  "Summarize my recent sessions",
  "Help me configure a channel",
  "Check system health",
];

function renderWelcomeState(props: ChatProps): TemplateResult {
  const name = props.assistantName || "Assistant";
  const avatar = resolveAgentAvatarUrl({
    identity: {
      avatar: props.assistantAvatar ?? undefined,
      avatarUrl: props.assistantAvatarUrl ?? undefined,
    },
  });
  const logoUrl = props.employeeMode
    ? employeeLogoUrl(props.basePath ?? "")
    : agentLogoUrl(props.basePath ?? "");
  const displayName = props.employeeMode ? "PlatformClaw" : name;
  const suggestions = props.employeeMode
    ? [
        "오늘 해야 할 일을 정리해줘",
        "방금 대화한 내용을 요약해줘",
        "보낼 답장을 초안으로 만들어줘",
        "다음 단계 업무를 추천해줘",
      ]
    : WELCOME_SUGGESTIONS;

  return html`
    <div class="agent-chat__welcome" style="--agent-color: var(--accent)">
      <div class="agent-chat__welcome-glow"></div>
      ${avatar
        ? html`<img
            src=${avatar}
            alt=${displayName}
            style="width:56px; height:56px; border-radius:50%; object-fit:cover;"
          />`
        : html`<div class="agent-chat__avatar agent-chat__avatar--logo">
            <img src=${logoUrl} alt=${displayName} />
          </div>`}
      <h2>${displayName}</h2>
      <div class="agent-chat__badges">
        <span class="agent-chat__badge"
          ><img src=${logoUrl} alt="" /> ${props.employeeMode
            ? "PlatformClaw Workspace"
            : "Ready to chat"}</span
        >
      </div>
      <p class="agent-chat__hint">
        ${props.employeeMode
          ? "업무 관련 질문, 요약, 초안 작성, 다음 단계 정리까지 자연스럽게 요청할 수 있습니다."
          : html`Type a message below &middot; <kbd>/</kbd> for commands`}
      </p>
      <div class="agent-chat__suggestions">
        ${suggestions.map(
          (text) => html`
            <button
              type="button"
              class="agent-chat__suggestion"
              @click=${() => {
                props.onDraftChange(text);
                props.onSend();
              }}
            >
              ${text}
            </button>
          `,
        )}
      </div>
    </div>
  `;
}

function renderSearchBar(requestUpdate: () => void): TemplateResult | typeof nothing {
  if (!vs.searchOpen) {
    return nothing;
  }
  return html`
    <div class="agent-chat__search-bar">
      ${icons.search}
      <input
        type="text"
        placeholder="Search messages..."
        aria-label="Search messages"
        .value=${vs.searchQuery}
        @input=${(e: Event) => {
          vs.searchQuery = (e.target as HTMLInputElement).value;
          requestUpdate();
        }}
      />
      <button
        class="btn btn--ghost"
        aria-label="Close search"
        @click=${() => {
          vs.searchOpen = false;
          vs.searchQuery = "";
          requestUpdate();
        }}
      >
        ${icons.x}
      </button>
    </div>
  `;
}

function renderPinnedSection(
  props: ChatProps,
  pinned: PinnedMessages,
  requestUpdate: () => void,
): TemplateResult | typeof nothing {
  const messages = Array.isArray(props.messages) ? props.messages : [];
  const entries: Array<{ index: number; text: string; role: string }> = [];
  for (const idx of pinned.indices) {
    const msg = messages[idx] as Record<string, unknown> | undefined;
    if (!msg) {
      continue;
    }
    const text = getPinnedMessageSummary(msg);
    const role = typeof msg.role === "string" ? msg.role : "unknown";
    entries.push({ index: idx, text, role });
  }
  if (entries.length === 0) {
    return nothing;
  }
  return html`
    <div class="agent-chat__pinned">
      <button
        class="agent-chat__pinned-toggle"
        @click=${() => {
          vs.pinnedExpanded = !vs.pinnedExpanded;
          requestUpdate();
        }}
      >
        ${icons.bookmark} ${entries.length} pinned
        <span class="collapse-chevron ${vs.pinnedExpanded ? "" : "collapse-chevron--collapsed"}"
          >${icons.chevronDown}</span
        >
      </button>
      ${vs.pinnedExpanded
        ? html`
            <div class="agent-chat__pinned-list">
              ${entries.map(
                ({ index, text, role }) => html`
                  <div class="agent-chat__pinned-item">
                    <span class="agent-chat__pinned-role"
                      >${role === "user" ? "You" : "Assistant"}</span
                    >
                    <span class="agent-chat__pinned-text"
                      >${text.slice(0, 100)}${text.length > 100 ? "..." : ""}</span
                    >
                    <button
                      class="btn btn--ghost"
                      @click=${() => {
                        pinned.unpin(index);
                        requestUpdate();
                      }}
                      title="Unpin"
                    >
                      ${icons.x}
                    </button>
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderSlashMenu(
  requestUpdate: () => void,
  props: ChatProps,
): TemplateResult | typeof nothing {
  if (!vs.slashMenuOpen) {
    return nothing;
  }

  // Arg-picker mode: show options for the selected command
  if (vs.slashMenuMode === "args" && vs.slashMenuCommand && vs.slashMenuArgItems.length > 0) {
    return html`
      <div class="slash-menu" role="listbox" aria-label="Command arguments">
        <div class="slash-menu-group">
          <div class="slash-menu-group__label">
            /${vs.slashMenuCommand.name} ${vs.slashMenuCommand.description}
          </div>
          ${vs.slashMenuArgItems.map(
            (arg, i) => html`
              <div
                class="slash-menu-item ${i === vs.slashMenuIndex ? "slash-menu-item--active" : ""}"
                role="option"
                aria-selected=${i === vs.slashMenuIndex}
                @click=${() => selectSlashArg(arg, props, requestUpdate, true)}
                @mouseenter=${() => {
                  vs.slashMenuIndex = i;
                  requestUpdate();
                }}
              >
                ${vs.slashMenuCommand?.icon
                  ? html`<span class="slash-menu-icon">${icons[vs.slashMenuCommand.icon]}</span>`
                  : nothing}
                <span class="slash-menu-name">${arg}</span>
                <span class="slash-menu-desc">/${vs.slashMenuCommand?.name} ${arg}</span>
              </div>
            `,
          )}
        </div>
        <div class="slash-menu-footer">
          <kbd>↑↓</kbd> navigate <kbd>Tab</kbd> fill <kbd>Enter</kbd> run <kbd>Esc</kbd> close
        </div>
      </div>
    `;
  }

  // Command mode: show grouped commands
  if (vs.slashMenuItems.length === 0) {
    return nothing;
  }

  const grouped = new Map<
    SlashCommandCategory,
    Array<{ cmd: SlashCommandDef; globalIdx: number }>
  >();
  for (let i = 0; i < vs.slashMenuItems.length; i++) {
    const cmd = vs.slashMenuItems[i];
    const cat = cmd.category ?? "session";
    let list = grouped.get(cat);
    if (!list) {
      list = [];
      grouped.set(cat, list);
    }
    list.push({ cmd, globalIdx: i });
  }

  const sections: TemplateResult[] = [];
  for (const [cat, entries] of grouped) {
    sections.push(html`
      <div class="slash-menu-group">
        <div class="slash-menu-group__label">${CATEGORY_LABELS[cat]}</div>
        ${entries.map(
          ({ cmd, globalIdx }) => html`
            <div
              class="slash-menu-item ${globalIdx === vs.slashMenuIndex
                ? "slash-menu-item--active"
                : ""}"
              role="option"
              aria-selected=${globalIdx === vs.slashMenuIndex}
              @click=${() => selectSlashCommand(cmd, props, requestUpdate)}
              @mouseenter=${() => {
                vs.slashMenuIndex = globalIdx;
                requestUpdate();
              }}
            >
              ${cmd.icon ? html`<span class="slash-menu-icon">${icons[cmd.icon]}</span>` : nothing}
              <span class="slash-menu-name">/${cmd.name}</span>
              ${cmd.args ? html`<span class="slash-menu-args">${cmd.args}</span>` : nothing}
              <span class="slash-menu-desc">${cmd.description}</span>
              ${cmd.argOptions?.length
                ? html`<span class="slash-menu-badge">${cmd.argOptions.length} options</span>`
                : cmd.executeLocal && !cmd.args
                  ? html` <span class="slash-menu-badge">instant</span> `
                  : nothing}
            </div>
          `,
        )}
      </div>
    `);
  }

  return html`
    <div class="slash-menu" role="listbox" aria-label="Slash commands">
      ${sections}
      <div class="slash-menu-footer">
        <kbd>↑↓</kbd> navigate <kbd>Tab</kbd> fill <kbd>Enter</kbd> select <kbd>Esc</kbd> close
      </div>
    </div>
  `;
}

export function renderChat(props: ChatProps) {
  const isBusy = props.sending || props.stream !== null || props.canAbort;
  const canAbort = Boolean(props.canAbort && props.onAbort);
  const liveRunViewState = deriveLiveRunViewState(props);
  const showStopButton = shouldShowStopButton(props, liveRunViewState);
  const composerControls = deriveComposerControlState(props, liveRunViewState);
  const activeSession = props.sessions?.sessions?.find((row) => row.key === props.sessionKey);
  const reasoningLevel = activeSession?.reasoningLevel ?? "off";
  const showReasoning = props.showThinking && reasoningLevel !== "off";
  const assistantIdentity = {
    name: props.assistantName,
    avatar:
      resolveAgentAvatarUrl({
        identity: {
          avatar: props.assistantAvatar ?? undefined,
          avatarUrl: props.assistantAvatarUrl ?? undefined,
        },
      }) ?? null,
  };
  const pinned = getPinnedMessages(props.sessionKey);
  const deleted = getDeletedMessages(props.sessionKey);
  const inputHistory = getInputHistory(props.sessionKey);
  const hasAttachments = (props.attachments?.length ?? 0) > 0;
  const tokens = tokenEstimate(props.draft);

  const placeholder = props.connected
    ? hasAttachments
      ? "Add a message or paste more images..."
      : `Message ${props.assistantName || "agent"} (Enter to send)`
    : "Connect to the gateway to start chatting...";

  const requestUpdate = props.onRequestUpdate ?? (() => {});
  const getDraft = props.getDraft ?? (() => props.draft);

  const splitRatio = props.splitRatio ?? 0.6;
  const sidebarOpen = Boolean(props.sidebarOpen && props.onCloseSidebar);

  const handleCodeBlockCopy = (e: Event) => {
    const btn = (e.target as HTMLElement).closest(".code-block-copy");
    if (!btn) {
      return;
    }
    const code = (btn as HTMLElement).dataset.code ?? "";
    navigator.clipboard.writeText(code).then(
      () => {
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 1500);
      },
      () => {},
    );
  };

  const chatItems = buildChatItems(props);
  const isEmpty = chatItems.length === 0 && !props.loading;

  const thread = html`
    <div
      class="chat-thread"
      role="log"
      aria-live="polite"
      @scroll=${props.onChatScroll}
      @click=${handleCodeBlockCopy}
    >
      <div class="chat-thread-inner">
        ${props.loading
          ? html`
              <div class="chat-loading-skeleton" aria-label="Loading chat">
                <div class="chat-line assistant">
                  <div class="chat-msg">
                    <div class="chat-bubble">
                      <div
                        class="skeleton skeleton-line skeleton-line--long"
                        style="margin-bottom: 8px"
                      ></div>
                      <div
                        class="skeleton skeleton-line skeleton-line--medium"
                        style="margin-bottom: 8px"
                      ></div>
                      <div class="skeleton skeleton-line skeleton-line--short"></div>
                    </div>
                  </div>
                </div>
                <div class="chat-line user" style="margin-top: 12px">
                  <div class="chat-msg">
                    <div class="chat-bubble">
                      <div class="skeleton skeleton-line skeleton-line--medium"></div>
                    </div>
                  </div>
                </div>
                <div class="chat-line assistant" style="margin-top: 12px">
                  <div class="chat-msg">
                    <div class="chat-bubble">
                      <div
                        class="skeleton skeleton-line skeleton-line--long"
                        style="margin-bottom: 8px"
                      ></div>
                      <div class="skeleton skeleton-line skeleton-line--short"></div>
                    </div>
                  </div>
                </div>
              </div>
            `
          : nothing}
        ${isEmpty && !vs.searchOpen ? renderWelcomeState(props) : nothing}
        ${isEmpty && vs.searchOpen
          ? html` <div class="agent-chat__empty">No matching messages</div> `
          : nothing}
        ${repeat(
          chatItems,
          (item) => item.key,
          (item) => {
            if (item.kind === "divider") {
              return html`
                <div class="chat-divider" role="separator" data-ts=${String(item.timestamp)}>
                  <span class="chat-divider__line"></span>
                  <span class="chat-divider__label">${item.label}</span>
                  <span class="chat-divider__line"></span>
                </div>
              `;
            }
            if (item.kind === "reading-indicator") {
              return renderReadingIndicatorGroup(assistantIdentity, props.basePath);
            }
            if (item.kind === "stream") {
              return renderStreamingGroup(
                item.text,
                item.startedAt,
                props.onOpenSidebar,
                assistantIdentity,
                props.basePath,
              );
            }
            if (item.kind === "group") {
              if (deleted.has(item.key)) {
                return nothing;
              }
              return renderMessageGroup(item, {
                onOpenSidebar: props.onOpenSidebar,
                onOpenArtifact: props.onOpenArtifact,
                showReasoning,
                showToolCalls: props.showToolCalls,
                assistantName: props.assistantName,
                assistantAvatar: assistantIdentity.avatar,
                basePath: props.basePath,
                contextWindow:
                  activeSession?.contextTokens ?? props.sessions?.defaults?.contextTokens ?? null,
                onDelete: () => {
                  deleted.delete(item.key);
                  requestUpdate();
                },
                sendFailures: props.sendFailures,
                retryDisabled: !props.connected || isBusy,
                onRetrySend: props.onRetrySend,
                localizedKo: props.employeeMode === true,
              });
            }
            return nothing;
          },
        )}
      </div>
    </div>
  `;

  const handleKeyDown = (e: KeyboardEvent) => {
    // Slash menu navigation — arg mode
    if (vs.slashMenuOpen && vs.slashMenuMode === "args" && vs.slashMenuArgItems.length > 0) {
      const len = vs.slashMenuArgItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex + 1) % len;
          requestUpdate();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex - 1 + len) % len;
          requestUpdate();
          return;
        case "Tab":
          e.preventDefault();
          selectSlashArg(vs.slashMenuArgItems[vs.slashMenuIndex], props, requestUpdate, false);
          return;
        case "Enter":
          e.preventDefault();
          selectSlashArg(vs.slashMenuArgItems[vs.slashMenuIndex], props, requestUpdate, true);
          return;
        case "Escape":
          e.preventDefault();
          vs.slashMenuOpen = false;
          resetSlashMenuState();
          requestUpdate();
          return;
      }
    }

    // Slash menu navigation — command mode
    if (vs.slashMenuOpen && vs.slashMenuItems.length > 0) {
      const len = vs.slashMenuItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex + 1) % len;
          requestUpdate();
          return;
        case "ArrowUp":
          e.preventDefault();
          vs.slashMenuIndex = (vs.slashMenuIndex - 1 + len) % len;
          requestUpdate();
          return;
        case "Tab":
          e.preventDefault();
          tabCompleteSlashCommand(vs.slashMenuItems[vs.slashMenuIndex], props, requestUpdate);
          return;
        case "Enter":
          e.preventDefault();
          selectSlashCommand(vs.slashMenuItems[vs.slashMenuIndex], props, requestUpdate);
          return;
        case "Escape":
          e.preventDefault();
          vs.slashMenuOpen = false;
          resetSlashMenuState();
          requestUpdate();
          return;
      }
    }

    // Input history (only when input is empty)
    if (!props.draft.trim()) {
      if (e.key === "ArrowUp") {
        const prev = inputHistory.up();
        if (prev !== null) {
          e.preventDefault();
          props.onDraftChange(prev);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        const next = inputHistory.down();
        e.preventDefault();
        props.onDraftChange(next ?? "");
        return;
      }
    }

    // Cmd+F for search
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
      e.preventDefault();
      vs.searchOpen = !vs.searchOpen;
      if (!vs.searchOpen) {
        vs.searchQuery = "";
      }
      requestUpdate();
      return;
    }

    // Send on Enter (without shift)
    if (e.key === "Enter" && !e.shiftKey) {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      if (composerControls.submitDisabled) {
        return;
      }
      e.preventDefault();
      if (props.draft.trim()) {
        inputHistory.push(props.draft);
      }
      props.onSend();
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    adjustTextareaHeight(target);
    updateSlashMenu(target.value, requestUpdate);
    inputHistory.reset();
    props.onDraftChange(target.value);
  };

  return html`
    <section
      class="card chat"
      @drop=${(e: DragEvent) => handleDrop(e, props)}
      @dragover=${(e: DragEvent) => e.preventDefault()}
    >
      ${renderArtifactFocusViewer({
        artifact: props.artifactFocus,
        onClose: props.onCloseArtifact,
      })}
      ${props.disabledReason ? html`<div class="callout">${props.disabledReason}</div>` : nothing}
      ${renderRequestStatus(props, liveRunViewState)}
      ${props.focusMode
        ? html`
            <button
              class="chat-focus-exit"
              type="button"
              @click=${props.onToggleFocusMode}
              aria-label="Exit focus mode"
              title="Exit focus mode"
            >
              ${icons.x}
            </button>
          `
        : nothing}
      ${renderSearchBar(requestUpdate)} ${renderPinnedSection(props, pinned, requestUpdate)}

      <div class="chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}">
        <div
          class="chat-main"
          style="flex: ${sidebarOpen ? `0 0 ${splitRatio * 100}%` : "1 1 100%"}"
        >
          ${thread}
        </div>

        ${sidebarOpen
          ? html`
              <resizable-divider
                .splitRatio=${splitRatio}
                @resize=${(e: CustomEvent) => props.onSplitRatioChange?.(e.detail.splitRatio)}
              ></resizable-divider>
              <div class="chat-sidebar">
                ${renderMarkdownSidebar({
                  content: props.sidebarContent ?? null,
                  error: props.sidebarError ?? null,
                  onClose: props.onCloseSidebar!,
                  onViewRawText: () => {
                    if (!props.sidebarContent || !props.onOpenSidebar) {
                      return;
                    }
                    props.onOpenSidebar(`\`\`\`\n${props.sidebarContent}\n\`\`\``);
                  },
                })}
              </div>
            `
          : nothing}
      </div>

      ${props.queue.length
        ? html`
            <div class="chat-queue" role="status" aria-live="polite">
              <div class="chat-queue__list">
                ${props.queue.map(
                  (item) => html`
                    <div class="chat-queue__item chat-line user">
                      <div class="chat-queue__bubble chat-bubble">
                        <div class="chat-queue__meta">
                          <span class="chat-queue__title">
                            전송 대기 중${props.queue.length > 1 ? ` (${props.queue.length})` : ""}
                          </span>
                          <span class="chat-queue__description">
                            현재 응답이 끝나면 자동으로 전송됩니다.
                          </span>
                          <button
                            class="btn chat-queue__remove"
                            type="button"
                            aria-label="전송 대기 취소"
                            title="전송 대기 취소"
                            @click=${() => props.onQueueRemove(item.id)}
                          >
                            취소
                          </button>
                        </div>
                        <div class="chat-queue__text">
                          ${item.text ||
                          (item.attachments?.length
                            ? `첨부 파일 ${item.attachments.length}개`
                            : "")}
                        </div>
                      </div>
                    </div>
                  `,
                )}
              </div>
            </div>
          `
        : nothing}
      ${renderFallbackIndicator(props.fallbackStatus)}
      ${renderContextNotice(activeSession, props.sessions?.defaults?.contextTokens ?? null)}
      ${props.showNewMessages
        ? html`
            <button class="chat-new-messages" type="button" @click=${props.onScrollToBottom}>
              ${icons.arrowDown} New messages
            </button>
          `
        : nothing}

      <!-- Input bar -->
      <div class="agent-chat__input">
        ${renderSlashMenu(requestUpdate, props)} ${renderAttachmentPreview(props)}

        <input
          type="file"
          accept=${CHAT_ATTACHMENT_ACCEPT}
          multiple
          class="agent-chat__file-input"
          @change=${(e: Event) => handleFileSelect(e, props)}
        />

        ${vs.sttRecording && vs.sttInterimText
          ? html`<div class="agent-chat__stt-interim">${vs.sttInterimText}</div>`
          : nothing}

        <textarea
          ${ref((el) => el && adjustTextareaHeight(el as HTMLTextAreaElement))}
          .value=${props.draft}
          dir=${detectTextDirection(props.draft)}
          ?disabled=${composerControls.inputDisabled}
          @keydown=${handleKeyDown}
          @input=${handleInput}
          @paste=${(e: ClipboardEvent) => handlePaste(e, props)}
          placeholder=${vs.sttRecording ? "Listening..." : placeholder}
          rows="1"
        ></textarea>

        <div class="agent-chat__toolbar">
          <div class="agent-chat__toolbar-left">
            <button
              class="agent-chat__input-btn"
              @click=${() => {
                document.querySelector<HTMLInputElement>(".agent-chat__file-input")?.click();
              }}
              title="Attach file"
              aria-label="Attach file"
              ?disabled=${!props.connected}
            >
              ${icons.paperclip}
            </button>

            ${isSttSupported()
              ? html`
                  <button
                    class="agent-chat__input-btn ${vs.sttRecording
                      ? "agent-chat__input-btn--recording"
                      : ""}"
                    @click=${() => {
                      if (vs.sttRecording) {
                        stopStt();
                        vs.sttRecording = false;
                        vs.sttInterimText = "";
                        requestUpdate();
                      } else {
                        const started = startStt({
                          onTranscript: (text, isFinal) => {
                            if (isFinal) {
                              const current = getDraft();
                              const sep = current && !current.endsWith(" ") ? " " : "";
                              props.onDraftChange(current + sep + text);
                              vs.sttInterimText = "";
                            } else {
                              vs.sttInterimText = text;
                            }
                            requestUpdate();
                          },
                          onStart: () => {
                            vs.sttRecording = true;
                            requestUpdate();
                          },
                          onEnd: () => {
                            vs.sttRecording = false;
                            vs.sttInterimText = "";
                            requestUpdate();
                          },
                          onError: () => {
                            vs.sttRecording = false;
                            vs.sttInterimText = "";
                            requestUpdate();
                          },
                        });
                        if (started) {
                          vs.sttRecording = true;
                          requestUpdate();
                        }
                      }
                    }}
                    title=${vs.sttRecording ? "Stop recording" : "Voice input"}
                    ?disabled=${!props.connected}
                  >
                    ${vs.sttRecording ? icons.micOff : icons.mic}
                  </button>
                `
              : nothing}
            ${tokens ? html`<span class="agent-chat__token-count">${tokens}</span>` : nothing}
          </div>

          <div class="agent-chat__toolbar-right">
            ${nothing /* search hidden for now */}
            ${canAbort
              ? nothing
              : props.employeeMode
                ? nothing
                : html`
                    <button
                      class="btn btn--ghost"
                      @click=${props.onNewSession}
                      title="New session"
                      aria-label="New session"
                    >
                      ${icons.plus}
                    </button>
                  `}
            <button
              class="btn btn--ghost"
              @click=${() => exportMarkdown(props)}
              title="Export"
              aria-label="Export chat"
              ?disabled=${props.messages.length === 0}
            >
              ${icons.download}
            </button>

            ${showStopButton
              ? html`
                  <button
                    class="chat-send-btn chat-send-btn--stop"
                    @click=${props.onAbort}
                    title="Stop"
                    aria-label="Stop generating"
                  >
                    ${icons.stop}
                  </button>
                `
              : nothing}
            <button
              class="chat-send-btn"
              @click=${() => {
                if (props.draft.trim()) {
                  inputHistory.push(props.draft);
                }
                props.onSend();
              }}
              ?disabled=${composerControls.submitDisabled}
              title=${composerControls.submitTitle}
              aria-label=${composerControls.submitAriaLabel}
              data-submit-mode=${composerControls.submitMode}
            >
              ${icons.send}
            </button>
          </div>
        </div>
      </div>
    </section>
  `;
}

const CHAT_HISTORY_RENDER_LIMIT = 200;

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const normalized = normalizeMessage(item.message);
    const role = normalizeRoleForGrouping(normalized.role);
    const senderLabel =
      normalizeLowercaseStringOrEmpty(role) === "user" ? (normalized.senderLabel ?? null) : null;
    const timestamp = normalized.timestamp || Date.now();

    if (
      !currentGroup ||
      currentGroup.role !== role ||
      (normalizeLowercaseStringOrEmpty(role) === "user" && currentGroup.senderLabel !== senderLabel)
    ) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        senderLabel,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }
  return result;
}

function buildChatItems(props: ChatProps): Array<ChatItem | MessageGroup> {
  const items: ChatItem[] = [];
  const history = Array.isArray(props.messages) ? props.messages : [];
  const tools = Array.isArray(props.toolMessages) ? props.toolMessages : [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);
  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: `Showing last ${CHAT_HISTORY_RENDER_LIMIT} messages (${historyStart} hidden).`,
        timestamp: Date.now(),
      },
    });
  }
  for (let i = historyStart; i < history.length; i++) {
    const msg = history[i];
    const normalized = normalizeMessage(msg);
    const raw = msg as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${normalized.timestamp}:${i}`,
        label: "Compaction",
        timestamp: normalized.timestamp ?? Date.now(),
      });
      continue;
    }

    if (!props.showToolCalls && normalizeLowercaseStringOrEmpty(normalized.role) === "toolresult") {
      continue;
    }

    // Apply search filter if active
    if (vs.searchOpen && vs.searchQuery.trim() && !messageMatchesSearchQuery(msg, vs.searchQuery)) {
      continue;
    }

    items.push({
      kind: "message",
      key: messageKey(msg, i),
      message: msg,
    });
  }
  // Interleave stream segments and tool cards in order. Each segment
  // contains text that was streaming before the corresponding tool started.
  // This ensures correct visual ordering: text → tool → text → tool → ...
  const segments = props.streamSegments ?? [];
  const maxLen = Math.max(segments.length, tools.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < segments.length && segments[i].text.trim().length > 0) {
      items.push({
        kind: "stream" as const,
        key: `stream-seg:${props.sessionKey}:${i}`,
        text: segments[i].text,
        startedAt: segments[i].ts,
      });
    }
    if (i < tools.length && props.showToolCalls) {
      items.push({
        kind: "message",
        key: messageKey(tools[i], i + history.length),
        message: tools[i],
      });
    }
  }

  if (props.stream !== null) {
    const key = `stream:${props.sessionKey}:${props.streamStartedAt ?? "live"}`;
    if (props.stream.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: props.stream,
        startedAt: props.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key });
    }
  }

  return groupMessages(items);
}

function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = typeof m.toolCallId === "string" ? m.toolCallId : "";
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const messageId = typeof m.messageId === "string" ? m.messageId : "";
  if (messageId) {
    return `msg:${messageId}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}

export const __test = {
  deriveLiveRunStatus,
};
