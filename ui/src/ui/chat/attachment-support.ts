export const CHAT_ATTACHMENT_ACCEPT = "*/*";

export function isSupportedChatAttachmentMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" ? true : true;
}
