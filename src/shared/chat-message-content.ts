import { readStringValue } from "./string-coerce.js";

export type ChatMessageTextContentBlock = Record<string, unknown> & {
  type: "text" | "input_text" | "output_text";
  text: string;
};

export type ChatMessageAttachmentKind = "image" | "file";

export type ChatMessageAttachmentContentBlock = Record<string, unknown> & {
  type: "attachment";
  attachmentType: ChatMessageAttachmentKind;
  fileName: string;
  storedFileName?: string;
  workspacePath?: string;
  mimeType?: string;
  sizeBytes?: number;
  promptMode?: string;
  inlineTruncated?: boolean;
};

export type ChatMessageContentBlock = Record<string, unknown> & {
  type?: unknown;
};

export function toChatMessageContentBlocks(content: unknown): ChatMessageContentBlock[] {
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter(
    (block): block is ChatMessageContentBlock =>
      Boolean(block) && typeof block === "object" && !Array.isArray(block),
  );
}

export function isTextLikeContentBlock(
  block: unknown,
): block is ChatMessageTextContentBlock {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return false;
  }
  const record = block as { type?: unknown; text?: unknown };
  return (
    (record.type === "text" ||
      record.type === "input_text" ||
      record.type === "output_text" ||
      record.type === undefined) &&
    typeof record.text === "string"
  );
}

export function isAttachmentContentBlock(
  block: unknown,
): block is ChatMessageAttachmentContentBlock {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return false;
  }
  const record = block as {
    type?: unknown;
    attachmentType?: unknown;
    fileName?: unknown;
  };
  return (
    record.type === "attachment" &&
    (record.attachmentType === "image" || record.attachmentType === "file") &&
    typeof record.fileName === "string" &&
    record.fileName.trim().length > 0
  );
}

export function extractAttachmentContentBlocks(message: unknown): ChatMessageAttachmentContentBlock[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const content = (message as { content?: unknown }).content;
  return toChatMessageContentBlocks(content).filter(isAttachmentContentBlock);
}

export function extractFirstTextBlock(message: unknown): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  const inline = readStringValue(content);
  if (inline !== undefined) {
    return inline;
  }
  if (!Array.isArray(content) || content.length === 0) {
    return undefined;
  }
  const first = content[0];
  if (!isTextLikeContentBlock(first)) {
    return undefined;
  }
  return readStringValue(first.text);
}

export type AssistantPhase = "commentary" | "final_answer";

export function normalizeAssistantPhase(value: unknown): AssistantPhase | undefined {
  return value === "commentary" || value === "final_answer" ? value : undefined;
}

export function parseAssistantTextSignature(
  value: unknown,
): { id?: string; phase?: AssistantPhase } | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  if (!value.startsWith("{")) {
    return { id: value };
  }
  try {
    const parsed = JSON.parse(value) as { id?: unknown; phase?: unknown; v?: unknown };
    if (parsed.v !== 1) {
      return null;
    }
    return {
      ...(typeof parsed.id === "string" ? { id: parsed.id } : {}),
      ...(normalizeAssistantPhase(parsed.phase)
        ? { phase: normalizeAssistantPhase(parsed.phase) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function encodeAssistantTextSignature(params: {
  id: string;
  phase?: AssistantPhase;
}): string {
  return JSON.stringify({
    v: 1,
    id: params.id,
    ...(params.phase ? { phase: params.phase } : {}),
  });
}

export function resolveAssistantMessagePhase(message: unknown): AssistantPhase | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const entry = message as { phase?: unknown; content?: unknown };
  const directPhase = normalizeAssistantPhase(entry.phase);
  if (directPhase) {
    return directPhase;
  }
  const contentBlocks = toChatMessageContentBlocks(entry.content);
  if (contentBlocks.length === 0) {
    return undefined;
  }
  const explicitPhases = new Set<AssistantPhase>();
  for (const block of contentBlocks) {
    if (!isTextLikeContentBlock(block)) {
      continue;
    }
    const phase = parseAssistantTextSignature(block.textSignature)?.phase;
    if (phase) {
      explicitPhases.add(phase);
    }
  }
  return explicitPhases.size === 1 ? [...explicitPhases][0] : undefined;
}

export function extractAssistantTextForPhase(
  message: unknown,
  options?: {
    phase?: AssistantPhase;
    sanitizeText?: (text: string) => string;
    joinWith?: string;
  },
): string | undefined {
  if (!message || typeof message !== "object") {
    return undefined;
  }
  const entry = message as { text?: unknown; content?: unknown; phase?: unknown };
  const messagePhase = normalizeAssistantPhase(entry.phase);
  const phase = options?.phase;
  const shouldIncludeContent = (resolvedPhase?: AssistantPhase) => {
    if (phase) {
      return resolvedPhase === phase;
    }
    return resolvedPhase === undefined;
  };
  const sanitizeText = options?.sanitizeText;
  const joinWith = options?.joinWith ?? "\n";
  const sanitizeBlockText = (text: string) => (sanitizeText ? sanitizeText(text) : text);
  const normalizeJoinedText = (text: string) => {
    const normalized = text.trim();
    return normalized || undefined;
  };

  if (typeof entry.text === "string") {
    if (!shouldIncludeContent(messagePhase)) {
      return undefined;
    }
    return normalizeJoinedText(sanitizeBlockText(entry.text));
  }

  if (typeof entry.content === "string") {
    if (!shouldIncludeContent(messagePhase)) {
      return undefined;
    }
    return normalizeJoinedText(sanitizeBlockText(entry.content));
  }

  const contentBlocks = toChatMessageContentBlocks(entry.content);
  if (contentBlocks.length === 0) {
    return undefined;
  }

  const hasExplicitPhasedTextBlocks = contentBlocks.some(
    (block) =>
      isTextLikeContentBlock(block) &&
      Boolean(parseAssistantTextSignature(block.textSignature)?.phase),
  );

  // Once explicit phased blocks exist, unphased extraction should not revive
  // legacy text from the same message.
  if (!phase && hasExplicitPhasedTextBlocks) {
    return undefined;
  }

  const parts = contentBlocks
    .map((block) => {
      if (!isTextLikeContentBlock(block)) {
        return null;
      }
      const signature = parseAssistantTextSignature(block.textSignature);
      const resolvedPhase =
        signature?.phase ?? (hasExplicitPhasedTextBlocks ? undefined : messagePhase);
      if (!shouldIncludeContent(resolvedPhase)) {
        return null;
      }
      const sanitized = sanitizeBlockText(block.text);
      return sanitized.trim() ? sanitized : null;
    })
    .filter((value): value is string => typeof value === "string");

  if (parts.length === 0) {
    return undefined;
  }
  return normalizeJoinedText(parts.join(joinWith));
}

export function extractAssistantVisibleText(message: unknown): string | undefined {
  const finalAnswerText = extractAssistantTextForPhase(message, { phase: "final_answer" });
  if (finalAnswerText) {
    return finalAnswerText;
  }
  return extractAssistantTextForPhase(message);
}
