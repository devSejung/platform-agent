import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resolveVisibleModelCatalog } from "./model-catalog-visibility.js";
import type { ModelCatalogEntry } from "./model-catalog.js";

const catalog: ModelCatalogEntry[] = [
  { provider: "openai", id: "gpt-5.4", name: "GPT 5.4" },
  { provider: "openai", id: "gpt-5.4-mini", name: "GPT 5.4 Mini" },
  { provider: "amazon-bedrock", id: "anthropic.claude-opus-4-1", name: "Opus 4.1" },
  { provider: "amazon-bedrock", id: "anthropic.claude-sonnet-4-5", name: "Sonnet 4.5" },
  { provider: "deepseek", id: "deepseek-chat", name: "DeepSeek Chat" },
];

describe("resolveVisibleModelCatalog", () => {
  it("shows configured defaults and fallbacks without exposing the full runtime catalog", () => {
    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.4",
            fallbacks: ["amazon-bedrock/anthropic.claude-sonnet-4-5"],
          },
        },
      },
    } as OpenClawConfig;

    expect(
      resolveVisibleModelCatalog({
        cfg,
        catalog,
        defaultProvider: "openai",
        defaultModel: "openai/gpt-5.4",
      }),
    ).toEqual([
      { provider: "amazon-bedrock", id: "anthropic.claude-sonnet-4-5", name: "Sonnet 4.5" },
      { provider: "openai", id: "gpt-5.4", name: "GPT 5.4" },
    ]);
  });

  it("honors provider wildcard visibility explicitly", () => {
    const cfg = {
      agents: {
        defaults: {
          model: { primary: "openai/gpt-5.4" },
          models: {
            "amazon-bedrock/*": {},
          },
        },
      },
    } as OpenClawConfig;

    expect(
      resolveVisibleModelCatalog({
        cfg,
        catalog,
        defaultProvider: "openai",
        defaultModel: "openai/gpt-5.4",
      }).map((entry) => `${entry.provider}/${entry.id}`),
    ).toEqual([
      "amazon-bedrock/anthropic.claude-opus-4-1",
      "amazon-bedrock/anthropic.claude-sonnet-4-5",
      "openai/gpt-5.4",
    ]);
  });
});
