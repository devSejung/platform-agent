import { resolveKnoxAccount } from "./accounts.js";
import type { CoreConfig, KnoxSendResult } from "./types.js";

type SendKnoxTextParams = {
  cfg: CoreConfig;
  accountId?: string | null;
  to: string;
  text: string;
  threadId?: string | number | null;
};

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function sendKnoxText(params: SendKnoxTextParams): Promise<KnoxSendResult> {
  const account = resolveKnoxAccount({ cfg: params.cfg, accountId: params.accountId });
  if (!account.enabled) {
    throw new Error("Knox channel account is disabled.");
  }
  if (!account.adapterOutboundUrl) {
    throw new Error("Knox channel requires channels.knox.adapterOutboundUrl.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), account.sendTimeoutMs);
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (account.adapterAuthToken) {
      headers.authorization = `Bearer ${account.adapterAuthToken}`;
    }
    const response = await fetch(account.adapterOutboundUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        accountId: account.accountId,
        to: params.to,
        threadId: params.threadId ?? null,
        text: params.text,
        status: "final",
        final: true,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed: unknown = undefined;
    try {
      parsed = raw ? JSON.parse(raw) : undefined;
    } catch {}
    if (!response.ok) {
      const error =
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as { message?: unknown }).message === "string"
          ? (parsed as { message: string }).message
          : raw || `Knox adapter outbound failed with status ${response.status}`;
      throw new Error(error);
    }
    const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    return {
      ok: true,
      messageId: typeof record.messageId === "string" ? record.messageId : undefined,
      chatId: typeof record.chatroomId === "string" ? record.chatroomId : undefined,
      meta: {
        ...(typeof record.chatMsgId === "string" ? { chatMsgId: record.chatMsgId } : {}),
        ...(record.delivered !== undefined ? { delivered: record.delivered } : {}),
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: "Knox adapter outbound timed out." };
    }
    return { ok: false, error: asErrorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}
