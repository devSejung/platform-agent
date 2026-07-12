import type { CredentialRuntimeContext } from "./runtime-credential-resolver.js";

type ExecCredentialRuntimeContextInput = {
  runId: string;
  agentId?: string | null;
  sessionKey?: string | null;
  messageProvider?: string | null;
  currentChannelId?: string | null;
  accountId?: string | null;
};

export type ExecCredentialRuntimeContextSkippedReason =
  | "missing_account"
  | "missing_run"
  | "group_session"
  | "group_channel";

export type ExecCredentialRuntimeContextResult =
  | {
      ok: true;
      context: CredentialRuntimeContext;
    }
  | {
      ok: false;
      reason: ExecCredentialRuntimeContextSkippedReason;
    };

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function isGroupLikeSessionKey(sessionKey: string | null): boolean {
  if (!sessionKey) {
    return false;
  }
  return /:(?:channel|room|group):/i.test(sessionKey) || /^group-/i.test(sessionKey);
}

export function buildExecCredentialRuntimeContext(
  input: ExecCredentialRuntimeContextInput,
): CredentialRuntimeContext | null {
  const result = resolveExecCredentialRuntimeContext(input);
  return result.ok ? result.context : null;
}

export function resolveExecCredentialRuntimeContext(
  input: ExecCredentialRuntimeContextInput,
): ExecCredentialRuntimeContextResult {
  const accountId = normalize(input.accountId);
  const runId = normalize(input.runId);
  const sessionKey = normalize(input.sessionKey);
  const currentChannelId = normalize(input.currentChannelId);
  if (!accountId) {
    return { ok: false, reason: "missing_account" };
  }
  if (!runId) {
    return { ok: false, reason: "missing_run" };
  }
  if (isGroupLikeSessionKey(sessionKey)) {
    return { ok: false, reason: "group_session" };
  }
  if (isGroupLikeSessionKey(currentChannelId)) {
    return { ok: false, reason: "group_channel" };
  }
  return {
    ok: true,
    context: {
      runId,
      skillId: normalize(input.agentId) ?? "exec",
      effectiveOwnerType: "account",
      effectiveOwnerId: accountId,
      actorAccountId: accountId,
      sessionId: sessionKey,
      roomId: currentChannelId,
      channel: normalize(input.messageProvider),
    },
  };
}
