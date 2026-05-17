export type KnoxAccountConfig = {
  name?: string;
  enabled?: boolean;
  adapterOutboundUrl?: string;
  adapterAuthToken?: string;
  sendTimeoutMs?: number;
  allowFrom?: Array<string | number>;
  defaultTo?: string;
};

export type KnoxConfig = KnoxAccountConfig & {
  accounts?: Record<string, Partial<KnoxAccountConfig>>;
  defaultAccount?: string;
};

export type CoreConfig = {
  channels?: {
    knox?: KnoxConfig;
  };
};

export type ResolvedKnoxAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name?: string;
  adapterOutboundUrl: string;
  adapterAuthToken?: string;
  sendTimeoutMs: number;
  config: KnoxAccountConfig;
};

export type KnoxSendResult = {
  ok: boolean;
  messageId?: string | null;
  chatId?: string | null;
  error?: string | null;
  meta?: Record<string, unknown>;
};
