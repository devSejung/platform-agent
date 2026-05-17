import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import { isRecord } from "../utils.js";

function extractManualSessionSendText(message: string): string | null {
  const compact = message.trim();
  if (!/\bsessions_send\b/i.test(compact)) {
    return null;
  }

  const exactTextMatch = compact.match(
    /\bsend\s+exactly\s+this\s+text\s+to\s+sessionKey\s+\S+\s*:\s*([\s\S]*?)(?:\s+No\s+extra\s+text\.?\s*)?$/i,
  );
  const extracted = exactTextMatch?.[1]?.trim();
  if (extracted) {
    return extracted;
  }

  return null;
}

function removeManualSessionSendInstruction(message: string) {
  const extracted = extractManualSessionSendText(message);
  if (extracted) {
    return extracted;
  }
  return [
    "Complete the scheduled task and return the result as plain text.",
    "Do not call sessions_send or other messaging tools; cron delivery will route the result.",
    "",
    "Original request:",
    message.trim(),
  ].join("\n");
}

export function coerceUnsafeCronOriginDeliveryJob(job: Record<string, unknown>) {
  const payload = isRecord(job.payload) ? job.payload : null;
  if (payload?.kind !== "agentTurn" || typeof payload.message !== "string") {
    return;
  }

  const delivery = isRecord(job.delivery) ? job.delivery : null;
  const mode = normalizeLowercaseStringOrEmpty(
    typeof delivery?.mode === "string" ? delivery.mode : "",
  );
  const channel = normalizeLowercaseStringOrEmpty(
    typeof delivery?.channel === "string" ? delivery.channel : "",
  );
  const to = typeof delivery?.to === "string" ? delivery.to.trim() : "";
  const sessionKey = typeof job.sessionKey === "string" ? job.sessionKey.trim() : "";

  if (sessionKey && (mode === "" || mode === "announce") && channel === "last" && !to) {
    job.delivery = { mode: "origin" };
  }

  if (!/\bsessions_send\b/i.test(payload.message)) {
    return;
  }

  payload.message = removeManualSessionSendInstruction(payload.message);
  if (sessionKey && (mode === "" || mode === "none")) {
    job.delivery = { mode: "origin" };
  }
}
