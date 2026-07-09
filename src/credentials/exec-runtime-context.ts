import type { CredentialRuntimeContext } from "./runtime-credential-resolver.js";

type ExecCredentialRuntimeContextInput = {
  runId: string;
  agentId?: string | null;
  sessionKey?: string | null;
  messageProvider?: string | null;
  currentChannelId?: string | null;
  accountId?: string | null;
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
  const accountId = normalize(input.accountId);
  const runId = normalize(input.runId);
  if (
    !accountId ||
    !runId ||
    isGroupLikeSessionKey(normalize(input.sessionKey)) ||
    isGroupLikeSessionKey(normalize(input.currentChannelId))
  ) {
    return null;
  }
  return {
    runId,
    skillId: normalize(input.agentId) ?? "exec",
    effectiveOwnerType: "account",
    effectiveOwnerId: accountId,
    actorAccountId: accountId,
    sessionId: normalize(input.sessionKey),
    roomId: normalize(input.currentChannelId),
    channel: normalize(input.messageProvider),
  };
}
