import {
  buildChannelOutboundSessionRoute,
  createChatChannelPlugin,
} from "openclaw/plugin-sdk/channel-core";
import { getChatChannelMeta } from "openclaw/plugin-sdk/channel-plugin-common";
import { createRawChannelSendResultAdapter } from "openclaw/plugin-sdk/channel-send-result";
import { resolvePayloadMediaUrls } from "openclaw/plugin-sdk/reply-payload";
import {
  DEFAULT_ACCOUNT_ID,
  listKnoxAccountIds,
  resolveDefaultKnoxAccountId,
  resolveKnoxAccount,
} from "./accounts.js";
import { knoxPluginConfigSchema } from "./config-schema.js";
import { buildKnoxFileLinksText } from "./file-links.js";
import { sendKnoxText } from "./outbound.js";
import { normalizeKnoxTarget, parseKnoxTarget } from "./target.js";
import type { CoreConfig, ResolvedKnoxAccount } from "./types.js";

const CHANNEL_ID = "knox" as const;
const meta = { ...getChatChannelMeta(CHANNEL_ID) };

const knoxRawSendResultAdapter = createRawChannelSendResultAdapter({
  channel: CHANNEL_ID,
  sendText: async ({ cfg, to, text, accountId, threadId }) =>
    await sendKnoxText({
      cfg: cfg as CoreConfig,
      accountId,
      to,
      text,
      threadId,
    }),
});

function toKnoxDeliveryResult(result: Awaited<ReturnType<typeof sendKnoxText>>) {
  return {
    channel: CHANNEL_ID,
    messageId: result.messageId ?? "",
    chatId: result.chatId ?? undefined,
    ...(result.meta ? { meta: result.meta } : {}),
  };
}

export const knoxChannelPlugin = createChatChannelPlugin<ResolvedKnoxAccount>({
  base: {
    id: CHANNEL_ID,
    meta,
    capabilities: {
      chatTypes: ["direct", "group"],
      media: false,
      reactions: false,
      threads: true,
      polls: false,
      nativeCommands: false,
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.knox"] },
    configSchema: knoxPluginConfigSchema,
    setup: {
      applyAccountConfig: ({ cfg }) => cfg,
    },
    config: {
      listAccountIds: (cfg) => listKnoxAccountIds(cfg as CoreConfig),
      resolveAccount: (cfg, accountId) => resolveKnoxAccount({ cfg: cfg as CoreConfig, accountId }),
      defaultAccountId: (cfg) => resolveDefaultKnoxAccountId(cfg as CoreConfig),
      isEnabled: (account) => account.enabled,
      isConfigured: (account) => account.configured,
      disabledReason: () => "Knox channel account is disabled.",
      unconfiguredReason: () => "Set channels.knox.adapterOutboundUrl.",
      resolveAllowFrom: ({ cfg, accountId }) =>
        resolveKnoxAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom,
      resolveDefaultTo: ({ cfg, accountId }) =>
        resolveKnoxAccount({ cfg: cfg as CoreConfig, accountId }).config.defaultTo,
      describeAccount: (account) => ({
        accountId: account.accountId,
        label: account.name ?? account.accountId,
        enabled: account.enabled,
        configured: account.configured,
        detail: account.adapterOutboundUrl || "adapter outbound URL not configured",
      }),
    },
    messaging: {
      normalizeTarget: normalizeKnoxTarget,
      parseExplicitTarget: ({ raw }) => {
        const parsed = parseKnoxTarget(raw);
        return {
          to: parsed.target,
          chatType: parsed.kind === "direct" ? "direct" : "group",
        };
      },
      inferTargetChatType: ({ to }) => (parseKnoxTarget(to).kind === "direct" ? "direct" : "group"),
      targetResolver: {
        looksLikeId: (raw) => Boolean(normalizeKnoxTarget(raw)),
        hint: "<dm:user|room:chatroom>",
      },
      resolveOutboundSessionRoute: ({ cfg, agentId, accountId, target, threadId }) => {
        const parsed = parseKnoxTarget(target);
        return buildChannelOutboundSessionRoute({
          cfg,
          agentId,
          channel: CHANNEL_ID,
          accountId: accountId ?? DEFAULT_ACCOUNT_ID,
          peer: {
            kind: parsed.kind === "direct" ? "direct" : "group",
            id: parsed.target,
          },
          chatType: parsed.kind === "direct" ? "direct" : "group",
          from: `knox:${accountId ?? DEFAULT_ACCOUNT_ID}`,
          to: parsed.target,
          ...(threadId !== undefined && threadId !== null ? { threadId } : {}),
        });
      },
    },
  },
  outbound: {
    base: {
      deliveryMode: "direct",
      chunker: null,
      textChunkLimit: 1800,
    },
    attachedResults: {
      channel: CHANNEL_ID,
      sendText: async (ctx) => await knoxRawSendResultAdapter.sendText!(ctx),
      sendPayload: async (ctx) => {
        const mediaUrls = resolvePayloadMediaUrls(ctx.payload);
        const account = resolveKnoxAccount({
          cfg: ctx.cfg as CoreConfig,
          accountId: ctx.accountId,
        });
        const text =
          mediaUrls.length > 0
            ? await buildKnoxFileLinksText({
                cfg: ctx.cfg as CoreConfig,
                mediaUrls,
                text: ctx.payload.text ?? "",
                baseUrl: account.config.fileLinksBaseUrl,
                mediaAccess:
                  ctx.mediaLocalRoots || ctx.mediaReadFile
                    ? {
                        ...(ctx.mediaLocalRoots?.length ? { localRoots: ctx.mediaLocalRoots } : {}),
                        ...(ctx.mediaReadFile ? { readFile: ctx.mediaReadFile } : {}),
                      }
                    : undefined,
              })
            : ctx.payload.text ?? "";
        return toKnoxDeliveryResult(
          await sendKnoxText({
            cfg: ctx.cfg as CoreConfig,
            accountId: ctx.accountId,
            to: ctx.to,
            text,
            threadId: ctx.threadId,
          }),
        );
      },
    },
  },
});
