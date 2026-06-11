export type ChatAttachment = {
  id: string;
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "image" | "inline" | "workspace" | "failed";
  progress: number;
  workspacePath?: string;
  storedFileName?: string;
  inlineContent?: string | null;
  inlineTruncated?: boolean;
  error?: string | null;
  previewUrl?: string | null;
  file?: File;
};

export type ChatFailureCode =
  | "timeout"
  | "rate_limit"
  | "overloaded"
  | "auth"
  | "auth_permanent"
  | "billing"
  | "format"
  | "model_not_found"
  | "session_expired"
  | "network"
  | "unknown";

export type ChatSendFailure = {
  runId: string;
  message: string;
  attachments: ChatAttachment[];
  code: ChatFailureCode;
  title: string;
  detail: string;
  retryable: boolean;
  phase: "submit" | "run";
  retrying: boolean;
};

export type ChatSendDraft = {
  message: string;
  attachments: ChatAttachment[];
};

export type ChatQueueItem = {
  id: string;
  text: string;
  createdAt: number;
  attachments?: ChatAttachment[];
  refreshSessions?: boolean;
  localCommandArgs?: string;
  localCommandName?: string;
  pendingRunId?: string;
};

export const CRON_CHANNEL_LAST = "last";

export type CronFormState = {
  name: string;
  description: string;
  agentId: string;
  sessionKey: string;
  clearAgent: boolean;
  enabled: boolean;
  deleteAfterRun: boolean;
  scheduleKind: "at" | "every" | "cron";
  scheduleAt: string;
  everyAmount: string;
  everyUnit: "minutes" | "hours" | "days";
  cronExpr: string;
  cronTz: string;
  scheduleExact: boolean;
  staggerAmount: string;
  staggerUnit: "seconds" | "minutes";
  sessionTarget: "main" | "isolated" | "current" | `session:${string}`;
  wakeMode: "next-heartbeat" | "now";
  payloadKind: "systemEvent" | "agentTurn";
  payloadText: string;
  payloadModel: string;
  payloadThinking: string;
  payloadLightContext: boolean;
  deliveryMode: "none" | "announce" | "webhook";
  deliveryChannel: string;
  deliveryTo: string;
  deliveryAccountId: string;
  deliveryBestEffort: boolean;
  failureAlertMode: "inherit" | "disabled" | "custom";
  failureAlertAfter: string;
  failureAlertCooldownSeconds: string;
  failureAlertChannel: string;
  failureAlertTo: string;
  failureAlertDeliveryMode: "announce" | "webhook";
  failureAlertAccountId: string;
  timeoutSeconds: string;
};
