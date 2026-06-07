import { formatErrorMessage } from "../infra/errors.js";
import { logImagePayloadDebug, summarizeImagePayload } from "../infra/image-payload-debug.js";
import { estimateBase64DecodedBytes } from "../media/base64.js";
import type { PromptImageOrderEntry } from "../media/prompt-image-order.js";
import { sniffMimeFromBase64 } from "../media/sniff-mime-from-base64.js";
import { deleteMediaBuffer, saveMediaBuffer } from "../media/store.js";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
} from "../shared/string-coerce.js";

export type ChatAttachment = {
  type?: string;
  mimeType?: string;
  fileName?: string;
  content?: unknown;
  workspacePath?: string;
  originalFileName?: string;
  storedFileName?: string;
  sizeBytes?: number;
  promptMode?: string;
  inlineContent?: string | null;
  inlineTruncated?: boolean;
};

export type ChatImageContent = {
  type: "image";
  data: string;
  mimeType: string;
};

/**
 * Metadata for an attachment that was offloaded to the media store.
 *
 * Included in ParsedMessageWithImages.offloadedRefs so that callers can
 * persist structured media metadata for transcripts. Without this, consumers
 * that derive MediaPath/MediaPaths from the `images` array (e.g.
 * persistChatSendImages and buildChatSendTranscriptMessage in chat.ts) would
 * silently omit all large attachments that were offloaded to disk.
 */
export type OffloadedRef = {
  /** Opaque media URI injected into the message, e.g. "media://inbound/<id>" */
  mediaRef: string;
  /** The raw media ID from SavedMedia.id, usable with resolveMediaBufferPath */
  id: string;
  /** Absolute filesystem path returned by saveMediaBuffer — used for transcript MediaPath */
  path: string;
  /** MIME type of the offloaded attachment */
  mimeType: string;
  /** The label / filename of the original attachment */
  label: string;
};

export type ParsedMessageWithImages = {
  message: string;
  promptPreamble: string;
  /** Small attachments (≤ OFFLOAD_THRESHOLD_BYTES) passed inline to the model */
  images: ChatImageContent[];
  /** Original accepted attachment order after inline/offloaded split. */
  imageOrder: PromptImageOrderEntry[];
  /**
   * Large attachments (> OFFLOAD_THRESHOLD_BYTES) that were offloaded to the
   * media store. Each entry corresponds to a `[media attached: media://inbound/<id>]`
   * marker appended to `message`.
   *
   * Callers MUST persist this list separately for transcript media metadata.
   * It is intentionally separate from `images` because downstream model calls
   * do not receive these as inline image blocks.
   *
   * ⚠️  Call sites (chat.ts, agent.ts, server-node-events.ts) MUST also pass
   * `supportsImages: modelSupportsImages(model)` so that text-only model runs
   * do not inject unresolvable media:// markers into prompt text.
   */
  offloadedRefs: OffloadedRef[];
  transcriptAttachments: ChatTranscriptAttachment[];
};

export type ChatTranscriptAttachment = {
  type: "image" | "file";
  fileName: string;
  storedFileName?: string;
  workspacePath?: string;
  mimeType: string;
  sizeBytes?: number;
  promptMode?: "image" | "inline" | "workspace";
  inlineTruncated?: boolean;
};

type AttachmentLog = {
  info?: (message: string) => void;
  warn: (message: string) => void;
};

type NormalizedAttachment = {
  label: string;
  mime: string;
  base64: string;
};

type SavedMedia = {
  id: string;
  path?: string;
};

const OFFLOAD_THRESHOLD_BYTES = 2_000_000;
const INLINE_ATTACHMENTS_TOTAL_MAX_BYTES = 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  // bmp/tiff excluded from SUPPORTED_OFFLOAD_MIMES to avoid extension-loss
  // bug in store.ts; entries kept here for future extension support
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
};

