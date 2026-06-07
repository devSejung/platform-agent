export const EMPLOYEE_CHAT_ATTACHMENTS_BASE_PATH = "/employee/api/chat-attachments";
export const EMPLOYEE_CHAT_ATTACHMENTS_UPLOAD_PATH = `${EMPLOYEE_CHAT_ATTACHMENTS_BASE_PATH}/upload`;
export const EMPLOYEE_CHAT_ATTACHMENTS_DELETE_PATH = `${EMPLOYEE_CHAT_ATTACHMENTS_BASE_PATH}/delete`;

export type EmployeeChatAttachmentPromptMode = "image" | "inline" | "workspace";

export type EmployeeChatAttachmentUploadRecord = {
  type: "image" | "file";
  originalFileName: string;
  storedFileName: string;
  workspacePath: string;
  mimeType: string;
  sizeBytes: number;
  promptMode: EmployeeChatAttachmentPromptMode;
  inlineContent: string | null;
  inlineTruncated: boolean;
};

export type EmployeeChatAttachmentUploadResponse = {
  attachment: EmployeeChatAttachmentUploadRecord;
};
