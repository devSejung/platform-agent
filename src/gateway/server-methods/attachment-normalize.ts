import type { ChatAttachment } from "../chat-attachments.js";

export type RpcAttachmentInput = {
  type?: unknown;
  mimeType?: unknown;
  fileName?: unknown;
  content?: unknown;
  workspacePath?: unknown;
  originalFileName?: unknown;
  storedFileName?: unknown;
  sizeBytes?: unknown;
  promptMode?: unknown;
  inlineContent?: unknown;
  inlineTruncated?: unknown;
  source?: unknown;
};

function normalizeAttachmentContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("base64");
  }
  if (content instanceof ArrayBuffer) {
    return Buffer.from(content).toString("base64");
  }
  return undefined;
}

export function normalizeRpcAttachmentsToChatAttachments(
  attachments: RpcAttachmentInput[] | undefined,
): ChatAttachment[] {
  return (
    attachments
      ?.map((a) => {
        const source = a?.source && typeof a.source === "object" ? a.source : undefined;
        const sourceRecord = source as
          | { type?: unknown; media_type?: unknown; data?: unknown }
          | undefined;
        const sourceType = typeof sourceRecord?.type === "string" ? sourceRecord.type : undefined;
        const sourceMimeType =
          typeof sourceRecord?.media_type === "string" ? sourceRecord.media_type : undefined;
        const sourceContent =
          sourceType === "base64" ? normalizeAttachmentContent(sourceRecord?.data) : undefined;

        return {
          type: typeof a?.type === "string" ? a.type : undefined,
          mimeType: typeof a?.mimeType === "string" ? a.mimeType : sourceMimeType,
          fileName: typeof a?.fileName === "string" ? a.fileName : undefined,
          content: normalizeAttachmentContent(a?.content) ?? sourceContent,
          workspacePath: typeof a?.workspacePath === "string" ? a.workspacePath : undefined,
          originalFileName:
            typeof a?.originalFileName === "string" ? a.originalFileName : undefined,
          storedFileName: typeof a?.storedFileName === "string" ? a.storedFileName : undefined,
          sizeBytes: typeof a?.sizeBytes === "number" ? a.sizeBytes : undefined,
          promptMode: typeof a?.promptMode === "string" ? a.promptMode : undefined,
          inlineContent: typeof a?.inlineContent === "string" ? a.inlineContent : undefined,
          inlineTruncated: a?.inlineTruncated === true,
        };
      })
      .filter(
        (a) =>
          typeof a.content === "string" ||
          typeof a.workspacePath === "string" ||
          typeof a.inlineContent === "string",
      ) ?? []
  );
}
