import { describe, expect, it } from "vitest";
import { resolveAgentRunContext } from "./run-context.js";

describe("resolveAgentRunContext", () => {
  it("carries senderId from ingress opts into the run context", () => {
    expect(
      resolveAgentRunContext({
        message: "hello",
        senderIsOwner: false,
        allowModelOverride: false,
        senderId: "hyeonho.jung",
      }),
    ).toMatchObject({
      senderId: "hyeonho.jung",
    });
  });

  it("prefers an explicit runContext senderId when both are present", () => {
    expect(
      resolveAgentRunContext({
        message: "hello",
        senderIsOwner: false,
        allowModelOverride: false,
        senderId: "ignored.user",
        runContext: {
          senderId: "seungon.jung",
        },
      }),
    ).toMatchObject({
      senderId: "seungon.jung",
    });
  });
});
