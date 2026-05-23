import { afterEach, describe, expect, it, vi } from "vitest";
import { sendKnoxText } from "./outbound.js";
import type { CoreConfig } from "./types.js";

const cfg: CoreConfig = {
  channels: {
    knox: {
      adapterOutboundUrl: "http://127.0.0.1:8081/api/v1/platformclaw/knox/outbound/core-send",
      adapterAuthToken: "secret",
      sendTimeoutMs: 2_000,
    },
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("knox outbound", () => {
  it("throws when the adapter returns unauthorized", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: "unauthorized" }),
      })),
    );

    await expect(
      sendKnoxText({
        cfg,
        to: "dm:eon",
        text: "hello",
      }),
    ).rejects.toThrow(/unauthorized/i);
  });

  it("returns delivery metadata on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            messageId: "msg_123",
            chatroomId: "dm_eon",
            chatMsgId: "knox-out-123",
            delivered: true,
          }),
      })),
    );

    await expect(
      sendKnoxText({
        cfg,
        to: "dm:eon",
        text: "hello",
      }),
    ).resolves.toEqual({
      ok: true,
      messageId: "msg_123",
      chatId: "dm_eon",
      meta: {
        chatMsgId: "knox-out-123",
        delivered: true,
      },
    });
  });
});
