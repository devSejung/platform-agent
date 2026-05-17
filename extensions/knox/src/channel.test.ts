import { describe, expect, it } from "vitest";
import { resolveKnoxAccount } from "./accounts.js";
import { knoxChannelPlugin } from "./channel.js";
import { normalizeKnoxTarget, parseKnoxTarget } from "./target.js";
import type { CoreConfig } from "./types.js";

describe("knox channel", () => {
  it("normalizes direct and room targets", () => {
    expect(normalizeKnoxTarget("knox:room:R123")).toBe("room:R123");
    expect(parseKnoxTarget("dm:eon")).toEqual({
      kind: "direct",
      id: "eon",
      target: "dm:eon",
    });
    expect(parseKnoxTarget("room:ROOM1")).toEqual({
      kind: "room",
      id: "ROOM1",
      target: "room:ROOM1",
    });
    expect(parseKnoxTarget("ROOM2")).toEqual({
      kind: "room",
      id: "ROOM2",
      target: "room:ROOM2",
    });
  });

  it("resolves account configuration from channels.knox", () => {
    const cfg: CoreConfig = {
      channels: {
        knox: {
          adapterOutboundUrl: "http://127.0.0.1:3010/api/v1/platformclaw/knox/outbound/core-send",
          adapterAuthToken: "secret",
          defaultTo: "dm:eon",
        },
      },
    };

    const account = resolveKnoxAccount({ cfg });

    expect(account.enabled).toBe(true);
    expect(account.configured).toBe(true);
    expect(account.adapterAuthToken).toBe("secret");
    expect(account.config.defaultTo).toBe("dm:eon");
  });

  it("builds channel-scoped session routes", async () => {
    const route = await knoxChannelPlugin.messaging!.resolveOutboundSessionRoute!({
      cfg: {} as never,
      agentId: "eon",
      accountId: "default",
      target: "room:ROOM1",
      threadId: "THREAD1",
    });

    if (!route) {
      throw new Error("expected route");
    }
    expect(route.sessionKey).toContain("agent:eon:");
    expect(route.to).toBe("room:ROOM1");
    expect(route.threadId).toBe("THREAD1");
    expect(route.chatType).toBe("group");
  });
});
