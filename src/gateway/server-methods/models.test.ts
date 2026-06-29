import { describe, expect, it, vi } from "vitest";
import { modelsHandlers } from "./models.js";
import type { GatewayClient, GatewayRequestContext } from "./types.js";

const mocks = vi.hoisted(() => ({
  loadConfigReturn: {} as Record<string, unknown>,
}));

vi.mock("../../config/config.js", async () => {
  const actual =
    await vi.importActual<typeof import("../../config/config.js")>("../../config/config.js");
  return {
    ...actual,
    loadConfig: () => mocks.loadConfigReturn,
  };
});

describe("models.list handler", () => {
  it("returns employee-visible models instead of the full runtime catalog", async () => {
    mocks.loadConfigReturn = {
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.4",
            fallbacks: ["amazon-bedrock/anthropic.claude-sonnet-4-5"],
          },
        },
      },
    };
    const respond = vi.fn();
    const client = {
      internal: {
        employee: {
          kind: "session",
          employeeId: "eon",
          agentId: "eon",
          token: "token",
        },
      },
    } as unknown as GatewayClient;
    await modelsHandlers["models.list"]({
      req: { type: "req", id: "req-1", method: "models.list" },
      params: {},
      respond,
      client,
      context: {
        loadGatewayModelCatalog: async () => [
          { provider: "openai", id: "gpt-5.4", name: "GPT 5.4" },
          { provider: "amazon-bedrock", id: "anthropic.claude-opus-4-1", name: "Opus 4.1" },
          {
            provider: "amazon-bedrock",
            id: "anthropic.claude-sonnet-4-5",
            name: "Sonnet 4.5",
          },
        ],
      } as unknown as GatewayRequestContext,
      isWebchatConnect: () => false,
    });

    expect(respond).toHaveBeenCalledWith(
      true,
      {
        models: [
          {
            provider: "amazon-bedrock",
            id: "anthropic.claude-sonnet-4-5",
            name: "Sonnet 4.5",
          },
          { provider: "openai", id: "gpt-5.4", name: "GPT 5.4" },
        ],
      },
      undefined,
    );
  });
});