// Module-level Set for O(1) lookup — not rebuilt on every attachment iteration.
//
// heic/heif are included only if store.ts's extensionForMime maps them to an
// extension. If it does not (same extension-loss risk as bmp/tiff), remove
// them from this set.
const SUPPORTED_OFFLOAD_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

/**
 * Raised when the Gateway cannot persist an attachment to the media store.
 *
 * Distinct from ordinary input-validation errors so that Gateway handlers can
 * map it to a server-side 5xx status rather than a client 4xx.
 *
 * Example causes: ENOSPC, EPERM, unexpected saveMediaBuffer return shape.
 */
export class MediaOffloadError extends Error {
  readonly cause: unknown;
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaOffloadError";
    this.cause = options?.cause;
  }
}

function normalizeMime(mime?: string): string | undefined {
  if (!mime) {
    return undefined;
  }
  const cleaned = normalizeOptionalLowercaseString(mime.split(";")[0]);
  return cleaned || undefined;
}

function extractDataUrlMime(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const match = /^\s*data:([^;,]+)(?:;[^,]*)?,/i.exec(value);
  return normalizeMime(match?.[1]);
}

function normalizeAttachmentType(value: string | undefined): "image" | "file" {
  return value === "image" ? "image" : "file";
}

function normalizePromptMode(value: string | undefined): "image" | "inline" | "workspace" | undefined {
  return value === "image" || value === "inline" || value === "workspace" ? value : undefined;
}

function formatAttachmentSize(sizeBytes?: number): string {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return "unknown";
  }
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(2).replace(/\.00$/, "")} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${(sizeBytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  }
  return `${sizeBytes} B`;
}

function buildTranscriptAttachment(att: ChatAttachment, fallbackLabel: string): ChatTranscriptAttachment {
  const mimeType = normalizeMime(att.mimeType) ?? "application/octet-stream";
  return {
    type: normalizeAttachmentType(att.type),
    fileName: att.originalFileName || att.fileName || fallbackLabel,
    storedFileName: typeof att.storedFileName === "string" ? att.storedFileName : undefined,
    workspacePath: typeof att.workspacePath === "string" ? att.workspacePath : undefined,
    mimeType,
    sizeBytes: typeof att.sizeBytes === "number" ? att.sizeBytes : undefined,
    promptMode: normalizePromptMode(att.promptMode),
    inlineTruncated: att.inlineTruncated === true,
  };
}

function appendWorkspaceAttachmentPromptBlock(lines: string[], att: ChatTranscriptAttachment) {
  lines.push(`- name: ${att.fileName}`);
  lines.push(`  type: ${att.type}`);
  lines.push(`  mime: ${att.mimeType}`);
  lines.push(`  size: ${formatAttachmentSize(att.sizeBytes)}`);
  if (att.workspacePath) {
    lines.push(`  workspace_path: ${att.workspacePath}`);
  }
  if (att.storedFileName) {
    lines.push(`  stored_name: ${att.storedFileName}`);
  }
  lines.push(`  handling: ${att.promptMode ?? "workspace"}`);
}

function logAttachmentClassificationDebug(params: {
  index: number;
  label: string;
  declaredMime?: string;
  contentDataUrlMime?: string;
  transcriptAttachment: ChatTranscriptAttachment;
  shouldTreatAsImageContent: boolean;
  supportsImages?: boolean;
  content: unknown;
}) {
  logImagePayloadDebug({
    stage: "gateway.chat.attachments.classify",
    note:
      `index=${params.index} label=${params.label} ` +
      `declaredMime=${params.declaredMime ?? "none"} ` +
      `contentDataUrlMime=${params.contentDataUrlMime ?? "none"} ` +
      `transcriptType=${params.transcriptAttachment.type} ` +
      `promptMode=${params.transcriptAttachment.promptMode ?? "none"} ` +
      `shouldImage=${params.shouldTreatAsImageContent ? "true" : "false"} ` +
      `supportsImages=${params.supportsImages === false ? "false" : "true"}`,
    entries: [
      {
        index: params.index,
        mimeType: params.declaredMime ?? params.contentDataUrlMime,
        summary: summarizeImagePayload(params.content),
      },
    ],
    allowEmpty: true,
  });
}

