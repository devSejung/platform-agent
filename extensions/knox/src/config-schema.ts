import {
  AllowFromListSchema,
  buildCatchallMultiAccountChannelSchema,
  buildChannelConfigSchema,
} from "openclaw/plugin-sdk/channel-config-schema";
import { z } from "openclaw/plugin-sdk/zod";

const KnoxAccountConfigSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  adapterOutboundUrl: z.string().url().optional(),
  adapterAuthToken: z.string().optional(),
  fileLinksBaseUrl: z.string().url().optional(),
  sendTimeoutMs: z.number().int().min(100).max(120_000).optional(),
  allowFrom: AllowFromListSchema,
  defaultTo: z.string().optional(),
});

export const KnoxConfigSchema = buildCatchallMultiAccountChannelSchema(KnoxAccountConfigSchema);

export const knoxPluginConfigSchema = buildChannelConfigSchema(KnoxConfigSchema, {
  uiHints: {
    adapterOutboundUrl: {
      label: "Adapter outbound URL",
      help: "Internal Knox adapter endpoint, for example http://knox-adapter:3010/api/v1/platformclaw/knox/outbound/core-send.",
    },
    adapterAuthToken: {
      label: "Adapter auth token",
      help: "Optional bearer token required by the Knox adapter core outbound endpoint.",
      sensitive: true,
    },
    fileLinksBaseUrl: {
      label: "File links base URL",
      help: "Public base URL used to build Knox download links, for example https://openclaw.company.example.",
    },
    defaultTo: {
      label: "Default target",
      help: "Optional Knox target such as dm:<chatroomId> or room:<chatroomId>.",
    },
  },
});
