import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "knox",
  name: "Knox",
  description: "PlatformClaw Knox Messenger bridge channel",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./api.js",
    exportName: "knoxChannelPlugin",
  },
});