function logAttachmentImageCandidateDebug(params: {
  index: number;
  label: string;
  providedMime?: string;
  sniffedMime?: string;
  finalMime?: string;
  action: "drop-non-image" | "drop-unknown" | "drop-resolved-non-image" | "accept-inline" | "accept-offload";
  base64: string;
}) {
  logImagePayloadDebug({
    stage: "gateway.chat.attachments.image-candidate",
    note:
      `index=${params.index} label=${params.label} action=${params.action} ` +
      `providedMime=${params.providedMime ?? "none"} ` +
      `sniffedMime=${params.sniffedMime ?? "none"} ` +
      `finalMime=${params.finalMime ?? "none"}`,
    entries: [
      {
        index: params.index,
        mimeType: params.finalMime ?? params.sniffedMime ?? params.providedMime,
        summary: summarizeImagePayload(params.base64),
      },
    ],
  });
}

function isImageMime(mime?: string): boolean {
  return typeof mime === "string" && mime.startsWith("image/");
}

function isValidBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0) {
    return false;
  }
  // A full O(n) regex scan is safe: no overlapping quantifiers, fails linearly.
  // Prevents adversarial payloads padded with megabytes of whitespace from
  // bypassing length thresholds.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * Confirms that the decoded buffer produced by Buffer.from(b64, 'base64')
 * matches the pre-decode size estimate.
 *
 * Node's Buffer.from silently drops invalid base64 characters rather than
 * throwing. A material size discrepancy means the source string contained
 * embedded garbage that was silently stripped, which would produce a corrupted
 * file on disk. ±3 bytes of slack accounts for base64 padding rounding.
 *
 * IMPORTANT: this is an input-validation check (4xx client error).
 * It MUST be called OUTSIDE the MediaOffloadError try/catch so that
 * corrupt-input errors are not misclassified as 5xx server errors.
 */
function verifyDecodedSize(buffer: Buffer, estimatedBytes: number, label: string): void {
  if (Math.abs(buffer.byteLength - estimatedBytes) > 3) {
    throw new Error(
      `attachment ${label}: base64 contains invalid characters ` +
        `(expected ~${estimatedBytes} bytes decoded, got ${buffer.byteLength})`,
    );
  }
}

function ensureExtension(label: string, mime: string): string {
  if (/\.[a-zA-Z0-9]+$/.test(label)) {
    return label;
  }
  const ext = MIME_TO_EXT[normalizeLowercaseStringOrEmpty(mime)] ?? "";
  return ext ? `${label}${ext}` : label;
}

/**
 * Type guard for the return value of saveMediaBuffer.
 *
 * Also validates that the returned ID:
 * - is a non-empty string
 * - contains no path separators (/ or \) or null bytes
 *
 * Catching a bad shape here produces a cleaner error than a cryptic failure
 * deeper in the stack, and is treated as a 5xx infrastructure error.
 */
function assertSavedMedia(value: unknown, label: string): SavedMedia {
  if (
    value !== null &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as Record<string, unknown>).id === "string"
  ) {
    const id = (value as Record<string, unknown>).id as string;
    if (id.length === 0) {
      throw new Error(`attachment ${label}: saveMediaBuffer returned an empty media ID`);
    }
    if (id.includes("/") || id.includes("\\") || id.includes("\0")) {
      throw new Error(
        `attachment ${label}: saveMediaBuffer returned an unsafe media ID ` +
          `(contains path separator or null byte)`,
      );
    }
    return value as SavedMedia;
  }
  throw new Error(`attachment ${label}: saveMediaBuffer returned an unexpected shape`);
}

