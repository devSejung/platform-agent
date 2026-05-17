import { createAccountListHelpers } from "openclaw/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk/account-id";
import { resolveMergedAccountConfig } from "openclaw/plugin-sdk/account-resolution";
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import type { CoreConfig, KnoxAccountConfig, ResolvedKnoxAccount } from "./types.js";

const DEFAULT_SEND_TIMEOUT_MS = 10_000;

const { listAccountIds: listKnoxAccountIds, resolveDefaultAccountId: resolveDefaultKnoxAccountId } =
  createAccountListHelpers("knox", { normalizeAccountId });

export { listKnoxAccountIds, resolveDefaultKnoxAccountId };

function resolveMergedKnoxAccountConfig(cfg: CoreConfig, accountId: string): KnoxAccountConfig {
  return resolveMergedAccountConfig<KnoxAccountConfig>({
    channelConfig: cfg.channels?.knox as KnoxAccountConfig | undefined,
    accounts: cfg.channels?.knox?.accounts,
    accountId,
    omitKeys: ["defaultAccount"],
    normalizeAccountId,
  });
}

export function resolveKnoxAccount(params: {
  cfg: CoreConfig;
  accountId?: string | null;
}): ResolvedKnoxAccount {
  const accountId = normalizeAccountId(params.accountId);
  const merged = resolveMergedKnoxAccountConfig(params.cfg, accountId);
  const baseEnabled = params.cfg.channels?.knox?.enabled !== false;
  const enabled = baseEnabled && merged.enabled !== false;
  const adapterOutboundUrl = merged.adapterOutboundUrl?.trim() ?? "";
  return {
    accountId,
    enabled,
    configured: Boolean(adapterOutboundUrl),
    name: normalizeOptionalString(merged.name),
    adapterOutboundUrl,
    adapterAuthToken: normalizeOptionalString(merged.adapterAuthToken),
    sendTimeoutMs: merged.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS,
    config: {
      ...merged,
      allowFrom: merged.allowFrom ?? ["*"],
    },
  };
}

export function listEnabledKnoxAccounts(cfg: CoreConfig): ResolvedKnoxAccount[] {
  return listKnoxAccountIds(cfg)
    .map((accountId) => resolveKnoxAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}

export { DEFAULT_ACCOUNT_ID };