function normalizeAttachment(
  att: ChatAttachment,
  idx: number,
  opts: { stripDataUrlPrefix: boolean; requireImageMime: boolean },
): NormalizedAttachment {
  const mime = att.mimeType ?? "";
  const content = att.content;
  const label = att.fileName || att.type || `attachment-${idx + 1}`;

  if (typeof content !== "string") {
    throw new Error(`attachment ${label}: content must be base64 string`);
  }
  if (opts.requireImageMime && !mime.startsWith("image/")) {
    throw new Error(`attachment ${label}: only image/* supported`);
  }

  let base64 = content.trim();
  if (opts.stripDataUrlPrefix) {
    const dataUrlMatch = /^data:[^;]+;base64,(.*)$/.exec(base64);
    if (dataUrlMatch) {
      base64 = dataUrlMatch[1];
    }
  }
  return { label, mime, base64 };
}

function validateAttachmentBase64OrThrow(
  normalized: NormalizedAttachment,
  opts: { maxBytes: number },
): number {
  if (!isValidBase64(normalized.base64)) {
    throw new Error(`attachment ${normalized.label}: invalid base64 content`);
  }
  const sizeBytes = estimateBase64DecodedBytes(normalized.base64);
  if (sizeBytes <= 0 || sizeBytes > opts.maxBytes) {
    throw new Error(
      `attachment ${normalized.label}: exceeds size limit (${sizeBytes} > ${opts.maxBytes} bytes)`,
    );
  }
  return sizeBytes;
}

/**
 * Parse attachments and extract images as structured content blocks.
 * Returns the message text, inline image blocks, and offloaded media refs.
 *
 * ## Offload behaviour
 * Attachments whose decoded size exceeds OFFLOAD_THRESHOLD_BYTES are saved to
 * disk via saveMediaBuffer and replaced with an opaque `media://inbound/<id>`
 * URI appended to the message. The agent resolves these URIs via
 * resolveMediaBufferPath before passing them to the model.
 *
 * ## Transcript metadata
 * Callers MUST use `result.offloadedRefs` to persist structured media metadata
 * for transcripts. These refs are intentionally excluded from `result.images`
 * because they are not passed inline to the model.
 *
 * ## Text-only model runs
 * Pass `supportsImages: false` for text-only model runs so that no media://
 * markers are injected into prompt text.
 *
 * ⚠️  Call sites in chat.ts, agent.ts, and server-node-events.ts MUST be
 * updated to pass `supportsImages: modelSupportsImages(model)`. Until they do,
 * text-only model runs receive unresolvable media:// markers in their prompt.
 *
 * ## Cleanup on failure
 * On any parse failure after files have already been offloaded, best-effort
 * cleanup is performed before rethrowing so that malformed requests do not
 * accumulate orphaned files on disk ahead of the periodic TTL sweep.
 *
 * ## Known ordering limitation
 * In mixed large/small batches, the model receives images in a different order
 * than the original attachment list because detectAndLoadPromptImages
 * initialises from existingImages first, then appends prompt-detected refs.
 * A future refactor should unify all image references into a single ordered list.
 *
 * @throws {MediaOffloadError} Infrastructure failure saving to media store → 5xx.
 * @throws {Error} Input validation failure → 4xx.
 */
export async function parseMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number; log?: AttachmentLog; supportsImages?: boolean },
): Promise<ParsedMessageWithImages> {
  const maxBytes = opts?.maxBytes ?? 5_000_000;
  const log = opts?.log;

  if (!attachments || attachments.length === 0) {
    return { message, promptPreamble: "", images: [], imageOrder: [], offloadedRefs: [], transcriptAttachments: [] };
  }

  const images: ChatImageContent[] = [];
  const imageOrder: PromptImageOrderEntry[] = [];
  const offloadedRefs: OffloadedRef[] = [];
  const transcriptAttachments: ChatTranscriptAttachment[] = [];
  const inlineAttachmentBlocks: Array<{
    attachment: ChatTranscriptAttachment;
    content: string;
    truncated: boolean;
  }> = [];
  const workspaceAttachmentBlocks: ChatTranscriptAttachment[] = [];
  let updatedMessage = message;
  let inlineBudgetBytes = 0;

  // Track IDs of files saved during this request for cleanup if a later
  // attachment fails validation and the entire parse is aborted.
  const savedMediaIds: string[] = [];

  try {
    for (const [idx, att] of attachments.entries()) {
      if (!att) {
        continue;
      }

      const fallbackLabel = att.fileName || att.type || `attachment-${idx + 1}`;
      const baseTranscriptAttachment = buildTranscriptAttachment(att, fallbackLabel);
      const declaredMime = normalizeMime(att.mimeType);
      const contentDataUrlMime = extractDataUrlMime(att.content);
      const transcriptAttachment =
        contentDataUrlMime !== undefined && !isImageMime(contentDataUrlMime)
          ? {
              ...baseTranscriptAttachment,
              type: "file" as const,
              mimeType: contentDataUrlMime,
              promptMode:
                baseTranscriptAttachment.promptMode === "image"
                  ? ("workspace" as const)
                  : baseTranscriptAttachment.promptMode,
            }
          : baseTranscriptAttachment;
      transcriptAttachments.push(transcriptAttachment);
      const shouldTreatAsImageContent =
        contentDataUrlMime !== undefined
          ? isImageMime(contentDataUrlMime)
          : isImageMime(declaredMime) ||
            (declaredMime === undefined && transcriptAttachment.type === "image");
      logAttachmentClassificationDebug({
        index: idx,
        label: fallbackLabel,
        declaredMime,
        contentDataUrlMime,
        transcriptAttachment,
        shouldTreatAsImageContent,
        supportsImages: opts?.supportsImages,
        content: att.content,
      });

      if (typeof att.content !== "string" || !shouldTreatAsImageContent) {
        if (transcriptAttachment.type === "file") {
          const normalizedPromptMode = transcriptAttachment.promptMode ?? "workspace";
          if (normalizedPromptMode === "inline" && typeof att.inlineContent === "string") {
            const inlineBytes = Buffer.byteLength(att.inlineContent, "utf8");
            if (inlineBudgetBytes + inlineBytes <= INLINE_ATTACHMENTS_TOTAL_MAX_BYTES) {
              inlineBudgetBytes += inlineBytes;
              inlineAttachmentBlocks.push({
                attachment: { ...transcriptAttachment, promptMode: "inline" },
                content: att.inlineContent,
                truncated: att.inlineTruncated === true,
              });
            } else {
              workspaceAttachmentBlocks.push({ ...transcriptAttachment, promptMode: "workspace" });
            }
          } else {
            workspaceAttachmentBlocks.push({
              ...transcriptAttachment,
              promptMode: normalizedPromptMode === "image" ? "workspace" : normalizedPromptMode,
            });
          }
        } else if (opts?.supportsImages === false) {
          log?.warn(`attachment ${fallbackLabel}: image dropped — model does not support images`);
        }
        continue;
      }

      const normalized = normalizeAttachment(att, idx, {
        stripDataUrlPrefix: true,
        requireImageMime: false,
      });

      const { base64: b64, label, mime } = normalized;

      if (!isValidBase64(b64)) {
        throw new Error(`attachment ${label}: invalid base64 content`);
      }

      const sizeBytes = estimateBase64DecodedBytes(b64);
      if (sizeBytes <= 0) {
        log?.warn(`attachment ${label}: estimated size is zero, dropping`);
        continue;
      }

      if (sizeBytes > maxBytes) {
        throw new Error(
          `attachment ${label}: exceeds size limit (${sizeBytes} > ${maxBytes} bytes)`,
        );
      }

      const providedMime = normalizeMime(mime);
      const sniffedMime = normalizeMime(await sniffMimeFromBase64(b64));

      if (sniffedMime && !isImageMime(sniffedMime)) {
        logAttachmentImageCandidateDebug({
          index: idx,
          label,
          providedMime,
          sniffedMime,
          action: "drop-non-image",
          base64: b64,
        });
        log?.warn(`attachment ${label}: detected non-image (${sniffedMime}), dropping content`);
        continue;
      }
      if (!sniffedMime && !isImageMime(providedMime)) {
        logAttachmentImageCandidateDebug({
          index: idx,
          label,
          providedMime,
          sniffedMime,
          action: "drop-unknown",
          base64: b64,
        });
        log?.warn(`attachment ${label}: unable to detect image mime type, dropping content`);
        continue;
      }
      if (sniffedMime && providedMime && sniffedMime !== providedMime) {
        log?.warn(
          `attachment ${label}: mime mismatch (${providedMime} -> ${sniffedMime}), using sniffed`,
        );
      }

      // Third fallback normalises `mime` so a raw un-normalised string (e.g.
      // "IMAGE/JPEG") does not silently bypass the SUPPORTED_OFFLOAD_MIMES check.
      const finalMime = sniffedMime ?? providedMime ?? normalizeMime(mime) ?? mime;
      if (!isImageMime(finalMime)) {
        logAttachmentImageCandidateDebug({
          index: idx,
          label,
          providedMime,
          sniffedMime,
          finalMime,
          action: "drop-resolved-non-image",
          base64: b64,
        });
        log?.warn(`attachment ${label}: resolved non-image mime type (${finalMime}), dropping content`);
        continue;
      }
      transcriptAttachments[transcriptAttachments.length - 1] = {
        ...transcriptAttachment,
        type: "image",
        mimeType: finalMime,
        promptMode: "image",
      };

      if (opts?.supportsImages === false) {
        log?.warn(`attachment ${label}: image dropped — model does not support images`);
        continue;
      }

      let isOffloaded = false;

      if (sizeBytes > OFFLOAD_THRESHOLD_BYTES) {
        const isSupportedForOffload = SUPPORTED_OFFLOAD_MIMES.has(finalMime);

        if (!isSupportedForOffload) {
          // Passing this inline would reintroduce the OOM risk this PR prevents.
          throw new Error(
            `attachment ${label}: format ${finalMime} is too large to pass inline ` +
              `(${sizeBytes} > ${OFFLOAD_THRESHOLD_BYTES} bytes) and cannot be offloaded. ` +
              `Please convert to JPEG, PNG, WEBP, GIF, HEIC, or HEIF.`,
          );
        }

        // Decode and run input-validation BEFORE the MediaOffloadError try/catch.
        // verifyDecodedSize is a 4xx client error and must not be wrapped as a
        // 5xx MediaOffloadError.
        const buffer = Buffer.from(b64, "base64");
        verifyDecodedSize(buffer, sizeBytes, label);

        // Only the storage operation is wrapped so callers can distinguish
        // infrastructure failures (5xx) from input errors (4xx).
        try {
          const labelWithExt = ensureExtension(label, finalMime);

          const rawResult = await saveMediaBuffer(
            buffer,
            finalMime,
            "inbound",
            maxBytes,
            labelWithExt,
          );

          const savedMedia = assertSavedMedia(rawResult, label);

          // Track for cleanup if a subsequent attachment fails.
          savedMediaIds.push(savedMedia.id);

          // Opaque URI — compatible with workspaceOnly sandboxes and decouples
          // the Gateway from the agent's filesystem layout.
          const mediaRef = `media://inbound/${savedMedia.id}`;

          updatedMessage += `\n[media attached: ${mediaRef}]`;
          log?.info?.(`[Gateway] Intercepted large image payload. Saved: ${mediaRef}`);

          // Record for transcript metadata — separate from `images` because
          // these are not passed inline to the model.
          offloadedRefs.push({
            mediaRef,
            id: savedMedia.id,
            path: savedMedia.path ?? "",
            mimeType: finalMime,
            label,
          });
          imageOrder.push("offloaded");
          logAttachmentImageCandidateDebug({
            index: idx,
            label,
            providedMime,
            sniffedMime,
            finalMime,
            action: "accept-offload",
            base64: b64,
          });

          isOffloaded = true;
        } catch (err) {
          const errorMessage = formatErrorMessage(err);
          throw new MediaOffloadError(
            `[Gateway Error] Failed to save intercepted media to disk: ${errorMessage}`,
            { cause: err },
          );
        }
      }

      if (isOffloaded) {
        continue;
      }

      images.push({ type: "image", data: b64, mimeType: finalMime });
      imageOrder.push("inline");
      logAttachmentImageCandidateDebug({
        index: idx,
        label,
        providedMime,
        sniffedMime,
        finalMime,
        action: "accept-inline",
        base64: b64,
      });
    }
  } catch (err) {
    // Best-effort cleanup before rethrowing.
    if (savedMediaIds.length > 0) {
      await Promise.allSettled(savedMediaIds.map((id) => deleteMediaBuffer(id, "inbound")));
    }
    throw err;
  }

  const promptLines: string[] = [];
  if (workspaceAttachmentBlocks.length > 0 || inlineAttachmentBlocks.length > 0) {
    promptLines.push("[Attached files metadata]");
    promptLines.push("The user uploaded files into the workspace before sending this message.");
    promptLines.push("Use the metadata below. Open workspace files when deeper inspection is needed.");
    promptLines.push("");
    promptLines.push("```yaml");
    promptLines.push("attachments:");
    for (const att of workspaceAttachmentBlocks) {
      appendWorkspaceAttachmentPromptBlock(promptLines, att);
    }
    for (const att of inlineAttachmentBlocks) {
      appendWorkspaceAttachmentPromptBlock(promptLines, att.attachment);
    }
    promptLines.push("```");
  }
  for (const block of inlineAttachmentBlocks) {
    promptLines.push("");
    promptLines.push(`[Inline attachment: ${block.attachment.fileName}]`);
    if (block.attachment.workspacePath) {
      promptLines.push(`workspace_path: ${block.attachment.workspacePath}`);
    }
    if (block.truncated) {
      promptLines.push("note: content was truncated during upload preview.");
    }
    promptLines.push("```text");
    promptLines.push(block.content);
    promptLines.push("```");
  }

  return {
    message: updatedMessage !== message ? updatedMessage.trimEnd() : message,
    promptPreamble: promptLines.join("\n").trim(),
    images,
    imageOrder,
    offloadedRefs,
    transcriptAttachments,
  };
}

/**
 * @deprecated Use parseMessageWithAttachments instead.
 * This function converts images to markdown data URLs which Claude API cannot process as images.
 */
export function buildMessageWithAttachments(
  message: string,
  attachments: ChatAttachment[] | undefined,
  opts?: { maxBytes?: number },
): string {
  const maxBytes = opts?.maxBytes ?? 2_000_000;

  if (!attachments || attachments.length === 0) {
    return message;
  }

  const blocks: string[] = [];

  for (const [idx, att] of attachments.entries()) {
    if (!att) {
      continue;
    }

    const normalized = normalizeAttachment(att, idx, {
      stripDataUrlPrefix: false,
      requireImageMime: true,
    });
    validateAttachmentBase64OrThrow(normalized, { maxBytes });

    const { base64, label, mime } = normalized;
    const safeLabel = label.replace(/\s+/g, "_");
    blocks.push(`![${safeLabel}](data:${mime};base64,${base64})`);
  }

  if (blocks.length === 0) {
    return message;
  }

  const separator = message.trim().length > 0 ? "\n\n" : "";
  return `${message}${separator}${blocks.join("\n\n")}`;
}
